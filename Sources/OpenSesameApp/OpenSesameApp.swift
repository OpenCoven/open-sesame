import OpenSesameCore
import SwiftUI

@main
struct OpenSesameApp: App {
    @State private var catalog = CatalogBootstrap.loadInitialCatalog()
    private let persistence: CatalogPersistence? = CatalogPersistence.defaultURL().map(CatalogPersistence.init(fileURL:))

    var body: some Scene {
        WindowGroup {
            ShellView(catalog: $catalog)
                .frame(minWidth: 900, minHeight: 620)
                .onChange(of: catalog) { _, newValue in
                    persistence?.save(newValue)
                }
        }
        .windowStyle(.titleBar)
        .defaultSize(width: 1180, height: 760)
    }
}

private enum CatalogBootstrap {
    private static let socialsMigrationKey = "didMigrateSocialsV2"

    static func loadInitialCatalog() -> SiteCatalog {
        var catalog = loadCatalog()
        migrateSocialsIfNeeded(&catalog)
        return catalog
    }

    private static func loadCatalog() -> SiteCatalog {
        // 1. Application Support (user's persisted state)
        if let persistence = CatalogPersistence.defaultURL().map(CatalogPersistence.init(fileURL:)),
           FileManager.default.fileExists(atPath: persistence.fileURL.path),
           let loaded = try? persistence.load() {
            return loaded
        }

        // 2. Legacy: open-sesame-sites.json in cwd
        let configurationURL = URL(filePath: FileManager.default.currentDirectoryPath)
            .appending(path: "open-sesame-sites.json")
        if FileManager.default.fileExists(atPath: configurationURL.path),
           let loaded = try? SiteCatalog.loadConfiguration(at: configurationURL) {
            return loaded
        }

        // 3. Default bundled catalog
        return .defaultCatalog
    }

    /// One-time migration: socials are opt-out by default, so any curated
    /// social URL already in the catalog gets removed. Users can toggle each
    /// one back in via Settings → Suggested. If the auto-created "Socials"
    /// folder is left empty by the removal, drop it too.
    private static func migrateSocialsIfNeeded(_ catalog: inout SiteCatalog) {
        guard !UserDefaults.standard.bool(forKey: socialsMigrationKey) else { return }
        defer { UserDefaults.standard.set(true, forKey: socialsMigrationKey) }

        let socialURLs = Set(CuratedCatalog.socialApps.map { $0.urlString })
        let toRemove = catalog.sites.filter { socialURLs.contains($0.url.absoluteString) }

        for site in toRemove {
            catalog.removeSite(withID: site.id)
        }

        if let socialsFolder = catalog.groups.first(where: { $0.name == CuratedCatalog.socialsFolderName }),
           socialsFolder.sites.isEmpty {
            catalog.removeGroup(withID: socialsFolder.id)
        }
    }
}
