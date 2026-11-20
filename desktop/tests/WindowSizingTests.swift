import AppKit

@main struct WindowSizingTests {
    static func main() {
        _ = NSApplication.shared
        let window = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 1000, height: 600), styleMask: [.titled, .resizable], backing: .buffered, defer: false)
        for ratio in [NSSize(width: 16, height: 9), .zero] {
            window.contentAspectRatio = ratio
            OpenSesameWindowSizing.allowFreeResize(window)
            let increments = window.resizeIncrements
            guard increments.width.isFinite, increments.height.isFinite, increments.width >= 1, increments.height >= 1 else {
                fputs("FAIL: free resize leaves invalid frame increments: \(increments)\n", stderr); exit(1)
            }
            let content = window.contentResizeIncrements
            guard content.width >= 1, content.height >= 1, window.contentAspectRatio == .zero else {
                fputs("FAIL: free resize retains aspect or invalid content increments\n", stderr); exit(1)
            }
            for size in [NSSize(width: 560, height: 360), NSSize(width: 1456, height: 820), NSSize(width: 864, height: 450)] {
                window.setContentSize(size)
                guard window.frame.width.isFinite, window.frame.height.isFinite, window.contentRect(forFrameRect: window.frame).size == size else { exit(1) }
            }
        }
        print("Window sizing: aspect reset preserves positive frame/content increments and finite wide/narrow/short frames. No existing window was manipulated.")
    }
}
