import AppKit

@main struct TerminalClipboardTests {
    static func main() throws {
        let board = NSPasteboard.withUniqueName()
        defer { board.releaseGlobally() }
        let text = "first line\n第二行 👑\t$ literal `text`\n"
        try OpenSesameTerminalClipboard.write(["text": text], to: board)
        let roundtrip = try OpenSesameTerminalClipboard.read([:], from: board)
        precondition(roundtrip == text)
        for params: [String: Any] in [["text": 3], ["text": "x", "extra": true], [:], ["text": String(repeating: "👑", count: OpenSesameTerminalClipboard.limit / 4 + 1)] ] {
            do { try OpenSesameTerminalClipboard.write(params, to: board); fatalError("Invalid write accepted") } catch {}
            precondition(board.string(forType: .string) == text, "Rejected writes preserve clipboard")
        }
        do { _ = try OpenSesameTerminalClipboard.read(["extra": true], from: board); fatalError("Invalid read accepted") } catch {}
        board.clearContents(); board.setString(String(repeating: "x", count: OpenSesameTerminalClipboard.limit + 1), forType: .string)
        do { _ = try OpenSesameTerminalClipboard.read([:], from: board); fatalError("Oversize read accepted") } catch {}
        board.clearContents()
        let empty = try OpenSesameTerminalClipboard.read([:], from: board)
        precondition(empty.isEmpty)
        print("Terminal clipboard Unicode/multiline roundtrip, strict fields, byte limits and rejected-write preservation passed on a private pasteboard.")
    }
}
