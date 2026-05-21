import Foundation

struct SiteMetadata: Equatable {
    var title: String?
    var description: String?
    var siteName: String?
}

@MainActor
final class SiteMetadataService {
    static let shared = SiteMetadataService()

    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    func fetch(_ url: URL) async -> SiteMetadata? {
        var request = URLRequest(url: url, timeoutInterval: 8)
        request.setValue(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko)",
            forHTTPHeaderField: "User-Agent"
        )

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                return nil
            }

            guard let html = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) else {
                return nil
            }

            return SiteMetadata(
                title: extractTitle(from: html),
                description: extractMetaContent(from: html, name: "description"),
                siteName: extractMetaProperty(from: html, property: "og:site_name")
            )
        } catch {
            return nil
        }
    }

    private func extractTitle(from html: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: #"<title[^>]*>([\s\S]*?)</title>"#, options: [.caseInsensitive]) else {
            return nil
        }
        let range = NSRange(html.startIndex..., in: html)
        guard let match = regex.firstMatch(in: html, options: [], range: range),
              match.numberOfRanges > 1,
              let titleRange = Range(match.range(at: 1), in: html) else {
            return nil
        }
        let raw = String(html[titleRange])
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return decodingHTMLEntities(raw).nilIfEmpty
    }

    private func extractMetaContent(from html: String, name: String) -> String? {
        let escaped = NSRegularExpression.escapedPattern(for: name)
        let patterns = [
            #"<meta[^>]+name=["']\#(escaped)["'][^>]+content=["']([^"']*)["'][^>]*/?>"#,
            #"<meta[^>]+content=["']([^"']*)["'][^>]+name=["']\#(escaped)["'][^>]*/?>"#
        ]
        return firstMatch(in: html, patterns: patterns).map { decodingHTMLEntities($0) }?.nilIfEmpty
    }

    private func extractMetaProperty(from html: String, property: String) -> String? {
        let escaped = NSRegularExpression.escapedPattern(for: property)
        let patterns = [
            #"<meta[^>]+property=["']\#(escaped)["'][^>]+content=["']([^"']*)["'][^>]*/?>"#,
            #"<meta[^>]+content=["']([^"']*)["'][^>]+property=["']\#(escaped)["'][^>]*/?>"#
        ]
        return firstMatch(in: html, patterns: patterns).map { decodingHTMLEntities($0) }?.nilIfEmpty
    }

    private func firstMatch(in html: String, patterns: [String]) -> String? {
        for pattern in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { continue }
            let range = NSRange(html.startIndex..., in: html)
            if let match = regex.firstMatch(in: html, options: [], range: range),
               match.numberOfRanges > 1,
               let captureRange = Range(match.range(at: 1), in: html) {
                return String(html[captureRange]).trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }
        return nil
    }

    private func decodingHTMLEntities(_ text: String) -> String {
        guard let data = text.data(using: .utf8) else { return text }
        let options: [NSAttributedString.DocumentReadingOptionKey: Any] = [
            .documentType: NSAttributedString.DocumentType.html,
            .characterEncoding: String.Encoding.utf8.rawValue
        ]
        if let attributed = try? NSAttributedString(data: data, options: options, documentAttributes: nil) {
            return attributed.string
        }
        return text
    }
}

private extension String {
    var nilIfEmpty: String? {
        let trimmed = self.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
