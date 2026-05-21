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
    static func loadInitialCatalog() -> SiteCatalog {
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
}
