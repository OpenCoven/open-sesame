import AppKit
import AVFoundation
import Speech

final class OpenSesameVoiceInput {
    private let emit: ([String: Any]) -> Void
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var recognizer: SFSpeechRecognizer?
    private var session = ""
    private var text = ""
    private var tapped = false
    private var limit: Timer?
    private var finishing: Timer?

    init(emit: @escaping ([String: Any]) -> Void) { self.emit = emit }

    func start(id: String, locale: String, completion: @escaping (String?) -> Void) {
        stop(id: session, cancel: true)
        guard !id.isEmpty, id.count <= 80 else { completion("Invalid voice request."); return }
        session = id; text = ""
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            DispatchQueue.main.async {
                guard let self = self, self.session == id else { completion("Voice input cancelled."); return }
                guard status == .authorized else { self.session = ""; completion("Allow Speech Recognition in macOS Privacy settings to use voice input."); return }
                AVCaptureDevice.requestAccess(for: .audio) { [weak self] allowed in
                    DispatchQueue.main.async {
                        guard let self = self, self.session == id else { completion("Voice input cancelled."); return }
                        guard allowed else { self.session = ""; completion("Allow Microphone access in macOS Privacy settings to use voice input."); return }
                        self.begin(id: id, locale: locale, completion: completion)
                    }
                }
            }
        }
    }

    private func begin(id: String, locale: String, completion: @escaping (String?) -> Void) {
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: String(locale.prefix(40)))), recognizer.isAvailable else { session = ""; completion("Speech recognition is unavailable for this language."); return }
        self.recognizer = recognizer
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.taskHint = .dictation
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        self.request = request
        let input = engine.inputNode, format = engine.inputNode.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { stop(id: id, cancel: true); completion("No available microphone was found."); return }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in request.append(buffer) }
        tapped = true
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self = self, self.session == id else { return }
                if let result = result {
                    self.text = String(result.bestTranscription.formattedString.prefix(2000))
                    self.emit(["event": "voice.result", "id": id, "text": self.text, "final": false])
                    if result.isFinal { self.finish(id: id); return }
                }
                if error != nil {
                    if self.finishing != nil && !self.text.isEmpty { self.finish(id: id) }
                    else { self.emit(["event": "voice.error", "id": id, "message": "Speech recognition stopped. Check your microphone, language, and connection."]); self.stop(id: id, cancel: true) }
                }
            }
        }
        do { engine.prepare(); try engine.start() }
        catch { stop(id: id, cancel: true); completion("Could not start the microphone."); return }
        let timer = Timer(timeInterval: 30, repeats: false) { [weak self] _ in self?.stop(id: id, cancel: false) }
        limit = timer; RunLoop.main.add(timer, forMode: .common)
        completion(nil)
    }

    private func stopAudio() {
        engine.stop()
        if tapped { engine.inputNode.removeTap(onBus: 0); tapped = false }
        request?.endAudio(); limit?.invalidate(); limit = nil
    }

    func stop(id: String, cancel: Bool) {
        guard !session.isEmpty, id == session else { return }
        stopAudio()
        if cancel {
            session = ""; finishing?.invalidate(); finishing = nil
            task?.cancel(); task = nil; request = nil; recognizer = nil
        } else if finishing == nil {
            let timer = Timer(timeInterval: 1.2, repeats: false) { [weak self] _ in self?.finish(id: id) }
            finishing = timer; RunLoop.main.add(timer, forMode: .common)
        }
    }

    private func finish(id: String) {
        guard session == id else { return }
        let value = text; stop(id: id, cancel: true)
        emit(["event": "voice.result", "id": id, "text": value, "final": true])
    }

    func cancel() { stop(id: session, cancel: true) }
}
