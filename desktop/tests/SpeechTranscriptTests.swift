import Foundation

@main struct SpeechTranscriptTests {
    static func main() {
        var text = OpenSesameSpeechTranscript()
        precondition(text.update("First phrase", start: nil, end: nil, sealed: false) == "First phrase")
        precondition(text.update("First phrase.", start: 0.2, end: 2, sealed: true) == "First phrase.")
        precondition(text.update("Second", start: nil, end: nil, sealed: false) == "First phrase.\nSecond")
        precondition(text.update("Second phrase", start: nil, end: nil, sealed: false) == "First phrase.\nSecond phrase")
        precondition(text.update("Second phrase.", start: 4, end: 6, sealed: true) == "First phrase.\nSecond phrase.")
        precondition(text.update("", start: nil, end: nil, sealed: false) == "First phrase.\nSecond phrase.")
        precondition(text.update("Second phrase.", start: 4, end: 6, sealed: true) == "First phrase.\nSecond phrase.")
        precondition(text.update("Third phrase", start: 8, end: 9, sealed: false) == "First phrase.\nSecond phrase.\nThird phrase")
        precondition(text.update("Third phrase corrected.", start: 8, end: 10, sealed: true) == "First phrase.\nSecond phrase.\nThird phrase corrected.")
        // A final cumulative result replaces the matching span instead of duplicating it.
        precondition(text.update("First phrase. Second phrase. Third phrase corrected.", start: 0.2, end: 10, sealed: true) == "First phrase. Second phrase. Third phrase corrected.")
        // Repeated words at different audio times are distinct speech.
        var repeated = OpenSesameSpeechTranscript()
        _ = repeated.update("Yes", start: 0, end: 1, sealed: true)
        precondition(repeated.update("Yes", start: 3, end: 4, sealed: true) == "Yes\nYes")
        // Timed utterance resets are retained even without a metadata boundary.
        var noBoundary = OpenSesameSpeechTranscript()
        _ = noBoundary.update("Before the pause", start: 0, end: 2, sealed: false)
        precondition(noBoundary.update("After the pause", start: 5, end: 7, sealed: false) == "Before the pause\nAfter the pause")
        // Untimed partial revisions stay in the active tail and do not accumulate duplicates.
        var partial = OpenSesameSpeechTranscript()
        _ = partial.update("I want two", start: nil, end: nil, sealed: false)
        precondition(partial.update("I want to keep everything", start: nil, end: nil, sealed: false) == "I want to keep everything")
        // A provider can restart both its text and timestamps after silence.
        var resetClock = OpenSesameSpeechTranscript()
        _ = resetClock.update("Before the pause.", start: 0, end: 2, sealed: true)
        _ = resetClock.update("After", start: nil, end: nil, sealed: false)
        precondition(resetClock.update("After the pause.", start: 0, end: 2, sealed: true) == "Before the pause.\nAfter the pause.")
        precondition(resetClock.update("After the pause corrected.", start: 0, end: 2, sealed: true) == "Before the pause.\nAfter the pause corrected.")
        precondition(resetClock.update("Before the pause. After the pause corrected.", start: 0, end: 5, sealed: true) == "Before the pause. After the pause corrected.")
        // Untimed cumulative callbacks use spaces even though displayed chunks use newlines.
        var untimedCumulative = OpenSesameSpeechTranscript()
        _ = untimedCumulative.update("First phrase.", start: 0, end: 2, sealed: true)
        _ = untimedCumulative.update("Second phrase.", start: 4, end: 6, sealed: true)
        precondition(untimedCumulative.update("First phrase.  Second phrase. Third", start: nil, end: nil, sealed: false) == "First phrase.\nSecond phrase.\nThird")
        precondition(untimedCumulative.update("First phrase. Second phrase. Third corrected.", start: nil, end: nil, sealed: false) == "First phrase.\nSecond phrase.\nThird corrected.")
        precondition(untimedCumulative.update("Third corrected again.", start: nil, end: nil, sealed: true) == "First phrase.\nSecond phrase.\nThird corrected again.")
        precondition(untimedCumulative.update("First phrase. Second phrase. Third corrected again.", start: nil, end: nil, sealed: true) == "First phrase.\nSecond phrase.\nThird corrected again.")
        // A new capture has no transcript from a prior capture.
        precondition(OpenSesameSpeechTranscript().text.isEmpty)
        let long = String(repeating: "Full transcript. ", count: 1000)
        var full = OpenSesameSpeechTranscript()
        precondition(full.update(long, start: 0, end: 45, sealed: true).count > 12000)
        print("Speech transcript retention: pauses, untimed partials, timestamped replacement/correction, duplicate boundaries, cumulative finals, repeated words and complete text pass without capturing audio.")
    }
}
