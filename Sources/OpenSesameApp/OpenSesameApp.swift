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
                .ignoresSafeArea()
                .onChange(of: catalog) { _, newValue in
                    persistence?.save(newValue)
                }
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1180, height: 760)
    }
}

private enum CatalogBootstrap {
    private static let socialsMigrationKey = "didMigrateSocialsV2"
    private static let covenMigrationKey = "didMigrateCovenV2"
    private static let renameMigrationKey = "didMigrateRenamesV1"
    private static let discordRemovalKey = "didRemoveDiscordV1"

    private static let deprecatedSocialURLs: [String] = [
        "https://discord.com/app"
    ]

    static func loadInitialCatalog() -> SiteCatalog {
        var catalog = loadCatalog()
        migrateSocialsIfNeeded(&catalog)
        migrateCovenIfNeeded(&catalog)
        migrateRenamesIfNeeded(&catalog)
        migrateDeprecatedSocialsIfNeeded(&catalog)
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

    /// One-time migration: the first curated default (Documentation) becomes
    /// the home and lives at root, the remaining curated defaults nest inside
    /// the Coven folder. Documentation is pulled out of any folder it's in,
    /// then moved to root index 0. User-added sites are not touched.
    private static func migrateCovenIfNeeded(_ catalog: inout SiteCatalog) {
        guard !UserDefaults.standard.bool(forKey: covenMigrationKey) else { return }
        defer { UserDefaults.standard.set(true, forKey: covenMigrationKey) }

        let homeApp = CuratedCatalog.defaultApps.first
        let folderApps = Array(CuratedCatalog.defaultApps.dropFirst())
        let folderURLs = Set(folderApps.map { $0.urlString })

        // 1. Move the non-home defaults into the Coven folder.
        let toFolder = catalog.sites.filter { folderURLs.contains($0.url.absoluteString) }
        if !toFolder.isEmpty {
            let groupID: SiteGroup.ID
            if let existing = catalog.groups.first(where: { $0.name == CuratedCatalog.covenFolderName }) {
                groupID = existing.id
            } else {
                let group = SiteGroup(name: CuratedCatalog.covenFolderName)
                catalog.addGroup(group)
                groupID = group.id
            }

            for site in toFolder where catalog.groupID(containingSite: site.id) != groupID {
                catalog.moveSite(site.id, intoGroup: groupID)
            }
        }

        // 2. Pull the home site out of any folder and position it at root[0].
        if let homeApp,
           let home = catalog.sites.first(where: { $0.url.absoluteString == homeApp.urlString }) {
            if catalog.groupID(containingSite: home.id) != nil {
                catalog.moveSiteToRoot(home.id)
            }
            if let currentIndex = catalog.entries.firstIndex(where: { entry in
                if case .site(let s) = entry, s.id == home.id { return true }
                return false
            }), currentIndex != 0 {
                catalog.moveRootEntries(fromOffsets: IndexSet(integer: currentIndex), toOffset: 0)
            }
        }
    }

    /// One-time cleanup: when an app gets dropped from CuratedCatalog (e.g.
    /// Discord), it should also disappear from catalogs where the user had
    /// previously toggled it on, since the Suggested tab no longer exposes
    /// a way to remove it. Empties the Socials folder if it ends up bare.
    private static func migrateDeprecatedSocialsIfNeeded(_ catalog: inout SiteCatalog) {
        guard !UserDefaults.standard.bool(forKey: discordRemovalKey) else { return }
        defer { UserDefaults.standard.set(true, forKey: discordRemovalKey) }

        let dropURLs = Set(deprecatedSocialURLs)
        let toRemove = catalog.sites.filter { dropURLs.contains($0.url.absoluteString) }
        for site in toRemove {
            catalog.removeSite(withID: site.id)
        }

        if let socialsFolder = catalog.groups.first(where: { $0.name == CuratedCatalog.socialsFolderName }),
           socialsFolder.sites.isEmpty {
            catalog.removeGroup(withID: socialsFolder.id)
        }
    }

    /// One-time rename pass: brings the user's existing catalog entries in
    /// line with current CuratedCatalog display names. Matches by URL and
    /// the previous display name so user-customized names are not touched.
    private static func migrateRenamesIfNeeded(_ catalog: inout SiteCatalog) {
        guard !UserDefaults.standard.bool(forKey: renameMigrationKey) else { return }
        defer { UserDefaults.standard.set(true, forKey: renameMigrationKey) }

        let renames: [(url: String, oldName: String, newName: String)] = [
            ("https://github.com/OpenCoven", "OpenCoven", "GitHub"),
            ("https://mind.opencoven.ai", "Coven Grimoire", "Grimoire")
        ]

        for site in catalog.sites {
            guard let match = renames.first(where: {
                site.url.absoluteString == $0.url && site.name == $0.oldName
            }) else { continue }

            if let updated = try? PortalSite(
                id: site.id,
                name: match.newName,
                urlString: site.url.absoluteString,
                iconData: site.iconData
            ) {
                catalog.updateSite(updated)
            }
        }
    }
}
