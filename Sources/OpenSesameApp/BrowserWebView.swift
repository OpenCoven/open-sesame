import Combine
import SwiftUI
import WebKit

private final class FocusableWebView: WKWebView {
    override var acceptsFirstResponder: Bool {
        true
    }

    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        super.mouseDown(with: event)
    }
}

/// A navigation error surfaced from WKWebView's NSError. We keep just what
/// the overlay needs and treat user-cancelled / new-load-in-flight as
/// non-errors (those happen during normal tab swaps and shouldn't render a
/// failure card).
struct WebLoadError: Identifiable, Equatable {
    let id = UUID()
    let url: URL?
    let title: String
    let detail: String

    init?(_ error: Error, url: URL?) {
        let nsError = error as NSError
        // -999 = NSURLErrorCancelled (user cancelled or new nav superseded);
        // 102 = WebKit "FrameLoadInterrupted" (same cause).
        let code = nsError.code
        if nsError.domain == NSURLErrorDomain && code == NSURLErrorCancelled { return nil }
        if nsError.domain == "WebKitErrorDomain" && code == 102 { return nil }

        self.url = url
        switch code {
        case NSURLErrorNotConnectedToInternet, NSURLErrorNetworkConnectionLost:
            title = "You're offline"
            detail = "Check your internet connection and try again."
        case NSURLErrorTimedOut:
            title = "Request timed out"
            detail = "The server didn't respond in time."
        case NSURLErrorCannotFindHost, NSURLErrorDNSLookupFailed:
            title = "Can't find the server"
            detail = "Make sure the URL is correct."
        case NSURLErrorServerCertificateUntrusted,
             NSURLErrorServerCertificateHasBadDate,
             NSURLErrorServerCertificateHasUnknownRoot,
             NSURLErrorServerCertificateNotYetValid:
            title = "Certificate issue"
            detail = "This site's security certificate isn't trusted."
        default:
            title = "Couldn't load this page"
            detail = nsError.localizedDescription
        }
    }
}

@MainActor
final class BrowserController: ObservableObject {
    @Published private(set) var canGoBack: Bool = false
    @Published private(set) var canGoForward: Bool = false
    @Published private(set) var currentURL: URL?
    @Published private(set) var isLoading: Bool = false
    @Published private(set) var estimatedProgress: Double = 0
    @Published private(set) var loadError: WebLoadError?
    @Published private(set) var magnification: CGFloat = 1
    @Published var chromeHidden: Bool = false

    fileprivate weak var webView: WKWebView?
    private var observers: [NSKeyValueObservation] = []

    fileprivate func attach(_ webView: WKWebView) {
        self.webView = webView
        chromeHidden = false
        loadError = nil
        magnification = webView.magnification
        observers.removeAll()

        observers.append(webView.observe(\.canGoBack, options: [.initial, .new]) { [weak self] webView, _ in
            Task { @MainActor in self?.canGoBack = webView.canGoBack }
        })
        observers.append(webView.observe(\.canGoForward, options: [.initial, .new]) { [weak self] webView, _ in
            Task { @MainActor in self?.canGoForward = webView.canGoForward }
        })
        observers.append(webView.observe(\.url, options: [.initial, .new]) { [weak self] webView, _ in
            Task { @MainActor in self?.currentURL = webView.url }
        })
        observers.append(webView.observe(\.isLoading, options: [.initial, .new]) { [weak self] webView, _ in
            Task { @MainActor in self?.isLoading = webView.isLoading }
        })
        observers.append(webView.observe(\.estimatedProgress, options: [.initial, .new]) { [weak self] webView, _ in
            Task { @MainActor in self?.estimatedProgress = webView.estimatedProgress }
        })
    }

    fileprivate func setError(_ error: WebLoadError?) {
        loadError = error
    }

    func goBack() {
        webView?.goBack()
    }

    func goForward() {
        webView?.goForward()
    }

    func reload() {
        loadError = nil
        webView?.reload()
    }

    func load(_ url: URL) {
        loadError = nil
        webView?.load(URLRequest(url: url))
    }

    // MARK: - Zoom

    private static let zoomStep: CGFloat = 0.1
    private static let zoomMin: CGFloat = 0.4
    private static let zoomMax: CGFloat = 3.0

    func zoomIn() { applyMagnification(magnification + Self.zoomStep) }
    func zoomOut() { applyMagnification(magnification - Self.zoomStep) }
    func resetZoom() { applyMagnification(1) }

    private func applyMagnification(_ value: CGFloat) {
        let clamped = min(Self.zoomMax, max(Self.zoomMin, value))
        webView?.setMagnification(clamped, centeredAt: .zero)
        magnification = clamped
    }

    // MARK: - Find

    /// Searches for `query`; resolves with whether a match was found.
    @discardableResult
    func find(_ query: String, forward: Bool = true) async -> Bool {
        guard let webView else { return false }
        guard !query.isEmpty else { return false }

        let config = WKFindConfiguration()
        config.backwards = !forward
        config.caseSensitive = false
        config.wraps = true

        return await withCheckedContinuation { continuation in
            webView.find(query, configuration: config) { result in
                continuation.resume(returning: result.matchFound)
            }
        }
    }
}

/// Receives scroll-direction messages from the injected page script and
/// updates the bound controller's `chromeHidden` flag. The script posts
/// `{ "dir": "down" | "up", "y": Number }` whenever the dominant scroll
/// direction changes (with a small dead-zone) and always reports "up" near
/// the top so the chrome reappears as you reach the page top.
@MainActor
final class ChromeScrollHandler: NSObject, WKScriptMessageHandler {
    weak var controller: BrowserController?

    init(controller: BrowserController) {
        self.controller = controller
        super.init()
    }

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "chromeScroll" else { return }
        guard let dict = message.body as? [String: Any],
              let dir = dict["dir"] as? String else { return }
        switch dir {
        case "down": controller?.chromeHidden = true
        case "up": controller?.chromeHidden = false
        default: break
        }
    }
}

/// Posts the dominant scroll direction back to the host whenever it changes
/// (with a 4px dead-zone) and forces "up" near the page top so the chrome
/// reappears when you reach the top edge.
@MainActor
private let chromeScrollScript: WKUserScript = {
    let source = """
    (function() {
      var lastY = 0;
      var lastDir = '';
      function notify(dir, y) {
        if (dir === lastDir) return;
        lastDir = dir;
        try { window.webkit.messageHandlers.chromeScroll.postMessage({ dir: dir, y: y }); } catch (e) {}
      }
      window.addEventListener('scroll', function() {
        var y = window.scrollY || document.documentElement.scrollTop || 0;
        var dy = y - lastY;
        if (y < 24) {
          notify('up', y);
        } else if (dy > 4) {
          notify('down', y);
        } else if (dy < -4) {
          notify('up', y);
        }
        lastY = y;
      }, { passive: true });
    })();
    """
    return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
}()

struct BrowserWebView: NSViewRepresentable {
    let url: URL
    let reloadToken: UUID
    let controller: BrowserController

    func makeCoordinator() -> Coordinator {
        Coordinator(controller: controller)
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.userContentController.add(BlockCounter.shared, name: "blockCounter")
        configuration.userContentController.addUserScript(ContentBlocker.blockTallyScript)

        configuration.userContentController.add(
            ChromeScrollHandler(controller: controller),
            name: "chromeScroll"
        )
        configuration.userContentController.addUserScript(chromeScrollScript)

        let webView = FocusableWebView(frame: .zero, configuration: configuration)
        webView.allowsBackForwardNavigationGestures = true
        webView.navigationDelegate = context.coordinator

        // Transparent web area so tab switches and slow paints don't flash
        // white over the sidebar's dark surface. `drawsBackground` is the
        // legacy private setter that's still respected by AppKit's WebView
        // backing layer.
        webView.setValue(false, forKey: "drawsBackground")
        if #available(macOS 14.0, *) {
            webView.underPageBackgroundColor = .clear
        }

        Task { @MainActor [weak webView] in
            guard let list = await ContentBlocker.shared.compiled(),
                  let webView else { return }
            webView.configuration.userContentController.add(list)
        }

        webView.load(URLRequest(url: url))

        context.coordinator.lastURL = url
        context.coordinator.lastReloadToken = reloadToken

        controller.attach(webView)

        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        if context.coordinator.lastURL != url {
            webView.load(URLRequest(url: url))
            context.coordinator.lastURL = url
            context.coordinator.lastReloadToken = reloadToken
            return
        }

        if context.coordinator.lastReloadToken != reloadToken {
            webView.reload()
            context.coordinator.lastReloadToken = reloadToken
        }
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate {
        let controller: BrowserController
        var lastURL: URL?
        var lastReloadToken: UUID?

        init(controller: BrowserController) {
            self.controller = controller
            super.init()
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            controller.setError(nil)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            controller.setError(WebLoadError(error, url: webView.url))
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            controller.setError(WebLoadError(error, url: webView.url ?? lastURL))
        }
    }
}
