import Foundation
import Security
import CryptoKit
import WorkOS

private final class FixtureJWKS: URLProtocol {
    static var payload = Data()
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "fixture.workos.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.payload)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@main
@MainActor
struct AuthenticationTests {
    static func b64(_ data: Data) -> String { data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
    static func main() async throws {
        URLProtocol.registerClass(FixtureJWKS.self)
        defer { URLProtocol.unregisterClass(FixtureJWKS.self) }
        let callback = URL(string: "opensesame://auth/callback?state=fixture-state&code=fixture-code")!
        let code = try OpenSesameAuthentication.authorizationCode(callback, state: "fixture-state")
        precondition(code == "fixture-code")
        for value in ["https://auth/callback?state=fixture-state&code=x", "opensesame://other/callback?state=fixture-state&code=x", "opensesame://auth/login?state=fixture-state&code=x", "opensesame://auth/callback?state=wrong&code=x", "opensesame://auth/callback?state=fixture-state&state=fixture-state&code=x", "opensesame://auth/callback?state=fixture-state&code=x&code=y", "opensesame://auth/callback?state=fixture-state&error=denied&code=x", "opensesame://auth/callback?state=fixture-state&code=", "opensesame://auth/callback?state=fixture-state&code=x#fragment"] {
            precondition((try? OpenSesameAuthentication.authorizationCode(URL(string: value)!, state: "fixture-state")) == nil)
        }
        let client = PublicClient(clientID: OpenSesameAuthentication.clientID)
        let authorization = try client.getAuthorizationUrlWithPKCE(redirectUri: OpenSesameAuthentication.redirect, provider: "authkit")
        let query = URLComponents(url: authorization.url, resolvingAgainstBaseURL: false)!.queryItems!
        precondition(query.first(where: { $0.name == "code_challenge_method" })?.value == "S256")
        precondition(query.first(where: { $0.name == "code_challenge" })?.value == b64(Data(SHA256.hash(data: Data(authorization.codeVerifier.utf8)))))
        precondition(!authorization.state.isEmpty && authorization.codeVerifier.count >= 43)
        precondition(!query.contains(where: { $0.name.contains("secret") || $0.name.contains("api_key") }))

        // Verify the actual pinned SDK with an ephemeral signing key and intercepted JWKS; no real account, tokens or Keychain writes.
        let generator = Process(), output = Pipe()
        generator.executableURL = URL(fileURLWithPath: "/usr/bin/openssl"); generator.arguments = ["genrsa", "2048"]
        generator.standardOutput = output; generator.standardError = Pipe(); try generator.run(); generator.waitUntilExit()
        precondition(generator.terminationStatus == 0)
        let pem = String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)!
        let encoded = pem.split(separator: "\n").filter({ !$0.hasPrefix("-----") }).joined()
        let privateData = Data(base64Encoded: encoded)!
        var keyError: Unmanaged<CFError>?
        guard let key = SecKeyCreateWithData(privateData as CFData, [kSecAttrKeyType: kSecAttrKeyTypeRSA, kSecAttrKeyClass: kSecAttrKeyClassPrivate] as CFDictionary, &keyError) else {
            print("Native Security could not import an ephemeral fixture key: \(keyError?.takeRetainedValue().localizedDescription ?? "unavailable")"); exit(1)
        }
        let publicKey = SecKeyCopyPublicKey(key)!
        let der = [UInt8](SecKeyCopyExternalRepresentation(publicKey, nil)! as Data)
        var offset = 0
        func block(_ tag: UInt8) -> [UInt8] {
            precondition(der[offset] == tag); offset += 1
            var length = Int(der[offset]); offset += 1
            if length & 128 != 0 { let count = length & 127; length = 0; for _ in 0..<count { length = length * 256 + Int(der[offset]); offset += 1 } }
            let value = Array(der[offset..<offset+length]); offset += length; return value
        }
        precondition(der[offset] == 0x30); offset += 1; let seq = Int(der[offset]); offset += 1; if seq & 128 != 0 { offset += seq & 127 }
        let n = Data(block(0x02).drop(while: { $0 == 0 })), e = Data(block(0x02))
        FixtureJWKS.payload = try JSONSerialization.data(withJSONObject: ["keys": [["kty":"RSA", "kid":"fixture", "alg":"RS256", "use":"sig", "n":b64(n), "e":b64(e), "x5c":[], "x5t#S256":"fixture"]]])
        let verifier = WorkOSClient(configuration: Configuration(apiKey: "", baseURL: URL(string: "https://fixture.workos.invalid")!, maxRetries: 0, clientID: "fixture"))
        let user = User(object: "user", id: "user_fixture", email: "fixture@example.invalid", emailVerified: true, createdAt: Date(), updatedAt: Date())
        let password = String(repeating: "fixture-password", count: 4)
        func jwt(_ claims: [String: Any]) throws -> String {
            let header = b64(try JSONSerialization.data(withJSONObject: ["alg":"RS256", "kid":"fixture"]))
            let body = b64(try JSONSerialization.data(withJSONObject: claims))
            let input = header + "." + body
            let signature = SecKeyCreateSignature(key, .rsaSignatureMessagePKCS1v15SHA256, Data(input.utf8) as CFData, nil)! as Data
            return input + "." + b64(signature)
        }
        func session(_ token: String) throws -> Session {
            let response = AuthenticateResponse(user: user, accessToken: token, refreshToken: "synthetic-refresh-token")
            return try Session(client: verifier, sessionData: Session.seal(from: response, cookiePassword: password), validatingCookiePassword: password)
        }
        let claims: [String: Any] = ["sub":user.id, "exp":Int(Date().timeIntervalSince1970)+300, "sid":"session_fixture", "auth_time":Int(Date().timeIntervalSince1970)]
        let token = try jwt(claims)
        let jwksClient = PublicClient(clientID: "fixture", baseURL: URL(string: "https://fixture.workos.invalid")!)
        do { let jwks = try await jwksClient.getJwks(requestOptions: RequestOptions(timeout: 2)); print("Fixture JWKS keys: \(jwks.keys.count)") }
        catch { print("Fixture JWKS transport/decoding failed: \(error)"); exit(1) }
        let valid = await (try session(token)).authenticateVerified()
        guard valid.authenticated && valid.user?.id == user.id else { print("Fixture session verification failed: \(valid.reason ?? "unknown")"); exit(1) }
        let deadline = try OpenSesameAuthentication.expiration(token)
        precondition(deadline > Date())
        var wrongUser = claims; wrongUser["sub"] = "user_other"
        let bound = await (try session(jwt(wrongUser))).authenticateVerified(); precondition(!bound.authenticated)
        var expired = claims; expired["exp"] = 1
        let old = await (try session(jwt(expired))).authenticateVerified(); precondition(!old.authenticated && old.needsRefresh)
        precondition((try? OpenSesameAuthentication.expiration(jwt(expired))) == nil)
        var agent = claims; agent["sub_type"] = "agent"
        let nonUser = await (try session(jwt(agent))).authenticateVerified(); precondition(!nonUser.authenticated)
        let chunks = token.split(separator: ".").map(String.init)
        var forged = claims; forged["sub"] = "user_other"
        let tampered = chunks[0] + "." + b64(try JSONSerialization.data(withJSONObject: forged)) + "." + chunks[2]
        let invalid = await (try session(tampered)).authenticateVerified(); precondition(!invalid.authenticated)
        print("WorkOS native PKCE, strict callback state/destination, signed user binding, expiry, non-user token rejection and forged-token rejection passed with synthetic keys and intercepted JWKS. No login or Keychain write performed.")
    }
}
