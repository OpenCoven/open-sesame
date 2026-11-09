import AppKit
import AuthenticationServices
import CryptoKit
import Security

private final class SpotifyRedirectGuard: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

// Public-client PKCE. User credentials and provider tokens never enter the widget page.
@MainActor
final class OpenSesameSpotify: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let defaultClientID = "000d9575abe844d9a0c258ddc9c0bc09"
    static let scopes = "user-read-private user-library-read playlist-read-private playlist-read-collaborative"
    static let redirect = "opensesame-spotify://auth/callback"
    private var browser: ASWebAuthenticationSession?
    private var task: Task<Void, Never>?
    private var epoch = 0
    private var accessToken: String?
    private var name = ""
    private var expires = Date.distantPast
    private var error = ""
    private(set) var busy = false
    weak var window: NSWindow?
    var changed: (() -> Void)?
    var clientID: String { Self.effectiveClientID(UserDefaults.standard.string(forKey: "openSesame.spotify.publicClientID")) }
    static func effectiveClientID(_ stored: String?) -> String { stored.flatMap { validClient($0) ? $0 : nil } ?? defaultClientID }
    var status: [String: Any] {
        let connected = accessToken != nil && expires > Date()
        return ["connected": connected, "busy": busy, "name": connected ? name : "", "expiresAt": connected ? expires.timeIntervalSince1970 * 1000 : 0, "clientId": clientID, "redirectURI": Self.redirect, "error": error]
    }
    static func validClient(_ value: String) -> Bool { value.range(of: "^[a-fA-F0-9]{32}$", options: .regularExpression) != nil }
    static func base64URL(_ value: Data) -> String { value.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
    static func proof() throws -> (verifier: String, state: String, challenge: String) {
        var bytes = [UInt8](repeating: 0, count: 72)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw Issue.invalid }
        let verifier = base64URL(Data(bytes.prefix(48))), state = base64URL(Data(bytes.suffix(24)))
        return (verifier, state, base64URL(Data(SHA256.hash(data: Data(verifier.utf8)))))
    }
    static func code(_ url: URL, state: String) throws -> String {
        guard url.scheme == "opensesame-spotify", url.host == "auth", url.path == "/callback", url.user == nil, url.password == nil, url.port == nil, url.fragment == nil,
              let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              query.filter({$0.name == "state"}).count == 1, query.first(where: {$0.name == "state"})?.value == state,
              !query.contains(where: {$0.name == "error"}), query.filter({$0.name == "code"}).count == 1,
              let code = query.first(where: {$0.name == "code"})?.value, !code.isEmpty, code.utf8.count <= 8192 else { throw Issue.invalid }
        return code
    }
    enum Issue: Error { case invalid, unavailable }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { window ?? ASPresentationAnchor() }
    func configure(_ value: String) throws {
        guard Self.validClient(value) else { throw Issue.invalid }
        if clientID != value { disconnect(); UserDefaults.standard.set(value, forKey: "openSesame.spotify.publicClientID") }
        changed?()
    }
    func disconnect() {
        epoch += 1; browser?.cancel(); browser = nil; task?.cancel(); task = nil
        accessToken = nil; name = ""; expires = .distantPast; busy = false; error = ""; changed?()
    }
    func signIn() throws {
        guard !busy else { return }
        guard Self.validClient(clientID) else { throw Issue.invalid }
        let proof = try Self.proof(), client = clientID, ticket = epoch + 1, started = Date()
        epoch = ticket; busy = true; error = ""; changed?()
        var url = URLComponents(string: "https://accounts.spotify.com/authorize")!
        url.queryItems = [URLQueryItem(name: "client_id", value: client), URLQueryItem(name: "response_type", value: "code"), URLQueryItem(name: "redirect_uri", value: Self.redirect), URLQueryItem(name: "scope", value: Self.scopes), URLQueryItem(name: "state", value: proof.state), URLQueryItem(name: "code_challenge_method", value: "S256"), URLQueryItem(name: "code_challenge", value: proof.challenge)]
        browser = ASWebAuthenticationSession(url: url.url!, callbackURLScheme: "opensesame-spotify") { [weak self] callback, _ in
            Task { @MainActor in
                guard let self, ticket == self.epoch else { return }
                self.browser = nil
                guard let callback else { self.busy = false; self.error = "Spotify sign-in was cancelled."; self.changed?(); return }
                do {
                    guard Date().timeIntervalSince(started) < 600 else { throw Issue.invalid }
                    let code = try Self.code(callback, state: proof.state)
                    self.task = Task { @MainActor in
                        do {
                            let fields = [URLQueryItem(name: "grant_type", value: "authorization_code"), URLQueryItem(name: "code", value: code), URLQueryItem(name: "redirect_uri", value: Self.redirect), URLQueryItem(name: "client_id", value: client), URLQueryItem(name: "code_verifier", value: proof.verifier)]
                            var encoded = URLComponents(); encoded.queryItems = fields
                            var request = URLRequest(url: URL(string: "https://accounts.spotify.com/api/token")!); request.httpMethod = "POST"; request.httpBody = encoded.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B").data(using: .utf8); request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
                            let token = try await Self.json(request)
                            guard let access = token["access_token"] as? String, !access.isEmpty, let seconds = token["expires_in"] as? NSNumber, seconds.doubleValue.isFinite, seconds.doubleValue > 0, Self.scopes.split(separator: " ").allSatisfy({ (token["scope"] as? String ?? "").split(separator: " ").contains($0) }) else { throw Issue.invalid }
                            var profile = URLRequest(url: URL(string: "https://api.spotify.com/v1/me")!); profile.setValue("Bearer " + access, forHTTPHeaderField: "Authorization")
                            let user = try await Self.json(profile)
                            guard let id = user["id"] as? String, !id.isEmpty else { throw Issue.invalid }
                            guard ticket == self.epoch, !Task.isCancelled else { return }
                            self.accessToken = access; self.name = (user["display_name"] as? String).flatMap({$0.isEmpty ? nil : $0}) ?? id; self.expires = Date().addingTimeInterval(seconds.doubleValue); self.busy = false; self.error = ""; self.changed?()
                        } catch { self.failed(ticket) }
                    }
                } catch { self.failed(ticket) }
            }
        }
        browser?.presentationContextProvider = self; browser?.prefersEphemeralWebBrowserSession = false
        if browser?.start() != true { failed(ticket) }
    }
    static func libraryURL(kind: String, offset: Int) throws -> URL {
        guard ["tracks", "playlists"].contains(kind), (0...100000).contains(offset) else { throw Issue.invalid }
        return URL(string: "https://api.spotify.com/v1/me/" + kind + "?limit=50&offset=\(offset)")!
    }
    static func libraryPage(_ data: [String: Any], kind: String, offset: Int) throws -> [String: Any] {
        _ = try libraryURL(kind: kind, offset: offset)
        guard let entries = data["items"] as? [Any] else { throw Issue.invalid }
        let items: [[String: Any]] = entries.prefix(50).compactMap { entry in
            guard let entry = entry as? [String: Any], let item = (kind == "tracks" ? entry["track"] as? [String: Any] : entry), item["is_local"] as? Bool != true,
                  let id = item["id"] as? String, id.range(of: "^[a-zA-Z0-9]{22}$", options: .regularExpression) != nil, let title = item["name"] as? String, !title.isEmpty else { return nil }
            let artists = item["artists"] as? [[String: Any]] ?? []
            let detail = kind == "tracks" ? artists.compactMap { $0["name"] as? String }.joined(separator: ", ") : (item["owner"] as? [String: Any])?["display_name"] as? String ?? ""
            return ["id": id, "name": String(title.prefix(500)), "detail": String(detail.prefix(500)), "url": "https://open.spotify.com/" + (kind == "tracks" ? "track/" : "playlist/") + id]
        }
        return ["items": items, "nextOffset": data["next"] as? String != nil && offset + 50 <= 100000 ? offset + 50 as Any : NSNull()]
    }
    func library(kind: String, offset: Int) async throws -> [String: Any] {
        let url = try Self.libraryURL(kind: kind, offset: offset), ticket = epoch
        guard let access = accessToken, expires > Date() else { throw Issue.unavailable }
        var request = URLRequest(url: url); request.setValue("Bearer " + access, forHTTPHeaderField: "Authorization")
        let data = try await Self.json(request)
        guard ticket == epoch, accessToken == access, expires > Date(), !Task.isCancelled else { throw Issue.unavailable }
        return try Self.libraryPage(data, kind: kind, offset: offset)
    }
    private func failed(_ ticket: Int) {
        guard ticket == epoch else { return }
        browser = nil; busy = false; error = "Spotify could not connect. Retry sign-in and check that your account can access Open Sesame in Spotify."; changed?()
    }
    private static func json(_ input: URLRequest) async throws -> [String: Any] {
        var request = input; request.timeoutInterval = 20; request.cachePolicy = .reloadIgnoringLocalCacheData
        let configuration = URLSessionConfiguration.ephemeral; configuration.httpShouldSetCookies = false; configuration.urlCache = nil
        let session = URLSession(configuration: configuration, delegate: SpotifyRedirectGuard(), delegateQueue: nil); defer { session.invalidateAndCancel() }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode), data.count <= 1048576, let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw Issue.unavailable }
        return value
    }
}
