import Foundation

/// Reads and writes the catalog JSON to disk. Writes are best-effort and
/// log via `print` rather than throwing — UI flows should not be interrupted
/// by save failures.
public struct CatalogPersistence: Sendable {
    public let fileURL: URL

    public init(fileURL: URL) {
        self.fileURL = fileURL
    }

    public static func defaultURL() -> URL? {
        let fm = FileManager.default
        guard let supportDir = try? fm.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        ) else {
            return nil
        }

        let appDir = supportDir.appending(path: "OpenSesame", directoryHint: .isDirectory)
        do {
            try fm.createDirectory(at: appDir, withIntermediateDirectories: true)
        } catch {
            return nil
        }
        return appDir.appending(path: "catalog.json")
    }

    public func load() throws -> SiteCatalog {
        let data = try Data(contentsOf: fileURL)
        return try SiteCatalog.decodeConfiguration(from: data)
    }

    public func save(_ catalog: SiteCatalog) {
        let configuration = SiteCatalogConfiguration(
            entries: catalog.entries.map { entry in
                switch entry {
                case .site(let site):
                    return .site(
                        PortalSiteDefinition(
                            name: site.name,
                            url: site.url.absoluteString,
                            isPinned: site.isPinned
                        )
                    )
                case .group(let group):
                    return .group(
                        SiteGroupDefinition(
                            id: group.id,
                            name: group.name,
                            isCollapsed: group.isCollapsed,
                            sites: group.sites.map { site in
                                PortalSiteDefinition(
                                    name: site.name,
                                    url: site.url.absoluteString,
                                    isPinned: site.isPinned
                                )
                            }
                        )
                    )
                }
            }
        )

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

        do {
            let data = try encoder.encode(configuration)
            try data.write(to: fileURL, options: .atomic)
        } catch {
            print("[OpenSesame] Failed to persist catalog: \(error)")
        }
    }
}
