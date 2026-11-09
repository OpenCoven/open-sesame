// Native application entrypoint, window lifecycle and authenticated main-frame RPC gateway.
// Handlers below own Swift-only operations; the allowlisted Python path uses Bridge.handle in bridge.py. See docs/repository-map.md.
import AppKit
import WebKit
import ColorSync

final class NotchPanel: NSPanel {
    var onEscape: (() -> Bool)?
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
    override func sendEvent(_ event: NSEvent) {
        if event.type == .keyDown, event.keyCode == 53, event.modifierFlags.intersection([.command, .control, .option, .shift]).isEmpty, onEscape?() == true { return }
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
    let vnc = VNCTransport()
    var bridge: Process?
    var input: FileHandle?
    var readBuffer = Data()
    var assets: URL!
    var currentSize = NSSize(width: 280, height: 35)
    var requestedSize = NSSize(width: 280, height: 35)
    var fillsDisplay = false
    var placement = "notch"
    var detached = false
    var detachedFrame: NSRect?
    var detachedRatio: CGFloat = 16.0 / 9.0
    var beforeFullscreen: NSRect?
    var shortcut: GlobalShortcut?
    var screenNotes = OpenSesameScreenNotes()
    var trackingNativeMenus = Set<ObjectIdentifier>()
    var pendingLauncher = false
    var dockedScreenID: NSNumber?
    var dockedScreenFrame: NSRect?
    var reportedDisplay = ""
    var pointerFollowTimer: Timer?
    var displayPreference = OpenSesameDisplayPreference.load()
    var displayMenuOpen = false
    var needsDisplayReanchor = false
    var embeddedPages: [String: EmbeddedWebSurface] = [:]
    var outsideClickMonitors: [Any] = []
    var authentication: OpenSesameAuthentication!
    var spotify: OpenSesameSpotify!
    var protectedShare: OpenSesameProtectedShare!
    var appUnlocked = false
    var pendingAuthenticationURLs: [URL] = []
    var familiarPermissions = OpenSesameFamiliarPermissions()
    var nativeCallbacks: [String: ([String: Any]) -> Void] = [:]

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
        web.focusRingType = .none
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
        surface.autoresizingMask = [.width, .height]
        web.translatesAutoresizingMaskIntoConstraints = false
        surface.addSubview(web)
        NSLayoutConstraint.activate([web.leadingAnchor.constraint(equalTo: surface.leadingAnchor), web.trailingAnchor.constraint(equalTo: surface.trailingAnchor), web.topAnchor.constraint(equalTo: surface.topAnchor), web.bottomAnchor.constraint(equalTo: surface.bottomAnchor)])
        createStatusItem()
        NotificationCenter.default.addObserver(self, selector: #selector(nativeMenuBegan(_:)), name: NSMenu.didBeginTrackingNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(nativeMenuEnded(_:)), name: NSMenu.didEndTrackingNotification, object: nil)
        watchOutsideClicks()
        shortcut = GlobalShortcut { [weak self] in self?.openLauncher() }
        web.configuration.userContentController.addUserScript(WKUserScript(source: "window.__OPEN_SESAME_GLOBAL_SHORTCUT__=\(shortcut?.available == true ? "true" : "false");", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        status.button?.toolTip = shortcut?.available == true ? "Open Sesame · Option–Space" : "Open Sesame · Option–Space unavailable"
        spotify = OpenSesameSpotify()
        protectedShare = OpenSesameProtectedShare()
        protectedShare.changed = { [weak self] in
            guard let self, let data = try? JSONSerialization.data(withJSONObject: ["event": "privacy.changed", "status": self.protectedShare.status]), let json = String(data: data, encoding: .utf8) else { return }
            self.web.evaluateJavaScript("window.__openSesameReceive && window.__openSesameReceive(\(json))", completionHandler: nil)
        }
        spotify.window = panel
        spotify.changed = { [weak self] in
            guard let self, let data = try? JSONSerialization.data(withJSONObject: ["event": "music.spotify.changed", "status": self.spotify.status]), let json = String(data: data, encoding: .utf8) else { return }
            self.web.evaluateJavaScript("window.__openSesameReceive && window.__openSesameReceive(\(json))", completionHandler: nil)
        }
        vnc.emit = { [weak self] message in
            guard let self, self.authentication?.authenticated == true, let data = try? JSONSerialization.data(withJSONObject: message), let json = String(data:data, encoding:.utf8) else { return }
            self.web.evaluateJavaScript("window.__openSesameReceive && window.__openSesameReceive(\(json))", completionHandler:nil)
        }
        authentication = OpenSesameAuthentication()
        screenNotes.window = panel
        familiarPermissions.window = panel
        familiarPermissions.authenticated = { [weak self] in self?.authentication?.authenticated == true }
        familiarPermissions.call = { [weak self] method, params, completion in self?.nativeCall(method, params: params, completion: completion) }
        authentication.window = panel
        panel.onEscape = { [weak self] in
            guard let self, self.panel.isKeyWindow, self.panel.isVisible, NSApp.modalWindow == nil, self.panel.attachedSheet == nil, !self.displayMenuOpen, self.trackingNativeMenus.isEmpty, !self.authentication.busy, !self.spotify.busy else { return false }
            if !self.authentication.authenticated { self.panel.orderOut(nil); return true }
            // Forward child WKWebView Escape into the trusted app's dismissal stack. Never navigate or close a provider page.
            self.web.evaluateJavaScript("window.OpenSesameEscape?.native()", completionHandler: nil)
            return true
        }
        authentication.changed = { [weak self] in self?.authenticationChanged() }
        showSignIn()
        let pendingURLs = pendingAuthenticationURLs; pendingAuthenticationURLs.removeAll()
        if !pendingURLs.contains(where: { $0.path == "/login" }) { authentication.restore() }
        if !pendingURLs.isEmpty { application(NSApp, open: pendingURLs) }
        positionPanel()
        panel.orderFrontRegardless()
        watchPointerDisplay()
    }

    @objc func nativeMenuBegan(_ notification: Notification) {
        if let menu = notification.object as? NSMenu { trackingNativeMenus.insert(ObjectIdentifier(menu)) }
    }
    @objc func nativeMenuEnded(_ notification: Notification) {
        if let menu = notification.object as? NSMenu { trackingNativeMenus.remove(ObjectIdentifier(menu)) }
    }

    func showSignIn() {
        requestedSize = NSSize(width: 680, height: 382); fillsDisplay = false
        positionPanel()
        web.loadFileURL(assets.appendingPathComponent("sign-in.html"), allowingReadAccessTo: assets)
    }

    func authenticationChanged() {
        if !authentication.authenticated { vnc.closeAll() }
        if authentication.authenticated {
            if !appUnlocked {
                appUnlocked = true
                startBridge(resources: Bundle.main.resourceURL!)
                web.loadFileURL(assets.appendingPathComponent("index.html"), allowingReadAccessTo: assets)
            }
        } else if appUnlocked {
            screenNotes.cancel()
            familiarPermissions.cancel()
            failNativeCallbacks()
            protectedShare.stop()
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
        if let url = Bundle.main.url(forResource: "OpenSesame", withExtension: "icns"), let image = NSImage(contentsOf: url) {
            NSApp.applicationIconImage = image
            let menuImage = image.copy() as! NSImage
            menuImage.size = NSSize(width: 20, height: 20); menuImage.isTemplate = false
            status.button?.image = menuImage
        } else { status.button?.title = "OS" }
        status.button?.target = self
        status.button?.action = #selector(statusPressed)
        status.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
        status.button?.toolTip = "Open Sesame"
    }

    @objc func statusPressed() {
        if NSApp.currentEvent?.type == .rightMouseUp {
            let menu = NSMenu()
            menu.addItem(withTitle: "Open widget", action: #selector(showWidget), keyEquivalent: "")
            let launcher = menu.addItem(withTitle: "Open launcher", action: #selector(openLauncher), keyEquivalent: " ")
            launcher.keyEquivalentModifierMask = [.option]; launcher.target = self
            if shortcut?.available != true {
                let notice = menu.addItem(withTitle: "Option–Space is unavailable", action: nil, keyEquivalent: "")
                notice.isEnabled = false
            }
            menu.addItem(.separator())
            let display = menu.addItem(withTitle: "Widget display", action: nil, keyEquivalent: "")
            display.submenu = widgetDisplayMenu()
            menu.addItem(.separator())
            if authentication.authenticated { menu.addItem(withTitle: "Sign out of Open Sesame", action: #selector(signOut), keyEquivalent: "").target = self }
            menu.addItem(withTitle: "Quit Open Sesame", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
            for item in menu.items where item.action == #selector(showWidget) { item.target = self }
            status.menu = menu
            status.button?.performClick(nil)
            status.menu = nil
        } else if panel.isVisible, authentication.authenticated { web.evaluateJavaScript("void window.OpenSesameWindow?.toggle()", completionHandler: nil) } else { showWidget() }
    }

    @objc func showPanel() {
        positionPanel(); NSApp.activate(ignoringOtherApps: true); panel.makeKeyAndOrderFront(nil)
    }

    @objc func showWidget() {
        showPanel()
        if authentication.authenticated { web.evaluateJavaScript("void window.OpenSesameWindow?.show()", completionHandler: nil) }
    }

    func watchOutsideClicks() {
        let mask: NSEvent.EventTypeMask = [.leftMouseDown, .rightMouseDown, .otherMouseDown]
        if let monitor = NSEvent.addGlobalMonitorForEvents(matching: mask, handler: { [weak self] event in self?.outsideClick(event) }) { outsideClickMonitors.append(monitor) }
        if let monitor = NSEvent.addLocalMonitorForEvents(matching: mask, handler: { [weak self] event in self?.outsideClick(event); return event }) { outsideClickMonitors.append(monitor) }
    }

    func outsideClick(_ event: NSEvent) {
        if authentication?.busy == true || spotify?.busy == true { return }
        // Local panel and app-owned popup events are inside interactions even if
        // the pointer/window moved while a native dropdown was tracking.
        if event.window != nil { return }
        let point = NSEvent.mouseLocation
        guard panel.isVisible, !panel.frame.contains(point), trackingNativeMenus.isEmpty, NSApp.modalWindow == nil, panel.attachedSheet == nil else { return }
        // App-owned menus and pickers are part of the current interaction.
        if NSApp.windows.contains(where: { ($0 is NSSavePanel) && $0.isVisible }) { return }
        if let button = status.button, let window = button.window, window.convertToScreen(button.convert(button.bounds, to: nil)).contains(point) { return }
        if !authentication.authenticated { panel.orderOut(nil); return }
        DispatchQueue.main.async { [weak self] in
            self?.web.evaluateJavaScript("void window.OpenSesameWindow?.collapse({outside:true})", completionHandler: nil)
        }
    }

    @objc func openLauncher() {
        guard authentication.authenticated else { showPanel(); return }
        let toggle = panel.isVisible && panel.isKeyWindow && placementScreen() == panel.screen
        showPanel()
        panel.makeFirstResponder(web)
        web.evaluateJavaScript("Boolean(window.OpenSesameLauncher && (window.OpenSesameLauncher.\(toggle ? "toggle" : "open")(), true))") { [weak self] value, _ in
            self?.pendingLauncher = value as? Bool != true
        }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { if webView === web { vnc.closeAll() } }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if webView === web, let screen = placementScreen() { publishDisplay(screen, force: true) }
        if webView === web, authentication.authenticated, pendingLauncher { pendingLauncher = false; openLauncher() }
    }

    func screenID(_ screen: NSScreen) -> NSNumber? { screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber }
    func screenUUID(_ screen: NSScreen) -> String? {
        guard let id = screenID(screen), let uuid = CGDisplayCreateUUIDFromDisplayID(id.uint32Value)?.takeRetainedValue() else { return nil }
        return CFUUIDCreateString(nil, uuid) as String
    }
    var displayPreferenceStatus: [String: Any] {
        ["pinned": displayPreference.uuid != nil, "name": displayPreference.name,
         "available": displayPreference.uuid == nil || displayPreference.index(in: NSScreen.screens.map(screenUUID)) != nil,
         "detached": detached]
    }
    func publishDisplayPreference() {
        guard let data = try? JSONSerialization.data(withJSONObject: ["event": "window.display.changed", "status": displayPreferenceStatus]), let json = String(data: data, encoding: .utf8) else { return }
        web?.evaluateJavaScript("window.__openSesameReceive && window.__openSesameReceive(\(json))", completionHandler: nil)
    }
    func widgetDisplayMenu() -> NSMenu {
        let menu = NSMenu(title: "Widget display")
        let follow = menu.addItem(withTitle: "Follow pointer", action: #selector(selectWidgetDisplay), keyEquivalent: "")
        follow.target = self; follow.representedObject = ""; follow.state = displayPreference.uuid == nil ? .on : .off
        menu.addItem(.separator())
        for screen in NSScreen.screens {
            guard let uuid = screenUUID(screen) else { continue }
            let item = menu.addItem(withTitle: "Pin to " + screen.localizedName, action: #selector(selectWidgetDisplay), keyEquivalent: "")
            item.target = self; item.representedObject = ["uuid": uuid, "name": screen.localizedName]
            item.state = displayPreference.uuid == uuid ? .on : .off
        }
        if displayPreference.uuid != nil, displayPreference.index(in: NSScreen.screens.map(screenUUID)) == nil {
            menu.addItem(.separator())
            let unavailable = menu.addItem(withTitle: "Pinned display unavailable · following pointer", action: nil, keyEquivalent: ""); unavailable.isEnabled = false
        }
        return menu
    }
    @objc func selectWidgetDisplay(_ sender: NSMenuItem) {
        if let choice = sender.representedObject as? [String: String], let uuid = choice["uuid"], NSScreen.screens.contains(where: { screenUUID($0) == uuid }) {
            displayPreference = OpenSesameDisplayPreference(uuid: uuid, name: choice["name"] ?? "Display")
        } else if sender.representedObject as? String == "" { displayPreference = OpenSesameDisplayPreference() }
        else { return }
        displayPreference.save(); positionPanel(); publishDisplayPreference()
    }
    func showWidgetDisplayMenu() {
        displayMenuOpen = true
        widgetDisplayMenu().popUp(positioning: nil, at: NSEvent.mouseLocation, in: nil)
        displayMenuOpen = false; followPointerDisplay(force: true)
    }

    var displayInteractionInProgress: Bool {
        !trackingNativeMenus.isEmpty || displayMenuOpen || NSEvent.pressedMouseButtons != 0 || panel?.inLiveResize == true || NSApp.modalWindow != nil || panel?.attachedSheet != nil || authentication?.busy == true || spotify?.busy == true || NSApp.windows.contains { ($0 is NSSavePanel) && $0.isVisible }
    }

    func placementScreen() -> NSScreen? {
        let screens = NSScreen.screens
        let saved = dockedScreenID.flatMap { id in screens.first { screenID($0) == id } }
        let preferred = detached ? (panel?.screen ?? saved ?? NSScreen.main) : (saved ?? panel?.screen ?? NSScreen.main)
        let fallback = preferred.flatMap { screens.firstIndex(of: $0) }
        let pointer: NSPoint? = detached || displayInteractionInProgress ? nil : NSEvent.mouseLocation
        let pinned = detached ? nil : displayPreference.index(in: screens.map(screenUUID))
        guard let index = OpenSesameScreenPlacement.screenIndex(pointer: pointer, frames: screens.map(\.frame), fallback: fallback, pinned: pinned) else { return nil }
        return screens[index]
    }

    func watchPointerDisplay() {
        let timer = Timer(timeInterval: 0.12, repeats: true) { [weak self] _ in self?.followPointerDisplay() }
        timer.tolerance = 0.04; pointerFollowTimer = timer; RunLoop.main.add(timer, forMode: .common)
        NotificationCenter.default.addObserver(self, selector: #selector(screenParametersChanged), name: NSApplication.didChangeScreenParametersNotification, object: nil)
    }

    @objc func screenParametersChanged(_ notification: Notification) { needsDisplayReanchor = true; protectedShare?.displayConfigurationChanged(); followPointerDisplay(force: true); publishDisplayPreference() }

    func followPointerDisplay(force: Bool = false) {
        guard OpenSesameScreenPlacement.shouldFollow(placement: placement, detached: detached, visible: panel?.isVisible == true, interacting: displayInteractionInProgress, reconfigure: needsDisplayReanchor), let screen = placementScreen() else { return }
        guard force || needsDisplayReanchor || screenID(screen) != dockedScreenID || screen.frame != dockedScreenFrame else { return }
        positionPanel()
    }

    func publishDisplay(_ screen: NSScreen, force: Bool = false) {
        let frame = screen.frame, key = "\(screenID(screen)?.stringValue ?? ""):\(frame.width):\(frame.height)"
        guard force || reportedDisplay != key else { return }; reportedDisplay = key
        let source = "window.__OPEN_SESAME_SCREEN__={width:\(Double(frame.width)),height:\(Double(frame.height))};window.dispatchEvent(new Event('open-sesame-display-changed'));"
        web?.evaluateJavaScript(source, completionHandler: nil)
    }

    func positionPanel() {
        if detached { return }
        guard let screen = placementScreen() else { return }
        var menuAnchor: NSRect?
        if placement == "menu", let button = status.button, let window = button.window, window.screen == screen {
            menuAnchor = window.convertToScreen(button.convert(button.bounds, to: nil))
        }
        guard let target = OpenSesameScreenPlacement.panelFrame(requested: requestedSize, frame: screen.frame, visibleFrame: screen.visibleFrame, placement: placement, full: fillsDisplay, menuAnchor: menuAnchor) else { return }
        dockedScreenID = screenID(screen); dockedScreenFrame = screen.frame; currentSize = target.size
        needsDisplayReanchor = false
        panel.setFrame(target, display: true, animate: false)
        web?.layoutSubtreeIfNeeded()
        publishDisplay(screen)
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
        process.terminationHandler = { [weak self, weak process] _ in DispatchQueue.main.async { guard let process, self?.bridge === process else { return }; self?.familiarPermissions.cancel(); self?.failNativeCallbacks(); self?.web.evaluateJavaScript("window.dispatchEvent(new Event('open-sesame-desktop-disconnected'))", completionHandler: nil) } }
        do { try process.run(); bridge = process; input = stdin.fileHandleForWriting } catch {
            let alert = NSAlert(); alert.messageText = "Could not start the desktop connection"; alert.informativeText = error.localizedDescription; alert.runModal()
        }
    }

    func consume(_ data: Data) {
        readBuffer.append(data)
        while let end = readBuffer.firstIndex(of: 10) {
            let line = readBuffer[..<end]; readBuffer.removeSubrange(...end)
            if let text = String(data: Data(line), encoding: .utf8), let value = (try? JSONSerialization.jsonObject(with: Data(line))) as? [String: Any] {
                if let id = value["requestId"] as? String, id.hasPrefix("native-"), let callback = nativeCallbacks.removeValue(forKey: id) { callback(value); continue }
                if (value["requestId"] as? String)?.hasPrefix("native-") == true { continue }
                web.evaluateJavaScript("window.__openSesameReceive && window.__openSesameReceive(\(text))", completionHandler: nil)
            }
        }
    }

    func failNativeCallbacks() {
        let callbacks = nativeCallbacks; nativeCallbacks.removeAll()
        for callback in callbacks.values { callback(["error": "Desktop connection closed. Your message is kept."]) }
    }

    func nativeCall(_ method: String, params: [String: Any], completion: @escaping ([String: Any]) -> Void) {
        guard authentication.authenticated, let input, bridge?.isRunning == true else { completion(["error": "Desktop connection unavailable."]); return }
        let id = "native-" + UUID().uuidString
        nativeCallbacks[id] = completion
        do {
            var data = try JSONSerialization.data(withJSONObject: ["requestId": id, "method": method, "params": params]); data.append(10)
            try input.write(contentsOf: data)
        } catch { nativeCallbacks.removeValue(forKey: id)?(["error": "Could not reach the desktop connection."]) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 330) { [weak self] in self?.nativeCallbacks.removeValue(forKey: id)?(["error": "The permission operation timed out. Refresh its state before retrying."]) }
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
        guard !(requestId as? String ?? "").hasPrefix("native-") else { return }
        if method == "auth.status" { respond(requestId, result: authentication.status); return }
        if method == "auth.signIn" { respond(requestId, result: true); authentication.signIn(); return }
        if method == "auth.cancel" { respond(requestId, result: true); authentication.cancel(); return }
        if method == "auth.signOut" { respond(requestId, result: true); authentication.signOut(); return }
        if method == "system.info", !authentication.authenticated { respond(requestId, result: ["platform": "darwin", "authenticated": false]); return }
        guard authentication.authenticated || method == "window.focus" else { respond(requestId, error: "Sign in to Open Sesame before using this tool."); return }
        if method == "screen.notes.cancel" { screenNotes.cancel(); respond(requestId, result: true); return }
        if method == "screen.notes.capture" || method == "screen.notes.import" {
            screenNotes.request(importImage: method == "screen.notes.import", preferredDisplay: placementScreen().flatMap(screenID)?.uint32Value) { [weak self] result, error in
                self?.respond(requestId, result: result, error: error)
            }
            return
        }
        if method == "coven.permissions.cancel" { familiarPermissions.cancel(); respond(requestId, result: true); return }
        if method == "coven.avatar.set" || method == "coven.send" && params["permission"] as? String == "full" {
            familiarPermissions.request(operation: method == "coven.send" ? "send" : "avatar", input: params) { [weak self] response in
                self?.respond(requestId, result: response["result"], error: response["error"] as? String)
            }
            return
        }
        if method == "window.focus" {
            NSApp.activate(ignoringOtherApps: true); panel.makeKeyAndOrderFront(nil); panel.makeFirstResponder(web)
            respond(requestId, result: true); return
        }
        if method == "window.display.status" { respond(requestId, result: displayPreferenceStatus); return }
        if method == "window.display.choose" {
            respond(requestId, result: true)
            DispatchQueue.main.async { [weak self] in self?.showWidgetDisplayMenu() }
            return
        }
        if method.hasPrefix("privacy.") {
            switch method {
            case "privacy.status": respond(requestId, result: protectedShare.status)
            case "privacy.start":
                guard let id = params["displayID"] as? NSNumber, id.doubleValue.isFinite, id.doubleValue >= 0, id.doubleValue <= Double(UInt32.max), id.doubleValue.rounded() == id.doubleValue else { respond(requestId, error: "Choose an available display."); return }
                protectedShare.start(displayID: id.uint32Value) { [weak self] error in self?.respond(requestId, result: self?.protectedShare.status, error: error) }
            case "privacy.stop": protectedShare.stop(); respond(requestId, result: protectedShare.status)
            case "privacy.show": protectedShare.show(); respond(requestId, result: protectedShare.status)
            default: respond(requestId, error: "Unsupported screen-share action.")
            }
            return
        }
        if method.hasPrefix("vnc.") {
            do { respond(requestId, result:try vnc.call(method, params)) } catch { respond(requestId, error:error.localizedDescription) }
            return
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

            let full = params["full"] as? Bool == true
            let requestedWidth = (params["width"] as? NSNumber)?.doubleValue ?? 280
            let requestedHeight = (params["height"] as? NSNumber)?.doubleValue ?? 35
            guard requestedWidth.isFinite, requestedHeight.isFinite else { respond(requestId, error: "Invalid window dimensions."); return }
            requestedSize = NSSize(width: requestedWidth, height: requestedHeight); fillsDisplay = full
            placement = params["layout"] as? String ?? "notch"
            surface.layer?.cornerRadius = placement == "capture" ? 18 : params["expanded"] as? Bool == true ? (placement == "notch" ? 28 : 22) : 18
            surface.layer?.maskedCorners = placement == "notch" ? [.layerMinXMinYCorner, .layerMaxXMinYCorner] : [.layerMinXMinYCorner, .layerMaxXMinYCorner, .layerMinXMaxYCorner, .layerMaxXMaxYCorner]
            if full { surface.layer?.cornerRadius = 0 }
            positionPanel()
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
        let allowed = ["github.status", "github.add", "github.remove", "github.snapshot", "coven.status", "coven.familiars", "coven.avatar.set", "coven.command", "coven.open", "coven.send", "coven.cancel", "computer.control", "system.info", "agents.snapshot", "live.agents", "live.ask", "terminal.open", "terminal.input", "terminal.resize", "terminal.close", "feeds.fetch", "reading.fetch", "reading.pdf", "controller.start", "controller.stop", "controller.status", "controller.poll", "controller.ack"]
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
    func applicationWillTerminate(_ notification: Notification) { vnc.closeAll(); screenNotes.cancel(); familiarPermissions.cancel(); failNativeCallbacks(); protectedShare?.stop(); pointerFollowTimer?.invalidate(); pointerFollowTimer = nil; NotificationCenter.default.removeObserver(self, name: NSApplication.didChangeScreenParametersNotification, object: nil); NotificationCenter.default.removeObserver(self, name: NSMenu.didBeginTrackingNotification, object: nil); NotificationCenter.default.removeObserver(self, name: NSMenu.didEndTrackingNotification, object: nil); authentication?.shutdown(); outsideClickMonitors.forEach { NSEvent.removeMonitor($0) }; outsideClickMonitors.removeAll(); shortcut?.stop(); voice?.cancel(); audioRecorder?.clear(); embeddedPages.values.forEach { $0.close() }; try? input?.close(); bridge?.terminate() }
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
