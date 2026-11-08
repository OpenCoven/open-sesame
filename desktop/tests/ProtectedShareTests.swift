import AppKit
import Foundation
import CoreMedia
import ScreenCaptureKit

@main struct ProtectedShareTests {
    static func main() {
        var state = OpenSesameShareState()
        precondition(state.phase == .idle)
        precondition(!state.receive(0, complete: true), "Opening the app never starts capture or signals protection")
        let first = state.begin()!
        precondition(state.phase == .starting && state.begin() == nil)
        precondition(!state.receive(first, complete: false) && state.phase == .starting, "Incomplete video never signals a ready output")
        state.stop()
        precondition(!state.accepts(first) && !state.receive(first, complete: true), "Cancellation rejects frames already queued")
        let second = state.begin()!
        precondition(!state.receive(first, complete: true) && state.phase == .starting, "An old stream cannot activate a new share window")
        precondition(state.receive(second, complete: true) && state.phase == .ready)
        state.stop()
        precondition(state.phase == .idle && !state.receive(second, complete: true))
        precondition(!OpenSesameShareState.hasExclusion(owner: 123, excluded: []))
        precondition(!OpenSesameShareState.hasExclusion(owner: 123, excluded: [456]))
        precondition(!OpenSesameShareState.hasExclusion(owner: 0, excluded: [0]))
        precondition(OpenSesameShareState.hasExclusion(owner: 123, excluded: [456, 123]), "The current process must be explicitly excluded before starting")

        final class Frame {}
        let frames = OpenSesameLatestFrame<Frame>()
        var old: Frame? = Frame(); weak var released = old
        precondition(frames.put(old!))
        old = nil
        precondition(!frames.put(Frame()) && released == nil, "Backpressure replaces and releases the previous pending frame")
        for _ in 0..<5000 { precondition(!frames.put(Frame()), "Only one main delivery can be outstanding") }
        precondition(frames.take() != nil && frames.take() == nil)
        precondition(frames.put(Frame()))
        frames.invalidate()
        precondition(frames.take() == nil && !frames.put(Frame()), "Stop discards pending video and rejects subsequent callbacks")
        let concurrent = OpenSesameLatestFrame<Int>()
        DispatchQueue.concurrentPerform(iterations: 1000) { index in _ = concurrent.put(index) }
        precondition(concurrent.take() != nil)
        concurrent.invalidate(); precondition(concurrent.take() == nil)

        var pixels: CVPixelBuffer?
        precondition(CVPixelBufferCreate(kCFAllocatorDefault, 8, 8, kCVPixelFormatType_32BGRA, nil, &pixels) == kCVReturnSuccess)
        var format: CMVideoFormatDescription?
        precondition(CMVideoFormatDescriptionCreateForImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: pixels!, formatDescriptionOut: &format) == noErr)
        var sample: CMSampleBuffer?
        var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: 15), presentationTimeStamp: .zero, decodeTimeStamp: .invalid)
        precondition(CMSampleBufferCreateReadyWithImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: pixels!, formatDescription: format!, sampleTiming: &timing, sampleBufferOut: &sample) == noErr)
        precondition(!ProtectedShareOutput.complete(sample!), "A video without ScreenCaptureKit completeness metadata is refused")
        let attachments = CMSampleBufferGetSampleAttachmentsArray(sample!, createIfNecessary: true)! as NSArray
        let info = attachments[0] as! NSMutableDictionary
        info[SCStreamFrameInfo.status] = SCFrameStatus.complete.rawValue
        precondition(ProtectedShareOutput.complete(sample!))
        info[SCStreamFrameInfo.status] = SCFrameStatus.idle.rawValue
        precondition(!ProtectedShareOutput.complete(sample!), "Idle or partial frames never activate protected output")

        let share = OpenSesameProtectedShare()
        var refused = false
        precondition(!NSScreen.screens.contains { ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == UInt32.max })
        share.start(displayID: UInt32.max) { refused = $0 != nil }
        precondition(refused && share.status["active"] as? Bool == false && share.status["windowOpen"] as? Bool == false)
        share.displayConfigurationChanged(); share.stop()
        print("Protected share: explicit self-exclusion, inactive-by-default state, first-complete-frame readiness, cancel/stale-stream refusal, single-frame backpressure, concurrent producers and invalid-display refusal passed. No screen capture or permission prompt was started.")
    }
}
