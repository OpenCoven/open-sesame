import AppKit
import CoreGraphics

// Window targeting is independent of the system pointer. Only metadata is read.
struct OpenSesamePointerWindow: Equatable {
    let pid: pid_t
    let id: CGWindowID
    let bounds: CGRect
    let alpha: Double
    init(pid: pid_t, id: CGWindowID, bounds: CGRect, alpha: Double = 1) { self.pid = pid; self.id = id; self.bounds = bounds; self.alpha = alpha }
    init?(_ value: [String: Any]) {
        guard let pid = value[kCGWindowOwnerPID as String] as? NSNumber, let id = value[kCGWindowNumber as String] as? NSNumber, let dictionary = value[kCGWindowBounds as String] as? NSDictionary, let bounds = CGRect(dictionaryRepresentation: dictionary) else { return nil }
        self.init(pid: pid.int32Value, id: id.uint32Value, bounds: bounds, alpha: (value[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1)
    }
    static func choose(_ windows: [Self], point: CGPoint, display: CGRect, owner: pid_t, pointerWindow: CGWindowID?) -> Self? {
        guard point.x.isFinite, point.y.isFinite, display.contains(point) else { return nil }
        for window in windows where window.bounds.contains(point) && window.alpha > 0.01 {
            if window.pid == owner && window.id == pointerWindow { continue }
            // Do not click through the app's own UI or a window with an invalid owner.
            guard window.pid > 1, window.pid != owner, window.id != 0, window.bounds.width > 0, window.bounds.height > 0 else { return nil }
            return window
        }
        return nil
    }
    func configure(_ event: CGEvent, marker: Int64) {
        event.setIntegerValueField(.eventSourceUserData, value: marker)
        event.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(pid))
        event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(id))
        event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: Int64(id))
    }
    static func cocoaFrame(at point: CGPoint, primaryHeight: CGFloat) -> CGRect {
        CGRect(x: point.x - 3, y: primaryHeight - point.y - 33, width: 78, height: 36)
    }
}

@MainActor final class OpenSesameAgentPointer {
    let panel: NSPanel
    init() {
        panel = NSPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.identifier = NSUserInterfaceItemIdentifier("open-sesame-agent-pointer")
        panel.isReleasedWhenClosed = false; panel.isOpaque = false; panel.backgroundColor = .clear; panel.hasShadow = false
        panel.ignoresMouseEvents = true; panel.hidesOnDeactivate = false; panel.level = .popUpMenu
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        panel.contentView = PointerView(frame: NSRect(x: 0, y: 0, width: 78, height: 36))
        panel.setAccessibilityElement(false)
    }
    func move(to point: CGPoint) {
        panel.setFrame(OpenSesamePointerWindow.cocoaFrame(at: point, primaryHeight: CGDisplayBounds(CGMainDisplayID()).height), display: true)
        panel.orderFrontRegardless()
    }
    func hide() { panel.orderOut(nil) }
    private final class PointerView: NSView {
        override func draw(_ dirtyRect: NSRect) {
            let arrow = NSBezierPath(); arrow.move(to: NSPoint(x: 3, y: 33)); arrow.line(to: NSPoint(x: 3, y: 11)); arrow.line(to: NSPoint(x: 9, y: 17)); arrow.line(to: NSPoint(x: 15, y: 6)); arrow.line(to: NSPoint(x: 20, y: 9)); arrow.line(to: NSPoint(x: 14, y: 20)); arrow.line(to: NSPoint(x: 25, y: 21)); arrow.close()
            NSGraphicsContext.saveGraphicsState(); let shadow = NSShadow(); shadow.shadowColor = NSColor.black.withAlphaComponent(0.5); shadow.shadowBlurRadius = 3; shadow.shadowOffset = NSSize(width: 0, height: -1); shadow.set()
            NSColor(srgbRed: 0.87, green: 0.74, blue: 0.43, alpha: 1).setFill(); arrow.fill(); NSColor(calibratedWhite: 0.08, alpha: 1).setStroke(); arrow.lineWidth = 1.5; arrow.stroke(); NSGraphicsContext.restoreGraphicsState()
            NSColor(calibratedWhite: 0.08, alpha: 0.96).setFill(); NSBezierPath(roundedRect: NSRect(x: 27, y: 3, width: 44, height: 18), xRadius: 6, yRadius: 6).fill()
            ("Agent" as NSString).draw(at: NSPoint(x: 34, y: 6), withAttributes: [.font: NSFont.systemFont(ofSize: 10, weight: .medium), .foregroundColor: NSColor(srgbRed: 0.87, green: 0.78, blue: 0.58, alpha: 1)])
        }
    }
}
