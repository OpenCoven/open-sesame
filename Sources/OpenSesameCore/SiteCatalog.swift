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
                name: "Open Sorcery",
                label: "DevTools",
                urlString: "https://opensorcery.ai"
            )
        ]
    )
}
