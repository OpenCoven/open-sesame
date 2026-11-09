import AppKit
import ImageIO

@main struct ComputerAgentTests {
    @MainActor static func main() throws {
        for (name, code) in [("cmd+a",CGKeyCode(0)),("ctrl+shift+left",CGKeyCode(123)),("option+tab",CGKeyCode(48)),("Escape",CGKeyCode(53)),("enter",CGKeyCode(36))] {
            guard let parsed = OpenSesameComputerAgent.key(name) else { preconditionFailure("Supported shortcut failed") }
            precondition(parsed.0 == code)
        }
        precondition(OpenSesameComputerAgent.key("invented+a") == nil)
        precondition(OpenSesameComputerAgent.key("cmd+") == nil)
        precondition(OpenSesameComputerAgent.key("cmd+shutdown") == nil)
        let context = CGContext(data: nil, width: 1280, height: 720, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
        context.setFillColor(CGColor(red: 0.1, green: 0.12, blue: 0.15, alpha: 1)); context.fill(CGRect(x: 0,y: 0,width: 1280,height: 720))
        let image = context.makeImage()!, jpeg = try OpenSesameComputerAgent.jpeg(image)
        precondition(jpeg.count <= 650000 && jpeg.starts(with: [0xff,0xd8,0xff]))
        let decoded = CGImageSourceCreateWithData(jpeg as CFData,nil).flatMap { CGImageSourceCreateImageAtIndex($0,0,nil) }!
        precondition(decoded.width == 1280 && decoded.height == 720)
        let base64 = jpeg.base64EncodedString(); let wire = try JSONSerialization.data(withJSONObject: ["image":base64,"summary":String(repeating:"x",count:16000)])
        precondition(wire.count < 1048576)
        let controller = OpenSesameComputerAgent(); var calls = [String]()
        controller.call = { method,_,done in calls.append(method); done(["result":true]) }
        // Authentication false makes both operations read-only refusals.
        controller.requestPermission("screen"); controller.stop(); precondition(calls.isEmpty && !controller.active)
        print("Native computer shortcuts, generated-image JPEG geometry/wire budget, secure-input validation and unauthenticated refusal pass. No user screen, permissions, Keychain write or native input was used.")
    }
}
