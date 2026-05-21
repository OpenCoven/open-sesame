import Foundation

public struct SiteGroup: Identifiable, Hashable, Sendable, Codable {
    public let id: UUID
    public var name: String
    public var isCollapsed: Bool
    public var sites: [PortalSite]

    public init(
        id: UUID = UUID(),
        name: String,
        isCollapsed: Bool = false,
        sites: [PortalSite] = []
    ) {
        self.id = id
        self.name = name
        self.isCollapsed = isCollapsed
        self.sites = sites
    }
}
