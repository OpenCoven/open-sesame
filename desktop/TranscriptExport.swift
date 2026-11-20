import Foundation

enum OpenSesameTranscriptExport {
    static func data(_ params: [String: Any]) -> Data? {
        guard Set(params.keys) == ["text"], let text = params["text"] as? String,
              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !text.contains("\0"), let data = text.data(using: .utf8), data.count <= 4 * 1024 * 1024 else { return nil }
        return data
    }
}
