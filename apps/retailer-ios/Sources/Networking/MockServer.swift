#if DEBUG
import Foundation

/// DEBUG-only canned API. Launch with `-RFHMockData` to serve JSON shaped
/// exactly like api/retailer-auth.js and api/retailer-portal.js so every
/// signed-in screen can be exercised without real credentials. Never compiled
/// into Release builds.
///
/// Extra DEBUG launch arguments for screenshots:
///   -RFHAuthTab signin|apply|browse   open that pre-login tab
///   -RFHView home|dashboard|order|stock|profile|help   open that portal view
///   -RFHSheet pay|delete               present the Pay chooser / delete confirmation
///   -RFHMockStatus active|pending|suspended
enum MockServer {
    static var isEnabled: Bool { ProcessInfo.processInfo.arguments.contains("-RFHMockData") }
    static let token = "mock-session-token"

    static func argument(_ name: String) -> String? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
        return args[i + 1]
    }

    private static func iso(daysAgo: Double) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: Date().addingTimeInterval(-daysAgo * 86_400))
    }

    static var accountJSON: [String: Any] {
        [
            "id": "7b1e2c3d-0000-4000-8000-000000000001",
            "business_name": "Fresh Corner Market",
            "contact_name": "Ada Okafor",
            "email": "orders@freshcorner.example",
            "phone": "+1 (713) 555-0142",
            "address": "1200 Main St, Houston, TX 77002",
            "account_status": argument("-RFHMockStatus") ?? "active",
            "logo_url": NSNull(),
            "created_at": "2025-03-14T15:20:00.000Z",
        ]
    }

    static var ordersJSON: [[String: Any]] {
        [
            order("o1", "FRES11052026-06", 2, [("Ruby Sorrel Hibiscus Punch", "12-Pack", 4, 33.0), ("Ruby Ginger Refresher", "24-Case", 2, 64.0)], 260.0, "cash", "pending", "fulfilled"),
            order("o2", "FRES10282026-05", 10, [("Ruby Sorrel Hibiscus Punch", "24-Case", 2, 64.0)], 128.0, "zelle", "awaiting_confirmation", "confirmed", claimed: "zelle"),
            order("o3", "FRES10122026-04", 26, [("Ruby Ginger Refresher", "12-Pack", 3, 33.0)], 99.0, "pay_on_delivery", "pending", "pending"),
            order("o4", "FRES09182026-03", 50, [("Ruby Sorrel Hibiscus Punch", "12-Pack", 6, 33.0)], 198.0, "stripe", "paid", "fulfilled", batch: "B-0918-A"),
            order("o5", "FRES08032026-02", 96, [("Ruby Ginger Refresher", "12oz Single", 24, 3.0)], 72.0, "cash", "pending", "canceled", cancel: "Duplicate order — placed twice by mistake"),
            order("o6", "WHS-000004", 150, [("Ruby Ginger Refresher", "6-Pack", 5, 17.0), ("Ruby Sorrel Hibiscus Punch", "12oz Single", 12, 3.0)], 121.0, "zelle", "confirmed_by_admin", "fulfilled"),
        ]
    }

    private static func order(_ id: String, _ number: String, _ daysAgo: Double,
                              _ items: [(String, String, Int, Double)], _ total: Double,
                              _ method: String, _ pay: String, _ status: String,
                              claimed: String? = nil, cancel: String? = nil, batch: String? = nil) -> [String: Any] {
        [
            "id": id, "order_number": number, "created_at": iso(daysAgo: daysAgo),
            "items": items.map { ["product": $0.0, "variant": $0.1, "quantity": $0.2, "wholesale_price": $0.3] },
            "total": total, "payment_method": method, "payment_status": pay, "order_status": status,
            "claimed_payment_method": claimed as Any? ?? NSNull(),
            "cancel_reason": cancel as Any? ?? NSNull(),
            "production_batch": batch as Any? ?? NSNull(),
        ]
    }

    static var catalogJSON: [[String: Any]] {
        [
            ["product_id": "p-ging-1", "name": "Ruby Ginger Refresher", "variant": "12oz Single", "wholesale_price": 3.0],
            ["product_id": "p-ging-6", "name": "Ruby Ginger Refresher", "variant": "6-Pack", "wholesale_price": 17.0],
            ["product_id": "p-ging-12", "name": "Ruby Ginger Refresher", "variant": "12-Pack", "wholesale_price": 33.0],
            ["product_id": "p-ging-24", "name": "Ruby Ginger Refresher", "variant": "24-Case", "wholesale_price": 64.0],
            ["product_id": "p-sorr-1", "name": "Ruby Sorrel Hibiscus Punch", "variant": "12oz Single", "wholesale_price": 3.0],
            ["product_id": "p-sorr-12", "name": "Ruby Sorrel Hibiscus Punch", "variant": "12-Pack", "wholesale_price": 33.0],
            ["product_id": "p-sorr-24", "name": "Ruby Sorrel Hibiscus Punch", "variant": "24-Case", "wholesale_price": 64.0],
        ]
    }

    static var stockJSON: [String: Any] {
        [
            "stock": [
                ["product_id": "p-sorr-12", "quantity": 18, "updated_at": iso(daysAgo: 1), "products": ["name": "Ruby Sorrel Hibiscus Punch", "variant": "12-Pack"]],
                ["product_id": "p-ging-24", "quantity": 3, "updated_at": iso(daysAgo: 2), "products": ["name": "Ruby Ginger Refresher", "variant": "24-Case"]],
                ["product_id": "p-ging-6", "quantity": 0, "updated_at": iso(daysAgo: 9), "products": ["name": "Ruby Ginger Refresher", "variant": "6-Pack"]],
                ["product_id": "p-sorr-1", "quantity": 9, "updated_at": iso(daysAgo: 4), "products": ["name": "Ruby Sorrel Hibiscus Punch", "variant": "12oz Single"]],
            ],
            "movements": [
                ["change": -2, "note": "Sold — reported by retailer", "created_at": iso(daysAgo: 1), "products": ["name": "Ruby Sorrel Hibiscus Punch", "variant": "12-Pack"]],
                ["change": 4, "note": "Delivered — order FRES11052026-06", "created_at": iso(daysAgo: 2), "products": ["name": "Ruby Sorrel Hibiscus Punch", "variant": "12-Pack"]],
                ["change": 2, "note": "Delivered — order FRES11052026-06", "created_at": iso(daysAgo: 2), "products": ["name": "Ruby Ginger Refresher", "variant": "24-Case"]],
                ["change": -5, "note": NSNull(), "created_at": iso(daysAgo: 9), "products": ["name": "Ruby Ginger Refresher", "variant": "6-Pack"]],
            ],
        ]
    }

    static var publicCatalogJSON: [String: Any] {
        [
            "products": ["Ruby Ginger Refresher", "Ruby Sorrel Hibiscus Punch"],
            "catalog": [
                ["name": "Ruby Ginger Refresher", "sizes": ["12oz Single", "6-Pack", "12-Pack", "24-Case"]],
                ["name": "Ruby Sorrel Hibiscus Punch", "sizes": ["12oz Single", "6-Pack", "12-Pack", "24-Case"]],
            ],
        ]
    }

    static func respond(endpoint: String, body: [String: Any]) -> (Data, Int) {
        let action = body["action"] as? String ?? ""
        func ok(_ obj: Any) -> (Data, Int) { ((try? JSONSerialization.data(withJSONObject: obj)) ?? Data(), 200) }

        if endpoint == APIClient.Endpoint.auth.rawValue {
            switch action {
            case "login", "signup": return ok(["token": token, "account": accountJSON])
            case "me": return ok(["account": accountJSON])
            case "logout": return ok(["success": true])
            default: return ((try? JSONSerialization.data(withJSONObject: ["error": "Unknown action."])) ?? Data(), 400)
            }
        }
        switch action {
        case "public-catalog": return ok(publicCatalogJSON)
        case "catalog": return ok(["catalog": catalogJSON])
        case "orders": return ok(["orders": ordersJSON])
        case "stock": return ok(stockJSON)
        case "place-order":
            let method = body["paymentMethod"] as? String ?? "cash"
            if method == "stripe" {
                return ok(["success": true, "orderNumber": "FRES11072026-07", "paymentMethod": method,
                           "checkoutUrl": "https://www.rubyfoodhub.com/retailer?ws_canceled=1"])
            }
            var o = ordersJSON[0]; o["id"] = "o7"; o["order_number"] = "FRES11072026-07"; o["payment_method"] = method
            o["order_status"] = "pending"
            return ok(["success": true, "orderNumber": "FRES11072026-07", "paymentMethod": method, "order": o])
        case "pay-order": return ok(["success": true, "checkoutUrl": "https://www.rubyfoodhub.com/retailer?ws_canceled=1"])
        case "verify-stripe": return ok(["paid": false])
        case "claim-payment": return ok(["success": true, "orderNumber": "FRES11052026-06"])
        case "report-sold": return ok(["success": true, "quantity": 1])
        case "profile-update", "contact-support": return ok(["success": true])
        case "upload-logo": return ok(["success": true, "logoUrl": "https://www.rubyfoodhub.com/logo-mark.png"])
        case "delete-account": return ok(["success": true, "outstanding": 183.0])
        default: return ((try? JSONSerialization.data(withJSONObject: ["error": "Unknown action."])) ?? Data(), 400)
        }
    }
}
#endif
