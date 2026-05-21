import Combine
import SwiftUI
import WebKit

@MainActor
final class BrowserController: ObservableObject {
    @Published private(set) var canGoBack: Bool = false
    @Published private(set) var canGoForward: Bool = false
    @Published private(set) var currentURL: URL?

    fileprivate weak var webView: WKWebView?
    private var observers: [NSKeyValueObservation] = []

    fileprivate func attach(_ webView: WKWebView) {
        self.webView = webView
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

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.allowsBackForwardNavigationGestures = true
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
