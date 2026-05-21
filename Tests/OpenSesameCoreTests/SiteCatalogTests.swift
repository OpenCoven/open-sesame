import Foundation
import Testing
@testable import OpenSesameCore

@Test func siteTrimsNamesAndRequiresHTTPURL() throws {
    let site = try PortalSite(name: "  Open Sorcery  ", urlString: "https://opensorcery.ai")

    #expect(site.name == "Open Sorcery")
    #expect(site.url.absoluteString == "https://opensorcery.ai")
}

@Test func siteRejectsUnsupportedURLSchemes() {
    #expect(throws: PortalSite.ValidationError.self) {
        try PortalSite(name: "Local File", urlString: "file:///tmp/index.html")
    }
}

@Test func defaultCatalogPutsHomeAtRootAndRestInCoven() throws {
    let catalog = SiteCatalog.defaultCatalog

    let expectedNames = CuratedCatalog.defaultApps.map(\.name)
    let homeApp = CuratedCatalog.defaultApps.first

    // Root has the home site, then the Coven folder — 2 entries total.
    #expect(catalog.entries.count == 2)
    if case .site(let home) = catalog.entries[0] {
        #expect(home.name == homeApp?.name)
        #expect(home.url.absoluteString == homeApp?.urlString)
    } else {
        Issue.record("expected entries[0] to be the home site")
    }
    #expect(catalog.groups.first?.name == CuratedCatalog.covenFolderName)
    #expect(catalog.groups.first?.sites.count == expectedNames.count - 1)
    #expect(catalog.sites.count == expectedNames.count)
    #expect(catalog.selectedSite?.name == homeApp?.name)
}

@Test func curatedCatalogSeparatesDefaultsFromSocials() throws {
    #expect(CuratedCatalog.defaultApps.allSatisfy { $0.category == .default })
    #expect(CuratedCatalog.socialApps.allSatisfy { $0.category == .social })
    let defaultIDs = Set(CuratedCatalog.defaultApps.map(\.id))
    let socialIDs = Set(CuratedCatalog.socialApps.map(\.id))
    #expect(defaultIDs.intersection(socialIDs).isEmpty)
}

@Test func removeSiteRemovesAnyEntry() throws {
    let a = try PortalSite(name: "Home", urlString: "https://example.com")
    let b = try PortalSite(name: "Extra", urlString: "https://example.org")
    var catalog = SiteCatalog(sites: [a, b])

    let removedA = catalog.removeSite(withID: a.id)
    let removedB = catalog.removeSite(withID: b.id)

    #expect(removedA == true)
    #expect(removedB == true)
    #expect(catalog.sites.isEmpty)
}

@Test func updateSiteRewritesNameAndURL() throws {
    let original = try PortalSite(name: "Old", urlString: "https://example.com")
    var catalog = SiteCatalog(sites: [original])

    let edited = try PortalSite(
        id: original.id,
        name: "New",
        urlString: "https://other.example"
    )
    catalog.updateSite(edited)

    let stored = catalog.sites.first
    #expect(stored?.name == "New")
    #expect(stored?.url.absoluteString == "https://other.example")
}

@Test func catalogSelectsSitesByStableIdentifier() throws {
    let first = try PortalSite(name: "One", urlString: "https://one.example")
    let second = try PortalSite(name: "Two", urlString: "https://two.example")
    var catalog = SiteCatalog(sites: [first, second])

    catalog.selectSite(withID: second.id)

    #expect(catalog.selectedSite?.id == second.id)
    #expect(catalog.selectedSite?.name == "Two")
}

@Test func catalogDecodesFromLegacyFlatJSON() throws {
    let data = """
    {
      "sites": [
        {"name": "Local App", "label": "Development", "url": "http://localhost:3000"},
        {"name": "Production", "label": "Live", "url": "https://example.com"}
      ]
    }
    """.data(using: .utf8)!

    let catalog = try SiteCatalog.decodeConfiguration(from: data)

    #expect(catalog.sites.count == 2)
    #expect(catalog.selectedSite?.name == "Local App")
    #expect(catalog.sites[1].url.absoluteString == "https://example.com")
}

@Test func catalogDecodesEntriesTreeWithGroups() throws {
    let data = """
    {
      "entries": [
        {
          "type": "site",
          "payload": {"name": "Home", "url": "https://opencoven.ai"}
        },
        {
          "type": "group",
          "payload": {
            "name": "Dev",
            "sites": [
              {"name": "Localhost", "url": "http://localhost:3000"},
              {"name": "Staging", "url": "https://staging.example"}
            ]
          }
        }
      ]
    }
    """.data(using: .utf8)!

    let catalog = try SiteCatalog.decodeConfiguration(from: data)

    #expect(catalog.entries.count == 2)
    #expect(catalog.sites.count == 3)
    #expect(catalog.groups.count == 1)
    #expect(catalog.groups.first?.name == "Dev")
    #expect(catalog.groups.first?.sites.count == 2)
    #expect(catalog.sites.first?.name == "Home")
}

@Test func catalogConfigurationUsesPortalSiteValidation() throws {
    let data = """
    {
      "sites": [
        {"name": "Local File", "label": "Unsafe", "url": "file:///tmp/index.html"}
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
        {"name": "Workbench", "label": "Local", "url": "http://127.0.0.1:8080"}
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

// MARK: - Groups & reordering

@Test func addGroupAndAddSiteIntoGroup() throws {
    var catalog = SiteCatalog(entries: [])
    let group = SiteGroup(name: "Dev")
    catalog.addGroup(group)

    let site = try PortalSite(name: "Local", urlString: "http://localhost:3000")
    catalog.addSite(site, toGroupID: group.id)

    #expect(catalog.entries.count == 1)
    #expect(catalog.groups.first?.sites.count == 1)
    #expect(catalog.sites.count == 1)
    #expect(catalog.findSite(withID: site.id)?.name == "Local")
}

@Test func moveSiteInAndOutOfGroup() throws {
    let rootSite = try PortalSite(name: "Root", urlString: "https://root.example")
    let groupSite = try PortalSite(name: "Inside", urlString: "https://inside.example")
    let group = SiteGroup(name: "Folder", sites: [groupSite])
    var catalog = SiteCatalog(entries: [.site(rootSite), .group(group)])

    catalog.moveSite(rootSite.id, intoGroup: group.id)
    #expect(catalog.groupID(containingSite: rootSite.id) == group.id)
    #expect(catalog.groups.first?.sites.count == 2)

    catalog.moveSiteToRoot(groupSite.id)
    #expect(catalog.groupID(containingSite: groupSite.id) == nil)
}

@Test func removeGroupPromotesChildrenToRoot() throws {
    let a = try PortalSite(name: "A", urlString: "https://a.example")
    let b = try PortalSite(name: "B", urlString: "https://b.example")
    let group = SiteGroup(name: "G", sites: [a, b])
    let other = try PortalSite(name: "C", urlString: "https://c.example")
    var catalog = SiteCatalog(entries: [.group(group), .site(other)])

    catalog.removeGroup(withID: group.id)

    #expect(catalog.entries.count == 3)
    #expect(catalog.groups.isEmpty)
    if case .site(let first) = catalog.entries[0] { #expect(first.id == a.id) } else { Issue.record("expected .site") }
    if case .site(let second) = catalog.entries[1] { #expect(second.id == b.id) } else { Issue.record("expected .site") }
    if case .site(let third) = catalog.entries[2] { #expect(third.id == other.id) } else { Issue.record("expected .site") }
}

@Test func moveRootEntriesReorders() throws {
    let a = try PortalSite(name: "A", urlString: "https://a.example")
    let b = try PortalSite(name: "B", urlString: "https://b.example")
    let c = try PortalSite(name: "C", urlString: "https://c.example")
    var catalog = SiteCatalog(sites: [a, b, c])

    catalog.moveRootEntries(fromOffsets: IndexSet(integer: 0), toOffset: 2)

    let names = catalog.sites.map(\.name)
    #expect(names == ["B", "A", "C"])
}
