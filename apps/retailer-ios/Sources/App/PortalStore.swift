import SwiftUI
import UIKit

/// A .notice banner. `markdown` uses **bold** where the HTML uses <strong>.
struct Banner: Equatable {
    var markdown: String
    var good = false
}

enum AuthTab: String, CaseIterable, Identifiable {
    case signin, apply, browse
    var id: String { rawValue }
    var title: String {
        switch self {
        case .signin: return "Sign In"
        case .apply: return "Apply for Access"
        case .browse: return "Browse Products"
        }
    }
}

enum PortalView: String, CaseIterable, Identifiable {
    case home, dashboard, order, stock, profile, help
    var id: String { rawValue }
    var title: String {
        switch self {
        case .home: return "Home"
        case .dashboard: return "My Orders"
        case .order: return "Place New Order"
        case .stock: return "My Stock"
        case .profile: return "Profile"
        case .help: return "Help & Support"
        }
    }
}

enum PayMethod: String, CaseIterable, Identifiable {
    case stripe, zelle, cash
    var id: String { rawValue }
}

struct SafariTarget: Identifiable, Equatable {
    let id = UUID()
    let url: URL
}

/// All portal state and every API flow from retailer.html, in one place.
@MainActor
final class PortalStore: ObservableObject {
    enum Phase { case launching, auth, portal }

    let api = APIClient()

    @Published var phase: Phase = .launching
    @Published var account: Account?
    @Published var authTab: AuthTab = .signin
    @Published var authError: String?

    @Published var view: PortalView = .home
    /// Raised from the top-bar Account menu; ProfileView opens the delete confirmation.
    @Published var requestDeleteAccount = false
    @Published var statusBanner: Banner?

    @Published var orders: [Order] = []
    @Published var ordersLoaded = false
    @Published var ordersError: String?

    @Published var catalog: [CatalogItem] = []
    @Published var catalogLoaded = false
    @Published var catalogError: String?
    @Published var quantities: [String: Int] = [:]

    @Published var stock: [StockRow] = []
    @Published var movements: [StockMovement] = []
    @Published var stockLoaded = false
    @Published var stockError: String?

    @Published var homeError: String?

    @Published var publicCatalog: [PublicCatalogItem] = []
    @Published var publicCatalogLoaded = false
    @Published var publicCatalogError: String?
    private var publicCatalogRequested = false

    /// Order currently shown in the Pay chooser sheet.
    @Published var payOrder: Order?
    /// Stripe Checkout page shown in SFSafariViewController.
    @Published var safari: SafariTarget?
    private var pendingCheckoutSessionId: String?

    private var token: String?

    // MARK: - Session lifecycle

    func bootstrap() async {
        #if DEBUG
        if MockServer.isEnabled {
            Keychain.saveToken(MockServer.token)
            if let t = MockServer.argument("-RFHAuthTab"), let tab = AuthTab(rawValue: t) {
                Keychain.deleteToken()
                phase = .auth
                selectAuthTab(tab)
                return
            }
        } else {
            // Never send a canned mock token to the live API.
            if Keychain.loadToken() == MockServer.token { Keychain.deleteToken() }
            if let t = MockServer.argument("-RFHAuthTab"), let tab = AuthTab(rawValue: t) {
                phase = .auth
                selectAuthTab(tab)
                return
            }
        }
        #endif
        guard let saved = Keychain.loadToken() else { phase = .auth; return }
        token = saved
        do {
            let me: MeResponse = try await api.post(.auth, ["action": "me", "token": saved])
            enterPortal(me.account)
        } catch {
            // Same as the web init: any failure clears the stored session.
            clearSession()
            phase = .auth
        }
    }

    private func clearSession() {
        token = nil
        Keychain.deleteToken()
    }

    /// backToAuth(message) from the HTML.
    func backToAuth(_ message: String? = nil) {
        clearSession()
        account = nil
        orders = []; ordersLoaded = false
        catalog = []; catalogLoaded = false; quantities = [:]
        stock = []; movements = []; stockLoaded = false
        statusBanner = nil
        payOrder = nil
        safari = nil
        view = .home
        authError = message
        phase = .auth
    }

    func selectAuthTab(_ tab: AuthTab) {
        authTab = tab
        authError = nil
        if tab == .browse && !publicCatalogRequested {
            publicCatalogRequested = true
            Task { await loadPublicCatalog() }
        }
    }

    func loadPublicCatalog() async {
        do {
            let r: PublicCatalogResponse = try await api.post(.portal, ["action": "public-catalog"],
                                                              defaultError: "Could not load products.")
            publicCatalog = r.items
            publicCatalogError = nil
        } catch {
            publicCatalogError = error.localizedDescription
        }
        publicCatalogLoaded = true
    }

    func login(email: String, password: String) async {
        authError = nil
        do {
            let r: AuthResponse = try await api.post(.auth, ["action": "login", "email": email, "password": password],
                                                     defaultError: "Login failed")
            startSession(r)
        } catch {
            authError = error.localizedDescription
        }
    }

    func signup(business: String, contact: String, email: String, phone: String, address: String, password: String) async {
        authError = nil
        do {
            let r: AuthResponse = try await api.post(.auth, [
                "action": "signup", "businessName": business, "contactName": contact, "email": email,
                "phone": phone, "address": address, "password": password,
            ], defaultError: "Signup failed")
            startSession(r)
        } catch {
            authError = error.localizedDescription
        }
    }

    private func startSession(_ r: AuthResponse) {
        token = r.token
        Keychain.saveToken(r.token)
        enterPortal(r.account)
    }

    func logout() async {
        if let token {
            _ = try? await api.post(.auth, ["action": "logout", "token": token], as: EmptyResponse.self)
        }
        backToAuth()
    }

    /// enterPortal(account) from the HTML, including the pending/suspended gates.
    func enterPortal(_ account: Account) {
        self.account = account
        authError = nil
        phase = .portal
        if account.account_status == "pending" {
            statusBanner = Banner(markdown: "Your application is **pending approval**. Our team reviews new retailer accounts quickly — you'll get an email at \(account.email) once you're approved and can start ordering.")
            view = .profile
            return
        }
        if account.account_status == "suspended" {
            statusBanner = Banner(markdown: "Your account is **suspended**. Contact [sales@rubyfoodhub.com](mailto:sales@rubyfoodhub.com) for help.")
            return
        }
        statusBanner = nil
        view = .home
        #if DEBUG
        if let v = MockServer.argument("-RFHView"), let pv = PortalView(rawValue: v) { view = pv }
        #endif
        Task {
            if view == .home { await loadHome() } else { await loadOrders() }
            await loadCatalog()
            if view == .stock { await loadStock() }
            #if DEBUG
            if MockServer.argument("-RFHSheet") == "pay", let o = orders.first(where: { $0.canPay }) { payOrder = o }
            #endif
        }
    }

    var isActive: Bool { account?.account_status == "active" }
    var isPending: Bool { account?.account_status == "pending" }

    func show(_ v: PortalView) {
        view = v
        Task {
            if v == .stock { await loadStock() }
            if v == .home { await loadHome() }
        }
    }

    // MARK: - API wrapper (401 → sign out with the message)

    private func call<T: Decodable>(_ body: [String: Any], as type: T.Type = T.self) async throws -> T {
        var b = body
        b["token"] = token ?? ""
        do {
            return try await api.post(.portal, b)
        } catch let APIError.unauthorized(message) {
            backToAuth(message)
            throw APIError.unauthorized(message)
        }
    }

    // MARK: - Orders

    func loadOrders() async {
        do {
            let r: OrdersResponse = try await call(["action": "orders"])
            orders = r.orders
            ordersError = nil
        } catch {
            ordersError = error.localizedDescription
        }
        ordersLoaded = true
    }

    /// Home: orders + stock (stock failure tolerated, as in the HTML).
    func loadHome() async {
        do {
            async let o: OrdersResponse = call(["action": "orders"])
            let s: StockResponse = (try? await call(["action": "stock"])) ?? StockResponse()
            orders = try await o.orders
            ordersLoaded = true
            stock = s.stock
            movements = s.movements
            homeError = nil
        } catch {
            homeError = error.localizedDescription
        }
    }

    /// Standing payment push shown at the top of every portal view.
    var dueBanner: (text: String, owed: [Order])? {
        let live = orders.filter { !$0.isCanceled }
        let owed = live.filter { $0.payment_status == "pending" }
        let awaiting = live.filter { $0.payment_status == "awaiting_confirmation" }
        let sum: ([Order]) -> Double = { $0.reduce(0) { $0 + $1.total } }
        if owed.isEmpty {
            guard !awaiting.isEmpty else { return nil }
            let plural = awaiting.count > 1
            return ("Your reported payment\(plural ? "s" : "") totaling **\(Fmt.money(sum(awaiting)))** \(plural ? "are" : "is") awaiting confirmation by our team.", [])
        }
        return ("**Payment due: \(Fmt.money(sum(owed)))** across \(owed.count) order\(owed.count > 1 ? "s" : ""). Pay by card now, or send Zelle / pay cash and report it.", owed)
    }

    // MARK: - Payment

    /// "Pay Online Now (Card via Stripe)" → pay-order → Stripe Checkout in Safari view.
    func payByCard(_ order: Order) async throws {
        let r: CheckoutResponse = try await call(["action": "pay-order", "orderId": order.id])
        guard let s = r.checkoutUrl, let url = URL(string: s) else { throw APIError.server("Could not start checkout.") }
        payOrder = nil
        openCheckout(url)
    }

    private func openCheckout(_ url: URL) {
        pendingCheckoutSessionId = Self.checkoutSessionId(from: url.absoluteString)
        // Let the pay sheet finish dismissing before presenting Safari.
        Task {
            try? await Task.sleep(nanoseconds: 450_000_000)
            safari = SafariTarget(url: url)
        }
    }

    /// Stripe Checkout URLs carry the session id (cs_test_… / cs_live_…) in the path.
    nonisolated static func checkoutSessionId(from url: String) -> String? {
        guard let r = url.range(of: #"cs_(test|live)_[A-Za-z0-9]+"#, options: .regularExpression) else { return nil }
        return String(url[r])
    }

    /// Equivalent of handleStripeReturn(): runs when the Safari view closes.
    func checkoutFinished() async {
        let sessionId = pendingCheckoutSessionId
        pendingCheckoutSessionId = nil
        if let sessionId {
            if let r: VerifyStripeResponse = try? await call(["action": "verify-stripe", "sessionId": sessionId]) {
                if r.paid {
                    statusBanner = Banner(markdown: "Payment received — order **\(r.orderNumber ?? "")** is confirmed as paid. Thank you!", good: true)
                } else {
                    statusBanner = Banner(markdown: "Payment was canceled — your order is saved as unpaid. You can pay later or contact us.")
                }
            }
        }
        await refreshAfterReturn()
    }

    func refreshAfterReturn() async {
        guard phase == .portal, isActive else { return }
        await loadOrders()
        if view == .home { await loadHome() }
        if view == .stock { await loadStock() }
    }

    func claimPayment(_ order: Order, method: String, reference: String) async throws {
        let _: EmptyResponse = try await call(["action": "claim-payment", "orderId": order.id, "method": method,
                                               "reference": reference.trimmingCharacters(in: .whitespacesAndNewlines)])
        payOrder = nil
        let label = method == "zelle" ? "Zelle" : "cash"
        statusBanner = Banner(markdown: "Thanks — your \(label) payment for **\(order.order_number)** has been reported. It will show as Awaiting Confirmation until our team verifies and confirms it.", good: true)
        await loadOrders()
        await loadHome()
    }

    // MARK: - New order

    func loadCatalog() async {
        do {
            let r: CatalogResponse = try await call(["action": "catalog"])
            catalog = r.catalog
            catalogError = nil
        } catch {
            catalogError = error.localizedDescription
        }
        catalogLoaded = true
    }

    var orderTotal: Double {
        catalog.reduce(0) { $0 + Double(quantities[$1.product_id] ?? 0) * $1.wholesale_price }
    }

    var orderItems: [[String: Any]] {
        catalog.compactMap { c in
            let q = quantities[c.product_id] ?? 0
            return q > 0 ? ["product_id": c.product_id, "quantity": q] : nil
        }
    }

    /// Returns nil on success, or the text for the order note.
    func placeOrder(method: PayMethod) async -> String? {
        let items = orderItems
        guard !items.isEmpty else { return "Enter a quantity for at least one product." }
        do {
            let r: PlaceOrderResponse = try await call(["action": "place-order", "items": items, "paymentMethod": method.rawValue])
            quantities = [:]
            if let s = r.checkoutUrl, let url = URL(string: s) {
                view = .dashboard
                openCheckout(url)
                return nil
            }
            await loadCatalog()
            await loadOrders()
            view = .dashboard
            let number = r.orderNumber ?? ""
            if method == .zelle {
                statusBanner = Banner(markdown: "Order **\(number)** submitted. Send your Zelle payment to **bankpay@rubyfoodhub.com** (Ruby Foodhub Inc), then report it so our team can confirm. It stays \"Payment Pending\" until confirmed.")
                if let o = r.order { payOrder = o }
            } else {
                statusBanner = Banner(markdown: "Order **\(number)** submitted — pay our team in cash on delivery. You can also pay online anytime from the Pay button on the order.", good: true)
            }
            return nil
        } catch {
            return "Error: " + error.localizedDescription
        }
    }

    // MARK: - Stock

    func loadStock() async {
        do {
            let r: StockResponse = try await call(["action": "stock"])
            stock = r.stock
            movements = r.movements
            stockError = nil
        } catch {
            stockError = error.localizedDescription
        }
        stockLoaded = true
    }

    func reportSold(productId: String, quantity: Int) async throws {
        let _: EmptyResponse = try await call(["action": "report-sold", "productId": productId, "quantity": quantity])
        await loadStock()
    }

    // MARK: - Profile

    func saveProfile(business: String, contact: String, phone: String, address: String) async -> String {
        do {
            let _: EmptyResponse = try await call(["action": "profile-update", "businessName": business,
                                                   "contactName": contact, "phone": phone, "address": address])
            if var a = account {
                a.business_name = business
                a.contact_name = contact
                a.phone = phone
                a.address = address
                account = a
            }
            return "Profile saved."
        } catch {
            return "Error: " + error.localizedDescription
        }
    }

    func uploadLogo(jpeg: Data) async -> String {
        do {
            let r: UploadLogoResponse = try await call(["action": "upload-logo", "imageBase64": jpeg.base64EncodedString(),
                                                        "contentType": "image/jpeg"])
            account?.logo_url = r.logoUrl
            return "Logo uploaded — looking sharp!"
        } catch {
            return "Upload failed: " + error.localizedDescription
        }
    }

    func deleteAccount() async throws -> Double {
        let r: DeleteAccountResponse = try await call(["action": "delete-account", "confirm": "DELETE"])
        return r.outstanding
    }

    // MARK: - Help

    func contactSupport(topic: String, orderNumber: String, subject: String, message: String) async throws {
        let _: EmptyResponse = try await call(["action": "contact-support", "topic": topic, "orderNumber": orderNumber,
                                               "subject": subject, "message": message])
    }
}
