import AppKit
import WebKit

private final class EmbeddedWebViewport: NSView {
    override var isFlipped: Bool { true }
}

// External pages have their own WKWebView configuration, without the app bridge.
final class EmbeddedWebSurface: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    let id: String
    let view: WKWebView
    private let viewport = EmbeddedWebViewport(frame: .zero)
    private let assets: URL
    private let emit: ([String: Any]) -> Void
    private var generation = ""
    private var loadedURL: URL?
    private let identity = URL(string: "https://\((Bundle.main.bundleIdentifier ?? "com.perch.widgetstudio").lowercased())/")!

    init(id: String, parent: WKWebView, assets: URL, emit: @escaping ([String: Any]) -> Void) {
        self.id = id; self.assets = assets; self.emit = emit
        let configuration = WKWebViewConfiguration()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        view = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        view.navigationDelegate = self; view.uiDelegate = self
        view.underPageBackgroundColor = NSColor(calibratedWhite: 0.06, alpha: 1)
        view.appearance = NSAppearance(named: .darkAqua)
        viewport.wantsLayer = true; viewport.layer?.cornerRadius = 8; viewport.layer?.masksToBounds = true
        viewport.isHidden = true
        if id == "youtube" { configuration.userContentController.add(self, name: "youtubePlayer") }
        viewport.addSubview(view)
        parent.addSubview(viewport)
    }

    static func pageURL(_ value: Any?) -> URL? {
        guard let text = value as? String, text.count <= 8192, let url = URL(string: text),
              ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
              url.host != nil, url.user == nil, url.password == nil else { return nil }
        return url
    }

    func open(_ params: [String: Any]) throws {
        guard let token = params["generation"] as? String, token.range(of: "^[A-Za-z0-9_-]{1,80}$", options: .regularExpression) != nil else { throw SurfaceError.invalidCommand }
        generation = token
        if id != "youtube" {
            guard let url = Self.pageURL(params["url"]) else { throw SurfaceError.invalidURL }
            if loadedURL != url { loadedURL = url; view.load(URLRequest(url: url)) }
        } else {
            guard let source = params["source"] as? [String: Any] else { throw SurfaceError.invalidURL }
            let video = source["id"] as? String ?? "", list = source["list"] as? String ?? ""
            guard (!video.isEmpty || !list.isEmpty),
                  video.isEmpty || video.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil,
                  list.isEmpty || list.range(of: "^[A-Za-z0-9_-]{10,180}$", options: .regularExpression) != nil else { throw SurfaceError.invalidURL }
            let start = max(0, min(86400, (source["start"] as? NSNumber)?.intValue ?? 0))
            let value: [String: Any] = ["id": video, "list": list, "start": start, "origin": identity.absoluteString, "generation": generation]
            let json = String(data: try JSONSerialization.data(withJSONObject: value), encoding: .utf8)!
            let html = try String(contentsOf: assets.appendingPathComponent("native-youtube.html"), encoding: .utf8)
            view.loadHTMLString(html.replacingOccurrences(of: "__OPEN_SESAME_SOURCE__", with: json), baseURL: identity)
        }
    }

    struct Layout {
        let viewport: NSRect
        let content: NSRect
    }

    static func layout(_ params: [String: Any], bounds: NSRect, flipped: Bool) throws -> Layout {
        guard let x = params["x"] as? NSNumber, let y = params["y"] as? NSNumber,
              let width = params["width"] as? NSNumber, let height = params["height"] as? NSNumber,
              [x, y, width, height].allSatisfy({ $0.doubleValue.isFinite }) else { throw SurfaceError.invalidFrame }
        let element = NSRect(x: x.doubleValue, y: y.doubleValue, width: max(0, width.doubleValue), height: max(0, height.doubleValue))
        var clip = element
        if let value = params["clip"] as? [String: Any] {
            guard let cx = value["x"] as? NSNumber, let cy = value["y"] as? NSNumber,
                  let cw = value["width"] as? NSNumber, let ch = value["height"] as? NSNumber,
                  [cx, cy, cw, ch].allSatisfy({ $0.doubleValue.isFinite }) else { throw SurfaceError.invalidFrame }
            clip = clip.intersection(NSRect(x: cx.doubleValue, y: cy.doubleValue, width: max(0, cw.doubleValue), height: max(0, ch.doubleValue)))
        }
        clip = clip.intersection(NSRect(origin: .zero, size: bounds.size))
        guard !clip.isEmpty else { return Layout(viewport: .zero, content: .zero) }
        // DOM rectangles are top-down. WKWebView is flipped on macOS; consult the parent instead of flipping twice.
        let rectangle = NSRect(x: bounds.minX + clip.minX, y: flipped ? bounds.minY + clip.minY : bounds.maxY - clip.maxY, width: clip.width, height: clip.height)
        return Layout(viewport: rectangle, content: NSRect(x: element.minX - clip.minX, y: element.minY - clip.minY, width: element.width, height: element.height))
    }

    func frame(_ params: [String: Any]) throws {
        guard let parent = viewport.superview else { return }
        let layout = try Self.layout(params, bounds: parent.bounds, flipped: parent.isFlipped)
        viewport.isHidden = params["visible"] as? Bool != true || layout.viewport.isEmpty || (id == "youtube" && (layout.content.width < 200 || layout.content.height < 200))
        if !layout.viewport.isEmpty { viewport.frame = layout.viewport; view.frame = layout.content }
    }

    func command(_ params: [String: Any]) throws {
        guard id == "youtube", params["generation"] as? String == generation,
              let action = params["action"] as? String,
              ["playVideo", "pauseVideo", "seekTo", "setVolume", "mute", "unMute", "setShuffle", "loadPlaylist", "cuePlaylist"].contains(action) else { throw SurfaceError.invalidCommand }
        let data = try JSONSerialization.data(withJSONObject: ["action": action, "args": params["args"] as? [Any] ?? []])
        guard data.count <= 32000, let json = String(data: data, encoding: .utf8) else { throw SurfaceError.invalidCommand }
        view.evaluateJavaScript("window.openSesamePlayerCommand(\(json))", completionHandler: nil)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard id == "youtube", message.webView === view, message.frameInfo.isMainFrame,
              let body = message.body as? [String: Any], body["generation"] as? String == generation else { return }
        emit(["event": "webview.youtube", "id": id, "generation": generation, "payload": body])
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if id != "youtube" { emit(["event": "webview.bookmark", "id": id, "generation": generation, "url": webView.url?.absoluteString ?? "", "title": webView.title ?? "", "state": "loaded"]) }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        emit(["event": "webview.error", "id": id, "generation": generation, "message": "The page could not load. Check the address and connection."])
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if id == "youtube", action.targetFrame?.isMainFrame == true {
            if url == identity || url.absoluteString == "about:blank" { decisionHandler(.allow) }
            else { if action.navigationType == .linkActivated, Self.pageURL(url.absoluteString) != nil { NSWorkspace.shared.open(url) }; decisionHandler(.cancel) }
        } else { decisionHandler(Self.pageURL(url.absoluteString) != nil || url.absoluteString == "about:blank" ? .allow : .cancel) }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = Self.pageURL(action.request.url?.absoluteString) {
            if id != "youtube" { webView.load(URLRequest(url: url)) } else { NSWorkspace.shared.open(url) }
        }
        return nil
    }

    func close() { view.stopLoading(); view.configuration.userContentController.removeScriptMessageHandler(forName: "youtubePlayer"); viewport.removeFromSuperview() }
    func matches(_ token: Any?) -> Bool { token as? String == generation }
    enum SurfaceError: LocalizedError {
        case invalidURL, invalidFrame, invalidCommand
        var errorDescription: String? { "Invalid embedded page request." }
    }
}
