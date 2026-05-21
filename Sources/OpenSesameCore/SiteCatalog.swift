import Foundation

public struct SiteCatalog: Sendable {
    public private(set) var sites: [PortalSite]
    public private(set) var selectedSiteID: PortalSite.ID?

    public var selectedSite: PortalSite? {
        guard let selectedSiteID else {
            return sites.first
        }

        return sites.first { $0.id == selectedSiteID } ?? sites.first
    }

    public var pinnedSite: PortalSite? {
        sites.first { $0.isPinned }
    }

    public init(sites: [PortalSite]) {
        self.sites = sites
        self.selectedSiteID = sites.first?.id
    }

    public mutating func selectSite(withID id: PortalSite.ID) {
        guard sites.contains(where: { $0.id == id }) else {
            return
        }

        selectedSiteID = id
    }

    public mutating func addSite(_ site: PortalSite) {
        sites.append(site)

        if selectedSiteID == nil {
            selectedSiteID = site.id
        }
    }

    public mutating func updateSite(_ site: PortalSite) {
        guard let index = sites.firstIndex(where: { $0.id == site.id }) else {
            return
        }

        var updated = site
        // Preserve pinned status — pinning is set at catalog level, not via edit.
        updated.isPinned = sites[index].isPinned
        sites[index] = updated
    }

    @discardableResult
    public mutating func removeSite(withID id: PortalSite.ID) -> Bool {
        guard let site = sites.first(where: { $0.id == id }) else {
            return false
        }

        if site.isPinned {
            return false
        }

        sites.removeAll { $0.id == id }

        if selectedSiteID == id {
            selectedSiteID = sites.first?.id
        }

        return true
    }

    public mutating func replaceSites(_ newSites: [PortalSite]) {
        sites = newSites

        if let selectedSiteID, newSites.contains(where: { $0.id == selectedSiteID }) {
            return
        }

        selectedSiteID = newSites.first?.id
    }
}

public extension SiteCatalog {
    static let defaultCatalog = SiteCatalog(
        sites: [
            try! PortalSite(
                name: "OpenCoven",
                label: "Home",
                urlString: "https://opencoven.ai",
                isPinned: true
            )
        ]
    )
}
