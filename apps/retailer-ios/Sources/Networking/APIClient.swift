import Foundation

enum APIError: LocalizedError, Equatable {
    /// HTTP 401 — the session is gone; the app signs out and shows this message.
    case unauthorized(String)
    case server(String)

    var errorDescription: String? {
        switch self {
        case .unauthorized(let m), .server(let m): return m
        }
    }
}

/// POST-JSON client for https://www.rubyfoodhub.com/api/*, same contract as
/// the api() helper in retailer.html: the session token travels in the body.
struct APIClient {
    enum Endpoint: String {
        case auth = "/api/retailer-auth"
        case portal = "/api/retailer-portal"
    }

    var session: URLSession = .shared

    func post<T: Decodable>(_ endpoint: Endpoint, _ body: [String: Any], as type: T.Type = T.self,
                            defaultError: String = "Request failed") async throws -> T {
        let data: Data
        let status: Int
        #if DEBUG
        if MockServer.isEnabled {
            (data, status) = MockServer.respond(endpoint: endpoint.rawValue, body: body)
            return try Self.decode(data: data, status: status, defaultError: defaultError)
        }
        #endif
        var request = URLRequest(url: Brand.baseURL.appendingPathComponent(endpoint.rawValue))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 45
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (d, response) = try await session.data(for: request)
        data = d
        status = (response as? HTTPURLResponse)?.statusCode ?? 0
        return try Self.decode(data: data, status: status, defaultError: defaultError)
    }

    static func decode<T: Decodable>(data: Data, status: Int, defaultError: String) throws -> T {
        if status == 401 {
            let msg = (try? JSONDecoder().decode(ErrorResponse.self, from: data))?.error
            throw APIError.unauthorized(msg ?? "Session expired — please sign in again.")
        }
        guard (200..<300).contains(status) else {
            let msg = (try? JSONDecoder().decode(ErrorResponse.self, from: data))?.error
            throw APIError.server(msg ?? defaultError)
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.server(defaultError)
        }
    }
}
