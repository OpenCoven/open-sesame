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
        var refused = false
        let capture = OpenSesameSystemAudio(output: {_ in fatalError("No capture was requested")}, level: {_ in}, failed: {_ in})
        capture.start(source: "unsupported") { refused = $0 != nil }
        precondition(refused, "Invalid sources fail before permissions or hardware access")
        print("System audio: independent PCM copy, sample fidelity, finite/clipped levels, true source mixing, bounded timeline, stale input and invalid-source refusal passed with synthetic buffers. No audio was captured.")
    }
}
