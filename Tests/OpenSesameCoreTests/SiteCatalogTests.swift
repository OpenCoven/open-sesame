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
