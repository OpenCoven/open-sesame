import Foundation
import CoreGraphics

@main struct ComputerAgentModelTests {
    static func main() throws {
        typealias Action = OpenSesameComputerAction
        let frame = OpenSesameComputerObservation(id: "frame", run: "task", display: 3, bounds: CGRect(x: -1920, y: 100, width: 1920, height: 1080), imageSize: CGSize(width: 1280, height: 720), foreground: 123, humanGeneration: 7, created: 10)
        let action = try Action(["action": "click", "observation": "frame", "coordinate": [640, 360]])
        let mapped = try frame.screenPoint(action.coordinate!); precondition(mapped == CGPoint(x: -960, y: 640))
        try frame.admit(action, run: "task", display: 3, bounds: frame.bounds, foreground: 123, humanGeneration: 7, now: 20)
        func refuses(_ body: () throws -> Void) { do { try body(); preconditionFailure("Unexpected admission") } catch {} }
        refuses { try frame.admit(action, run: "other", display: 3, bounds: frame.bounds, foreground: 123, humanGeneration: 7, now: 20) }
        refuses { try frame.admit(action, run: "task", display: 3, bounds: frame.bounds, foreground: 123, humanGeneration: 8, now: 20) }
        refuses { try frame.admit(action, run: "task", display: 3, bounds: frame.bounds, foreground: 456, humanGeneration: 7, now: 20) }
        refuses { try frame.admit(action, run: "task", display: 4, bounds: frame.bounds, foreground: 123, humanGeneration: 7, now: 20) }
        refuses { try frame.admit(action, run: "task", display: 3, bounds: frame.bounds, foreground: 123, humanGeneration: 7, now: 71) }
        refuses { _ = try frame.screenPoint(CGPoint(x: 1280, y: 0)) }
        for invalid: [String: Any] in [["action": "shell"], ["action": "observe", "text": "extra"], ["action": "click", "observation": "frame", "coordinate": [true, false]], ["action": "scroll", "observation": "frame", "direction": "down", "amount": true], ["action": "drag", "observation": "frame", "coordinate": [1, 2]]] { refuses { _ = try Action(invalid) } }
        let observe = try Action(["action": "observe", "text": NSNull()]); precondition(observe.kind == .observe)
        let unicode = String(repeating: "a", count: 31) + "🔮🌿e\u{301}" + String(repeating: "b", count: 40)
        let chunks = Action.textChunks(unicode)
        precondition(chunks.allSatisfy { $0.count <= 32 && !String(decoding: $0, as: UTF16.self).contains("�") })
        precondition(chunks.map { String(decoding: $0, as: UTF16.self) }.joined() == unicode)
        let displayBounds = CGRect(x: -1920,y: 100,width: 1920,height: 1080)
        precondition(OpenSesameComputerFocusPolicy.allows(role: "AXTextField",subrole: "",bounds: CGRect(x: -1800,y: 200,width: 300,height: 30),display: displayBounds))
        precondition(!OpenSesameComputerFocusPolicy.allows(role: "AXTextField",subrole: "AXSecureTextField",bounds: CGRect(x: -1800,y: 200,width: 300,height: 30),display: displayBounds))
        precondition(!OpenSesameComputerFocusPolicy.allows(role: "AXTextField",subrole: "",bounds: CGRect(x: 100,y: 200,width: 300,height: 30),display: displayBounds))
        precondition(!OpenSesameComputerFocusPolicy.allows(role: "AXWindow",subrole: "",bounds: CGRect(x: -300,y: 200,width: 600,height: 300),display: displayBounds))
        let scroll = try Action(["action":"scroll","observation":"frame","direction":"down","amount":2,"coordinate":[20,30]])
        precondition(scroll.coordinate == CGPoint(x:20,y:30))
        print("Native computer action schema, offset-display coordinate mapping, run/frame freshness, focus/human/display binding and invalid input refusal pass. No capture or input was performed.")
    }
}
