import AppKit

enum OpenSesameTerminalClipboard {
    static let limit = 1024 * 1024
    enum Failure: LocalizedError {
        case invalid, tooLarge, unavailable
        var errorDescription: String? {
            switch self {
            case .invalid: return "Invalid terminal clipboard request."
            case .tooLarge: return "Clipboard text is too large."
            case .unavailable: return "The clipboard is unavailable."
            }
        }
    }
    static func read(_ params: [String: Any], from board: NSPasteboard = .general) throws -> String {
        guard params.isEmpty else { throw Failure.invalid }
        let text = board.string(forType: .string) ?? ""
        guard text.utf8.count <= limit else { throw Failure.tooLarge }
        return text
    }
    static func write(_ params: [String: Any], to board: NSPasteboard = .general) throws {
        guard Set(params.keys) == ["text"], let text = params["text"] as? String else { throw Failure.invalid }
        guard text.utf8.count <= limit else { throw Failure.tooLarge }
        board.clearContents()
        guard board.setString(text, forType: .string) else { throw Failure.unavailable }
    }
}
