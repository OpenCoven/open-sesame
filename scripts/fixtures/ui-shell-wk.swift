// WKWebView renderer fixture; injects only the test host, with no Tauri/provider acceptance.
import AppKit
import WebKit
import Darwin

final class Probe: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    let root: URL
    let address: URL
    let output: URL
    var window: NSWindow!
    var web: WKWebView!
    var finished = false
    init(root: URL, address: URL, output: URL) { self.root = root; self.address = address; self.output = output }
    func start() throws {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.add(self, name: "report")
        let host = try String(contentsOf: root.appendingPathComponent("scripts/fixtures/ui-shell-host.js"), encoding: .utf8)
        configuration.userContentController.addUserScript(WKUserScript(source: host, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1090, height: 700), configuration: configuration)
        web.navigationDelegate = self
        window = NSWindow(contentRect: web.frame, styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.title = "Open Sesame renderer fixture"
        window.isReleasedWhenClosed = false
        window.contentView = web
        window.orderFront(nil)
        web.load(URLRequest(url: address))
        Timer.scheduledTimer(withTimeInterval: 90, repeats: false) { [weak self] _ in self?.finish(["passed": false, "error": "Native renderer timed out."]) }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        do {
            let code = try String(contentsOf: root.appendingPathComponent("scripts/fixtures/ui-shell-probe.js"), encoding: .utf8)
            webView.evaluateJavaScript(code + "; undefined;") { [weak self] _, error in
                if let error { self?.finish(["passed": false, "error": error.localizedDescription]) }
            }
        } catch { finish(["passed": false, "error": error.localizedDescription]) }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let text = message.body as? String, let data = text.data(using: .utf8), let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            finish(["passed": false, "error": "Malformed renderer report."]); return
        }
        finish(value)
    }
    func finish(_ value: [String: Any]) {
        if finished { return }; finished = true
        var report = value
        report["renderer"] = "WKWebView"
        report["platform"] = ProcessInfo.processInfo.operatingSystemVersionString
        var success = (report["passed"] as? Bool) == true
        do { try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]).write(to: output) }
        catch { success = false; fputs("Could not write renderer report.\n", stderr) }
        web?.configuration.userContentController.removeScriptMessageHandler(forName: "report")
        web?.stopLoading()
        window?.contentView = nil
        web = nil
        window?.close()
        Darwin.exit(success ? 0 : 1)
    }
}
let args = CommandLine.arguments
if args.count != 4 { fatalError("usage: probe root loopback-url output") }
let application = NSApplication.shared
application.setActivationPolicy(.accessory)
let probe = Probe(root: URL(fileURLWithPath: args[1]), address: URL(string: args[2])!, output: URL(fileURLWithPath: args[3]))
do { try probe.start(); application.run() }
catch { probe.finish(["passed": false, "error": error.localizedDescription]) }
