import Foundation

@main
struct LocalMediaPlayersTests {
    static func main() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("OpenSesame-player-test-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }
        let manager = OpenSesameLocalMediaPlayers(template: root.appendingPathComponent("missing.html"))
        defer { manager.closeAll() }
        precondition(OpenSesameLocalMediaPlayers.integer(true, maximum: 10) == nil)
        for value in [Double.nan, -1, 1.5, 11] { precondition(OpenSesameLocalMediaPlayers.integer(value, maximum: 10) == nil) }
        precondition(OpenSesameLocalMediaPlayers.remoteURL("file:///etc/passwd") == nil)
        precondition(OpenSesameLocalMediaPlayers.remoteURL("https://name:secret@example.com/audio.mp3") == nil)
        let metadata: [String: Any] = ["name": "sample.wav", "size": 4, "kind": "audio", "position": 2.0, "playing": false]
        var invalid = metadata; invalid["name"] = "key.txt"
        precondition((try? manager.call("media.player.begin", invalid)) == nil)
        let id = try manager.call("media.player.begin", metadata)["id"] as! String
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("OpenSesame-media-" + id)
        precondition(manager.count == 1 && FileManager.default.fileExists(atPath: folder.path))
        for params: [String: Any] in [["id": id, "offset": 1, "data": "AQI="], ["id": id, "offset": 0, "data": "invalid"], ["id": id, "offset": 0, "data": Data(repeating: 1, count: 131073).base64EncodedString()]] {
            precondition((try? manager.call("media.player.chunk", params)) == nil)
        }
        precondition((try? manager.call("media.player.open", ["id": id])) == nil, "Incomplete files cannot open.")
        _ = try manager.call("media.player.chunk", ["id": id, "offset": 0, "data": "AQI="])
        precondition((try? manager.call("media.player.chunk", ["id": id, "offset": 0, "data": "AQI="])) == nil, "Duplicate/out-of-order chunks cannot overwrite data.")
        _ = try manager.call("media.player.chunk", ["id": id, "offset": 2, "data": "AwQ="])
        let copied = try Data(contentsOf: folder.appendingPathComponent("media.wav")); precondition(copied == Data([1,2,3,4]))
        precondition((try? manager.call("media.player.open", ["id": id])) == nil, "A missing trusted template fails closed.")
        precondition(manager.count == 0 && !FileManager.default.fileExists(atPath: folder.path), "Failed windows remove owned uploads.")
        let second = try manager.call("media.player.begin", metadata)["id"] as! String
        _ = try manager.call("media.player.cancel", ["id": second])
        precondition(manager.count == 0)
        precondition(!FileManager.default.fileExists(atPath: FileManager.default.temporaryDirectory.appendingPathComponent("OpenSesame-media-" + second).path))
        print("Local player transfer ordering, bounds, URL validation, incomplete/refused opening, cancellation and owned-file cleanup passed without opening a window.")
    }
}
