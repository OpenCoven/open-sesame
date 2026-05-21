import Foundation

public struct SiteCatalog: Sendable, Equatable {
    public private(set) var entries: [CatalogEntry]
    public private(set) var selectedSiteID: PortalSite.ID?

    public var sites: [PortalSite] {
        entries.flatMap { entry -> [PortalSite] in
            switch entry {
            case .site(let site): return [site]
            case .group(let group): return group.sites
            }
        }
    }

    public var groups: [SiteGroup] {
        entries.compactMap { entry in
            if case .group(let group) = entry { return group }
            return nil
        }
    }

    public var selectedSite: PortalSite? {
        guard let selectedSiteID else {
            return sites.first
        }

        return findSite(withID: selectedSiteID) ?? sites.first
    }

    // MARK: - Init

    public init(entries: [CatalogEntry]) {
        self.entries = entries

        let flatSites = entries.flatMap { entry -> [PortalSite] in
            switch entry {
            case .site(let site): return [site]
            case .group(let group): return group.sites
            }
        }
        self.selectedSiteID = flatSites.first?.id
    }

    public init(sites: [PortalSite]) {
        self.init(entries: sites.map { .site($0) })
    }

    // MARK: - Lookup

    public func findSite(withID id: PortalSite.ID) -> PortalSite? {
        for entry in entries {
            switch entry {
            case .site(let site) where site.id == id:
                return site
            case .group(let group):
                if let match = group.sites.first(where: { $0.id == id }) {
                    return match
                }
            default:
                continue
            }
        }
        return nil
    }

    public func findGroup(withID id: SiteGroup.ID) -> SiteGroup? {
        for entry in entries {
            if case .group(let group) = entry, group.id == id { return group }
        }
        return nil
    }

    public func groupID(containingSite siteID: PortalSite.ID) -> SiteGroup.ID? {
        for entry in entries {
            if case .group(let group) = entry,
               group.sites.contains(where: { $0.id == siteID }) {
                return group.id
            }
        }
        return nil
    }

    // MARK: - Selection

    public mutating func selectSite(withID id: PortalSite.ID) {
        guard findSite(withID: id) != nil else { return }
        selectedSiteID = id
    }

    // MARK: - Sites

    public mutating func addSite(_ site: PortalSite) {
        entries.append(.site(site))

        if selectedSiteID == nil {
            selectedSiteID = site.id
        }
    }

    public mutating func addSite(_ site: PortalSite, toGroupID groupID: SiteGroup.ID) {
        guard let entryIndex = entries.firstIndex(where: { $0.id == groupID }),
              case .group(var group) = entries[entryIndex] else {
            // Group not found — add at root as fallback.
            addSite(site)
            return
        }

        group.sites.append(site)
        entries[entryIndex] = .group(group)

        if selectedSiteID == nil {
            selectedSiteID = site.id
        }
    }

    public mutating func updateSite(_ updated: PortalSite) {
        for index in entries.indices {
            switch entries[index] {
            case .site(let existing) where existing.id == updated.id:
                entries[index] = .site(updated)
                return
            case .group(var group):
                if let siteIndex = group.sites.firstIndex(where: { $0.id == updated.id }) {
                    group.sites[siteIndex] = updated
                    entries[index] = .group(group)
                    return
                }
            default:
                continue
            }
        }
    }

    @discardableResult
    public mutating func removeSite(withID id: PortalSite.ID) -> Bool {
        guard findSite(withID: id) != nil else { return false }

        for index in entries.indices {
            switch entries[index] {
            case .site(let site) where site.id == id:
                entries.remove(at: index)
                if selectedSiteID == id {
                    selectedSiteID = sites.first?.id
                }
                return true
            case .group(var group):
                if let siteIndex = group.sites.firstIndex(where: { $0.id == id }) {
                    group.sites.remove(at: siteIndex)
                    entries[index] = .group(group)
                    if selectedSiteID == id {
                        selectedSiteID = sites.first?.id
                    }
                    return true
                }
            default:
                continue
            }
        }
        return false
    }

    /// Updates the cached favicon bytes for a site. Does nothing if the site
    /// is not in the catalog.
    public mutating func updateIconData(_ data: Data?, forSiteWithID id: PortalSite.ID) {
        for index in entries.indices {
            switch entries[index] {
            case .site(var site) where site.id == id:
                site.iconData = data
                entries[index] = .site(site)
                return
            case .group(var group):
                if let siteIndex = group.sites.firstIndex(where: { $0.id == id }) {
                    group.sites[siteIndex].iconData = data
                    entries[index] = .group(group)
                    return
                }
            default:
                continue
            }
        }
    }

    // MARK: - Groups

    public mutating func addGroup(_ group: SiteGroup) {
        entries.append(.group(group))
    }

    public mutating func renameGroup(withID id: SiteGroup.ID, to name: String) {
        guard let index = entries.firstIndex(where: { $0.id == id }),
              case .group(var group) = entries[index] else { return }
        group.name = name
        entries[index] = .group(group)
    }

    public mutating func toggleGroupCollapsed(withID id: SiteGroup.ID) {
        guard let index = entries.firstIndex(where: { $0.id == id }),
              case .group(var group) = entries[index] else { return }
        group.isCollapsed.toggle()
        entries[index] = .group(group)
    }

    /// Removes a group and promotes its children to the root, preserving order.
    public mutating func removeGroup(withID id: SiteGroup.ID) {
        guard let index = entries.firstIndex(where: { $0.id == id }),
              case .group(let group) = entries[index] else { return }
        entries.remove(at: index)
        for (offset, site) in group.sites.enumerated() {
            entries.insert(.site(site), at: index + offset)
        }
    }

    // MARK: - Reordering

    public mutating func moveRootEntries(fromOffsets source: IndexSet, toOffset destination: Int) {
        entries = Self.moved(entries, fromOffsets: source, toOffset: destination)
    }

    public mutating func moveSitesInGroup(
        _ groupID: SiteGroup.ID,
        fromOffsets source: IndexSet,
        toOffset destination: Int
    ) {
        guard let index = entries.firstIndex(where: { $0.id == groupID }),
              case .group(var group) = entries[index] else { return }
        group.sites = Self.moved(group.sites, fromOffsets: source, toOffset: destination)
        entries[index] = .group(group)
    }

    /// Foundation-only equivalent of SwiftUI's `Array.move(fromOffsets:toOffset:)`.
    private static func moved<T>(_ array: [T], fromOffsets source: IndexSet, toOffset destination: Int) -> [T] {
        var result = array
        let movingItems = source.map { result[$0] }

        for index in source.sorted(by: >) {
            result.remove(at: index)
        }

        let beforeDestination = source.filter { $0 < destination }.count
        let adjustedDestination = max(0, min(result.count, destination - beforeDestination))
        result.insert(contentsOf: movingItems, at: adjustedDestination)
        return result
    }

    /// Moves a site into the given group (appended) and removes it from its
    /// previous location.
    public mutating func moveSite(_ siteID: PortalSite.ID, intoGroup targetGroupID: SiteGroup.ID) {
        guard let site = findSite(withID: siteID) else { return }
        guard groupID(containingSite: siteID) != targetGroupID else { return }

        _removeSiteByID(siteID, allowPinned: true)
        addSite(site, toGroupID: targetGroupID)
    }

    /// Moves a site out of its current group and to the root (appended).
    public mutating func moveSiteToRoot(_ siteID: PortalSite.ID) {
        guard groupID(containingSite: siteID) != nil else { return }
        guard let site = findSite(withID: siteID) else { return }

        _removeSiteByID(siteID, allowPinned: true)
        entries.append(.site(site))
    }

    /// Moves `siteID` to sit immediately before `targetSiteID`, inheriting the
    /// target's parent (root or group). No-op if either is missing or the same.
    public mutating func moveSite(_ siteID: PortalSite.ID, before targetSiteID: PortalSite.ID) {
        guard siteID != targetSiteID else { return }
        guard let site = findSite(withID: siteID) else { return }
        guard findSite(withID: targetSiteID) != nil else { return }

        let targetGroupID = groupID(containingSite: targetSiteID)
        _removeSiteByID(siteID, allowPinned: true)

        if let targetGroupID {
            guard let groupIdx = entries.firstIndex(where: { entry in
                if case .group(let g) = entry { return g.id == targetGroupID }
                return false
            }), case .group(var group) = entries[groupIdx] else {
                entries.append(.site(site))
                return
            }
            if let targetIdx = group.sites.firstIndex(where: { $0.id == targetSiteID }) {
                group.sites.insert(site, at: targetIdx)
            } else {
                group.sites.append(site)
            }
            entries[groupIdx] = .group(group)
        } else {
            if let targetIdx = entries.firstIndex(where: { entry in
                if case .site(let s) = entry { return s.id == targetSiteID }
                return false
            }) {
                entries.insert(.site(site), at: targetIdx)
            } else {
                entries.append(.site(site))
            }
        }
    }

    private mutating func _removeSiteByID(_ id: PortalSite.ID, allowPinned: Bool) {
        for index in entries.indices {
            switch entries[index] {
            case .site(let site) where site.id == id:
                entries.remove(at: index)
                return
            case .group(var group):
                if let siteIndex = group.sites.firstIndex(where: { $0.id == id }) {
                    group.sites.remove(at: siteIndex)
                    entries[index] = .group(group)
                    return
                }
            default:
                continue
            }
        }
        _ = allowPinned
    }

    // MARK: - Bulk replace

    public mutating func replaceEntries(_ newEntries: [CatalogEntry]) {
        entries = newEntries

        let flatSiteIDs: [PortalSite.ID] = newEntries.flatMap { entry -> [PortalSite.ID] in
            switch entry {
            case .site(let s): return [s.id]
            case .group(let g): return g.sites.map(\.id)
            }
        }

        if let selectedSiteID, flatSiteIDs.contains(selectedSiteID) { return }
        selectedSiteID = flatSiteIDs.first
    }
}

public extension SiteCatalog {
    static let defaultCatalog: SiteCatalog = {
        let sites: [PortalSite] = CuratedCatalog.defaultApps.compactMap { app in
            try? PortalSite(name: app.name, urlString: app.urlString)
        }
        let coven = SiteGroup(name: CuratedCatalog.covenFolderName, sites: sites)
        return SiteCatalog(entries: [.group(coven)])
    }()
}
