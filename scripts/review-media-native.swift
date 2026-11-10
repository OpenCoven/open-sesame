// Run separately from headless checks; opens only disposable, muted player windows.
import AppKit
import WebKit

@main
struct MediaNativeReview {
    static func wait(_ seconds: Double) { let until = Date().addingTimeInterval(seconds); while Date() < until { RunLoop.current.run(until: Date().addingTimeInterval(0.05)) } }
    static func main() throws {
        _ = NSApplication.shared; NSApp.setActivationPolicy(.accessory)
        guard CommandLine.arguments.count == 3 else { fatalError("Pass trusted template and generated WAV paths.") }
        let manager = OpenSesameLocalMediaPlayers(template: URL(fileURLWithPath: CommandLine.arguments[1]))
        defer { manager.closeAll() }
        let bytes = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2]))
        var ids: [String] = []
        for n in 1...2 {
            let id = try manager.call("media.player.begin", ["name": "Disposable PiP \(n).wav", "size": bytes.count, "kind": "audio", "position": 1.0, "playing": false])["id"] as! String
            ids.append(id)
            for offset in stride(from: 0, to: bytes.count, by: 131072) { _ = try manager.call("media.player.chunk", ["id": id, "offset": offset, "data": bytes.subdata(in: offset..<min(offset+131072,bytes.count)).base64EncodedString()]) }
            _ = try manager.call("media.player.open", ["id": id])
        }
        precondition(manager.count == 2)
        let windows = NSApp.windows.filter { $0.title.hasPrefix("Disposable PiP ") }
        precondition(windows.count == 2 && windows.allSatisfy { $0.isVisible && $0.level == .floating })
        wait(3)
        for window in windows {
            let web = window.contentView as! WKWebView
            var result: [String: Any]?, failure: Error?
            web.evaluateJavaScript("({ready:player.readyState,duration:player.duration,time:player.currentTime,bridge:typeof window.webkit?.messageHandlers?.openSesame})") { value,error in result = value as? [String: Any]; failure = error }
            wait(1)
            guard let result, failure == nil else { fatalError("Player document did not load: \(String(describing: failure))") }
            precondition((result["ready"] as? Int ?? 0) >= 2 && (result["duration"] as? Double ?? 0) >= 5)
            precondition(abs((result["time"] as? Double ?? 0)-1) < 0.2 && result["bridge"] as? String == "undefined")
            web.evaluateJavaScript("player.muted=true;player.play();true", completionHandler: nil)
            window.setContentSize(NSSize(width: 360, height: 150))
        }
        wait(1)
        var progressed = 0
        for window in windows { (window.contentView as! WKWebView).evaluateJavaScript("player.currentTime") { value,_ in if (value as? Double ?? 0) > 1.5 { progressed += 1 } } }
        wait(0.5); precondition(progressed == 2, "Both independent native players must advance.")
        windows[0].performClose(nil); wait(0.5); precondition(manager.count == 1 && windows[1].isVisible)
        manager.closeAll(); wait(0.2); precondition(manager.count == 0)
        for id in ids { precondition(!FileManager.default.fileExists(atPath: FileManager.default.temporaryDirectory.appendingPathComponent("OpenSesame-media-"+id).path)) }
        print("PASS native WebKit: two isolated floating audio players loaded, retained position, advanced muted playback independently, resized, closed separately and removed owned media copies. No installed app/profile used.")
    }
}
