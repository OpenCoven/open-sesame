import OpenSesameCore
import SwiftUI

@main
struct OpenSesameApp: App {
    @State private var catalog = SiteCatalog.defaultCatalog

    var body: some Scene {
        WindowGroup {
            ShellView(catalog: $catalog)
                .frame(minWidth: 900, minHeight: 620)
        }
        .windowStyle(.titleBar)
        .defaultSize(width: 1180, height: 760)
    }
}
