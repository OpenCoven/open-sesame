import AppKit
import AVFoundation
import CoreMedia
import ScreenCaptureKit

// A fixed-size timeline keeps the two sources synchronized without playing them back.
struct OpenSesameAudioTimeline {
    static let rate = 48000
    static let block = 960
    private let capacity = rate * 3
    private var system = [Float](repeating: 0, count: rate * 3)
    private var microphone = [Float](repeating: 0, count: rate * 3)
    private var cursor = 0
    mutating func put(_ samples: [Float], at frame: Int, mic: Bool) {
        for (offset, value) in samples.enumerated() {
            let position = frame + offset
            guard position >= cursor, position < cursor + capacity else { continue }
            if mic { microphone[position % capacity] = value.isFinite ? value : 0 }
            else { system[position % capacity] = value.isFinite ? value : 0 }
        }
    }
    mutating func take(mixed: Bool) -> [Float] {
        var result = [Float](repeating: 0, count: Self.block)
        for index in result.indices {
            let slot = (cursor + index) % capacity
            let value = mixed ? (system[slot] + microphone[slot]) * 0.5 : system[slot]
            result[index] = min(1, max(-1, value)); system[slot] = 0; microphone[slot] = 0
        }
        cursor += Self.block
        return result
    }
}

final class OpenSesameSystemAudio: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    static let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48000, channels: 1, interleaved: false)!
    private let queue = DispatchQueue(label: "computer.opensesame.system-audio")
    private var stream: SCStream?
    private var microphone: AVAudioEngine?
    private var ticker: DispatchSourceTimer?
    private var active = false
    private var epoch = 0
    private var mixed = false
    private var timeline = OpenSesameAudioTimeline()
    private var startTime = 0.0
    private var lastLevel = 0.0
    private var converters: [String: AVAudioConverter] = [:]
    private var output: ((AVAudioPCMBuffer) -> Void)?
    private let failed: (String) -> Void
    private let level: (Double) -> Void

    init(output: @escaping (AVAudioPCMBuffer) -> Void, level: @escaping (Double) -> Void, failed: @escaping (String) -> Void) {
        self.output = output; self.failed = failed; self.level = level
    }
    static func pcm(_ sample: CMSampleBuffer) -> AVAudioPCMBuffer? {
        guard CMSampleBufferDataIsReady(sample), let description = CMSampleBufferGetFormatDescription(sample), CMFormatDescriptionGetMediaType(description) == kCMMediaType_Audio else { return nil }
        let format = AVAudioFormat(cmAudioFormatDescription: description), frames = CMSampleBufferGetNumSamples(sample)
        guard frames > 0, frames <= 48000, format.sampleRate > 0, format.channelCount > 0, format.channelCount <= 8,
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames)) else { return nil }
        buffer.frameLength = AVAudioFrameCount(frames)
        guard CMSampleBufferCopyPCMDataIntoAudioBufferList(sample, at: 0, frameCount: Int32(frames), into: buffer.mutableAudioBufferList) == noErr else { return nil }
        return buffer
    }
    private static func copy(_ input: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard let result = AVAudioPCMBuffer(pcmFormat: input.format, frameCapacity: input.frameLength) else { return nil }
        result.frameLength = input.frameLength
        let source = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input.audioBufferList)), target = UnsafeMutableAudioBufferListPointer(result.mutableAudioBufferList)
        guard source.count == target.count else { return nil }
        for index in source.indices {
            guard let from = source[index].mData, let to = target[index].mData, source[index].mDataByteSize <= target[index].mDataByteSize else { return nil }
            memcpy(to, from, Int(source[index].mDataByteSize))
        }
        return result
    }
    func start(source: String, completion: @escaping (String?) -> Void) {
        guard ["system", "both"].contains(source), stream == nil else { completion("Choose System audio or Microphone + system audio."); return }
        epoch += 1; let ticket = epoch; mixed = source == "both"
        let begin: () -> Void = { [weak self] in
            Task { @MainActor in
                guard let self, self.epoch == ticket else { completion("Audio capture cancelled."); return }
                do {
                    let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
                    guard self.epoch == ticket else { completion("Audio capture cancelled."); return }
                    guard let display = content.displays.first else { throw NSError(domain: "OpenSesame", code: 1) }
                    let configuration = SCStreamConfiguration()
                    configuration.capturesAudio = true; configuration.sampleRate = 48000; configuration.channelCount = 2
                    configuration.excludesCurrentProcessAudio = false
                    configuration.width = 2; configuration.height = 2; configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1); configuration.queueDepth = 3; configuration.showsCursor = false
                    let stream = SCStream(filter: SCContentFilter(display: display, excludingWindows: []), configuration: configuration, delegate: self)
                    try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: self.queue)
                    self.stream = stream
                    if self.mixed {
                        let engine = AVAudioEngine(), input = engine.inputNode, format = engine.inputNode.outputFormat(forBus: 0)
                        guard format.sampleRate > 0, format.channelCount > 0 else { throw NSError(domain: "OpenSesame", code: 2) }
                        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
                            guard let copied = Self.copy(buffer) else { return }
                            let received = ProcessInfo.processInfo.systemUptime
                            self?.queue.async { [weak self] in self?.ingest(copied, mic: true, received: received) }
                        }
                        self.microphone = engine; engine.prepare(); try engine.start()
                    }
                    self.queue.sync { self.timeline = OpenSesameAudioTimeline(); self.converters.removeAll(); self.startTime = ProcessInfo.processInfo.systemUptime; self.active = true }
                    try await stream.startCapture()
                    guard self.epoch == ticket else { await self.stop(); completion("Audio capture cancelled."); return }
                    self.queue.async { [self] in
                        guard self.active else { return }
                        let timer = DispatchSource.makeTimerSource(queue: self.queue)
                        timer.schedule(deadline: .now() + .milliseconds(120), repeating: .milliseconds(20), leeway: .milliseconds(2))
                        timer.setEventHandler { [weak self] in self?.tick() }; self.ticker = timer; timer.resume()
                    }
                    completion(nil)
                } catch {
                    await self.stop()
                    completion("Allow Open Sesame in macOS Settings → Privacy & Security → Screen & System Audio Recording, then try again. Microphone access is also needed for the combined source.")
                }
            }
        }
        if mixed {
            AVCaptureDevice.requestAccess(for: .audio) { allowed in
                DispatchQueue.main.async { if allowed { begin() } else { completion("Allow Microphone access in macOS Privacy settings to include your microphone.") } }
            }
        } else { begin() }
    }
    private func ingest(_ buffer: AVAudioPCMBuffer, mic: Bool, received: Double) {
        guard active else { return }
        let key = mic ? "mic" : "system"
        let converter: AVAudioConverter
        if let saved = converters[key], saved.inputFormat == buffer.format { converter = saved }
        else { guard let value = AVAudioConverter(from: buffer.format, to: Self.format) else { return }; converters[key] = value; converter = value }
        let frames = AVAudioFrameCount(ceil(Double(buffer.frameLength) * 48000 / buffer.format.sampleRate) + 32)
        guard frames > 0, frames <= 96000, let converted = AVAudioPCMBuffer(pcmFormat: Self.format, frameCapacity: frames) else { return }
        var supplied = false, error: NSError?
        let result = converter.convert(to: converted, error: &error) { _, status in
            if supplied { status.pointee = .noDataNow; return nil }
            supplied = true; status.pointee = .haveData; return buffer
        }
        guard result != .error, error == nil, converted.frameLength > 0, let data = converted.floatChannelData?[0] else { return }
        let samples = Array(UnsafeBufferPointer(start: data, count: Int(converted.frameLength)))
        let end = max(0, Int((received - startTime) * 48000)), frame = max(0, end - samples.count)
        timeline.put(samples, at: frame, mic: mic)
    }
    private func tick() {
        guard active, let buffer = AVAudioPCMBuffer(pcmFormat: Self.format, frameCapacity: AVAudioFrameCount(OpenSesameAudioTimeline.block)), let data = buffer.floatChannelData?[0] else { return }
        let samples = timeline.take(mixed: mixed); buffer.frameLength = AVAudioFrameCount(samples.count)
        for index in samples.indices { data[index] = samples[index] }
        output?(buffer)
        let energy = samples.reduce(0.0) { $0 + Double($1 * $1) } / Double(samples.count)
        let now = ProcessInfo.processInfo.systemUptime
        if now - lastLevel >= 0.2 { lastLevel = now; level(min(100, sqrt(energy) * 300)) }
    }
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
        guard outputType == .audio, let buffer = Self.pcm(sampleBuffer) else { return }
        ingest(buffer, mic: false, received: ProcessInfo.processInfo.systemUptime)
    }
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        queue.async { self.active = false; self.ticker?.cancel(); self.ticker = nil }
        DispatchQueue.main.async { self.failed("System audio capture stopped. Check macOS recording permission and try again.") }
    }
    func stop(completion: (() -> Void)? = nil) {
        epoch += 1; microphone?.inputNode.removeTap(onBus: 0); microphone?.stop(); microphone = nil
        queue.sync { active = false; ticker?.cancel(); ticker = nil }
        let current = stream; stream = nil
        Task { @MainActor in
            try? await current?.stopCapture()
            self.queue.async { self.output = nil; self.converters.removeAll(); DispatchQueue.main.async { completion?() } }
        }
    }
    private func stop() async { await withCheckedContinuation { continuation in stop { continuation.resume() } } }
}
