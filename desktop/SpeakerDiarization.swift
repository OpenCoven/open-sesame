import AppKit
import AVFoundation

// A local, opt-in sidecar. Renderer requests never choose paths, executables or models.
final class OpenSesameSpeakerDiarization: @unchecked Sendable {
    static let modelName = "diar_streaming_sortformer_4spk-v2.1.nemo"
    static func validID(_ value: String) -> Bool { !value.isEmpty && value.count <= 80 && value.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") } }
    private final class Capture: @unchecked Sendable {
        let id: String, folder: URL, audio: URL, marker: URL, handle: FileHandle, process: Process
        var samples = 0, converters: [String: AVAudioConverter] = [:], pending = Data(), ready: ((String?) -> Void)?
        init(id: String, folder: URL, handle: FileHandle, process: Process, ready: @escaping (String?) -> Void) {
            self.id = id; self.folder = folder; self.audio = folder.appendingPathComponent("capture.pcm"); self.marker = folder.appendingPathComponent("finished"); self.handle = handle; self.process = process; self.ready = ready
        }
    }
    private let emit: ([String: Any]) -> Void
    private let io = DispatchQueue(label: "opensesame.speaker-audio")
    private var current: Capture?
    private let resources: URL
    private let root: URL
    init(resources: URL, root: URL? = nil, emit: @escaping ([String: Any]) -> Void) { self.resources = resources; self.root = root ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Open Sesame/diarization", isDirectory: true); self.emit = emit }
    var currentID: String? { current?.id }
    var offset: Double { guard let capture = current else { return 0 }; return io.sync { Double(capture.samples) / 16000 } }
    func status() -> [String: Any] {
        let ready = FileManager.default.isExecutableFile(atPath: root.appendingPathComponent("runtime/bin/python3").path) && FileManager.default.fileExists(atPath: root.appendingPathComponent(Self.modelName).path)
        return ["ready": ready, "engine": "NeMo Sortformer v2.1", "maxSpeakers": 4, "local": true]
    }
    func setupCommand() -> String {
        func quote(_ s: String) -> String { "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'" }
        return "/usr/bin/env python3 -B " + quote(resources.appendingPathComponent("diarization_worker.py").path) + " --install"
    }
    func start(id: String, completion: @escaping (String?) -> Void) {
        guard Self.validID(id), current == nil else { completion("Speaker labels are busy or the session is invalid."); return }
        guard status()["ready"] as? Bool == true else { completion("Set up local speaker labels before starting."); return }
        do {
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent("OpenSesame-speakers-" + UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            let audio = folder.appendingPathComponent("capture.pcm")
            guard FileManager.default.createFile(atPath: audio.path, contents: Data(), attributes: [.posixPermissions: 0o600]) else { throw CocoaError(.fileWriteUnknown) }
            let process = Process(), output = Pipe(), errors = Pipe()
            let capture = Capture(id: id, folder: folder, handle: try FileHandle(forWritingTo: audio), process: process, ready: completion)
            process.executableURL = root.appendingPathComponent("runtime/bin/python3")
            process.arguments = ["-B", resources.appendingPathComponent("diarization_worker.py").path, "--audio", audio.path, "--model", root.appendingPathComponent(Self.modelName).path, "--stop", capture.marker.path]
            var env = ProcessInfo.processInfo.environment
            for (key, value) in ["HF_HUB_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1", "DO_NOT_TRACK": "1", "NO_ALBUMENTATIONS_UPDATE": "1", "TRANSFORMERS_OFFLINE": "1", "WANDB_MODE": "disabled", "NEMO_LOG_LEVEL": "ERROR", "TOKENIZERS_PARALLELISM": "false", "OMP_NUM_THREADS": "4"] { env[key] = value }
            process.environment = env; process.standardInput = FileHandle.nullDevice; process.standardOutput = output; process.standardError = errors
            errors.fileHandleForReading.readabilityHandler = { handle in _ = handle.availableData }
            output.fileHandleForReading.readabilityHandler = { [weak self, weak capture] handle in
                let data = handle.availableData
                guard !data.isEmpty, let self, let capture else { return }
                DispatchQueue.main.async { [weak self] in self?.receive(data, capture: capture) }
            }
            process.terminationHandler = { [weak self, capture] process in
                output.fileHandleForReading.readabilityHandler = nil; errors.fileHandleForReading.readabilityHandler = nil
                process.terminationHandler = nil
                let trailing = output.fileHandleForReading.readDataToEndOfFile()
                DispatchQueue.main.async {
                    if !trailing.isEmpty { self?.receive(trailing, capture: capture) }
                    guard let self, self.current === capture else { return }
                    capture.ready?("Speaker labels could not start. Check local speaker setup."); capture.ready = nil
                    self.emit(["event": "diarization.ended", "id": capture.id]); self.current = nil
                }
                self?.io.async { try? capture.handle.close(); try? FileManager.default.removeItem(at: capture.folder) }
            }
            current = capture
            do { try process.run() } catch { process.terminationHandler = nil; current = nil; try? capture.handle.close(); try? FileManager.default.removeItem(at: folder); throw error }
            DispatchQueue.main.asyncAfter(deadline: .now() + 120) { [weak self, weak capture] in
                guard let self, let capture, self.current === capture, capture.ready != nil else { return }
                self.cancel(id: capture.id)
            }
        } catch { completion("Could not start local speaker labels. Run speaker setup and retry.") }
    }
    private func receive(_ data: Data, capture: Capture) {
        guard current === capture else { return }
        capture.pending.append(data)
        guard capture.pending.count <= 2 * 1024 * 1024 else { cancel(id: capture.id); return }
        while let newline = capture.pending.firstIndex(of: 10) {
            let line = capture.pending.prefix(upTo: newline); capture.pending.removeSubrange(...newline)
            guard let value = try? JSONSerialization.jsonObject(with: line) as? [String: Any], let type = value["type"] as? String else { cancel(id: capture.id); return }
            if type == "ready" { let ready = capture.ready; capture.ready = nil; ready?(nil) }
            else if type == "segments", let rows = value["segments"] as? [[String: Any]], rows.count <= 20000, let through = value["through"] as? Double, through.isFinite, (0...1800.25).contains(through), let final = value["final"] as? Bool {
                guard rows.allSatisfy({ row in
                    guard let start = row["start"] as? Double, let end = row["end"] as? Double, let speaker = row["speaker"] as? Int else { return false }
                    return start.isFinite && end.isFinite && start >= 0 && end > start && end <= 1800.25 && (0..<4).contains(speaker)
                }) else { cancel(id: capture.id); return }
                emit(["event": "diarization.result", "id": capture.id, "segments": rows, "through": through, "final": final])
            } else if type == "error" { emit(["event": "diarization.error", "id": capture.id, "message": "Speaker labels could not finish. Your transcript is preserved."]) }
        }
    }
    func append(_ buffer: AVAudioPCMBuffer) {
        guard let capture = current, buffer.frameLength > 0, buffer.frameLength <= 48000,
              let copy = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength) else { return }
        copy.frameLength = buffer.frameLength
        let src = UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList), dst = UnsafeMutableAudioBufferListPointer(copy.mutableAudioBufferList)
        for i in 0..<min(src.count, dst.count) { if let source = src[i].mData, let target = dst[i].mData { memcpy(target, source, Int(min(src[i].mDataByteSize, dst[i].mDataByteSize))) } }
        io.async {
            guard capture.samples < 16000 * 1800, let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false) else { return }
            let key = String(copy.format.sampleRate) + ":" + String(copy.format.channelCount)
            if capture.converters[key] == nil { capture.converters[key] = AVAudioConverter(from: copy.format, to: format) }
            guard let converter = capture.converters[key], let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(ceil(Double(copy.frameLength) * 16000 / copy.format.sampleRate)) + 32) else { return }
            var supplied = false, error: NSError?
            converter.convert(to: output, error: &error) { _, state in if supplied { state.pointee = .noDataNow; return nil }; supplied = true; state.pointee = .haveData; return copy }
            guard error == nil, let data = output.floatChannelData?[0] else { return }
            let count = min(Int(output.frameLength), 16000 * 1800 - capture.samples)
            do { try capture.handle.write(contentsOf: Data(bytes: data, count: count * 4)); capture.samples += count } catch {
                DispatchQueue.main.async { [weak self] in guard let self, self.current === capture else { return }; self.emit(["event": "diarization.error", "id": capture.id, "message": "Temporary speaker audio could not be buffered. Your transcript is preserved."]); self.cancel(id: capture.id) }
            }
        }
    }
    func finish(id: String) {
        guard let capture = current, capture.id == id else { return }
        io.async { try? capture.handle.synchronize(); FileManager.default.createFile(atPath: capture.marker.path, contents: Data(), attributes: [.posixPermissions: 0o600]) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 600) { [weak self, weak capture] in guard let self, let capture, self.current === capture else { return }; self.emit(["event": "diarization.error", "id": id, "message": "Speaker labeling timed out. Your transcript and existing labels are preserved."]); self.cancel(id: id) }
    }
    func shutdown() {
        guard let capture = current else { return }
        cancel(id: capture.id)
        if capture.process.isRunning { kill(capture.process.processIdentifier, SIGKILL) }
        try? FileManager.default.removeItem(at: capture.folder)
    }
    func cancel(id: String? = nil) {
        guard let capture = current, id == nil || capture.id == id else { return }
        current = nil; capture.ready?("Speaker labels cancelled."); capture.ready = nil
        if capture.process.isRunning { capture.process.terminate(); DispatchQueue.main.asyncAfter(deadline: .now() + 1) { if capture.process.isRunning { kill(capture.process.processIdentifier, SIGKILL) } } }
        io.async { try? capture.handle.close(); try? FileManager.default.removeItem(at: capture.folder) }
    }
}
