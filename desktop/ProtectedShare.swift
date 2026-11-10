import AppKit
import AVFoundation
import CoreMedia
import ScreenCaptureKit

// Ready means a frame from our explicitly filtered stream arrived, never just that a window opened.
struct OpenSesameShareState {
    enum Phase { case idle, starting, ready }
    private(set) var phase: Phase = .idle
    private(set) var epoch = 0
    mutating func begin() -> Int? {
        guard phase == .idle else { return nil }
        epoch += 1; phase = .starting; return epoch
    }
    func accepts(_ ticket: Int) -> Bool { ticket == epoch && phase != .idle }
    mutating func receive(_ ticket: Int, complete: Bool) -> Bool {
        guard complete, accepts(ticket) else { return false }
        phase = .ready; return true
    }
    mutating func stop() { epoch += 1; phase = .idle }
    static func hasExclusion(owner: pid_t, excluded: [pid_t]) -> Bool { owner > 0 && excluded.contains(owner) }
}

// Only one pending frame and one main-queue delivery are retained under backpressure.
final class OpenSesameLatestFrame<Value> {
    private let lock = NSLock()
    private var latest: Value?
    private var scheduled = false
    private var accepting = true
    func put(_ value: Value) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard accepting else { return false }
        latest = value
        if scheduled { return false }
        scheduled = true; return true
    }
    func take() -> Value? {
        lock.lock(); defer { lock.unlock() }
        defer { latest = nil; scheduled = false }
        return accepting ? latest : nil
    }
    func invalidate() { lock.lock(); accepting = false; latest = nil; lock.unlock() }
}

struct OpenSesameShareSizing {
    static func pixels(source: NSSize, viewport: NSSize, scale: CGFloat) -> NSSize? {
        guard [source.width, source.height, viewport.width, viewport.height, scale].allSatisfy({ $0.isFinite && $0 > 0 }) else { return nil }
        let factor = min(1, 4096 / max(source.width, source.height), min(viewport.width * scale / source.width, viewport.height * scale / source.height))
        return NSSize(width: max(2, floor(source.width * factor / 2) * 2), height: max(2, floor(source.height * factor / 2) * 2))
    }
}

private final class ProtectedShareVideo: NSView {
    let video = AVSampleBufferDisplayLayer()
    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true; layer?.backgroundColor = NSColor.black.cgColor
        video.videoGravity = .resizeAspect; video.frame = bounds; layer?.addSublayer(video)
    }
    required init?(coder: NSCoder) { fatalError("Not a storyboard view") }
    override func layout() { super.layout(); CATransaction.begin(); CATransaction.setDisableActions(true); video.frame = bounds; CATransaction.commit() }
    var failed: Bool {
        if #available(macOS 14, *) { return video.sampleBufferRenderer.status == .failed }
        else { return video.status == .failed }
    }
    var ready: Bool {
        if #available(macOS 14, *) { return video.sampleBufferRenderer.isReadyForMoreMediaData }
        else { return video.isReadyForMoreMediaData }
    }
    func enqueue(_ sample: CMSampleBuffer) {
        if #available(macOS 14, *) { video.sampleBufferRenderer.enqueue(sample) }
        else { video.enqueue(sample) }
    }
    func clear() {
        isHidden = true
        if #available(macOS 14, *) { video.sampleBufferRenderer.flush(removingDisplayedImage: true, completionHandler: nil) }
        else { video.flushAndRemoveImage() }
    }
}

final class ProtectedShareOutput: NSObject, SCStreamOutput {
    private let pending = OpenSesameLatestFrame<CMSampleBuffer>()
    private let deliver: (CMSampleBuffer) -> Void
    init(deliver: @escaping (CMSampleBuffer) -> Void) { self.deliver = deliver }
    func invalidate() { pending.invalidate() }
    static func complete(_ sample: CMSampleBuffer) -> Bool {
        guard CMSampleBufferIsValid(sample), CMSampleBufferDataIsReady(sample), CMSampleBufferGetImageBuffer(sample) != nil,
              let info = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let status = info.first?[.status] as? Int else { return false }
        return status == SCFrameStatus.complete.rawValue
    }
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
        guard outputType == .screen, Self.complete(sampleBuffer), pending.put(sampleBuffer) else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self, let sample = self.pending.take() else { return }
            self.deliver(sample)
        }
    }
}

// This produces a window the meeting app can share. It cannot alter another app's full-display capture.
final class OpenSesameProtectedShare: NSObject, SCStreamDelegate, NSWindowDelegate {
    static let title = "Open Sesame — Protected Share"
    private var state = OpenSesameShareState()
    private var stream: SCStream?
    private var output: ProtectedShareOutput?
    private var preview: NSWindow?
    private var video: ProtectedShareVideo?
    private var displayID: CGDirectDisplayID?
    private var message = ""
    private var sourcePixels = NSSize.zero
    private var resizeTimer: Timer?
    private var resizing = false
    private var requestedPixels: NSSize?
    private var configuredPixels = NSSize.zero
    private let queue = DispatchQueue(label: "computer.opensesame.protected-share", qos: .userInitiated)
    var changed: (() -> Void)?

    var status: [String: Any] {
        ["available": true, "active": state.phase == .ready, "starting": state.phase == .starting,
         "windowOpen": preview != nil, "fullscreen": preview?.styleMask.contains(.fullScreen) == true, "dynamicScaling": true, "windowTitle": Self.title, "error": message, "revision": state.epoch * 2 + (state.phase == .ready ? 1 : 0),
         "displayID": displayID.map { NSNumber(value: $0) } as Any? ?? NSNull(),
         "preferredDisplayID": (NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) } ?? NSScreen.main)?.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as Any? ?? NSNull(),
         "displays": NSScreen.screens.compactMap { screen -> [String: Any]? in
             guard let id = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else { return nil }
             return ["id": id, "name": screen.localizedName, "width": screen.frame.width, "height": screen.frame.height]
         }]
    }

    func start(displayID: CGDirectDisplayID, completion: @escaping (String?) -> Void) {
        guard let screen = NSScreen.screens.first(where: { ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == displayID }), screen.frame.width > 0, screen.frame.height > 0 else { completion("Choose an available display."); return }
        guard let ticket = state.begin() else { completion("A share window is already running or preparing."); return }
        message = ""; self.displayID = displayID; changed?()
        // A normal black window makes our accessory app discoverable for process exclusion.
        // No screen pixels reach it until the exclusion filter has been verified below.
        openWindow(ratio: screen.frame.width / screen.frame.height, displayID: displayID)
        Task { @MainActor [self] in
            do {
                // The system requests permission only after the user's explicit Start action.
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
                guard self.state.accepts(ticket) else { completion("Share preparation cancelled."); return }
                guard let display = content.displays.first(where: { $0.displayID == displayID }), display.width > 0, display.height > 0 else { throw ShareError.display }
                let owner = ProcessInfo.processInfo.processIdentifier
                let excluded = content.applications.filter { $0.processID == owner }
                guard OpenSesameShareState.hasExclusion(owner: owner, excluded: excluded.map(\.processID)) else { throw ShareError.exclusion }
                let configuration = SCStreamConfiguration()
                self.sourcePixels = NSSize(width: display.width, height: display.height)
                let pixels = self.desiredPixels() ?? self.sourcePixels
                configuration.width = Int(pixels.width); configuration.height = Int(pixels.height); self.configuredPixels = pixels
                configuration.minimumFrameInterval = CMTime(value: 1, timescale: 15)
                configuration.queueDepth = 3; configuration.capturesAudio = false; configuration.showsCursor = true
                let filter = SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: [])
                let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
                let output = ProtectedShareOutput { [weak self] sample in self?.receive(sample, ticket: ticket) }
                try stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: self.queue)
                self.stream = stream; self.output = output
                try await stream.startCapture()
                guard self.state.accepts(ticket) else { try? await stream.stopCapture(); completion("Share preparation cancelled."); return }
                completion(nil)
                DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in
                    guard let self, self.state.accepts(ticket), self.state.phase == .starting else { return }
                    self.stop(error: "No filtered video arrived. Check Screen Recording permission, then start again.")
                }
            } catch {
                guard self.state.accepts(ticket) else { completion("Share preparation cancelled."); return }
                let text: String
                if let reason = error as? ShareError { text = reason == .display ? "That display is no longer available. Choose another display." : "Open Sesame could not confirm its capture exclusion. No share output was enabled." }
                else { text = "Allow Open Sesame in macOS Settings → Privacy & Security → Screen & System Audio Recording, then start again." }
                self.stop(error: text); completion(text)
            }
        }
    }

    private func openWindow(ratio: CGFloat, displayID: CGDirectDisplayID) {
        let area = NSScreen.screens.first { ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == displayID }?.visibleFrame ?? NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1200, height: 800)
        let width = max(1, min(1000, area.width * 0.7, max(1, area.height - 80) * ratio))
        let window = NSWindow(contentRect: NSRect(x: area.midX - width / 2, y: area.midY - width / ratio / 2, width: width, height: width / ratio), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = Self.title; window.appearance = NSAppearance(named: .darkAqua)
        window.isReleasedWhenClosed = false; window.delegate = self
        window.collectionBehavior = [.fullScreenPrimary]
        window.standardWindowButton(.zoomButton)?.isEnabled = true
        window.contentMinSize = NSSize(width: min(320, width), height: min(320, width) / ratio)
        let view = ProtectedShareVideo(frame: NSRect(x: 0, y: 0, width: width, height: width / ratio))
        window.contentView = view; self.video = view; self.preview = window
        window.orderFrontRegardless(); changed?()
    }

    private func receive(_ sample: CMSampleBuffer, ticket: Int) {
        guard state.accepts(ticket), let video else { return }
        if video.failed { stop(error: "Share video was interrupted. Start a new protected share window."); return }
        guard video.ready else { return }
        video.enqueue(sample)
        let first = state.phase != .ready
        if state.receive(ticket, complete: true), first { changed?() }
    }

    func show() { preview?.makeKeyAndOrderFront(nil) }
    func toggleFullscreen() { guard state.phase != .idle else { return }; preview?.makeKeyAndOrderFront(nil); preview?.toggleFullScreen(nil) }
    private func desiredPixels() -> NSSize? {
        guard let preview, let content = preview.contentView else { return nil }
        return OpenSesameShareSizing.pixels(source: sourcePixels, viewport: content.bounds.size, scale: preview.backingScaleFactor)
    }
    private func updateSizing() {
        requestedPixels = desiredPixels(); guard !resizing, let stream else { return }
        resizing = true; let ticket = state.epoch
        Task { @MainActor [weak self] in
            guard let self else { return }
            defer { self.resizing = false }
            while self.state.accepts(ticket), self.stream === stream, let size = self.requestedPixels {
                self.requestedPixels = nil
                if size == self.configuredPixels { continue }
                let config = SCStreamConfiguration(); config.width = Int(size.width); config.height = Int(size.height)
                config.minimumFrameInterval = CMTime(value: 1, timescale: 15); config.queueDepth = 3; config.capturesAudio = false; config.showsCursor = true
                do { try await stream.updateConfiguration(config); self.configuredPixels = size }
                catch { if self.state.accepts(ticket) { self.stop(error: "Share scaling was interrupted. Start the share window again.") }; return }
            }
        }
    }
    private func scheduleSizing() {
        resizeTimer?.invalidate()
        let timer = Timer(timeInterval: 0.2, repeats: false) { [weak self] _ in self?.updateSizing() }; resizeTimer = timer; RunLoop.main.add(timer, forMode: .common)
    }
    func windowDidResize(_ notification: Notification) { scheduleSizing() }
    func windowDidChangeBackingProperties(_ notification: Notification) { scheduleSizing() }
    func windowDidEnterFullScreen(_ notification: Notification) { scheduleSizing(); changed?() }
    func windowDidExitFullScreen(_ notification: Notification) { scheduleSizing(); changed?() }

    func stop(error: String = "") {
        state.stop(); resizeTimer?.invalidate(); resizeTimer = nil; requestedPixels = nil; sourcePixels = .zero; message = error; output?.invalidate(); output = nil
        video?.clear(); video = nil
        let oldWindow = preview; preview = nil; oldWindow?.delegate = nil; oldWindow?.close()
        let oldStream = stream; stream = nil; displayID = nil
        if let oldStream { Task { try? await oldStream.stopCapture() } }
        changed?()
    }
    func displayConfigurationChanged() {
        guard state.phase != .idle else { return }
        stop(error: "Display configuration changed. Choose a display and start a new share window.")
    }
    func windowWillClose(_ notification: Notification) { stop() }
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.stream === stream else { return }
            self.stop(error: "Screen capture stopped. Check permission and start a new share window.")
        }
    }
    private enum ShareError: Error { case display, exclusion }
}
