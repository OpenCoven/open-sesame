import AppKit
import WebKit

final class NotchPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
    override func sendEvent(_ event: NSEvent) {
        if event.type == .leftMouseDown {
            NSApp.activate(ignoringOtherApps: true)
            makeKey()
        }
        super.sendEvent(event)
    }
}

final class OpenSesameApp: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {
    var panel: NotchPanel!
    var web: WKWebView!
    var surface: NSView!
    var voice: OpenSesameVoiceInput!
    var audioRecorder: OpenSesameAudioRecorder!
    var status: NSStatusItem!
    var bridge: Process?
    var input: FileHandle?
    var readBuffer = Data()
    var assets: URL!
    var currentSize = NSSize(width: 280, height: 35)
    var placement = "notch"
    var detached = false
    var detachedFrame: NSRect?
    var detachedRatio: CGFloat = 16.0 / 9.0
    var beforeFullscreen: NSRect?
    var shortcut: GlobalShortcut?
    var pendingLauncher = false
    var dockedScreenID: NSNumber?
    var embeddedPages: [String: EmbeddedWebSurface] = [:]
    var outsideClickMonitors: [Any] = []
    var authentication: OpenSesameAuthentication!
    var spotify: OpenSesameSpotify!
    var appUnlocked = false
    var pendingAuthenticationURLs: [URL] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        createMainMenu()
        let resources = Bundle.main.resourceURL!
        assets = resources.appendingPathComponent("web", isDirectory: true)
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "openSesame")
        let bookmarkScrollStyle = """
        if (window !== window.top && window.name === 'open-sesame-bookmark-preview') {
          const style = document.createElement('style');
          style.textContent = 'html,body {scrollbar-width:thin!important;scrollbar-color:#a6a4ab66 transparent!important} ::-webkit-scrollbar {width:6px;height:6px;background:transparent} ::-webkit-scrollbar-track,::-webkit-scrollbar-corner {background:transparent!important} ::-webkit-scrollbar-thumb {background:#a6a4ab66!important;border-radius:8px}';
          (document.head || document.documentElement).append(style);
        }
        """
        config.userContentController.addUserScript(WKUserScript(source: bookmarkScrollStyle, injectionTime: .atDocumentEnd, forMainFrameOnly: false, in: .defaultClient))
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "Development"
        let versionJSON = String(data: try! JSONSerialization.data(withJSONObject: [version]), encoding: .utf8)!
        config.userContentController.addUserScript(WKUserScript(source: "window.__OPEN_SESAME_NATIVE__=true;window.__OPEN_SESAME_VERSION__=\(versionJSON)[0];", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = WKWebView(frame: NSRect(origin: .zero, size: currentSize), configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        voice = OpenSesameVoiceInput { [weak self] event in
            guard let data = try? JSONSerialization.data(withJSONObject: event), let text = String(data: data, encoding: .utf8) else { return }
            self?.web.evaluateJavaScript("window.__openSesameReceive(\(text))", completionHandler: nil)
        }
        audioRecorder = OpenSesameAudioRecorder { [weak self] event in
            guard let data = try? JSONSerialization.data(withJSONObject: event), let json = String(data: data, encoding: .utf8) else { return }
            self?.web.evaluateJavaScript("window.__openSesameReceive(\(json))", completionHandler: nil)
        }
        web.underPageBackgroundColor = NSColor(srgbRed: 16.0/255, green: 17.0/255, blue: 19.0/255, alpha: 1)
        panel = NotchPanel(contentRect: NSRect(origin: .zero, size: currentSize), styleMask: [.borderless], backing: .buffered, defer: false)
        panel.becomesKeyOnlyIfNeeded = false
        panel.appearance = NSAppearance(named: .darkAqua)
        panel.delegate = self
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        surface = NSView(frame: NSRect(origin: .zero, size: currentSize))
        surface.wantsLayer = true
        surface.layer?.backgroundColor = NSColor(srgbRed: 16.0/255, green: 17.0/255, blue: 19.0/255, alpha: 1).cgColor
        surface.layer?.cornerRadius = 18
        surface.layer?.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]
        surface.layer?.masksToBounds = true
        panel.contentView = surface
        web.autoresizingMask = [.width, .height]
        surface.addSubview(web)
        createStatusItem()
        watchOutsideClicks()
        shortcut = GlobalShortcut { [weak self] in self?.openLauncher() }
        web.configuration.userContentController.addUserScript(WKUserScript(source: "window.__OPEN_SESAME_GLOBAL_SHORTCUT__=\(shortcut?.available == true ? "true" : "false");", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        status.button?.toolTip = shortcut?.available == true ? "Open Sesame · Option–Space" : "Open Sesame · Option–Space unavailable"
        spotify = OpenSesameSpotify()
        spotify.window = panel
        spotify.changed = { [weak self] in
            guard let self, let data = try? JSONSerialization.data(withJSONObject: ["event": "music.spotify.changed", "status": self.spotify.status]), let json = String(data: data, encoding: .utf8) else { return }
            self.web.evaluateJavaScript("window.__openSesameReceive && window.__openSesameReceive(\(json))", completionHandler: nil)
        }
        authentication = OpenSesameAuthentication()
        authentication.window = panel
        authentication.changed = { [weak self] in self?.authenticationChanged() }
        showSignIn()
        let pendingURLs = pendingAuthenticationURLs; pendingAuthenticationURLs.removeAll()
        if !pendingURLs.contains(where: { $0.path == "/login" }) { authentication.restore() }
        if !pendingURLs.isEmpty { application(NSApp, open: pendingURLs) }
        positionPanel()
        panel.orderFrontRegardless()
    }

    func showSignIn() {
        currentSize = NSSize(width: 680, height: 382)
        positionPanel()
        web.loadFileURL(assets.appendingPathComponent("sign-in.html"), allowingReadAccessTo: assets)
    }

    func authenticationChanged() {
        if authentication.authenticated {
            if !appUnlocked {
                appUnlocked = true
                startBridge(resources: Bundle.main.resourceURL!)
                web.loadFileURL(assets.appendingPathComponent("index.html"), allowingReadAccessTo: assets)
            }
        } else if appUnlocked {
            spotify.disconnect()
            appUnlocked = false; pendingLauncher = false
            voice.cancel(); audioRecorder.clear()
            for window in NSApp.windows { if let picker = window as? NSSavePanel, picker.isVisible { picker.cancel(nil) } }
            embeddedPages.values.forEach { $0.close() }; embeddedPages.removeAll()
            let previous = bridge; bridge = nil
            try? input?.close(); input = nil; readBuffer.removeAll()
            // EOF lets the host close its PTYs, agent jobs and workers before an eventual termination.
            DispatchQueue.main.asyncAfter(deadline: .now()+3) { if previous?.isRunning == true { previous?.terminate() } }
            if detached { setDetached(false, aspectRatio: detachedRatio, focus: false) }
            showSignIn()
        }
        web.evaluateJavaScript("window.dispatchEvent(new Event('open-sesame-auth-changed'))", completionHandler: nil)
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls where url.scheme == "opensesame" && url.host == "auth" {
            guard authentication != nil else { pendingAuthenticationURLs = [url]; return }
            if url.path == "/login" { showPanel(); authentication.signIn() }
            else if url.path == "/signed-out" { authentication.signOut(endRemoteSession: false); showPanel() }
        }
    }

    @objc func signOut() { authentication.signOut() }

    func createMainMenu() {
        let main = NSMenu(), appItem = NSMenuItem(), editItem = NSMenuItem()
        let application = NSMenu(), edit = NSMenu(title: "Edit")
        application.addItem(withTitle: "Quit Open Sesame", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = application
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        main.addItem(appItem); main.addItem(editItem); NSApp.mainMenu = main
    }

    func createStatusItem() {
        status = NSStatusBar.system.statusItem(withLength: 30)
        let image = NSImage(size: NSSize(width: 20, height: 14), flipped: false) { _ in
            NSColor.labelColor.setFill()
            for mirrored in [false, true] {
                let path = NSBezierPath()
                func point(_ x: CGFloat, _ y: CGFloat) -> NSPoint { NSPoint(x: mirrored ? 20-x : x, y: y) }
                path.move(to: point(1, 10)); path.curve(to: point(9, 5), controlPoint1: point(5, 10), controlPoint2: point(8, 7)); path.curve(to: point(1, 10), controlPoint1: point(5, 1), controlPoint2: point(2, 4)); path.close(); path.fill()
            }
            return true
        }
        image.isTemplate = true
        status.button?.image = image
        status.button?.target = self
        status.button?.action = #selector(statusPressed)
        status.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
        status.button?.toolTip = "Open Sesame"
    }

    @objc func statusPressed() {
        if NSApp.currentEvent?.type == .rightMouseUp {
            let menu = NSMenu()
            menu.addItem(withTitle: "Show Open Sesame", action: #selector(showPanel), keyEquivalent: "")
            let launcher = menu.addItem(withTitle: "Open launcher", action: #selector(openLauncher), keyEquivalent: " ")
            launcher.keyEquivalentModifierMask = [.option]; launcher.target = self
            if shortcut?.available != true {
                let notice = menu.addItem(withTitle: "Option–Space is unavailable", action: nil, keyEquivalent: "")
                notice.isEnabled = false
            }
            menu.addItem(.separator())
            if authentication.authenticated { menu.addItem(withTitle: "Sign out of Open Sesame", action: #selector(signOut), keyEquivalent: "").target = self }
            menu.addItem(withTitle: "Quit Open Sesame", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
            for item in menu.items where item.action == #selector(showPanel) { item.target = self }
            status.menu = menu
            status.button?.performClick(nil)
            status.menu = nil
        } else if panel.isVisible { web?.evaluateJavaScript("window.OpenSesameLive?.stopForHide()", completionHandler: nil); voice.cancel(); panel.orderOut(nil) } else { showPanel() }
    }

    @objc func showPanel() {
        positionPanel(); NSApp.activate(ignoringOtherApps: true); panel.makeKeyAndOrderFront(nil)
    }

    func watchOutsideClicks() {
        let mask: NSEvent.EventTypeMask = [.leftMouseDown, .rightMouseDown, .otherMouseDown]
        if let monitor = NSEvent.addGlobalMonitorForEvents(matching: mask, handler: { [weak self] event in self?.outsideClick(event) }) { outsideClickMonitors.append(monitor) }
        if let monitor = NSEvent.addLocalMonitorForEvents(matching: mask, handler: { [weak self] event in self?.outsideClick(event); return event }) { outsideClickMonitors.append(monitor) }
    }

    func outsideClick(_ event: NSEvent) {
        if authentication?.busy == true || spotify?.busy == true { return }
        let point = NSEvent.mouseLocation
        guard panel.isVisible, !panel.frame.contains(point), NSApp.modalWindow == nil, panel.attachedSheet == nil else { return }
        // App-owned menus and pickers are part of the current interaction.
        if let window = event.window, window !== panel { return }
        if NSApp.windows.contains(where: { ($0 is NSSavePanel) && $0.isVisible }) { return }
        if let button = status.button, let window = button.window, window.convertToScreen(button.convert(button.bounds, to: nil)).contains(point) { return }
        if !authentication.authenticated { panel.orderOut(nil); return }
        DispatchQueue.main.async { [weak self] in
            self?.web.evaluateJavaScript("void window.OpenSesameWindow?.collapse({outside:true})", completionHandler: nil)
        }
    }

    @objc func openLauncher() {
        guard authentication.authenticated else { showPanel(); return }
        let toggle = panel.isVisible && panel.isKeyWindow
        showPanel()
        panel.makeFirstResponder(web)
        web.evaluateJavaScript("Boolean(window.OpenSesameLauncher && (window.OpenSesameLauncher.\(toggle ? "toggle" : "open")(), true))") { [weak self] value, _ in
            self?.pendingLauncher = value as? Bool != true
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if webView === web, authentication.authenticated, pendingLauncher { pendingLauncher = false; openLauncher() }
    }

    func placementScreen() -> NSScreen? {
        if let screen = panel?.screen { return screen }
        if let id = dockedScreenID, let screen = NSScreen.screens.first(where: { $0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber == id }) { return screen }
        return NSScreen.main ?? NSScreen.screens.first
    }

    func positionPanel() {
        if detached { return }
        guard let screen = placementScreen() else { return }
        dockedScreenID = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber
        let frame = screen.frame
        if currentSize.width >= frame.width && currentSize.height >= frame.height {
            panel.setFrame(frame, display: true); return
        }
        var x = frame.midX-currentSize.width/2
        var top = placement == "menu" ? screen.visibleFrame.maxY - 5 : frame.maxY
        if placement == "menu", let button = status.button, let window = button.window, window.screen == screen {
            let rect = window.convertToScreen(button.convert(button.bounds, to: nil))
            x = rect.maxX-currentSize.width
            top = rect.minY-5
        }
        if placement == "capture" { top = screen.visibleFrame.midY + currentSize.height / 2 }
        x = max(frame.minX+4, min(frame.maxX-currentSize.width-4, x))
        panel.setFrame(NSRect(x: x, y: top-currentSize.height, width: currentSize.width, height: currentSize.height), display: true, animate: false)
        web?.layoutSubtreeIfNeeded()
        web?.evaluateJavaScript("window.dispatchEvent(new Event('open-sesame-layout'))", completionHandler: nil)
    }

    // Keep the same web view, streams and PTYs while changing the window shell.
    func rememberDetachedFrame(_ frame: NSRect) {
        detachedFrame = frame
        UserDefaults.standard.set(Double(panel.contentRect(forFrameRect: frame).width), forKey: "openSesame.floatingWidth")
    }

    func setDetached(_ value: Bool, aspectRatio: CGFloat, focus: Bool = true) {
        guard value != detached else { return }
        if !value { rememberDetachedFrame(beforeFullscreen ?? panel.frame) }
        detached = value
        beforeFullscreen = nil
        if value {
            detachedRatio = aspectRatio
            panel.styleMask = [.titled, .closable, .miniaturizable, .resizable]
            panel.title = "Open Sesame"
            panel.titleVisibility = .visible
            panel.level = .floating
            panel.isMovable = true
            if let screen = panel.screen ?? placementScreen() {
                let area = screen.visibleFrame
                let contentArea = panel.contentRect(forFrameRect: area).size
                let storedWidth = UserDefaults.standard.double(forKey: "openSesame.floatingWidth")
                let preferredWidth = detachedFrame.map { panel.contentRect(forFrameRect: $0).width } ?? (storedWidth.isFinite && storedWidth > 0 ? CGFloat(storedWidth) : currentSize.width)
                let limit = max(1, min(contentArea.width, contentArea.height * aspectRatio))
                let width = min(limit, max(800, preferredWidth))
                panel.contentMinSize = NSSize(width: min(800, limit), height: min(800, limit) / aspectRatio)
                panel.contentAspectRatio = NSSize(width: aspectRatio, height: 1)
                let size = panel.frameRect(forContentRect: NSRect(x: 0, y: 0, width: width, height: width / aspectRatio)).size
                let x = max(area.minX, min(area.maxX-size.width, detachedFrame?.minX ?? area.midX-size.width/2))
                let y = max(area.minY, min(area.maxY-size.height, detachedFrame?.minY ?? area.midY-size.height/2))
                panel.setFrame(NSRect(x: x, y: y, width: size.width, height: size.height), display: true)
            }
            surface.layer?.cornerRadius = 0
        } else {
            panel.contentAspectRatio = .zero
            panel.contentMinSize = .zero
            panel.styleMask = [.borderless]
            panel.minSize = .zero
            panel.level = .statusBar
            positionPanel()
        }
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        if focus { panel.makeKeyAndOrderFront(nil) }
        web.evaluateJavaScript("window.dispatchEvent(new Event('resize'))", completionHandler: nil)
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if !authentication.authenticated { panel.orderOut(nil); return false }
        web.evaluateJavaScript("void window.OpenSesameWindow?.collapse({focus:true})", completionHandler: nil)
        return false
    }

    func windowDidEndLiveResize(_ notification: Notification) {
        if detached && beforeFullscreen == nil { rememberDetachedFrame(panel.frame) }
    }

    func startBridge(resources: URL) {
        let savedPython = (try? String(contentsOf: resources.appendingPathComponent("python-path.txt"), encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)) ?? ""
        let candidates = [savedPython, "/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3"]
        guard let python = candidates.first(where: { !$0.isEmpty && FileManager.default.isExecutableFile(atPath: $0) }) else {
            let alert = NSAlert(); alert.messageText = "Python 3 is needed for local shells"; alert.informativeText = "Install Python 3, then reopen Open Sesame. No shell connection has been opened."; alert.runModal(); return
        }
        let process = Process(), stdin = Pipe(), stdout = Pipe(), stderr = Pipe()
        process.executableURL = URL(fileURLWithPath: python)
        process.arguments = ["-B", "-u", resources.appendingPathComponent("bridge.py").path, "--stdio"]
        process.standardInput = stdin; process.standardOutput = stdout; process.standardError = stderr
        stdout.fileHandleForReading.readabilityHandler = { [weak self, weak process] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            DispatchQueue.main.async { guard let process, self?.bridge === process, self?.authentication.authenticated == true else { return }; self?.consume(data) }
        }
        // Drain diagnostic stderr without exposing shell contents in application logs.
        stderr.fileHandleForReading.readabilityHandler = { handle in _ = handle.availableData }
        process.terminationHandler = { [weak self, weak process] _ in DispatchQueue.main.async { guard let process, self?.bridge === process else { return }; self?.web.evaluateJavaScript("window.dispatchEvent(new Event('open-sesame-desktop-disconnected'))", completionHandler: nil) } }
        do { try process.run(); bridge = process; input = stdin.fileHandleForWriting } catch {
            let alert = NSAlert(); alert.messageText = "Could not start the desktop connection"; alert.informativeText = error.localizedDescription; alert.runModal()
        }
    }

    func consume(_ data: Data) {
        readBuffer.append(data)
        while let end = readBuffer.firstIndex(of: 10) {
            let line = readBuffer[..<end]; readBuffer.removeSubrange(...end)
            if let text = String(data: Data(line), encoding: .utf8), (try? JSONSerialization.jsonObject(with: Data(line))) != nil {
                web.evaluateJavaScript("window.__openSesameReceive && window.__openSesameReceive(\(text))", completionHandler: nil)
            }
        }
    }

    func respond(_ id: Any?, result: Any? = nil, error: String? = nil) {
        var message: [String:Any] = ["requestId": id ?? NSNull()]
        if let error = error { message["error"] = error } else { message["result"] = result ?? NSNull() }
        if let data = try? JSONSerialization.data(withJSONObject: message), let text = String(data: data, encoding: .utf8) {
            web.evaluateJavaScript("window.__openSesameReceive(\(text))", completionHandler: nil)
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let source = message.frameInfo.request.url, source.isFileURL, source.resolvingSymlinksInPath().path.hasPrefix(assets.resolvingSymlinksInPath().path + "/"), let body = message.body as? [String:Any], let method = body["method"] as? String else { return }
        let params = body["params"] as? [String:Any] ?? [:], requestId = body["requestId"]
        if method == "auth.status" { respond(requestId, result: authentication.status); return }
        if method == "auth.signIn" { respond(requestId, result: true); authentication.signIn(); return }
        if method == "auth.cancel" { respond(requestId, result: true); authentication.cancel(); return }
        if method == "auth.signOut" { respond(requestId, result: true); authentication.signOut(); return }
        if method == "system.info", !authentication.authenticated { respond(requestId, result: ["platform": "darwin", "authenticated": false]); return }
        guard authentication.authenticated || method == "window.focus" else { respond(requestId, error: "Sign in to Open Sesame before using this tool."); return }
        if method == "window.focus" {
            NSApp.activate(ignoringOtherApps: true); panel.makeKeyAndOrderFront(nil); panel.makeFirstResponder(web)
            respond(requestId, result: true); return
        }
        if method.hasPrefix("music.spotify.") {
            do {
                switch method {
                case "music.spotify.status": break
                case "music.spotify.configure": try spotify.configure(params["clientId"] as? String ?? "")
                case "music.spotify.signIn": try spotify.signIn()
                case "music.spotify.disconnect", "music.spotify.cancel": spotify.disconnect()
                default: respond(requestId, error: "Unsupported Spotify action."); return
                }
                respond(requestId, result: spotify.status)
            } catch { respond(requestId, error: "Check your Spotify public client ID and registered redirect URI.") }
            return
        }
        if method.hasPrefix("webview.") {
            guard let id = params["id"] as? String, ["bookmark", "reading-bookmark", "youtube"].contains(id) else { respond(requestId, error: "Unsupported embedded page."); return }
            do {
                if method == "webview.open" {
                    if embeddedPages[id] == nil {
                        embeddedPages[id] = EmbeddedWebSurface(id: id, parent: web, assets: assets) { [weak self] event in
                            guard let data = try? JSONSerialization.data(withJSONObject: event), let json = String(data: data, encoding: .utf8) else { return }
                            self?.web.evaluateJavaScript("window.__openSesameReceive(\(json))", completionHandler: nil)
                        }
                    }
                    try embeddedPages[id]?.open(params)
                } else if let page = embeddedPages[id], page.matches(params["generation"]) {
                    if method == "webview.frame" { try page.frame(params) }
                    else if method == "webview.command" { try page.command(params) }
                    else if method == "webview.close" { page.close(); embeddedPages.removeValue(forKey: id) }
                    else { throw EmbeddedWebSurface.SurfaceError.invalidCommand }
                }
                respond(requestId, result: true)
            } catch { respond(requestId, error: error.localizedDescription) }
            return
        }
        if method == "speech.start" {
            voice.start(id: params["id"] as? String ?? "", locale: params["locale"] as? String ?? "en-US", source: params["source"] as? String ?? "mic") { [weak self] error in self?.respond(requestId, result: ["sourceLabel": self?.voice.inputName ?? "System microphone"], error: error) }
            return
        }
        if method.hasPrefix("record.") {
            let id = params["id"] as? String ?? ""
            if method == "record.start" { voice.cancel(); audioRecorder.start(id: id, source: params["source"] as? String ?? "mic") { [weak self] result, error in self?.respond(requestId, result: result, error: error) } }
            else if method == "record.stop" { audioRecorder.stopAsync(id: id) { [weak self] ready in self?.respond(requestId, result: ["ready": ready]) } }
            else if method == "record.save" { audioRecorder.save(id: id) { [weak self] saved, error in self?.respond(requestId, result: saved, error: error) } }
            else if method == "record.clear" { audioRecorder.clear(); respond(requestId, result: true) }
            else { respond(requestId, error: "Unsupported recording action.") }
            return
        }
        if method == "speech.stop" {
            voice.stop(id: params["id"] as? String ?? "", cancel: params["cancel"] as? Bool == true); respond(requestId, result: true); return
        }
        if method == "window.detach" {
            let ratio = (params["aspectRatio"] as? NSNumber)?.doubleValue ?? Double(detachedRatio)
            guard ratio.isFinite, ratio >= 1, ratio <= 3 else { respond(requestId, error: "Invalid window ratio."); return }
            setDetached(params["detached"] as? Bool == true, aspectRatio: CGFloat(ratio), focus: params["focus"] as? Bool ?? true)
            respond(requestId, result: ["detached": detached, "alwaysOnTop": true]); return
        }
        if method == "window.fullscreen" {
            if detached, let screen = panel.screen ?? NSScreen.main {
                if let previous = beforeFullscreen { panel.contentAspectRatio = NSSize(width: detachedRatio, height: 1); panel.setFrame(previous, display: true); beforeFullscreen = nil }
                else { beforeFullscreen = panel.frame; panel.contentAspectRatio = .zero; panel.setFrame(screen.visibleFrame, display: true) }
            }
            respond(requestId, result: ["fullscreen": beforeFullscreen != nil]); return
        }
        if method == "window.size" {
            if detached { respond(requestId, result: true); return }

            let screenFrame = placementScreen()?.frame ?? NSRect(x: 0, y: 0, width: 1512, height: 982)
            let full = params["full"] as? Bool == true
            let requestedWidth = (params["width"] as? NSNumber)?.doubleValue ?? 280
            let requestedHeight = (params["height"] as? NSNumber)?.doubleValue ?? 35
            guard requestedWidth.isFinite, requestedHeight.isFinite else { respond(requestId, error: "Invalid window dimensions."); return }
            let width = full ? Double(screenFrame.width) : min(Double(screenFrame.width) - 8, max(180, requestedWidth))
            let height = full ? Double(screenFrame.height) : min(Double(screenFrame.height) - 50, max(24, requestedHeight))
            currentSize = NSSize(width: width, height: height)
            placement = params["layout"] as? String ?? "notch"
            surface.layer?.cornerRadius = placement == "capture" ? 18 : params["expanded"] as? Bool == true ? (placement == "notch" ? 28 : 22) : 18
            surface.layer?.maskedCorners = placement == "notch" ? [.layerMinXMinYCorner, .layerMaxXMinYCorner] : [.layerMinXMinYCorner, .layerMaxXMinYCorner, .layerMinXMaxYCorner, .layerMaxXMaxYCorner]
            if full {
                panel.setFrame(screenFrame, display: true)
                surface.layer?.cornerRadius = 0
            } else { positionPanel() }
            respond(requestId, result: true); return
        }
        if method == "project.chooseFolder" {
            let picker = NSOpenPanel(); picker.canChooseDirectories = true; picker.canChooseFiles = false; picker.allowsMultipleSelection = false; picker.prompt = "Use project folder"
            picker.begin { [weak self] response in self?.respond(requestId, result: response == .OK ? ["path": picker.url?.path ?? ""] : ["path": ""]) }
            return
        }
        if method == "reading.saveRSS" {
            guard let xml = params["xml"] as? String, let data = xml.data(using: .utf8), data.count <= 3000000, xml.hasPrefix("<?xml"), xml.contains("<rss version=\"2.0\">") else { respond(requestId, error: "The RSS could not be prepared."); return }
            let picker = NSSavePanel(); picker.allowedFileTypes = ["xml"]; picker.canCreateDirectories = true; picker.nameFieldStringValue = "open-sesame-feed.xml"
            picker.begin { [weak self] response in
                guard response == .OK, let url = picker.url else { self?.respond(requestId, result: ["saved": false]); return }
                do { try data.write(to: url, options: .atomic); self?.respond(requestId, result: ["saved": true]) }
                catch { self?.respond(requestId, error: "Could not save the feed to this location.") }
            }
            return
        }
        if method == "reading.saveEPUB" {
            guard let encoded = params["data"] as? String, encoded.count <= 3000000, let data = Data(base64Encoded: encoded), data.starts(with: [0x50, 0x4b, 0x03, 0x04]) else { respond(requestId, error: "The EPUB could not be prepared."); return }
            let picker = NSSavePanel(); picker.allowedFileTypes = ["epub"]; picker.canCreateDirectories = true
            picker.nameFieldStringValue = ((params["name"] as? String ?? "Article.epub") as NSString).lastPathComponent
            picker.begin { [weak self] response in
                guard response == .OK, let url = picker.url else { self?.respond(requestId, result: ["saved": false]); return }
                do { try data.write(to: url, options: .atomic); self?.respond(requestId, result: ["saved": true]) }
                catch { self?.respond(requestId, error: "Could not save the EPUB to this location.") }
            }
            return
        }
        let allowed = ["coven.status", "coven.familiars", "coven.open", "coven.new", "coven.send", "coven.cancel", "computer.control", "system.info", "agents.snapshot", "live.agents", "live.ask", "terminal.open", "terminal.input", "terminal.resize", "terminal.close", "feeds.fetch", "reading.fetch", "reading.pdf", "controller.start", "controller.stop", "controller.status", "controller.poll", "controller.ack"]
        guard allowed.contains(method), let input = input, bridge?.isRunning == true else { respond(requestId, error: "The desktop terminal bridge is unavailable."); return }
        do { var data = try JSONSerialization.data(withJSONObject: body); data.append(10); try input.write(contentsOf: data) } catch { respond(requestId, error: "Could not reach the desktop terminal bridge.") }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard action.targetFrame?.isMainFrame != false, let url = action.request.url else { decisionHandler(.allow); return }
        if url.isFileURL && url.resolvingSymlinksInPath().path.hasPrefix(assets.resolvingSymlinksInPath().path + "/") { decisionHandler(authentication?.authenticated == true || url.lastPathComponent == "sign-in.html" ? .allow : .cancel) }
        else { if ["https", "http"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }; decisionHandler(.cancel) }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, ["https", "http"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }; return nil
    }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        guard authentication.authenticated, webView === web, frame.isMainFrame, let url = webView.url, url.isFileURL, url.resolvingSymlinksInPath().path.hasPrefix(assets.resolvingSymlinksInPath().path + "/") else { completionHandler(nil); return }
        let picker = NSOpenPanel(); picker.canChooseFiles = !parameters.allowsDirectories; picker.canChooseDirectories = parameters.allowsDirectories; picker.allowsMultipleSelection = parameters.allowsMultipleSelection; picker.prompt = "Choose"; picker.level = .statusBar
        NSApp.activate(ignoringOtherApps: true)
        picker.beginSheetModal(for: panel) { [weak self] response in completionHandler(response == .OK && self?.authentication.authenticated == true ? picker.urls : nil) }
    }
    func applicationWillTerminate(_ notification: Notification) { authentication?.shutdown(); outsideClickMonitors.forEach { NSEvent.removeMonitor($0) }; outsideClickMonitors.removeAll(); shortcut?.stop(); voice?.cancel(); audioRecorder?.clear(); embeddedPages.values.forEach { $0.close() }; try? input?.close(); bridge?.terminate() }
}

@main
struct OpenSesameLauncher {
    static func main() {
        let app = NSApplication.shared
        let delegate = OpenSesameApp()
        app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}
