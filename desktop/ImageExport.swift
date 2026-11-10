import AppKit

enum OpenSesameImageExport {
    static func png(_ value: Any?) -> Data? {
        guard let text = value as? String, text.hasPrefix("data:image/png;base64,"), text.utf8.count <= 11_200_000,
              let data = Data(base64Encoded: String(text.dropFirst(22))), data.count <= 8 * 1024 * 1024,
              data.starts(with: [137,80,78,71,13,10,26,10]), data.count >= 32 else { return nil }
        let width = data[16..<20].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
        let height = data[20..<24].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
        guard width > 0, height > 0, width <= 8192, height <= 8192, UInt64(width) * UInt64(height) <= 24_000_000,
              let bitmap = NSBitmapImageRep(data: data), bitmap.pixelsWide == Int(width), bitmap.pixelsHigh == Int(height) else { return nil }
        return bitmap.representation(using: .png, properties: [:])
    }
}
