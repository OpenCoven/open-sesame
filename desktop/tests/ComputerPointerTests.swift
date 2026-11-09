import AppKit
import CoreGraphics
@main struct PointerTests {
    static func main() {
        let display = CGRect(x: -1920, y: -100, width: 1920, height: 1080), point = CGPoint(x: -500, y: 250)
        let target = OpenSesamePointerWindow(pid: 42, id: 100, bounds: CGRect(x: -900, y: 0, width: 800, height: 700))
        let behind = OpenSesamePointerWindow(pid: 43, id: 101, bounds: display)
        let pointer = OpenSesamePointerWindow(pid: 7, id: 50, bounds: display)
        precondition(OpenSesamePointerWindow.choose([pointer,target,behind], point: point, display: display, owner: 7, pointerWindow: 50) == target)
        precondition(OpenSesamePointerWindow.choose([pointer,target], point: point, display: display, owner: 7, pointerWindow: nil) == nil, "Never click through Open Sesame UI")
        precondition(OpenSesamePointerWindow.choose([target], point: CGPoint(x: 1, y: 250), display: display, owner: 7, pointerWindow: nil) == nil)
        precondition(OpenSesamePointerWindow.choose([target], point: CGPoint(x: CGFloat.nan, y: 250), display: display, owner: 7, pointerWindow: nil) == nil)
        let transparent = OpenSesamePointerWindow(pid: 44, id: 102, bounds: display, alpha: 0)
        precondition(OpenSesamePointerWindow.choose([transparent,target], point: point, display: display, owner: 7, pointerWindow: nil) == target)
        let invalid = OpenSesamePointerWindow(pid: 0, id: 99, bounds: display)
        precondition(OpenSesamePointerWindow.choose([invalid,target], point: point, display: display, owner: 7, pointerWindow: nil) == nil)
        let event = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)!
        target.configure(event, marker: 123456)
        precondition(event.location == point && event.getIntegerValueField(.eventTargetUnixProcessID) == 42)
        precondition(event.getIntegerValueField(.mouseEventWindowUnderMousePointer) == 100 && event.getIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent) == 100 && event.getIntegerValueField(.eventSourceUserData) == 123456)
        let frame = OpenSesamePointerWindow.cocoaFrame(at: point, primaryHeight: 900)
        precondition(frame.origin == CGPoint(x: -503, y: 617), "Overlay coordinates preserve offset display geometry")
        print("Agent pointer: independent target/window metadata, frontmost hit selection, own-UI refusal, offset-display overlay mapping and tagged mouse event fields passed. No window, capture or input was posted.")
    }
}
