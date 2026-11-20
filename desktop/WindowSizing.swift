import AppKit

enum OpenSesameWindowSizing {
    static func allowFreeResize(_ window: NSWindow) {
        // Explicitly setting a zero aspect ratio installs zero frame resize increments.
        // AppKit's live resize and display-move animation can then produce NaN frames.
        window.contentResizeIncrements = NSSize(width: 1, height: 1)
    }
}
