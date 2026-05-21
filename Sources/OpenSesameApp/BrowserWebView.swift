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

@MainActor
final class BrowserController: ObservableObject {
    @Published private(set) var canGoBack: Bool = false
    @Published private(set) var canGoForward: Bool = false
    @Published private(set) var currentURL: URL?
    @Published var chromeHidden: Bool = false

    fileprivate weak var webView: WKWebView?
    private var observers: [NSKeyValueObservation] = []

    fileprivate func attach(_ webView: WKWebView) {
        self.webView = webView
        chromeHidden = false
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
    }

    func goBack() {
        webView?.goBack()
    }

    func goForward() {
        webView?.goForward()
    }

    func reload() {
        webView?.reload()
    }

    func load(_ url: URL) {
        webView?.load(URLRequest(url: url))
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
        Coordinator()
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

    final class Coordinator {
        var lastURL: URL?
        var lastReloadToken: UUID?
    }
}
