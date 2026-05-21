import AppKit
import Foundation

@MainActor
final class FaviconService: ObservableObject {
    static let shared = FaviconService()

    private let session: URLSession
    private let cacheDirectory: URL?
    private var memoryCache: [String: Data] = [:]
    private var inFlight: [String: Task<Data?, Never>] = [:]

    init(session: URLSession = .shared) {
        self.session = session

        let fm = FileManager.default
        let dir = try? fm.url(
            for: .cachesDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        .appending(path: "OpenSesame/Favicons", directoryHint: .isDirectory)

        if let dir {
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        self.cacheDirectory = dir
    }

    /// Returns icon bytes for the host. Uses memory cache, then disk cache,
    /// then a network fetch (direct → Google s2 fallback). Fetched bytes are
    /// written back to disk for next launch.
    func icon(for url: URL) async -> Data? {
        guard let host = url.host else { return nil }

        if let cached = memoryCache[host] { return cached }
        if let disk = readDiskCache(host: host) {
            memoryCache[host] = disk
            return disk
        }

        if let existing = inFlight[host] {
            return await existing.value
        }

        let task = Task<Data?, Never> { [weak self] in
            guard let self else { return nil }
            let bytes = await self.fetchIconBytes(for: url, host: host)
            if let bytes {
                self.memoryCache[host] = bytes
                self.writeDiskCache(host: host, data: bytes)
            }
            return bytes
        }
        inFlight[host] = task
        let result = await task.value
        inFlight.removeValue(forKey: host)
        return result
    }

    // MARK: - Network

    private func fetchIconBytes(for url: URL, host: String) async -> Data? {
        if let scraped = await scrapeIcon(from: url) {
            return scraped
        }
        if let direct = await fetchURL(URL(string: "https://\(host)/favicon.ico")) {
            return direct
        }
        if let google = await fetchURL(URL(string: "https://www.google.com/s2/favicons?domain=\(host)&sz=128")) {
            return google
        }
        return nil
    }

    private func scrapeIcon(from siteURL: URL) async -> Data? {
        guard let html = await fetchHTML(from: siteURL) else { return nil }
        guard let iconHref = extractIconHref(from: html) else { return nil }

        let resolved: URL?
        if iconHref.hasPrefix("http://") || iconHref.hasPrefix("https://") {
            resolved = URL(string: iconHref)
        } else if iconHref.hasPrefix("//") {
            resolved = URL(string: "https:\(iconHref)")
        } else if iconHref.hasPrefix("/") {
            resolved = siteURL.absoluteString.range(of: "://").flatMap { _ in
                URL(string: "\(siteURL.scheme ?? "https")://\(siteURL.host ?? "")\(iconHref)")
            }
        } else {
            resolved = URL(string: iconHref, relativeTo: siteURL)?.absoluteURL
        }

        guard let resolved else { return nil }
        return await fetchURL(resolved)
    }

    private func fetchHTML(from url: URL) async -> String? {
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
            return String(data: data, encoding: .utf8)
                ?? String(data: data, encoding: .isoLatin1)
        } catch {
            return nil
        }
    }

    private func fetchURL(_ url: URL?) async -> Data? {
        guard let url else { return nil }
        var request = URLRequest(url: url, timeoutInterval: 8)
        request.setValue("image/*", forHTTPHeaderField: "Accept")
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                return nil
            }
            // Sanity check: actual image bytes parse.
            guard NSImage(data: data) != nil else { return nil }
            return data
        } catch {
            return nil
        }
    }

    private func extractIconHref(from html: String) -> String? {
        // Match <link ... rel="icon" ... href="...">, also rel="shortcut icon",
        // "apple-touch-icon". Prefer earlier matches but apple-touch-icon last.
        let patterns = [
            #"<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["'][^>]*>"#,
            #"<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:shortcut )?icon["'][^>]*>"#,
            #"<link[^>]+rel=["']apple-touch-icon(?:-precomposed)?["'][^>]+href=["']([^"']+)["'][^>]*>"#,
            #"<link[^>]+href=["']([^"']+)["'][^>]+rel=["']apple-touch-icon(?:-precomposed)?["'][^>]*>"#
        ]

        for pattern in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { continue }
            let range = NSRange(html.startIndex..., in: html)
            if let match = regex.firstMatch(in: html, options: [], range: range),
               match.numberOfRanges > 1,
               let hrefRange = Range(match.range(at: 1), in: html) {
                return String(html[hrefRange])
            }
        }
        return nil
    }

    // MARK: - Disk cache

    private func filename(forHost host: String) -> String {
        let safe = host.replacingOccurrences(of: ":", with: "_")
        return "\(safe).bin"
    }

    private func readDiskCache(host: String) -> Data? {
        guard let cacheDirectory else { return nil }
        let url = cacheDirectory.appending(path: filename(forHost: host))
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try? Data(contentsOf: url)
    }

    private func writeDiskCache(host: String, data: Data) {
        guard let cacheDirectory else { return }
        let url = cacheDirectory.appending(path: filename(forHost: host))
        try? data.write(to: url, options: .atomic)
    }

    /// Drops the cached icon for the given host from memory and disk so the
    /// next `icon(for:)` call refetches. Used by "Use Auto Favicon" so users
    /// can force a fresh download after picking a custom icon.
    func invalidate(host: String) {
        memoryCache.removeValue(forKey: host)
        inFlight.removeValue(forKey: host)
        guard let cacheDirectory else { return }
        let url = cacheDirectory.appending(path: filename(forHost: host))
        try? FileManager.default.removeItem(at: url)
    }
}
