import SwiftUI

/// #portal-view: banners, the pill nav and the six views.
struct PortalScreen: View {
    @EnvironmentObject var store: PortalStore

    var body: some View {
        VStack(spacing: 0) {
            TopBar(signedIn: true)
            ScrollViewReader { proxy in
                ScrollView {
                    PageColumn {
                        Color.clear.frame(height: 0).id("top")
                        if let b = store.statusBanner {
                            NoticeView(markdown: b.markdown, good: b.good)
                        }
                        if store.isActive {
                            DueBannerView()
                            PortalNav()
                            content
                        } else {
                            // Pending or suspended: profile + Privacy & Account (delete) stay reachable.
                            ProfileView()
                        }
                        LegalFooter()
                    }
                }
                .scrollDismissesKeyboard(.interactively)
                .refreshable { await store.refreshAfterReturn() }
                .onChange(of: store.view) { _, _ in
                    withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("top", anchor: .top) }
                }
                .onChange(of: store.statusBanner) { _, b in
                    if b != nil { withAnimation { proxy.scrollTo("top", anchor: .top) } }
                }
            }
        }
        .sheet(item: $store.payOrder) { order in
            PayChooserSheet(order: order)
                .environmentObject(store)
        }
    }

    @ViewBuilder private var content: some View {
        switch store.view {
        case .home: HomeView()
        case .dashboard: OrdersView()
        case .order: PlaceOrderView()
        case .stock: StockView()
        case .profile: ProfileView()
        case .help: HelpView()
        }
    }
}

/// .portal-nav — wrapping row of pill buttons.
struct PortalNav: View {
    @EnvironmentObject var store: PortalStore
    var body: some View {
        FlowLayout(spacing: 8, lineSpacing: 8) {
            ForEach(PortalView.allCases) { v in
                let active = store.view == v
                Button { store.show(v) } label: {
                    Text(v.title)
                        .font(.footnote.weight(.bold))
                        .padding(.vertical, 9).padding(.horizontal, 18)
                        .frame(minHeight: 40)
                        .foregroundStyle(active ? .white : Brand.ink(0.7))
                        .background(active ? Brand.primary : .white, in: Capsule())
                        .overlay(Capsule().strokeBorder(active ? Brand.primary : Brand.ink(0.18), lineWidth: 1.5))
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(active ? [.isSelected] : [])
            }
        }
        .padding(.vertical, 6)
    }
}

/// #due-banner — unpaid balance push with Pay Now.
struct DueBannerView: View {
    @EnvironmentObject var store: PortalStore
    var body: some View {
        if let due = store.dueBanner {
            if due.owed.isEmpty {
                NoticeView(markdown: due.text)
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 12) {
                        Text(NoticeView.attributed(due.text)).frame(maxWidth: .infinity, alignment: .leading)
                        payButton
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        Text(NoticeView.attributed(due.text)).fixedSize(horizontal: false, vertical: true)
                        payButton
                    }
                }
                .font(.subheadline)
                .foregroundStyle(Brand.amberFG)
                .padding(.vertical, 14).padding(.horizontal, 16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Brand.amberBG, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
        }
    }

    private var payButton: some View {
        Button("Pay Now") {
            guard let due = store.dueBanner else { return }
            if due.owed.count == 1 { store.payOrder = due.owed[0] } else { store.show(.dashboard) }
        }
        .buttonStyle(.pillSmall)
    }
}

// MARK: - Pills shared by Orders and Home

enum OrderPills {
    @ViewBuilder static func payment(_ o: Order) -> some View {
        if o.payment_status == "paid" { Pill("Paid (Stripe)", .green) }
        else if o.payment_status == "confirmed_by_admin" { Pill("Payment Confirmed", .green) }
        else if o.payment_status == "awaiting_confirmation" {
            Pill((o.claimed_payment_method == "zelle" ? "Zelle" : "Cash") + " Sent — Awaiting Confirmation", .blue)
        }
        else if o.isCanceled { Pill("No Charge", .gray) }
        else { Pill("Payment Pending", .amber) }
    }

    @ViewBuilder static func status(_ o: Order) -> some View {
        if o.isCanceled {
            CellVStack {
                Pill("Canceled", .gray)
                if let r = o.cancel_reason, !r.isEmpty {
                    Text("Reason: " + r)
                        .font(.caption)
                        .foregroundStyle(Brand.muted)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: 240)
                }
            }
        }
        else if o.order_status == "fulfilled" { Pill("Fulfilled", .green) }
        else if o.order_status == "confirmed" { Pill("Confirmed", .blue) }
        else { Pill("Pending", .amber) }
    }

    static func methodLabel(_ m: String?) -> String {
        guard let m else { return "" }
        return ["stripe": "Stripe", "pay_on_delivery": "Pay on delivery", "cash": "Cash", "zelle": "Zelle"][m] ?? m
    }
}

/// payNowButton(o): filled "Pay Now" once fulfilled, outline "Pay Online" before.
struct PayNowButton: View {
    @EnvironmentObject var store: PortalStore
    let order: Order
    var body: some View {
        if order.canPay {
            Button(order.payIsDue ? "Pay Now" : "Pay Online") { store.payOrder = order }
                .buttonStyle(PillButtonStyle(kind: order.payIsDue ? .filled : .outline, small: true))
                .accessibilityLabel((order.payIsDue ? "Pay Now" : "Pay Online") + ", order \(order.order_number)")
        }
    }
}
