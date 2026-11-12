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
        precondition(Set(OpenSesameSpotify.scopes.split(separator: " ")) == Set(["user-read-private", "user-library-read", "playlist-read-private", "playlist-read-collaborative"]))
        precondition(OpenSesameSpotify.artwork([["url": "https://i.scdn.co/image/cover"]]) == "https://i.scdn.co/image/cover")
        for unsafe in ["http://i.scdn.co/image/cover", "https://i.scdn.co.evil.example/image", "https://user@i.scdn.co/image", "https://example.com/cover", "javascript:alert(1)"] { precondition(OpenSesameSpotify.artwork([["url": unsafe]]) == "") }
        let id = "0123456789ABCDEFGHIJKL"
        let page = try OpenSesameSpotify.libraryPage(["items": [["track": ["id": id, "name": "Song", "artists": [["name": "Artist"]]]], ["track": NSNull()]], "next": "https://untrusted.example"], kind: "tracks", offset: 0)
        let songs = page["items"] as! [[String: Any]]
        precondition(songs.count == 1 && songs[0]["url"] as? String == "https://open.spotify.com/track/" + id)
        precondition(page["nextOffset"] as? Int == 50)
        let next = try OpenSesameSpotify.libraryURL(kind: "tracks", offset: 50)
        precondition(next.absoluteString == "https://api.spotify.com/v1/me/tracks?limit=50&offset=50")
        let playlists = try OpenSesameSpotify.libraryPage(["items": [["id": id, "name": "Private list", "owner": ["display_name": "Owner"]]], "next": NSNull()], kind: "playlists", offset: 0)
        precondition((playlists["items"] as! [[String: Any]])[0]["detail"] as? String == "Owner")
        precondition(playlists["nextOffset"] is NSNull)
        for (kind, offset) in [("tracks", -1), ("tracks", 100001), ("https://untrusted.example", 0)] {
            do { _ = try OpenSesameSpotify.libraryURL(kind: kind, offset: offset); fatalError("Accepted invalid library page") } catch {}
        }
        do { _ = try OpenSesameSpotify.libraryPage([:], kind: "tracks", offset: 0); fatalError("Accepted malformed library") } catch {}
        let url = OpenSesameSpotify.redirect + "?state=" + first.state + "&code=fixture-code"
        let returned = try OpenSesameSpotify.code(URL(string: url)!, state: first.state)
        precondition(returned == "fixture-code")
        for invalid in [url + "&state=duplicate", url + "&code=other", url + "#fragment", url + "&error=access_denied", url.replacingOccurrences(of: first.state, with: "wrong"), url.replacingOccurrences(of: "opensesame-spotify:", with: "opensesame:"), url.replacingOccurrences(of: "/callback", with: "/other") ] {
            do { _ = try OpenSesameSpotify.code(URL(string: invalid)!, state: first.state); fatalError("Accepted invalid callback") } catch {}
        }
        print("Native Spotify: random S256 PKCE, public ID validation and strict callback/state rejection passed. No live authorization or token exchange was performed.")
    }
}
