import AppKit

@main struct ImageExportTests {
    static func main() {
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 2, pixelsHigh: 2, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        let data = bitmap.representation(using: .png, properties: [:])!
        precondition(OpenSesameImageExport.png("data:image/png;base64," + data.base64EncodedString()) != nil)
        for input in ["", "file:///private/example.png", "data:image/svg+xml;base64,AAAA", "data:image/png;base64,AAAA"] {
            precondition(OpenSesameImageExport.png(input) == nil)
        }
        var oversized = data
        oversized.replaceSubrange(16..<20, with: [0, 1, 0, 0])
        precondition(OpenSesameImageExport.png("data:image/png;base64," + oversized.base64EncodedString()) == nil)
        precondition(OpenSesameImageExport.png(NSNull()) == nil)
        print("Generated PNG decoding, re-encoding and export bounds pass")
    }
}
