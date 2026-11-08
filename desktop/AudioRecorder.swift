import AppKit
import AVFoundation
import UniformTypeIdentifiers

final class OpenSesameAudioRecorder: NSObject, AVAudioRecorderDelegate {
    private var recorder: AVAudioRecorder?
    private var systemAudio: OpenSesameSystemAudio?
    private var stoppingSystem = false
    private var systemFrames: Int64 = 0
    private var session = ""
    private var savedID = ""
    private var savedURL: URL?
    private var timer: Timer?
    private let emit: ([String: Any]) -> Void
    private let directory = FileManager.default.temporaryDirectory.appendingPathComponent("open-sesame-audio-" + UUID().uuidString, isDirectory: true)

    init(emit: @escaping ([String: Any]) -> Void) { self.emit = emit; super.init() }

    func start(id: String, source: String = "mic", completion: @escaping ([String: Any]?, String?) -> Void) {
        guard session.isEmpty, systemAudio == nil, !id.isEmpty, id.count <= 80, ["mic", "system", "both"].contains(source) else { completion(nil, "An audio capture is already starting or running."); return }
        session = id
        if source != "mic" { startSystem(id: id, source: source, completion: completion); return }
        AVCaptureDevice.requestAccess(for: .audio) { [weak self] allowed in
            DispatchQueue.main.async {
                guard let self = self, self.session == id else { completion(nil, "Recording cancelled."); return }
                guard allowed else { self.session = ""; completion(nil, "Allow Microphone access in macOS Privacy settings to record audio."); return }
                do {
                    try FileManager.default.createDirectory(at: self.directory, withIntermediateDirectories: true)
                    let url = self.directory.appendingPathComponent(UUID().uuidString + ".m4a")
                    let recorder = try AVAudioRecorder(url: url, settings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 44100, AVNumberOfChannelsKey: 1, AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue])
                    recorder.delegate = self; recorder.isMeteringEnabled = true
                    guard recorder.record() else { try? FileManager.default.removeItem(at: url); throw NSError(domain: "OpenSesame", code: 1) }
                    self.discardSaved(); self.savedURL = url; self.savedID = id; self.recorder = recorder
                    let timer = Timer(timeInterval: 0.2, repeats: true) { [weak self] _ in
                        guard let self = self, let recorder = self.recorder else { return }
                        recorder.updateMeters()
                        self.emit(["event": "record.level", "id": id, "level": min(100, max(0, pow(10, Double(recorder.averagePower(forChannel: 0)) / 20) * 300))])
                    }
                    self.timer = timer; RunLoop.main.add(timer, forMode: .common)
                    completion(["sourceLabel": AVCaptureDevice.default(for: .audio)?.localizedName ?? "System microphone"], nil)
                } catch { self.session = ""; completion(nil, "Could not start microphone recording.") }
            }
        }
    }

    private func startSystem(id: String, source: String, completion: @escaping ([String: Any]?, String?) -> Void) {
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let url = directory.appendingPathComponent(UUID().uuidString + ".m4a")
            systemFrames = 0
            let file = try AVAudioFile(forWriting: url, settings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 48000, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 128000], commonFormat: .pcmFormatFloat32, interleaved: false)
            let capture = OpenSesameSystemAudio(output: { [weak self] buffer in
                do { try file.write(from: buffer); self?.systemFrames += Int64(buffer.frameLength) }
                catch { DispatchQueue.main.async { guard self?.session == id else { return }; self?.emit(["event": "record.error", "id": id, "message": "Audio could not be written. Stop and save any captured audio."]) } }
            }, level: { [weak self] value in
                DispatchQueue.main.async { guard self?.session == id else { return }; self?.emit(["event": "record.level", "id": id, "level": value]) }
            }, failed: { [weak self] message in
                guard self?.session == id else { return }; self?.emit(["event": "record.error", "id": id, "message": message])
            })
            systemAudio = capture
            capture.start(source: source) { [weak self] error in
                guard let self, self.session == id else { completion(nil, "Recording cancelled."); return }
                if let error { self.stopAsync(id: id) { _ in try? FileManager.default.removeItem(at: url); completion(nil, error) }; return }
                self.discardSaved(); self.savedURL = url; self.savedID = id
                completion(["sourceLabel": source == "both" ? "Microphone + system audio" : "System audio"], nil)
            }
        } catch { session = ""; completion(nil, "Could not prepare the system audio recording.") }
    }
    func stopAsync(id: String, completion: @escaping (Bool) -> Void) {
        guard let capture = systemAudio else { completion(stop(id: id)); return }
        guard session == id, !stoppingSystem else { completion(false); return }
        session = ""; stoppingSystem = true
        capture.stop { [weak self] in
            guard let self else { completion(false); return }
            self.systemAudio = nil; self.stoppingSystem = false
            let size = (try? self.savedURL?.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            completion(self.savedID == id && self.systemFrames > 0 && size > 0)
        }
    }
    func stop(id: String) -> Bool {
        guard session == id || session.isEmpty && savedID == id else { return false }
        session = ""; timer?.invalidate(); timer = nil
        let current = recorder; recorder = nil; current?.stop()
        guard let url = savedURL, savedID == id, let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize else { return false }
        return size > 0
    }

    func save(id: String, completion: @escaping (Bool, String?) -> Void) {
        guard session.isEmpty, id == savedID, let url = savedURL else { completion(false, "No completed recording to save."); return }
        let picker = NSSavePanel(); picker.allowedContentTypes = [.mpeg4Audio]; picker.nameFieldStringValue = "open-sesame-audio.m4a"; picker.canCreateDirectories = true
        picker.level = .statusBar
        picker.begin { response in
            guard response == .OK, let destination = picker.url else { completion(false, nil); return }
            do { try Data(contentsOf: url).write(to: destination, options: .atomic); completion(true, nil) }
            catch { completion(false, "Could not save audio. Your recording is still available; try another location.") }
        }
    }

    func discardSaved() { if let url = savedURL { try? FileManager.default.removeItem(at: url) }; savedURL = nil; savedID = "" }
    func clear() { if systemAudio != nil { let id = session; stopAsync(id: id) { [weak self] _ in self?.discardSaved() }; return }; if !session.isEmpty { _ = stop(id: session) }; discardSaved() }
    func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        guard recorder === self.recorder else { return }
        let id = session; _ = stop(id: id)
        emit(["event": "record.error", "id": id, "message": "Recording stopped because audio could not be encoded. Save any captured audio before trying again."])
    }
    func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        guard recorder === self.recorder else { return }
        let id = session; _ = stop(id: id)
        emit(["event": "record.ended", "id": id, "message": flag ? "Recording finished. Save your audio." : "Audio input stopped. Save any captured audio before trying again."])
    }
    deinit { timer?.invalidate(); recorder?.stop(); try? FileManager.default.removeItem(at: directory) }
}
