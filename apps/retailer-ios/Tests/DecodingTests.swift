import XCTest
import UIKit
@testable import RubyFoodHubRetailer

final class DecodingTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    func testAuthResponse() throws {
        let r = try decode(AuthResponse.self, """
        {"token":"abc","account":{"id":"u1","business_name":"Fresh Corner","contact_name":null,"email":"a@b.co",
         "phone":null,"address":null,"account_status":"pending","logo_url":null,"created_at":"2026-01-02T03:04:05.123456+00:00"}}
        """)
        XCTAssertEqual(r.token, "abc")
        XCTAssertEqual(r.account.account_status, "pending")
        XCTAssertNil(r.account.phone)
        XCTAssertNotNil(Fmt.parse(r.account.created_at))
    }

    func testPublicCatalogPrefersCatalogThenFallsBackToProducts() throws {
        let rich = try decode(PublicCatalogResponse.self, #"{"products":["A","B"],"catalog":[{"name":"A","sizes":["Single","6-pack"]}]}"#)
        XCTAssertEqual(rich.items, [PublicCatalogItem(name: "A", sizes: ["Single", "6-pack"])])
        let namesOnly = try decode(PublicCatalogResponse.self, #"{"products":["A","B"],"catalog":[]}"#)
        XCTAssertEqual(namesOnly.items.map(\.name), ["A", "B"])
        XCTAssertTrue(namesOnly.items.allSatisfy { $0.sizes.isEmpty })
        let legacy = try decode(PublicCatalogResponse.self, #"{"products":["Zobo"]}"#)
        XCTAssertEqual(legacy.items.first?.name, "Zobo")
    }

    func testCatalog() throws {
        let r = try decode(CatalogResponse.self, #"{"catalog":[{"product_id":"p1","name":"Zobo","variant":"12-pack","wholesale_price":21}]}"#)
        XCTAssertEqual(r.catalog.first?.wholesale_price, 21)
    }

    func testOrdersWithNumericStringsAndNulls() throws {
        let r = try decode(OrdersResponse.self, """
        {"orders":[{"id":12,"order_number":"WHS-000004","created_at":"2026-10-01T12:00:00+00:00",
          "items":[{"product":"Zobo","variant":"12-pack","quantity":"4","wholesale_price":"21.00"}],
          "total":"84.00","payment_method":"pay_on_delivery","payment_status":"pending","order_status":"fulfilled",
          "claimed_payment_method":null,"cancel_reason":null,"production_batch":null,"stripe_session_id":null}]}
        """)
        let o = try XCTUnwrap(r.orders.first)
        XCTAssertEqual(o.id, "12")
        XCTAssertEqual(o.total, 84)
        XCTAssertEqual(o.items.first?.quantity, 4)
        XCTAssertEqual(o.itemsSummary, "4× Zobo — 12-pack")
        XCTAssertTrue(o.canPay)
        XCTAssertTrue(o.payIsDue)
        XCTAssertEqual(OrderPills.methodLabel(o.payment_method), "Pay on delivery")
    }

    func testOrderItemsNotAnArrayIsEmpty() throws {
        let r = try decode(OrdersResponse.self, #"{"orders":[{"id":"x","order_number":"N","items":"oops","total":1,"payment_status":"paid","order_status":"canceled"}]}"#)
        XCTAssertEqual(r.orders.first?.items.count, 0)
        XCTAssertFalse(r.orders.first!.canPay)
    }

    func testStock() throws {
        let r = try decode(StockResponse.self, """
        {"stock":[{"product_id":"p1","quantity":3,"updated_at":"2026-11-01T10:00:00.5+00:00","products":{"name":"Kunu","variant":"6-pack"}}],
         "movements":[{"change":-2,"note":null,"created_at":"2026-11-01T10:00:00Z","products":null}]}
        """)
        XCTAssertEqual(r.stock.first?.name, "Kunu")
        XCTAssertEqual(r.movements.first?.change, -2)
        XCTAssertNil(r.movements.first?.products)
    }

    func testSmallResponses() throws {
        XCTAssertEqual(try decode(PlaceOrderResponse.self, #"{"success":true,"orderNumber":"N1","paymentMethod":"stripe","checkoutUrl":"https://checkout.stripe.com/c/pay/cs_live_a1B2#x"}"#).checkoutUrl?.isEmpty, false)
        XCTAssertTrue(try decode(VerifyStripeResponse.self, #"{"paid":true,"orderNumber":"N1"}"#).paid)
        XCTAssertEqual(try decode(DeleteAccountResponse.self, #"{"success":true,"outstanding":"12.5"}"#).outstanding, 12.5)
        XCTAssertEqual(try decode(UploadLogoResponse.self, #"{"success":true,"logoUrl":"https://x/y.jpg?v=1"}"#).logoUrl, "https://x/y.jpg?v=1")
    }

    func testCheckoutSessionIdExtraction() {
        XCTAssertEqual(PortalStore.checkoutSessionId(from: "https://checkout.stripe.com/c/pay/cs_live_a1B2c3#fidkdWxOYHwn"), "cs_live_a1B2c3")
        XCTAssertEqual(PortalStore.checkoutSessionId(from: "https://checkout.stripe.com/c/pay/cs_test_ZZ9"), "cs_test_ZZ9")
        XCTAssertNil(PortalStore.checkoutSessionId(from: "https://www.rubyfoodhub.com/retailer"))
    }

    func testAPIErrorMapping() {
        let body = Data(#"{"error":"Session expired — please sign in again."}"#.utf8)
        XCTAssertThrowsError(try APIClient.decode(data: body, status: 401, defaultError: "x") as EmptyResponse) { e in
            XCTAssertEqual(e as? APIError, .unauthorized("Session expired — please sign in again."))
        }
        XCTAssertThrowsError(try APIClient.decode(data: Data("<html>".utf8), status: 500, defaultError: "Request failed") as EmptyResponse) { e in
            XCTAssertEqual(e as? APIError, .server("Request failed"))
        }
    }

    func testMoneyMatchesWebToFixed() {
        XCTAssertEqual(Fmt.money(1234.5), "$1234.50")
        XCTAssertEqual(Fmt.money(nil), "$0.00")
    }

    func testLogoResizeAndJPEG() throws {
        let big = UIGraphicsImageRenderer(size: CGSize(width: 2000, height: 1000), format: {
            let f = UIGraphicsImageRendererFormat(); f.scale = 1; return f
        }()).image { ctx in UIColor.red.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 2000, height: 1000)) }
        let data = try XCTUnwrap(LogoImage.jpeg(from: big))
        let back = try XCTUnwrap(UIImage(data: data))
        XCTAssertEqual(back.size.width * back.scale, 512)
        XCTAssertEqual(back.size.height * back.scale, 256)
        XCTAssertEqual(data.prefix(2), Data([0xFF, 0xD8]))  // JPEG magic
    }

    #if DEBUG
    func testMockPayloadsDecodeAsRealShapes() throws {
        func run<T: Decodable>(_ action: String, _ t: T.Type, endpoint: APIClient.Endpoint = .portal) throws -> T {
            let (d, s) = MockServer.respond(endpoint: endpoint.rawValue, body: ["action": action])
            XCTAssertEqual(s, 200, action)
            return try JSONDecoder().decode(T.self, from: d)
        }
        XCTAssertFalse(try run("orders", OrdersResponse.self).orders.isEmpty)
        XCTAssertFalse(try run("catalog", CatalogResponse.self).catalog.isEmpty)
        XCTAssertFalse(try run("stock", StockResponse.self).stock.isEmpty)
        XCTAssertFalse(try run("public-catalog", PublicCatalogResponse.self).items.isEmpty)
        XCTAssertEqual(try run("me", MeResponse.self, endpoint: .auth).account.business_name, "Fresh Corner Market")
    }
    #endif
}
