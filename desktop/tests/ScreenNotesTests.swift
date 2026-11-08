import AppKit
import CoreText
import ImageIO
import UniformTypeIdentifiers
@main struct ScreenNotesTests {
    static func main() throws {
        let context = CGContext(data: nil, width: 1000, height: 400, bitsPerComponent: 8, bytesPerRow: 4000, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.setFillColor(CGColor(gray: 1, alpha: 1)); context.fill(CGRect(x: 0, y: 0, width: 1000, height: 400))
        context.textPosition = CGPoint(x: 40, y: 240)
        let text = NSAttributedString(string: "OPEN SESAME SCREEN NOTES", attributes: [NSAttributedString.Key(kCTFontAttributeName as String): CTFontCreateWithName("Helvetica-Bold" as CFString, 42, nil), NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(gray: 0, alpha: 1)])
        CTLineDraw(CTLineCreateWithAttributedString(text), context)
        let image = context.makeImage()!, data = NSMutableData()
        let destination = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil)!
        CGImageDestinationAddImage(destination, image, nil); precondition(CGImageDestinationFinalize(destination))
        let decoded = try OpenSesameScreenNotes.decode(data as Data)
        let recognized = try OpenSesameScreenNotes.recognize(decoded)
        precondition(recognized.uppercased().contains("OPEN SESAME") && recognized.uppercased().contains("SCREEN NOTES"), "Actual local Vision OCR must read synthetic fixture text")
        do { _ = try OpenSesameScreenNotes.decode(Data("invalid".utf8)); fatalError("Invalid images must fail") } catch {}
        do { _ = try OpenSesameScreenNotes.decode(Data(repeating: 0, count: 20_000_001)); fatalError("Oversized images must fail") } catch {}
        print("Screen notes: real local Vision OCR, image decoding/orientation path and invalid/oversized input refusal passed using a generated fixture. No screen was captured or data uploaded.")
    }
}
