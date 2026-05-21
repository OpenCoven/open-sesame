import Foundation
import Testing
@testable import OpenSesameCore

@Test func siteTrimsNamesAndRequiresHTTPURL() throws {
    let site = try PortalSite(name: "  Open Sorcery  ", label: "  DevTools  ", urlString: "https://opensorcery.ai")

    #expect(site.name == "Open Sorcery")
    #expect(site.label == "DevTools")
    #expect(site.url.absoluteString == "https://opensorcery.ai")
}

@Test func siteRejectsUnsupportedURLSchemes() {
    #expect(throws: PortalSite.ValidationError.self) {
        try PortalSite(name: "Local File", label: "Unsafe", urlString: "file:///tmp/index.html")
    }
}

@Test func catalogUsesOpenSorceryAsDefaultSite() throws {
    let catalog = SiteCatalog.defaultCatalog

    #expect(catalog.sites.count == 1)
    #expect(catalog.selectedSite?.name == "Open Sorcery")
    #expect(catalog.selectedSite?.url.absoluteString == "https://opensorcery.ai")
}

@Test func catalogSelectsSitesByStableIdentifier() throws {
    let first = try PortalSite(name: "One", label: "A", urlString: "https://one.example")
    let second = try PortalSite(name: "Two", label: "B", urlString: "https://two.example")
    var catalog = SiteCatalog(sites: [first, second])

    catalog.selectSite(withID: second.id)

    #expect(catalog.selectedSite?.id == second.id)
    #expect(catalog.selectedSite?.name == "Two")
}

@Test func catalogDecodesFromJSONConfiguration() throws {
    let data = """
    {
      "sites": [
        {
          "name": "Local App",
          "label": "Development",
          "url": "http://localhost:3000"
        },
        {
          "name": "Production",
          "label": "Live",
          "url": "https://example.com"
        }
      ]
    }
    """.data(using: .utf8)!

    let catalog = try SiteCatalog.decodeConfiguration(from: data)

    #expect(catalog.sites.count == 2)
    #expect(catalog.selectedSite?.name == "Local App")
    #expect(catalog.sites[1].url.absoluteString == "https://example.com")
}

@Test func catalogConfigurationUsesPortalSiteValidation() throws {
    let data = """
    {
      "sites": [
        {
          "name": "Local File",
          "label": "Unsafe",
          "url": "file:///tmp/index.html"
        }
      ]
    }
    """.data(using: .utf8)!

    #expect(throws: PortalSite.ValidationError.self) {
        try SiteCatalog.decodeConfiguration(from: data)
    }
}

@Test func catalogLoadsConfigurationFromFileURL() throws {
    let configurationURL = FileManager.default.temporaryDirectory
        .appending(path: "open-sesame-\(UUID().uuidString).json")
    let data = """
    {
      "sites": [
        {
          "name": "Workbench",
          "label": "Local",
          "url": "http://127.0.0.1:8080"
        }
      ]
    }
    """.data(using: .utf8)!
    try data.write(to: configurationURL)
    defer {
        try? FileManager.default.removeItem(at: configurationURL)
    }

    let catalog = try SiteCatalog.loadConfiguration(at: configurationURL)

    #expect(catalog.selectedSite?.name == "Workbench")
    #expect(catalog.selectedSite?.url.absoluteString == "http://127.0.0.1:8080")
}
