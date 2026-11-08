import Foundation

// JSON shapes returned by api/retailer-auth.js and api/retailer-portal.js.
// Decoding is lenient (Supabase numeric columns may arrive as numbers or
// strings, ids may be uuids or integers) so a schema nuance never blanks a screen.

extension KeyedDecodingContainer {
    func flexString(_ key: Key) -> String? {
        if let s = try? decodeIfPresent(String.self, forKey: key) { return s }
        if let i = try? decodeIfPresent(Int.self, forKey: key) { return String(i) }
        if let d = try? decodeIfPresent(Double.self, forKey: key) { return String(d) }
        return nil
    }
    func flexDouble(_ key: Key) -> Double? {
        if let d = try? decodeIfPresent(Double.self, forKey: key) { return d }
        if let s = try? decodeIfPresent(String.self, forKey: key) { return Double(s) }
        return nil
    }
    func flexInt(_ key: Key) -> Int? {
        if let i = try? decodeIfPresent(Int.self, forKey: key) { return i }
        if let d = try? decodeIfPresent(Double.self, forKey: key) { return Int(d) }
        if let s = try? decodeIfPresent(String.self, forKey: key) { return Int(Double(s) ?? 0) }
        return nil
    }
}

struct Account: Codable, Equatable {
    var id: String
    var business_name: String
    var contact_name: String?
    var email: String
    var phone: String?
    var address: String?
    var account_status: String
    var logo_url: String?
    var created_at: String?

    enum CodingKeys: String, CodingKey {
        case id, business_name, contact_name, email, phone, address, account_status, logo_url, created_at
    }

    init(id: String, business_name: String, contact_name: String?, email: String, phone: String?, address: String?, account_status: String, logo_url: String?, created_at: String?) {
        self.id = id; self.business_name = business_name; self.contact_name = contact_name; self.email = email
        self.phone = phone; self.address = address; self.account_status = account_status; self.logo_url = logo_url; self.created_at = created_at
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.flexString(.id) ?? ""
        business_name = c.flexString(.business_name) ?? ""
        contact_name = c.flexString(.contact_name)
        email = c.flexString(.email) ?? ""
        phone = c.flexString(.phone)
        address = c.flexString(.address)
        account_status = c.flexString(.account_status) ?? "pending"
        logo_url = c.flexString(.logo_url)
        created_at = c.flexString(.created_at)
    }
}

struct AuthResponse: Decodable { let token: String; let account: Account }
struct MeResponse: Decodable { let account: Account }

struct PublicCatalogItem: Decodable, Equatable, Identifiable {
    var id: String { name }
    let name: String
    let sizes: [String]

    enum CodingKeys: String, CodingKey { case name, sizes }
    init(name: String, sizes: [String]) { self.name = name; self.sizes = sizes }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = c.flexString(.name) ?? ""
        sizes = (try? c.decodeIfPresent([String].self, forKey: .sizes)) ?? []
    }
}

struct PublicCatalogResponse: Decodable {
    let products: [String]?
    let catalog: [PublicCatalogItem]?

    /// Prefer the richer catalog (name + pack sizes); fall back to names only.
    var items: [PublicCatalogItem] {
        if let catalog, !catalog.isEmpty { return catalog }
        return (products ?? []).map { PublicCatalogItem(name: $0, sizes: []) }
    }
}

struct CatalogItem: Decodable, Identifiable, Equatable {
    var id: String { product_id }
    let product_id: String
    let name: String
    let variant: String
    let wholesale_price: Double

    enum CodingKeys: String, CodingKey { case product_id, name, variant, wholesale_price }
    init(product_id: String, name: String, variant: String, wholesale_price: Double) {
        self.product_id = product_id; self.name = name; self.variant = variant; self.wholesale_price = wholesale_price
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        product_id = c.flexString(.product_id) ?? ""
        name = c.flexString(.name) ?? ""
        variant = c.flexString(.variant) ?? ""
        wholesale_price = c.flexDouble(.wholesale_price) ?? 0
    }
}
struct CatalogResponse: Decodable { let catalog: [CatalogItem] }

struct OrderItem: Decodable, Equatable {
    let product: String
    let variant: String
    let quantity: Int
    let wholesale_price: Double?

    enum CodingKeys: String, CodingKey { case product, variant, quantity, wholesale_price }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        product = c.flexString(.product) ?? ""
        variant = c.flexString(.variant) ?? ""
        quantity = c.flexInt(.quantity) ?? 0
        wholesale_price = c.flexDouble(.wholesale_price)
    }
}

struct Order: Decodable, Identifiable, Equatable {
    let id: String
    let order_number: String
    let created_at: String?
    let items: [OrderItem]
    let total: Double
    let payment_method: String?
    let payment_status: String
    let order_status: String
    let claimed_payment_method: String?
    let cancel_reason: String?
    let production_batch: String?

    enum CodingKeys: String, CodingKey {
        case id, order_number, created_at, items, total, payment_method, payment_status, order_status
        case claimed_payment_method, cancel_reason, production_batch
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.flexString(.id) ?? UUID().uuidString
        order_number = c.flexString(.order_number) ?? ""
        created_at = c.flexString(.created_at)
        // items is a JSON array; anything else is treated as empty (as the web does).
        items = (try? c.decodeIfPresent([OrderItem].self, forKey: .items)) ?? []
        total = c.flexDouble(.total) ?? 0
        payment_method = c.flexString(.payment_method)
        payment_status = c.flexString(.payment_status) ?? "pending"
        order_status = c.flexString(.order_status) ?? "pending"
        claimed_payment_method = c.flexString(.claimed_payment_method)
        cancel_reason = c.flexString(.cancel_reason)
        production_batch = c.flexString(.production_batch)
    }

    var isCanceled: Bool { order_status == "canceled" }
    /// Unpaid, non-canceled orders can be paid online (payNowButton in the HTML).
    var canPay: Bool { !isCanceled && payment_status == "pending" }
    /// After fulfilment the payment is actually due: filled "Pay Now" vs outline "Pay Online".
    var payIsDue: Bool { order_status == "fulfilled" }
    var itemsSummary: String {
        items.map { "\($0.quantity)× \($0.product) — \($0.variant)" }.joined(separator: "; ")
    }
}
struct OrdersResponse: Decodable { let orders: [Order] }

struct ProductRef: Decodable, Equatable {
    let name: String
    let variant: String
    enum CodingKeys: String, CodingKey { case name, variant }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = c.flexString(.name) ?? ""
        variant = c.flexString(.variant) ?? ""
    }
}

struct StockRow: Decodable, Identifiable, Equatable {
    var id: String { product_id }
    let product_id: String
    let quantity: Int
    let updated_at: String?
    let products: ProductRef?

    enum CodingKeys: String, CodingKey { case product_id, quantity, updated_at, products }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        product_id = c.flexString(.product_id) ?? ""
        quantity = c.flexInt(.quantity) ?? 0
        updated_at = c.flexString(.updated_at)
        products = try? c.decodeIfPresent(ProductRef.self, forKey: .products)
    }
    var name: String { products?.name ?? "" }
    var variant: String { products?.variant ?? "" }
}

struct StockMovement: Decodable, Identifiable, Equatable {
    let id = UUID()
    let change: Int
    let note: String?
    let created_at: String?
    let products: ProductRef?

    enum CodingKeys: String, CodingKey { case change, note, created_at, products }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        change = c.flexInt(.change) ?? 0
        note = c.flexString(.note)
        created_at = c.flexString(.created_at)
        products = try? c.decodeIfPresent(ProductRef.self, forKey: .products)
    }
    static func == (a: StockMovement, b: StockMovement) -> Bool { a.id == b.id }
}

struct StockResponse: Decodable {
    let stock: [StockRow]
    let movements: [StockMovement]
    enum CodingKeys: String, CodingKey { case stock, movements }
    init(stock: [StockRow] = [], movements: [StockMovement] = []) { self.stock = stock; self.movements = movements }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        stock = (try? c.decodeIfPresent([StockRow].self, forKey: .stock)) ?? []
        movements = (try? c.decodeIfPresent([StockMovement].self, forKey: .movements)) ?? []
    }
}

struct PlaceOrderResponse: Decodable {
    let orderNumber: String?
    let paymentMethod: String?
    let checkoutUrl: String?
    let order: Order?
}
struct CheckoutResponse: Decodable { let checkoutUrl: String? }
struct VerifyStripeResponse: Decodable { let paid: Bool; let orderNumber: String? }
struct UploadLogoResponse: Decodable { let logoUrl: String }
struct DeleteAccountResponse: Decodable {
    let outstanding: Double
    enum CodingKeys: String, CodingKey { case outstanding }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        outstanding = c.flexDouble(.outstanding) ?? 0
    }
}
struct EmptyResponse: Decodable {}
struct ErrorResponse: Decodable { let error: String? }
