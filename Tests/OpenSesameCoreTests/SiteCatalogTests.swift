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

@Test func catalogUsesOpenCovenAsPinnedDefaultSite() throws {
    let catalog = SiteCatalog.defaultCatalog

    #expect(catalog.sites.count == 1)
    #expect(catalog.selectedSite?.name == "OpenCoven")
    #expect(catalog.selectedSite?.url.absoluteString == "https://opencoven.ai")
    #expect(catalog.selectedSite?.isPinned == true)
    #expect(catalog.pinnedSite?.id == catalog.selectedSite?.id)
}

@Test func catalogRefusesToRemovePinnedSites() throws {
    let pinned = try PortalSite(name: "Home", urlString: "https://example.com", isPinned: true)
    let extra = try PortalSite(name: "Extra", urlString: "https://example.org")
    var catalog = SiteCatalog(sites: [pinned, extra])

    let removedPinned = catalog.removeSite(withID: pinned.id)
    let removedExtra = catalog.removeSite(withID: extra.id)

    #expect(removedPinned == false)
    #expect(removedExtra == true)
    #expect(catalog.sites.count == 1)
    #expect(catalog.sites.first?.id == pinned.id)
}

@Test func updateSitePreservesPinnedFlag() throws {
    let pinned = try PortalSite(name: "Home", urlString: "https://example.com", isPinned: true)
    var catalog = SiteCatalog(sites: [pinned])

    let edited = try PortalSite(
        id: pinned.id,
        name: "New Home",
        urlString: "https://other.example",
        isPinned: false
    )
    catalog.updateSite(edited)

    let stored = catalog.sites.first
    #expect(stored?.name == "New Home")
    #expect(stored?.url.absoluteString == "https://other.example")
    #expect(stored?.isPinned == true)
}

@Test func catalogSelectsSitesByStableIdentifier() throws {
    let first = try PortalSite(name: "One", label: "A", urlString: "https://one.example")
    let second = try PortalSite(name: "Two", label: "B", urlString: "https://two.example")
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
          "payload": {"name": "Home", "url": "https://opencoven.ai", "isPinned": true}
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
    #expect(catalog.pinnedSite?.name == "Home")
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

@Test func setHomeSiteUnpinsPreviousHome() throws {
    let a = try PortalSite(name: "A", urlString: "https://a.example", isPinned: true)
    let b = try PortalSite(name: "B", urlString: "https://b.example")
    var catalog = SiteCatalog(sites: [a, b])

    catalog.setHomeSite(withID: b.id)

    #expect(catalog.findSite(withID: a.id)?.isPinned == false)
    #expect(catalog.findSite(withID: b.id)?.isPinned == true)
    #expect(catalog.pinnedSite?.id == b.id)
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
