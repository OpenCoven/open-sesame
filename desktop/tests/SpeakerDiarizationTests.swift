import AppKit
import AVFoundation

@main struct SpeakerDiarizationTests {
    static func wait(_ test: () -> Bool) {
        let deadline = Date().addingTimeInterval(5)
        while !test(), Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.01)) }
        precondition(test(), "Owned speaker worker did not settle")
    }
    static func main() throws {
        precondition(OpenSesameSpeakerDiarization.validID("speakers-123_abc"))
        for value in ["", "../private", "a\nb", "é", String(repeating: "x", count: 81)] { precondition(!OpenSesameSpeakerDiarization.validID(value)) }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("open-sesame-speaker-test-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root.appendingPathComponent("runtime/bin"), withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createSymbolicLink(atPath: root.appendingPathComponent("runtime/bin/python3").path, withDestinationPath: CommandLine.arguments[1])
        try Data().write(to: root.appendingPathComponent(OpenSesameSpeakerDiarization.modelName))
        let fixture = """
        import argparse,json,os,time
        from pathlib import Path
        p=argparse.ArgumentParser();p.add_argument('--audio');p.add_argument('--model');p.add_argument('--stop');a=p.parse_args()
        root=Path(a.model).parent
        (root/'observed.txt').write_text(a.audio)
        (root/'pid.txt').write_text(str(os.getpid()))
        print(json.dumps({'type':'ready'}),flush=True)
        while not Path(a.stop).exists():time.sleep(.01)
        print(json.dumps({'type':'segments','segments':[{'start':0.0,'end':0.064,'speaker':0}],'through':0.064,'final':True}),flush=True)
        print(json.dumps({'type':'ended'}),flush=True)
        """
        try fixture.write(to: root.appendingPathComponent("diarization_worker.py"), atomically: true, encoding: .utf8)
        var events: [[String: Any]] = [], ready = false
        let service = OpenSesameSpeakerDiarization(resources: root, root: root) { events.append($0) }
        service.start(id: "test-1") { precondition($0 == nil); ready = true }
        wait { ready }
        let capture = URL(fileURLWithPath: try String(contentsOf: root.appendingPathComponent("observed.txt"), encoding: .utf8)).deletingLastPathComponent()
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1024)!; buffer.frameLength = 1024
        for i in 0..<1024 { buffer.floatChannelData![0][i] = 0 }
        service.append(buffer); precondition(abs(service.offset - 0.064) < 0.001)
        service.finish(id: "test-1")
        wait { events.contains { $0["event"] as? String == "diarization.result" } && service.currentID == nil }
        wait { !FileManager.default.fileExists(atPath: capture.path) }
        ready = false; service.start(id: "test-2") { precondition($0 == nil); ready = true }; wait { ready }
        let cancelledFolder = URL(fileURLWithPath: try String(contentsOf: root.appendingPathComponent("observed.txt"), encoding: .utf8)).deletingLastPathComponent()
        let pid = Int32(try String(contentsOf: root.appendingPathComponent("pid.txt"), encoding: .utf8))!
        service.cancel(id: "test-2")
        wait { !FileManager.default.fileExists(atPath: cancelledFolder.path) }
        wait { kill(pid, 0) == -1 && errno == ESRCH }
        print("Speaker sidecar: strict IDs, real isolated process protocol, PCM timing, final events, cancellation, process exit and temporary audio deletion passed. Synthetic model only; no microphone or provider.")
    }
}
