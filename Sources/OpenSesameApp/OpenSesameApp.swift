import OpenSesameCore
import SwiftUI

@main
struct OpenSesameApp: App {
    @State private var catalog = CatalogBootstrap.loadInitialCatalog()

    var body: some Scene {
        WindowGroup {
            ShellView(catalog: $catalog)
                .frame(minWidth: 900, minHeight: 620)
        }
        .windowStyle(.titleBar)
        .defaultSize(width: 1180, height: 760)
    }
}

private enum CatalogBootstrap {
    static func loadInitialCatalog() -> SiteCatalog {
        let configurationURL = URL(filePath: FileManager.default.currentDirectoryPath)
            .appending(path: "open-sesame-sites.json")

        guard FileManager.default.fileExists(atPath: configurationURL.path) else {
            return .defaultCatalog
        }

        do {
            return try SiteCatalog.loadConfiguration(at: configurationURL)
        } catch {
            return .defaultCatalog
        }
    }
}
