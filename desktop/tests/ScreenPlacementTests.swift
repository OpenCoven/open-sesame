import Foundation
import CoreGraphics

@main struct ScreenPlacementTests {
    static func main() {
        typealias Placement = OpenSesameScreenPlacement
        let laptop = CGRect(x: 0, y: 0, width: 1512, height: 982)
        let left = CGRect(x: -1920, y: -120, width: 1920, height: 1080)
        let above = CGRect(x: 200, y: 982, width: 2560, height: 1440)
        let screens = [laptop, left, above]
        precondition(Placement.screenIndex(pointer: CGPoint(x: -500, y: 100), frames: screens, fallback: 0) == 1, "The pointer overrides the old window display")
        precondition(Placement.screenIndex(pointer: CGPoint(x: 1000, y: 1600), frames: screens, fallback: 1) == 2, "Displays above the primary use global AppKit coordinates")
        precondition(Placement.screenIndex(pointer: CGPoint(x: 500, y: 300), frames: screens, fallback: 2) == 0)
        precondition(Placement.screenIndex(pointer: CGPoint(x: 0, y: 400), frames: screens, fallback: 1) == 0, "Shared vertical edges belong to just one display")
        precondition(Placement.screenIndex(pointer: CGPoint(x: 500, y: 982), frames: screens, fallback: 0) == 2, "Shared horizontal edges belong to just one display")
        precondition(Placement.screenIndex(pointer: CGPoint(x: 100, y: 1200), frames: screens, fallback: 1) == 1, "A layout gap retains the last valid display")
        precondition(Placement.screenIndex(pointer: nil, frames: screens, fallback: 2) == 2)
        precondition(Placement.screenIndex(pointer: CGPoint(x: CGFloat.nan, y: 1), frames: screens, fallback: 1) == 1)
        precondition(Placement.screenIndex(pointer: nil, frames: [laptop], fallback: 2) == 0, "Removing a display falls back to an existing one")
        precondition(Placement.screenIndex(pointer: CGPoint(x: 400, y: 400), frames: [laptop, laptop], fallback: 1) == 1, "Mirrored displays retain a stable preference")
        let invalid = CGRect(x: 0, y: 0, width: 0, height: 100)
        precondition(Placement.screenIndex(pointer: nil, frames: [invalid, laptop], fallback: 0) == 1)
        precondition(Placement.screenIndex(pointer: nil, frames: [invalid], fallback: 0) == nil)
        precondition(Placement.screenIndex(pointer: nil, frames: [], fallback: nil) == nil)
        precondition(Placement.screenIndex(pointer: CGPoint(x: -500, y: 100), frames: screens, fallback: 1, pinned: 2) == 2, "A valid pin overrides pointer and previous display")
        precondition(Placement.screenIndex(pointer: CGPoint(x: -500, y: 100), frames: screens, fallback: 0, pinned: 9) == 1, "A missing pin safely follows the pointer")
        precondition(Placement.screenIndex(pointer: CGPoint(x: 500, y: 100), frames: [invalid, laptop], fallback: 1, pinned: 0) == 1)
        let suite = "computer.opensesame.display-test-" + UUID().uuidString
        let preferences = UserDefaults(suiteName: suite)!
        defer { preferences.removePersistentDomain(forName: suite) }
        let firstID = "12345678-1234-1234-1234-123456789abc", secondID = "ABCDEFAB-1234-1234-1234-123456789ABC"
        OpenSesameDisplayPreference(uuid: firstID, name: "Studio display").save(to: preferences)
        let restored = OpenSesameDisplayPreference.load(from: preferences)
        precondition(restored.name == "Studio display" && restored.index(in: [secondID, firstID]) == 1)
        precondition(restored.index(in: [secondID]) == nil && restored.uuid != nil, "Disconnecting does not erase the preferred hardware identity")
        precondition(restored.index(in: [firstID, secondID]) == 0, "Reconnection works after display IDs or ordering change")
        OpenSesameDisplayPreference().save(to: preferences)
        precondition(OpenSesameDisplayPreference.load(from: preferences).uuid == nil && preferences.string(forKey: "openSesame.display.name") == nil)
        preferences.set("corrupt", forKey: "openSesame.display.uuid")
        precondition(OpenSesameDisplayPreference.load(from: preferences).uuid == nil)

        let desired = CGSize(width: 1100, height: 619)
        func notch(_ frame: CGRect, requested: CGSize = desired, full: Bool = false) -> CGRect {
            Placement.panelFrame(requested: requested, frame: frame, visibleFrame: frame, placement: "notch", full: full)!
        }
        let compact = notch(left, requested: CGSize(width: 280, height: 35))
        precondition(compact.midX == left.midX && compact.maxY == left.maxY && compact.width == 280 && compact.height == 35)
        let expanded = notch(above)
        precondition(expanded.midX == above.midX && expanded.maxY == above.maxY && expanded.size == desired)
        let small = CGRect(x: 1512, y: 100, width: 800, height: 600)
        let constrained = notch(small)
        precondition(constrained.width == 792 && constrained.height == 550 && small.contains(constrained))
        precondition(notch(above).size == desired, "A small display never overwrites the preferred expanded size")
        precondition(notch(left, full: true) == left && notch(above, full: true) == above, "Full follows the target display's actual origin and dimensions")
        let visible = CGRect(x: 0, y: 50, width: 1512, height: 900)
        let capture = Placement.panelFrame(requested: CGSize(width: 700, height: 100), frame: laptop, visibleFrame: visible, placement: "capture", full: false)!
        precondition(capture.midX == laptop.midX && capture.midY == visible.midY)
        let menu = Placement.panelFrame(requested: CGSize(width: 400, height: 300), frame: laptop, visibleFrame: visible, placement: "menu", full: false, menuAnchor: CGRect(x: 1400, y: 950, width: 30, height: 25))!
        precondition(menu.maxX == 1430 && menu.maxY == 945 && laptop.contains(menu))
        for width in [1.0, 6, 80, 180, 640, 3840] {
            let frame = CGRect(x: -500, y: -800, width: width, height: max(1, width * 0.6))
            let result = notch(frame)
            precondition(result.width > 0 && result.height > 0 && frame.contains(result), "Every accepted size remains inside the target display")
        }
        precondition(Placement.panelFrame(requested: CGSize(width: CGFloat.infinity, height: 35), frame: laptop, visibleFrame: laptop, placement: "notch", full: false) == nil)
        precondition(Placement.panelFrame(requested: desired, frame: invalid, visibleFrame: invalid, placement: "notch", full: false) == nil)

        precondition(Placement.shouldFollow(placement: "notch", detached: false, visible: true, interacting: false))
        for placement in ["menu", "capture"] { precondition(!Placement.shouldFollow(placement: placement, detached: false, visible: true, interacting: false)) }
        precondition(Placement.shouldFollow(placement: "capture", detached: false, visible: true, interacting: false, reconfigure: true), "Launcher placement recovers after display reconnection")
        precondition(!Placement.shouldFollow(placement: "capture", detached: false, visible: true, interacting: true, reconfigure: true), "Reconfiguration waits until interaction ends")
        precondition(!Placement.shouldFollow(placement: "notch", detached: true, visible: true, interacting: false))
        precondition(!Placement.shouldFollow(placement: "notch", detached: false, visible: false, interacting: false))
        precondition(!Placement.shouldFollow(placement: "notch", detached: false, visible: true, interacting: true))
        let floating = Placement.floatingFrame(current: CGRect(x: 1400, y: -800, width: 1100, height: 700), visibleFrame: CGRect(x: -1920, y: 0, width: 1920, height: 1080))!
        precondition(floating == CGRect(x: -1100, y: 0, width: 1100, height: 700))
        let centered = Placement.floatingFrame(current: CGRect(x: 0, y: 0, width: 700, height: 800), visibleFrame: CGRect(x: 1920, y: 0, width: 1280, height: 720), center: true)!
        precondition(centered == CGRect(x: 2210, y: 0, width: 700, height: 720))
        precondition(Placement.floatingFrame(current: CGRect(x: 0, y: 0, width: CGFloat.nan, height: 200), visibleFrame: CGRect(x: 0, y: 0, width: 1280, height: 720)) == nil)
        print("Screen placement: pointer/pin priority, persisted UUID restoration, disconnect/reconnect and corrupt preference fallback, offset/shared/mirrored displays, retained sizes, bounded frames, Full and interaction guards passed. No display or pointer was moved.")
    }
}
