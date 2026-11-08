import Foundation
import CryptoKit

@main struct SpotifyAuthenticationTests {
    @MainActor static func main() throws {
        let first = try OpenSesameSpotify.proof(), second = try OpenSesameSpotify.proof()
        precondition(first.verifier.count >= 43 && first.state.count >= 24)
        precondition(first.verifier != second.verifier && first.state != second.state)
        precondition(first.challenge == OpenSesameSpotify.base64URL(Data(SHA256.hash(data: Data(first.verifier.utf8)))))
        precondition(OpenSesameSpotify.validClient(String(repeating: "a", count: 32)))
        precondition(!OpenSesameSpotify.validClient("client-secret"))
        precondition(OpenSesameSpotify.validClient(OpenSesameSpotify.defaultClientID))
        precondition(OpenSesameSpotify.effectiveClientID(nil) == OpenSesameSpotify.defaultClientID)
        precondition(OpenSesameSpotify.effectiveClientID("") == OpenSesameSpotify.defaultClientID)
        precondition(OpenSesameSpotify.effectiveClientID("invalid") == OpenSesameSpotify.defaultClientID)
        precondition(OpenSesameSpotify.effectiveClientID(String(repeating: "b", count: 32)) == String(repeating: "b", count: 32), "Existing explicit public-client overrides are preserved")
        let url = OpenSesameSpotify.redirect + "?state=" + first.state + "&code=fixture-code"
        let returned = try OpenSesameSpotify.code(URL(string: url)!, state: first.state)
        precondition(returned == "fixture-code")
        for invalid in [url + "&state=duplicate", url + "&code=other", url + "#fragment", url + "&error=access_denied", url.replacingOccurrences(of: first.state, with: "wrong"), url.replacingOccurrences(of: "opensesame-spotify:", with: "opensesame:"), url.replacingOccurrences(of: "/callback", with: "/other") ] {
            do { _ = try OpenSesameSpotify.code(URL(string: invalid)!, state: first.state); fatalError("Accepted invalid callback") } catch {}
        }
        print("Native Spotify: random S256 PKCE, public ID validation and strict callback/state rejection passed. No live authorization or token exchange was performed.")
    }
}
