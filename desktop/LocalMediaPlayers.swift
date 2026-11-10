import AppKit
import WebKit
import CoreFoundation

// Separate unprivileged player documents. Uploaded bytes and files stay local.
final class OpenSesameLocalMediaPlayers {
    private final class Player: NSObject, NSWindowDelegate, WKNavigationDelegate {
        let id: String, folder: URL, media: URL, expected: Int, name: String, kind: String, position: Double, playing: Bool
        var bytes = 0, touched = Date(), handle: FileHandle?, window: NSWindow?, web: WKWebView?
        var closed: (() -> Void)?
        init(id: String, folder: URL, expected: Int, name: String, kind: String, suffix: String, position: Double, playing: Bool) {
            self.id = id; self.folder = folder; self.expected = expected; self.name = name; self.kind = kind; self.position = position; self.playing = playing; media = folder.appendingPathComponent("media." + suffix)
        }
        func windowWillClose(_ notification: Notification) { window?.delegate = nil; window = nil; closed?() }
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { decisionHandler(.cancel); return }
            decisionHandler(url.isFileURL && url.deletingLastPathComponent().standardizedFileURL == folder.standardizedFileURL || url.absoluteString == "about:blank" ? .allow : .cancel)
        }
        func dispose() {
            let window = window; self.window = nil; window?.delegate = nil; web?.pauseAllMediaPlayback(completionHandler: {}); web?.stopLoading(); window?.close(); web = nil
            try? handle?.close(); handle = nil; try? FileManager.default.removeItem(at: folder)
        }
    }
    private let template: URL
    private var players: [String: Player] = [:]
    private var cleanup: Timer?
    init(template: URL) { self.template = template }
    var count: Int { players.count }
    static func integer(_ value: Any?, maximum: Int) -> Int? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue.isFinite,
              number.doubleValue >= 0, number.doubleValue <= Double(maximum), number.doubleValue.rounded(.down) == number.doubleValue else { return nil }
        return number.intValue
    }
    static func remoteURL(_ value: Any?) -> URL? { EmbeddedWebSurface.pageURL(value) }
    func call(_ method: String, _ params: [String: Any]) throws -> [String: Any] {
        if method == "media.player.begin" {
            guard Set(params.keys) == ["name", "size", "kind", "position", "playing"], let name = params["name"] as? String, !name.isEmpty, name.count <= 255, !name.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
                  let size = Self.integer(params["size"], maximum: 2 * 1024 * 1024 * 1024), size > 0,
                  let kind = params["kind"] as? String, ["audio", "video"].contains(kind), let position = params["position"] as? Double, position.isFinite, (0...86400).contains(position), let playing = params["playing"] as? Bool, players.count < 8 else { throw Failure.invalid }
            let suffix = URL(fileURLWithPath: name).pathExtension.lowercased()
            guard ["mp3","m4a","aac","wav","aiff","aif","flac","ogg","opus","mp4","mov","m4v","webm","ogv"].contains(suffix) else { throw Failure.format }
            let id = UUID().uuidString, folder = FileManager.default.temporaryDirectory.appendingPathComponent("OpenSesame-media-" + id, isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            let player = Player(id: id, folder: folder, expected: size, name: name, kind: kind, suffix: suffix, position: position, playing: playing)
            guard FileManager.default.createFile(atPath: player.media.path, contents: Data(), attributes: [.posixPermissions: 0o600]) else { try? FileManager.default.removeItem(at: folder); throw Failure.unavailable }
            do { player.handle = try FileHandle(forWritingTo: player.media) } catch { player.dispose(); throw error }
            players[id] = player; startCleanup(); return ["id": id]
        }
        guard let id = params["id"] as? String, let player = players[id] else { throw Failure.invalid }
        if method == "media.player.chunk" {
            guard Set(params.keys) == ["id", "offset", "data"], player.window == nil,
                  let offset = Self.integer(params["offset"], maximum: player.expected), offset == player.bytes,
                  let value = params["data"] as? String, value.count <= 180000, let data = Data(base64Encoded: value), !data.isEmpty, data.count <= 128 * 1024, player.bytes + data.count <= player.expected else { throw Failure.invalid }
            guard let handle = player.handle else { throw Failure.invalid }; try handle.write(contentsOf: data); player.bytes += data.count; player.touched = Date(); return ["bytes": player.bytes]
        }
        guard Set(params.keys) == ["id"] else { throw Failure.invalid }
        if method == "media.player.cancel" { close(id); return ["closed": true] }
        guard method == "media.player.open", player.bytes == player.expected, player.window == nil else { throw Failure.invalid }
        try player.handle?.synchronize(); try player.handle?.close(); player.handle = nil
        do { try present(player, source: player.media.lastPathComponent) } catch { close(id); throw error }
        return ["opened": true]
    }
    func openURL(_ params: [String: Any]) throws -> [String: Any] {
        guard Set(params.keys) == ["url", "name", "kind", "position", "playing"], players.count < 8, let url = Self.remoteURL(params["url"]), let name = params["name"] as? String, name.count <= 255,
              let kind = params["kind"] as? String, ["audio", "video"].contains(kind), let position = params["position"] as? Double, position.isFinite, (0...86400).contains(position), let playing = params["playing"] as? Bool else { throw Failure.invalid }
        let id = UUID().uuidString, folder = FileManager.default.temporaryDirectory.appendingPathComponent("OpenSesame-media-" + id, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        let player = Player(id: id, folder: folder, expected: 0, name: name, kind: kind, suffix: "media", position: position, playing: playing)
        players[id] = player
        do { try present(player, source: url.absoluteString) } catch { close(id); throw error }
        return ["opened": true]
    }
    private func present(_ player: Player, source: String) throws {
        let data = try JSONSerialization.data(withJSONObject: ["source": source, "position": player.position, "playing": player.playing])
        let json = String(data: data, encoding: .utf8)!.replacingOccurrences(of: "<", with: "\\u003c")
        let html = try String(contentsOf: template, encoding: .utf8).replacingOccurrences(of: "__CONFIG__", with: json).replacingOccurrences(of: "__KIND__", with: player.kind)
        let page = player.folder.appendingPathComponent("index.html"); try html.write(to: page, atomically: true, encoding: .utf8)
        let config = WKWebViewConfiguration(); config.mediaTypesRequiringUserActionForPlayback = []
        let view = WKWebView(frame: .zero, configuration: config); view.navigationDelegate = player; view.appearance = NSAppearance(named: .darkAqua)
        let window = NSWindow(contentRect: NSRect(x: 180, y: 180, width: 560, height: player.kind == "audio" ? 180 : 350), styleMask: [.titled,.closable,.resizable,.miniaturizable], backing: .buffered, defer: false)
        window.title = player.name; window.isReleasedWhenClosed = false; window.contentMinSize = NSSize(width: 300, height: player.kind == "audio" ? 120 : 200); window.level = .floating; window.collectionBehavior = [.canJoinAllSpaces,.fullScreenAuxiliary]; window.delegate = player
        player.window = window; player.web = view; let id = player.id; player.closed = { [weak self] in self?.close(id) }
        window.contentView = view; view.loadFileURL(page, allowingReadAccessTo: player.folder); window.makeKeyAndOrderFront(nil)
    }
    private func startCleanup() {
        guard cleanup == nil else { return }
        cleanup = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            guard let self else { return }; for id in self.players.keys.filter({ self.players[$0]?.window == nil && Date().timeIntervalSince(self.players[$0]!.touched) > 120 }) { self.close(id) }
        }
    }
    private func close(_ id: String) { let player = players.removeValue(forKey: id); player?.closed = nil; player?.dispose(); if players.isEmpty { cleanup?.invalidate(); cleanup = nil } }
    func closeAll() { for id in Array(players.keys) { close(id) } }
    enum Failure: LocalizedError { case invalid, unavailable, format
        var errorDescription: String? { self == .format ? "Use a supported audio or video file for this player." : self == .unavailable ? "The local player could not be prepared." : "The player upload changed or is unavailable. Try again." }
    }
}
