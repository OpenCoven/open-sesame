import Foundation

@main struct TranscriptExportTests {
    static func main() throws {
        let text = "Speaker 1: Before the pause.\nSpeaker 2: Après la pause. 🌙\nFinal marker.\n"
        let data = OpenSesameTranscriptExport.data(["text": text])!
        precondition(String(data: data, encoding: .utf8) == text)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let destination = directory.appendingPathComponent("transcript.txt")
        try data.write(to: destination, options: .atomic)
        let saved = try Data(contentsOf: destination)
        precondition(saved == data)
        for invalid: [String: Any] in [[:], ["text": " \n"], ["text": 42], ["text": "a\0b"], ["text": text, "path": "/tmp/untrusted"], ["text": String(repeating: "é", count: 2 * 1024 * 1024 + 1)]] {
            precondition(OpenSesameTranscriptExport.data(invalid) == nil)
        }
        precondition(OpenSesameTranscriptExport.data(["text": String(repeating: "a", count: 4 * 1024 * 1024)])?.count == 4 * 1024 * 1024)
        print("Transcript export: bounded exact UTF-8, strict request fields and atomic file round trip passed.")
    }
}
