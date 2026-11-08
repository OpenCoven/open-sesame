import AppKit
import AuthenticationServices
import Security
import WorkOS

// Only the public client ID ships. WorkOS API keys never belong in a desktop bundle.
@MainActor
final class OpenSesameAuthentication: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let clientID = "client_01M6WS836GMGC87S8SVBR6X35A"
    static let redirect = "opensesame://auth/callback"
    static let signedOut = "opensesame://auth/signed-out"
    private static let keychainService = "com.perch.widgetstudio.workos.production"
    private let publicClient = PublicClient(clientID: clientID)
    private let verifier = WorkOSClient(configuration: Configuration(apiKey: "", timeout: 20, maxRetries: 1, clientID: clientID))
    private var browser: ASWebAuthenticationSession?
    private var task: Task<Void, Never>?
    private var refreshTimer: Timer?
    private var expiryTimer: Timer?
    private var epoch = 0
    private var expires = Date.distantPast
    private var user: User?
    private var saved: SavedSession?
    private(set) var busy = false
    private(set) var message = "Sign in to use Open Sesame."
    weak var window: NSWindow?
    var changed: (() -> Void)?
    var authenticated: Bool { user != nil && expires > Date() }

    private struct SavedSession: Codable {
        let refreshToken: String
        let sealedSession: String
        let password: String
    }
    enum AuthError: Error { case invalidCallback, invalidSession, keychain }

    var status: [String: Any] {
        ["authenticated": authenticated, "busy": busy, "message": message,
         "name": authenticated ? (user?.name ?? user?.firstName ?? "") : "",
         "email": authenticated ? (user?.email ?? "") : ""]
    }

    static func authorizationCode(_ url: URL, state: String) throws -> String {
        guard url.scheme == "opensesame", url.host == "auth", url.path == "/callback",
              url.user == nil, url.password == nil, url.port == nil, url.fragment == nil,
              let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              query.filter({ $0.name == "state" }).count == 1,
              query.first(where: { $0.name == "state" })?.value == state,
              query.filter({ $0.name == "code" }).count == 1,
              !query.contains(where: { $0.name == "error" }),
              let code = query.first(where: { $0.name == "code" })?.value,
              !code.isEmpty, code.utf8.count <= 8192 else { throw AuthError.invalidCallback }
        return code
    }

    // This deadline is read only after the SDK has verified the JWT signature and user binding.
    static func expiration(_ token: String) throws -> Date {
        let parts = token.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[1].count <= 65536 else { throw AuthError.invalidSession }
        var payload = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        payload += String(repeating: "=", count: (4 - payload.count % 4) % 4)
        guard let data = Data(base64Encoded: payload), let claims = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let exp = claims["exp"] as? NSNumber, CFGetTypeID(exp) != CFBooleanGetTypeID(), exp.doubleValue.isFinite,
              exp.doubleValue > Date().timeIntervalSince1970 else { throw AuthError.invalidSession }
        return Date(timeIntervalSince1970: exp.doubleValue)
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { window ?? ASPresentationAnchor() }

    func restore() {
        guard !busy, !UserDefaults.standard.bool(forKey: "openSesame.auth.signedOut") else { changed?(); return }
        do {
            guard let value = try readSession() else { changed?(); return }
            saved = value; refresh()
        } catch { message = "The saved sign-in could not be opened. Sign in again."; changed?() }
    }

    func signIn() {
        guard !busy else { return }
        epoch += 1; let ticket = epoch
        do {
            let authorization = try publicClient.getAuthorizationUrlWithPKCE(redirectUri: Self.redirect, provider: "authkit")
            busy = true; message = "Finish signing in in your browser."; changed?()
            browser = ASWebAuthenticationSession(url: authorization.url, callbackURLScheme: "opensesame") { [weak self] callback, _ in
                Task { @MainActor in
                    guard let self, ticket == self.epoch else { return }
                    self.browser = nil
                    guard let callback else { self.busy = false; self.message = "Sign-in was cancelled. You can try again."; self.changed?(); return }
                    do {
                        let code = try Self.authorizationCode(callback, state: authorization.state)
                        self.task = Task { @MainActor in
                            do { let response = try await self.publicClient.authenticateWithCode(code: code, codeVerifier: authorization.codeVerifier, requestOptions: RequestOptions(timeout: 20)); try await self.accept(response, ticket: ticket) }
                            catch { self.failed(error, ticket: ticket) }
                        }
                    } catch { self.failed(error, ticket: ticket) }
                }
            }
            browser?.presentationContextProvider = self
            browser?.prefersEphemeralWebBrowserSession = false
            if browser?.start() != true { browser = nil; busy = false; message = "The sign-in browser could not open. Try again."; changed?() }
        } catch { failed(error, ticket: ticket) }
    }

    private func accept(_ response: AuthenticateResponse, ticket: Int) async throws {
        let password = UUID().uuidString + UUID().uuidString
        let sealed = try Session.seal(from: response, cookiePassword: password)
        let session = try Session(client: verifier, sessionData: sealed, validatingCookiePassword: password)
        let result = await session.authenticateVerified()
        guard ticket == epoch, !Task.isCancelled else { return }
        guard result.authenticated, result.user?.id == response.user.id else { throw AuthError.invalidSession }
        let deadline = try Self.expiration(response.accessToken)
        let value = SavedSession(refreshToken: response.refreshToken, sealedSession: sealed, password: password)
        try writeSession(value)
        UserDefaults.standard.set(false, forKey: "openSesame.auth.signedOut")
        saved = value; user = response.user; expires = deadline; busy = false; message = "Signed in."
        refreshTimer?.invalidate(); expiryTimer?.invalidate()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: max(1, deadline.timeIntervalSinceNow - 60), repeats: false) { [weak self] _ in Task { @MainActor in self?.refresh() } }
        expiryTimer = Timer.scheduledTimer(withTimeInterval: max(1, deadline.timeIntervalSinceNow), repeats: false) { [weak self] _ in Task { @MainActor in self?.message = "Your session expired. Sign in to continue."; self?.changed?() } }
        changed?()
    }

    private func refresh() {
        guard !busy, let saved else { return }
        let ticket = epoch; busy = true; message = authenticated ? "Refreshing sign-in…" : "Restoring your sign-in…"; changed?()
        task = Task { @MainActor in
            do { let response = try await publicClient.authenticateWithRefreshToken(refreshToken: saved.refreshToken, requestOptions: RequestOptions(timeout: 20)); try await accept(response, ticket: ticket) }
            catch { failed(error, ticket: ticket) }
        }
    }

    private func failed(_ error: Error, ticket: Int) {
        guard ticket == epoch, !Task.isCancelled else { return }
        busy = false
        var terminal = false
        if let issue = error as? WorkOSError {
            switch issue {
            case .badRequest(let e), .authentication(let e):
                var code = e.code
                if code == nil, case .object(let fields) = e.raw, case .string(let value) = fields["error"] { code = value }
                terminal = code == "invalid_grant" || code == "refresh_token_revoked"
            default: break
            }
        }
        if terminal { user = nil; expires = .distantPast; saved = nil; try? deleteSession() }
        let keychainFailure: Bool
        if let local = error as? AuthError, case .keychain = local { keychainFailure = true } else { keychainFailure = false }
        message = keychainFailure ? "Could not save your sign-in in macOS Keychain. Unlock your Keychain and try again." : terminal ? "Your sign-in has ended. Sign in again to continue." : "Could not complete sign-in. Check your connection and try again."
        if !terminal, !keychainFailure, saved != nil {
            refreshTimer?.invalidate()
            refreshTimer = Timer.scheduledTimer(withTimeInterval: 20, repeats: false) { [weak self] _ in Task { @MainActor in self?.refresh() } }
        }
        changed?()
    }

    func signOut(endRemoteSession: Bool = true) {
        let previous = saved
        epoch += 1; task?.cancel(); browser?.cancel(); browser = nil
        refreshTimer?.invalidate(); expiryTimer?.invalidate(); busy = false
        UserDefaults.standard.set(true, forKey: "openSesame.auth.signedOut")
        saved = nil; user = nil; expires = .distantPast; message = "Signed out on this Mac."
        do { try deleteSession() } catch { message = "Signed out. The saved credential could not be removed; sign in again to replace it." }
        changed?()
        let ticket = epoch
        if endRemoteSession, let previous {
            Task { @MainActor in
                guard let session = try? Session(client: verifier, sessionData: previous.sealedSession, validatingCookiePassword: previous.password),
                      let url = try? await session.getVerifiedLogoutUrl(returnTo: Self.signedOut), ticket == epoch else { return }
                NSWorkspace.shared.open(url)
            }
        }
    }

    func shutdown() { epoch += 1; task?.cancel(); browser?.cancel(); refreshTimer?.invalidate(); expiryTimer?.invalidate() }

    func cancel() { epoch += 1; task?.cancel(); browser?.cancel(); browser = nil; busy = false; message = "Sign in to continue."; changed?() }

    private var keychainQuery: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: Self.keychainService, kSecAttrAccount as String: Self.clientID] }
    private func readSession() throws -> SavedSession? {
        var query = keychainQuery; query[kSecReturnData as String] = true; query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?; let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data, data.count < 262144 else { throw AuthError.keychain }
        return try JSONDecoder().decode(SavedSession.self, from: data)
    }
    private func writeSession(_ value: SavedSession) throws {
        let data = try JSONEncoder().encode(value)
        let update = SecItemUpdate(keychainQuery as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if update == errSecSuccess { return }
        guard update == errSecItemNotFound else { throw AuthError.keychain }
        var query = keychainQuery; query[kSecValueData as String] = data; query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        guard SecItemAdd(query as CFDictionary, nil) == errSecSuccess else { throw AuthError.keychain }
    }
    private func deleteSession() throws {
        let result = SecItemDelete(keychainQuery as CFDictionary)
        guard result == errSecSuccess || result == errSecItemNotFound else { throw AuthError.keychain }
    }
}
