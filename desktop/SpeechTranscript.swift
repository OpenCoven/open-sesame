import Foundation

// Recognition may return only the newest utterance after a pause. Timed results
// replace their matching audio span; untimed partials replace only the open tail.
struct OpenSesameSpeechTranscript {
    struct Word { var text: String; var start: Double; var end: Double }
    var words: [Word] { chunks.flatMap(\.words) }
    private struct Chunk {
        var text: String
        var start: Double?
        var end: Double?
        var sealed: Bool
        var words: [Word]
    }
    private var chunks: [Chunk] = []
    var text: String { chunks.map(\.text).joined(separator: "\n") }

    mutating func update(_ value: String, start: Double?, end: Double?, sealed: Bool, words: [Word] = []) -> String {
        let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return text }
        let start = start.flatMap { $0.isFinite && $0 >= 0 ? $0 : nil }
        let end = end.flatMap { $0.isFinite && $0 >= (start ?? 0) ? $0 : nil }
        let next = Chunk(text: value, start: start, end: end, sealed: sealed, words: words.filter { $0.start.isFinite && $0.end.isFinite && $0.start >= 0 && $0.end >= $0.start })
        guard let last = chunks.last else { chunks.append(next); return text }
        if let start {
            // A cumulative/corrected result can cover several earlier utterances.
            let completedPrefix = chunks.dropLast().map(\.text).joined(separator: " ").split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
            let normalized = value.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
            let cumulative = !completedPrefix.isEmpty && normalized.hasPrefix(completedPrefix)
            let matches = chunks.indices.filter { chunks[$0].start.map { abs($0 - start) < 0.08 } ?? false }
            if last.start == nil && chunks.count > 1 && !cumulative {
                // Some backends also restart timestamps for a new utterance. An
                // already-open partial tail belongs to that utterance, not the
                // earlier chunk which happens to have the same timestamp.
                chunks[chunks.count - 1] = next
            } else if let index = cumulative ? matches.first : matches.last {
                chunks.replaceSubrange(index..., with: [next])
            } else if last.start == nil {
                chunks[chunks.count - 1] = next
            } else if start > (last.end ?? start) + 0.05 {
                chunks.append(next)
            } else {
                chunks[chunks.count - 1] = next
            }
        } else {
            // A backend may send the whole transcript without timestamps. Preserve
            // completed chunks and apply only its new tail, normalizing separators.
            let completedCount = last.sealed ? chunks.count : chunks.count - 1
            let prefix = chunks.prefix(completedCount).map(\.text).joined(separator: " ").split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
            let normalized = value.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
            var tail = next
            if !prefix.isEmpty && (normalized == prefix || normalized.hasPrefix(prefix + " ")) {
                let remainder = normalized.dropFirst(prefix.count).trimmingCharacters(in: .whitespacesAndNewlines)
                guard !remainder.isEmpty else { return text }
                tail.text = remainder
            } else if last.sealed && value == last.text {
                return text // Duplicate boundary callback.
            }
            if last.sealed { chunks.append(tail) }
            else { chunks[chunks.count - 1] = tail }
        }
        return text
    }
}
