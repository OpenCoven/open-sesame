import AVFoundation
import CoreMedia
import Foundation

@main struct SystemAudioTests {
    static func main() throws {
        var timeline = OpenSesameAudioTimeline()
        timeline.put([0.5, -0.5, .nan, 2], at: 0, mic: false)
        let pure = timeline.take(mixed: false)
        precondition(pure.count == 960 && pure[0] == 0.5 && pure[1] == -0.5 && pure[2] == 0 && pure[3] == 1)
        precondition(timeline.take(mixed: false).allSatisfy {$0 == 0})
        timeline.put([1], at: 0, mic: false)
        precondition(timeline.take(mixed: false).allSatisfy {$0 == 0}, "Late samples cannot corrupt a newer timeline slot")
        var mixed = OpenSesameAudioTimeline()
        mixed.put([0.8, -0.8], at: 0, mic: false); mixed.put([0.4, -0.4], at: 0, mic: true)
        let result = mixed.take(mixed: true)
        precondition(abs(result[0]-0.6) < 0.0001 && abs(result[1]+0.6) < 0.0001)
        mixed.put([1], at: 48000*4, mic: false)
        precondition(mixed.take(mixed: true).allSatisfy {$0 == 0}, "Oversized future input is bounded")
        let sound = [Float](repeating: 0.5, count: 960)
        for delay in [0.0, 4.0, 120.0] {
            var delayed = OpenSesameAudioTimeline()
            delayed.put(sound, received: delay, mic: false)
            precondition(delayed.take(mixed: false).allSatisfy { $0 == 0 }, "Input before successful capture start is ignored")
            delayed.start(at: delay)
            for index in 0..<200 {
                delayed.put(sound, received: delay + Double(index + 1) * 0.02, mic: false)
                precondition(delayed.take(mixed: false).allSatisfy { $0 == 0.5 }, "Slow capture startup must never leave input permanently ahead of the ring")
            }
        }
        var system = OpenSesameAudioSignal(), mic = OpenSesameAudioSignal()
        precondition(system.state(at: 10) == "waiting")
        system.receive(level: 0, at: 10); precondition(system.state(at: 10) == "silent")
        mic.receive(level: 0.2, at: 10); precondition(mic.state(at: 10) == "detected" && system.state(at: 10) == "silent", "Mic activity cannot imply system audio")
        system.receive(level: 0.1, at: 10.1); precondition(system.state(at: 10.5) == "detected")
        system.receive(level: 0, at: 11.5); precondition(system.state(at: 11.5) == "silent")
        precondition(system.state(at: 14) == "waiting")
        var invalid = OpenSesameAudioSignal(); invalid.receive(level: .nan, at: 1); precondition(invalid.state(at: 1) == "waiting")
        let format = OpenSesameSystemAudio.format
        let original = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4)!
        original.frameLength = 4
        for index in 0..<4 { original.floatChannelData![0][index] = Float(index)/4 }
        var description: CMAudioFormatDescription?
        var asbd = format.streamDescription.pointee
        precondition(CMAudioFormatDescriptionCreate(allocator: kCFAllocatorDefault, asbd: &asbd, layoutSize: 0, layout: nil, magicCookieSize: 0, magicCookie: nil, extensions: nil, formatDescriptionOut: &description) == noErr)
        var sample: CMSampleBuffer?
        var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: 48000), presentationTimeStamp: .zero, decodeTimeStamp: .invalid)
        precondition(CMSampleBufferCreate(allocator: kCFAllocatorDefault, dataBuffer: nil, dataReady: false, makeDataReadyCallback: nil, refcon: nil, formatDescription: description, sampleCount: 4, sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleSizeEntryCount: 0, sampleSizeArray: nil, sampleBufferOut: &sample) == noErr)
        precondition(CMSampleBufferSetDataBufferFromAudioBufferList(sample!, blockBufferAllocator: kCFAllocatorDefault, blockBufferMemoryAllocator: kCFAllocatorDefault, flags: 0, bufferList: original.audioBufferList) == noErr)
        precondition(CMSampleBufferSetDataReady(sample!) == noErr)
        let copied = OpenSesameSystemAudio.pcm(sample!)!
        precondition(copied.frameLength == 4)
        for index in 0..<4 { precondition(copied.floatChannelData![0][index] == Float(index)/4) }
        for interleaved in [false, true] {
            let stereo = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 44100, channels: 2, interleaved: interleaved)!
            let input = AVAudioPCMBuffer(pcmFormat: stereo, frameCapacity: 4410)!
            input.frameLength = 4410
            if interleaved { for index in 0..<8820 { input.floatChannelData![0][index] = 0.25 } }
            else { for channel in 0..<2 { for index in 0..<4410 { input.floatChannelData![channel][index] = 0.25 } } }
            let converter = AVAudioConverter(from: stereo, to: format)!
            let normalized = OpenSesameSystemAudio.convert(input, using: converter)!
            precondition(normalized.format == format && normalized.frameLength > 4000)
            let samples = Array(UnsafeBufferPointer(start: normalized.floatChannelData![0], count: Int(normalized.frameLength)))
            precondition(samples.allSatisfy { $0.isFinite } && samples.dropFirst(100).contains { abs($0) > 0.1 }, "Stereo input reaches the mono speech format with real resampling")
            precondition(input.floatChannelData![0][200] == 0.25, "Normalization preserves the input buffer")
        }
        let empty = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1)!
        precondition(OpenSesameSystemAudio.convert(empty, using: AVAudioConverter(from: format, to: format)!) == nil)
        var refused = false
        let capture = OpenSesameSystemAudio(output: {_ in fatalError("No capture was requested")}, level: {_ in}, failed: {_ in})
        capture.start(source: "unsupported") { refused = $0 != nil }
        precondition(refused, "Invalid sources fail before permissions or hardware access")
        print("System audio: delayed-start recovery, pre-start refusal, independent source detection, stale/silent input, real stereo/interleaved resampling, independent PCM copy, finite/clipped levels, true source mixing, bounded timeline and invalid-source refusal passed with synthetic buffers. No audio was captured.")
    }
}
