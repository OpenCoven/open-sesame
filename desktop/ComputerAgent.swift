import AppKit
import ApplicationServices
import ScreenCaptureKit
import ImageIO

// All state and input dispatch stay on the application's main actor. The private
// session nonce never crosses to JavaScript; only task text/progress does.
@MainActor final class OpenSesameComputerAgent {
    typealias Call = (String, [String: Any], @escaping ([String: Any]) -> Void) -> Void
    var call: Call!
    weak var window: NSWindow?
    var authenticated: () -> Bool = { false }
    var publish: ([String: Any]) -> Void = { _ in }
    var collapse: () -> Void = {}
    private struct Run { var id: String?; let session: String; let display: CGDirectDisplayID; let displayName: String; let marker: Int64 }
    private var run: Run?
    private var startingSession: String?
    private var agentPointer: OpenSesameAgentPointer?
    private var observation: OpenSesameComputerObservation?
    private struct Focus { let element: AXUIElement; let bounds: CGRect; let role: String; let subrole: String }
    private var keyboardTarget: (id: String, focus: Focus)?
    private var generation = 0
    private var humanGeneration: UInt64 = 0
    private var monitors: [Any] = []
    private var approval: NSAlert?
    private var cancelApproval: (() -> Void)?
    private var task: Task<Void, Never>?
    var active: Bool { run != nil || approval != nil || cancelApproval != nil || startingSession != nil }

    var permissions: [String: Any] {
        var supported = false
        if #available(macOS 14, *) { supported = true }
        return ["supported": supported, "screen": CGPreflightScreenCaptureAccess(), "accessibility": AXIsProcessTrusted(), "active": active]
    }
    func requestPermission(_ kind: String) {
        guard authenticated() else { return }
        if kind == "screen" { _ = CGRequestScreenCaptureAccess() }
        else if kind == "accessibility" { _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary) }
    }
    func start(_ input: [String: Any], preferredDisplay: CGDirectDisplayID?, completion: @escaping ([String: Any]) -> Void) {
        guard #available(macOS 14, *), authenticated(), !active, window?.attachedSheet == nil else { completion(["error": "Finish the current task or dialog first. Computer use requires macOS 14 or later."]); return }
        guard CGPreflightScreenCaptureAccess(), AXIsProcessTrusted() else { completion(["error": "Enable Screen Recording and Accessibility for Open Sesame, then start again."]); return }
        generation += 1; let ticket = generation
        var token: String?
        var settled = false
        func finish(_ allowed: Bool, display: CGDirectDisplayID? = nil, name: String = "") {
            guard !settled else { return }; settled = true
            self.approval = nil; self.cancelApproval = nil
            guard let token else { completion(["cancelled": true]); return }
            guard allowed, self.generation == ticket, self.authenticated(), let display else {
                self.call("native.computer.finish", ["token": token, "approved": false]) { _ in }
                completion(["cancelled": true]); return
            }
            let session = UUID().uuidString
            self.startingSession = session
            self.run = Run(id: nil, session: session, display: display, displayName: name, marker: Int64.random(in: 1...Int64.max))
            self.watchHumanInput(); self.collapse()
            self.call("native.computer.finish", ["token": token, "approved": true, "session": session]) { response in
                guard self.generation == ticket, self.startingSession == session, self.authenticated() else {
                    if let id = (response["result"] as? [String: Any])?["runId"] as? String { self.call("computer.cancel", ["runId": id]) { _ in } }
                    completion(["cancelled": true]); return
                }
                guard let result = response["result"] as? [String: Any], let id = result["runId"] as? String, self.run?.id == nil || self.run?.id == id else { self.stop(); completion(response["error"] == nil ? ["error": "The native task could not start."] : response); return }
                self.startingSession = nil; self.run?.id = id; completion(["result": result])
            }
        }
        cancelApproval = { finish(false) }
        call("native.computer.prepare", input) { response in
            guard let proposal = response["result"] as? [String: Any], let value = proposal["token"] as? String, let prompt = proposal["prompt"] as? String, let provider = proposal["provider"] as? String, let model = proposal["model"] as? String else {
                if self.generation == ticket { self.cancelApproval = nil; completion(response["error"] == nil ? ["error": "Could not verify this computer task."] : response) }; return
            }
            token = value
            guard self.generation == ticket, !settled, self.authenticated(), let window = self.window else { self.call("native.computer.finish", ["token": value, "approved": false]) { _ in }; return }
            let screens = NSScreen.screens
            let picker = NSPopUpButton(frame: NSRect(x: 0, y: 0, width: 300, height: 28)); picker.addItems(withTitles: screens.map(\.localizedName))
            func id(_ screen: NSScreen) -> CGDirectDisplayID? { (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value }
            if let index = screens.firstIndex(where: { id($0) == preferredDisplay }) { picker.selectItem(at: index) }
            let destination = proposal["destination"] as? String ?? provider
            let familiar = proposal["familiar"] as? [String: Any]
            let familiarContext = familiar.map { "\nFamiliar: \($0["displayName"] as? String ?? "")\nWorkspace identity: \($0["workspace"] as? String ?? "Not specified")" } ?? ""
            let alert = NSAlert(); self.approval = alert; alert.messageText = "Allow Coven to use this screen?"
            alert.informativeText = "\(provider) · \(model)\nDestination: \(destination)\(familiarContext)\n\nScreenshots of the selected display are sent to this provider. The agent can click, type, scroll and drag across applications, including actions that change files or send information. This approval is only for this task, for up to 10 minutes. Touch the mouse or keyboard to pause. Stop cannot undo completed actions.\n\nTask: \(String(prompt.prefix(4000)))\(prompt.count > 4000 ? "… (full task remains in the app)" : "")"
            alert.accessoryView = picker; alert.addButton(withTitle: "Cancel"); alert.addButton(withTitle: "Allow this task")
            alert.buttons[0].keyEquivalent = "\r"; alert.buttons[1].keyEquivalent = ""
            alert.beginSheetModal(for: window) { result in
                guard self.generation == ticket else { finish(false); return }
                let index = picker.indexOfSelectedItem
                guard result == .alertSecondButtonReturn, screens.indices.contains(index) else { finish(false); return }
                finish(true, display: id(screens[index]), name: screens[index].localizedName)
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 85) { if self.generation == ticket, !settled { self.stop() } }
        }
    }
    func stop() {
        agentPointer?.hide()
        generation += 1; task?.cancel(); task = nil; observation = nil; keyboardTarget = nil
        let previous = run; run = nil; startingSession = nil
        monitors.forEach { NSEvent.removeMonitor($0) }; monitors.removeAll()
        if let alert = approval, let window, window.attachedSheet === alert.window { window.endSheet(alert.window, returnCode: .cancel) }
        let cancel = cancelApproval; cancelApproval = nil; approval = nil; cancel?()
        if let previous { call("native.computer.cancel", ["session": previous.session]) { _ in } }
    }
    func progress(_ value: [String: Any]) {
        guard value["event"] as? String == "computer.progress", let id = value["runId"] as? String, run?.id == id, let kind = value["type"] as? String, ["result", "paused", "error"].contains(kind) else { return }
        task?.cancel(); task = nil; observation = nil; keyboardTarget = nil; run = nil; stopMonitoring()
    }
    private func watchHumanInput() {
        let mask: NSEvent.EventTypeMask = [.keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown, .mouseMoved, .leftMouseDragged, .rightMouseDragged, .scrollWheel]
        func changed(_ event: NSEvent) {
            guard let run = self.run, event.cgEvent?.getIntegerValueField(.eventSourceUserData) != run.marker else { return }
            self.humanGeneration &+= 1
            let id = run.id; self.stop()
            if let id { self.publish(["event": "computer.progress", "runId": id, "type": "paused", "text": "Paused while you use the computer. Review the screen before continuing."]) }
        }
        if let global = NSEvent.addGlobalMonitorForEvents(matching: mask, handler: changed) { monitors.append(global) }
        if let local = NSEvent.addLocalMonitorForEvents(matching: mask, handler: { event in changed(event); return event }) { monitors.append(local) }
    }
    func receive(_ event: [String: Any]) {
        guard let id = event["id"] as? String, id.count <= 100, let runID = event["runId"] as? String, runID.count <= 100, let session = event["session"] as? String, session.count <= 128 else { return }
        func reply(_ value: [String: Any]) { self.call("native.computer.reply", ["id": id, "runId": runID, "session": session, "reply": value]) { _ in } }
        guard authenticated(), var current = run, current.session == session, current.id == nil || current.id == runID, task == nil else { reply(["summary": "Task is no longer active.", "error": true, "paused": true]); return }
        current.id = runID; run = current
        guard let raw = event["action"] as? [String: Any], let action = try? OpenSesameComputerAction(raw) else { reply(["summary": "Invalid computer action.", "error": true, "paused": true]); return }
        let ticket = generation
        task = Task { @MainActor in
            defer { if self.generation == ticket { self.task = nil } }
            do {
                guard #available(macOS 14, *) else { throw OpenSesameComputerAction.Failure.invalid }
                try self.require(ticket)
                if action.kind == .ask_user {
                    self.publish(["event": "computer.question", "runId": runID, "text": action.text ?? "Please review the screen."])
                    reply(["summary": "Waiting for the user's answer.", "paused": true]); self.stopMonitoring(); self.observation = nil; self.run = nil; return
                }
                if action.kind != .observe {
                    guard let observed = self.observation else { throw OpenSesameComputerAction.Failure.stale }
                    try observed.admit(action, run: runID, display: current.display, bounds: CGDisplayBounds(current.display), foreground: NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0, humanGeneration: self.humanGeneration, now: ProcessInfo.processInfo.systemUptime)
                    self.observation = nil // Consume before dispatch, including failed actions.
                    try await self.dispatch(action, observed: observed, ticket: ticket, marker: current.marker)
                    try await Task.sleep(nanoseconds: 180_000_000)
                }
                let value = try await self.observe(current, ticket: ticket)
                try self.require(ticket); reply(value)
            } catch {
                if self.generation == ticket { reply(["summary": "The screen, focus or task changed. Review the screen before continuing.", "error": true, "paused": true]); self.stopMonitoring(); self.run = nil; self.observation = nil }
                else { reply(["summary": "Task paused or stopped.", "error": true, "paused": true]) }
            }
        }
    }
    private func stopMonitoring() { agentPointer?.hide(); monitors.forEach { NSEvent.removeMonitor($0) }; monitors.removeAll() }
    private func require(_ ticket: Int) throws {
        guard generation == ticket, run != nil, authenticated(), !Task.isCancelled, CGPreflightScreenCaptureAccess(), AXIsProcessTrusted() else { throw OpenSesameComputerAction.Failure.interrupted }
    }
    @available(macOS 14, *) private func observe(_ current: Run, ticket: Int) async throws -> [String: Any] {
        try require(ticket)
        let originalFocus = Self.focus(NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0)
        let originalForeground = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0, originalBounds = CGDisplayBounds(current.display)
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        try require(ticket)
        guard let display = content.displays.first(where: { $0.displayID == current.display }) else { throw OpenSesameComputerAction.Failure.displayChanged }
        let owner = ProcessInfo.processInfo.processIdentifier, excluded = content.applications.filter { $0.processID == owner }
        guard !excluded.isEmpty else { throw OpenSesameComputerAction.Failure.invalid }
        let config = SCStreamConfiguration(), scale = min(1, 1920.0 / Double(max(display.width, display.height)))
        config.width = max(2, Int(Double(display.width) * scale)); config.height = max(2, Int(Double(display.height) * scale)); config.capturesAudio = false; config.showsCursor = false
        let filter = SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: [])
        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
        try require(ticket)
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == originalForeground, CGDisplayBounds(current.display) == originalBounds else { throw OpenSesameComputerAction.Failure.stale }
        let encoded = try Self.jpeg(image)
        let app = NSWorkspace.shared.frontmostApplication, bounds = CGDisplayBounds(current.display)
        let frame = OpenSesameComputerObservation(id: UUID().uuidString, run: current.id!, display: current.display, bounds: bounds, imageSize: CGSize(width: image.width, height: image.height), foreground: app?.processIdentifier ?? 0, humanGeneration: humanGeneration, created: ProcessInfo.processInfo.systemUptime)
        observation = frame
        let focus = Self.focus(frame.foreground)
        keyboardTarget = if let originalFocus, let focus, CFEqual(originalFocus.element, focus.element), originalFocus.bounds == focus.bounds { (frame.id, focus) } else { nil }
        return ["summary": "Observed \(current.displayName). Foreground application: \(app?.localizedName ?? "Unknown"). Coordinates refer to this image; use its latest observation ID for the next input.", "observation": ["id": frame.id, "width": image.width, "height": image.height, "app": String((app?.localizedName ?? "Unknown").prefix(200)), "display": String(current.displayName.prefix(200))], "image": encoded.base64EncodedString()]
    }
    static func jpeg(_ image: CGImage) throws -> Data {
        let bitmap = NSBitmapImageRep(cgImage: image)
        for quality in [0.6, 0.4, 0.25] {
            if let data = bitmap.representation(using: .jpeg, properties: [.compressionFactor: quality]), data.count <= 650000 { return data }
        }
        throw OpenSesameComputerAction.Failure.invalid
    }
    private struct PointerTarget { let window: OpenSesamePointerWindow; let application: NSRunningApplication }
    private func pointerTarget(at point: CGPoint, display: CGRect) throws -> PointerTarget {
        let rows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] ?? []
        let windows = rows.compactMap(OpenSesamePointerWindow.init)
        guard let window = OpenSesamePointerWindow.choose(windows, point: point, display: display, owner: ProcessInfo.processInfo.processIdentifier, pointerWindow: agentPointer.flatMap { $0.panel.windowNumber > 0 ? CGWindowID($0.panel.windowNumber) : nil }), let app = NSRunningApplication(processIdentifier: window.pid), !app.isTerminated else { throw OpenSesameComputerAction.Failure.invalid }
        return PointerTarget(window: window, application: app)
    }
    private func dispatch(_ action: OpenSesameComputerAction, observed: OpenSesameComputerObservation, ticket: Int, marker: Int64) async throws {
        func post(_ event: CGEvent?, target: PointerTarget? = nil, expectedForeground: pid_t? = nil) throws {
            try require(ticket)
            guard CGDisplayBounds(observed.display) == observed.bounds else { throw OpenSesameComputerAction.Failure.displayChanged }
            if action.kind == .type || action.kind == .key {
                guard NSWorkspace.shared.frontmostApplication?.processIdentifier == observed.foreground, let target = keyboardTarget, target.id == observed.id, let current = Self.focus(observed.foreground), CFEqual(target.focus.element, current.element), current.bounds == target.focus.bounds, OpenSesameComputerFocusPolicy.allows(role: current.role, subrole: current.subrole, bounds: current.bounds, display: observed.bounds) else { throw OpenSesameComputerAction.Failure.focusChanged }
            }
            guard let event else { throw OpenSesameComputerAction.Failure.invalid }
            event.setIntegerValueField(.eventSourceUserData, value: marker)
            if let target {
                guard !target.application.isTerminated, NSWorkspace.shared.frontmostApplication?.processIdentifier == (expectedForeground ?? observed.foreground), let row = (CGWindowListCopyWindowInfo(.optionIncludingWindow, target.window.id) as? [[String: Any]])?.first, let current = OpenSesamePointerWindow(row), current.pid == target.window.pid, current.bounds == target.window.bounds else { throw OpenSesameComputerAction.Failure.focusChanged }
                target.window.configure(event, marker: marker)
                if agentPointer == nil { agentPointer = OpenSesameAgentPointer() }; agentPointer?.move(to: event.location)
                event.postToPid(target.window.pid)
            } else {
                guard event.type == .keyDown || event.type == .keyUp else { throw OpenSesameComputerAction.Failure.invalid }
                event.post(tap: .cghidEventTap)
            }
        }
        let source = CGEventSource(stateID: .combinedSessionState)
        func mouse(_ type: CGEventType, _ point: CGPoint, target: PointerTarget, expectedForeground: pid_t, right: Bool = false, clicks: Int64 = 1) throws { let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: right ? .right : .left); event?.setIntegerValueField(.mouseEventClickState, value: clicks); try post(event, target: target, expectedForeground: expectedForeground) }
        switch action.kind {
        case .click, .double_click, .right_click, .move, .drag:
            let point = try observed.screenPoint(action.coordinate!)
            guard !ownWindowContains(point) else { throw OpenSesameComputerAction.Failure.invalid }
            let target = try pointerTarget(at: point, display: observed.bounds)
            var expectedForeground = observed.foreground
            if action.kind != .move && target.application.activationPolicy == .regular && target.window.pid != observed.foreground {
                guard target.application.activate(options: []) else { throw OpenSesameComputerAction.Failure.focusChanged }
                for _ in 0..<10 { try require(ticket); if NSWorkspace.shared.frontmostApplication?.processIdentifier == target.window.pid { break }; try await Task.sleep(nanoseconds: 20_000_000) }
                guard NSWorkspace.shared.frontmostApplication?.processIdentifier == target.window.pid, try pointerTarget(at: point, display: observed.bounds).window == target.window else { throw OpenSesameComputerAction.Failure.focusChanged }
                expectedForeground = target.window.pid
            }
            if action.kind == .move { try mouse(.mouseMoved, point, target: target, expectedForeground: expectedForeground); return }
            if action.kind == .drag {
                let end = try observed.screenPoint(action.endCoordinate!)
                guard !ownWindowContains(end) else { throw OpenSesameComputerAction.Failure.invalid }
                try mouse(.leftMouseDown, point, target: target, expectedForeground: expectedForeground)
                var last = point
                defer { if let up = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: last, mouseButton: .left) { if !target.application.isTerminated { target.window.configure(up, marker: marker); up.postToPid(target.window.pid) } } }
                for step in 1...12 { try await Task.sleep(nanoseconds: 25_000_000); last = CGPoint(x: point.x + (end.x-point.x)*Double(step)/12, y: point.y + (end.y-point.y)*Double(step)/12); try mouse(.leftMouseDragged, last, target: target, expectedForeground: expectedForeground) }
            } else {
                let right = action.kind == .right_click
                func clickPair(_ count: Int64) throws {
                    try mouse(right ? .rightMouseDown : .leftMouseDown, point, target: target, expectedForeground: expectedForeground, right: right, clicks: count)
                    // Balance only our own press, even if its action closes or changes the window.
                    defer { if !target.application.isTerminated, let up = CGEvent(mouseEventSource: source, mouseType: right ? .rightMouseUp : .leftMouseUp, mouseCursorPosition: point, mouseButton: right ? .right : .left) { up.setIntegerValueField(.mouseEventClickState, value: count); target.window.configure(up, marker: marker); up.postToPid(target.window.pid) } }
                    try require(ticket)
                }
                for click in 1...(action.kind == .double_click ? 2 : 1) { try clickPair(Int64(click)) }
            }
        case .type:
            guard observed.foreground != ProcessInfo.processInfo.processIdentifier else { throw OpenSesameComputerAction.Failure.focusChanged }
            for chunk in OpenSesameComputerAction.textChunks(action.text!) {
                try require(ticket)
                for down in [true,false] { let event = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: down); chunk.withUnsafeBufferPointer { event?.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: $0.baseAddress) }; try post(event) }
                try await Task.sleep(nanoseconds: 10_000_000)
            }
        case .key:
            guard observed.foreground != ProcessInfo.processInfo.processIdentifier, let (code, flags) = Self.key(action.text!) else { throw OpenSesameComputerAction.Failure.invalid }
            for down in [true,false] { let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down); event?.flags = flags; try post(event) }
        case .scroll:
            let point = try observed.screenPoint(action.coordinate ?? CGPoint(x: observed.imageSize.width / 2, y: observed.imageSize.height / 2))
            guard !ownWindowContains(point) else { throw OpenSesameComputerAction.Failure.invalid }
            let target = try pointerTarget(at: point, display: observed.bounds)
            var remaining = action.amount!
            while remaining > 0 {
                let amount = Int32(min(remaining, 10)), direction = action.direction!
                let vertical: Int32 = direction == "up" ? amount : direction == "down" ? -amount : 0
                let horizontal: Int32 = direction == "left" ? amount : direction == "right" ? -amount : 0
                let event = CGEvent(scrollWheelEvent2Source: source, units: .line, wheelCount: 2, wheel1: vertical, wheel2: horizontal, wheel3: 0)
                event?.location = point; try post(event, target: target); remaining -= Int(amount)
            }
        case .wait: try await Task.sleep(nanoseconds: UInt64(action.milliseconds!) * 1_000_000)
        default: throw OpenSesameComputerAction.Failure.invalid
        }
    }
    private func ownWindowContains(_ point: CGPoint) -> Bool {
        let height = CGDisplayBounds(CGMainDisplayID()).height
        return NSApp.windows.filter { $0.isVisible && $0.identifier?.rawValue != "open-sesame-agent-pointer" }.contains { window in let frame = window.frame; return CGRect(x: frame.minX, y: height-frame.maxY, width: frame.width, height: frame.height).contains(point) }
    }
    private static func focus(_ pid: pid_t) -> Focus? {
        guard pid > 0, pid != ProcessInfo.processInfo.processIdentifier else { return nil }
        let application = AXUIElementCreateApplication(pid)
        func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? { var value: CFTypeRef?; guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }; return value }
        guard let value = attribute(application, kAXFocusedUIElementAttribute), CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        let element = value as! AXUIElement
        func bounds(_ target: AXUIElement) -> CGRect? {
            guard let position = attribute(target, kAXPositionAttribute), CFGetTypeID(position) == AXValueGetTypeID(), let size = attribute(target, kAXSizeAttribute), CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
            var point = CGPoint.zero, extent = CGSize.zero
            guard AXValueGetValue(position as! AXValue, .cgPoint, &point), AXValueGetValue(size as! AXValue, .cgSize, &extent) else { return nil }
            return CGRect(origin: point, size: extent)
        }
        var rect = bounds(element)
        if rect == nil, let window = attribute(application, kAXFocusedWindowAttribute), CFGetTypeID(window) == AXUIElementGetTypeID() { rect = bounds(window as! AXUIElement) }
        guard let rect else { return nil }
        return Focus(element: element, bounds: rect, role: attribute(element, kAXRoleAttribute) as? String ?? "", subrole: attribute(element, kAXSubroleAttribute) as? String ?? "")
    }
    static func key(_ value: String) -> (CGKeyCode, CGEventFlags)? {
        let codes: [String: CGKeyCode] = ["minus":27,"-":27,"equal":24,"=":24,"[":33,"]":30,";":41,"quote":39,",":43,".":47,"/":44,"backslash":42,"grave":50,"a":0,"s":1,"d":2,"f":3,"h":4,"g":5,"z":6,"x":7,"c":8,"v":9,"b":11,"q":12,"w":13,"e":14,"r":15,"y":16,"t":17,"1":18,"2":19,"3":20,"4":21,"6":22,"5":23,"9":25,"7":26,"8":28,"0":29,"o":31,"u":32,"i":34,"p":35,"enter":36,"return":36,"l":37,"j":38,"k":40,"n":45,"m":46,"tab":48,"space":49,"backspace":51,"escape":53,"esc":53,"home":115,"end":119,"pageup":116,"pagedown":121,"delete":117,"left":123,"right":124,"down":125,"up":126]
        let parts = value.lowercased().split(separator: "+").map(String.init)
        guard !parts.isEmpty, let code = codes[parts.last!] else { return nil }
        var flags: CGEventFlags = []
        for part in parts.dropLast() { switch part { case "cmd","command","meta": flags.insert(.maskCommand); case "ctrl","control": flags.insert(.maskControl); case "alt","option": flags.insert(.maskAlternate); case "shift": flags.insert(.maskShift); default: return nil } }
        return (code, flags)
    }
}
