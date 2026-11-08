import AppKit
import AVFoundation
import Speech

final class OpenSesameVoiceInput {
    private let emit: ([String: Any]) -> Void
    private let engine = AVAudioEngine()
    private var systemAudio: OpenSesameSystemAudio?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var recognizer: SFSpeechRecognizer?
    private var session = ""
    private var source = "mic"
    private var text = ""
    private var tapped = false
    private var limit: Timer?
    private var finishing: Timer?
    init(emit: @escaping ([String: Any]) -> Void) { self.emit = emit }
    var inputName: String { source == "system" ? "System audio" : source == "both" ? "Microphone + system audio" : AVCaptureDevice.default(for: .audio)?.localizedName ?? "System microphone" }

    func start(id: String, locale: String, source: String = "mic", completion: @escaping (String?) -> Void) {
        stop(id: session, cancel: true)
        guard !id.isEmpty, id.count <= 80, ["mic", "system", "both"].contains(source) else { completion("Invalid voice source."); return }
        session = id; text = ""; self.source = source
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            DispatchQueue.main.async {
                guard let self, self.session == id else { completion("Voice input cancelled."); return }
                guard status == .authorized else { self.session = ""; completion("Allow Speech Recognition in macOS Privacy settings to transcribe audio."); return }
                if source != "mic" { self.begin(id: id, locale: locale, completion: completion); return }
                AVCaptureDevice.requestAccess(for: .audio) { [weak self] allowed in
                    DispatchQueue.main.async {
                        guard let self, self.session == id else { completion("Voice input cancelled."); return }
                        guard allowed else { self.session = ""; completion("Allow Microphone access in macOS Privacy settings to include your microphone."); return }
                        self.begin(id: id, locale: locale, completion: completion)
                    }
                }
            }
        }
    }
    private func begin(id: String, locale: String, completion: @escaping (String?) -> Void) {
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: String(locale.prefix(40)))), recognizer.isAvailable else { session = ""; completion("Speech recognition is unavailable for this language."); return }
        self.recognizer = recognizer
        let request = SFSpeechAudioBufferRecognitionRequest(); request.shouldReportPartialResults = true; request.taskHint = .dictation
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        self.request = request
        let ready: (String?) -> Void = { [weak self] error in
            guard let self, self.session == id, self.request === request else { completion("Voice input cancelled."); return }
            if let error { self.stop(id: id, cancel: true); completion(error); return }
            self.task = recognizer.recognitionTask(with: request) { [weak self] result, error in
                DispatchQueue.main.async {
                    guard let self, self.session == id, self.request === request else { return }
                    if let result {
                        self.text = String(result.bestTranscription.formattedString.prefix(12000))
                        self.emit(["event": "voice.result", "id": id, "text": self.text, "final": false])
                        if result.isFinal { self.finish(id: id); return }
                    }
                    if error != nil {
                        if self.finishing != nil && !self.text.isEmpty { self.finish(id: id) }
                        else { self.emit(["event": "voice.error", "id": id, "message": "Speech recognition stopped. Check your audio source, language and connection."]); self.stop(id: id, cancel: true) }
                    }
                }
            }
            let timer = Timer(timeInterval: id.hasPrefix("live-") ? 45 : 30, repeats: false) { [weak self] _ in self?.stop(id: id, cancel: false) }
            self.limit = timer; RunLoop.main.add(timer, forMode: .common); completion(nil)
        }
        if source != "mic" {
            let capture = OpenSesameSystemAudio(output: { buffer in request.append(buffer) }, level: { [weak self] value in
                DispatchQueue.main.async { guard self?.session == id else { return }; self?.emit(["event": "voice.level", "id": id, "level": value]) }
            }, failed: { [weak self] message in
                guard self?.session == id else { return }; self?.emit(["event": "voice.error", "id": id, "message": message]); self?.stop(id: id, cancel: true)
            })
            systemAudio = capture; capture.start(source: source, completion: ready); return
        }
        let input = engine.inputNode, format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { stop(id: id, cancel: true); completion("No available microphone was found."); return }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in request.append(buffer) }; tapped = true
        do { engine.prepare(); try engine.start(); ready(nil) }
        catch { stop(id: id, cancel: true); completion("Could not start the microphone.") }
    }
    private func stopAudio() {
        engine.stop(); if tapped { engine.inputNode.removeTap(onBus: 0); tapped = false }
        systemAudio?.stop(); systemAudio = nil
        request?.endAudio(); limit?.invalidate(); limit = nil
    }
    func stop(id: String, cancel: Bool) {
        guard !session.isEmpty, id == session else { return }
        stopAudio()
        if cancel {
            session = ""; finishing?.invalidate(); finishing = nil; task?.cancel(); task = nil; request = nil; recognizer = nil
        } else if finishing == nil {
            let timer = Timer(timeInterval: 1.2, repeats: false) { [weak self] _ in self?.finish(id: id) }
            finishing = timer; RunLoop.main.add(timer, forMode: .common)
        }
    }
    private func finish(id: String) {
        guard session == id else { return }
        let value = text; stop(id: id, cancel: true); emit(["event": "voice.result", "id": id, "text": value, "final": true])
    }
    func cancel() { stop(id: session, cancel: true) }
}
