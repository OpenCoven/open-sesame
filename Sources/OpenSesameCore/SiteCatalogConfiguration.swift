import Foundation

public struct PortalSiteDefinition: Codable, Equatable, Sendable {
    public var name: String
    public var label: String
    public var url: String
    public var isPinned: Bool

    public init(name: String, label: String = "", url: String, isPinned: Bool = false) {
        self.name = name
        self.label = label
        self.url = url
        self.isPinned = isPinned
    }

    private enum CodingKeys: String, CodingKey {
        case name, label, url, isPinned
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        name = try container.decode(String.self, forKey: .name)
        label = try container.decodeIfPresent(String.self, forKey: .label) ?? ""
        url = try container.decode(String.self, forKey: .url)
        isPinned = try container.decodeIfPresent(Bool.self, forKey: .isPinned) ?? false
    }
}

public struct SiteGroupDefinition: Codable, Equatable, Sendable {
    public var id: UUID
    public var name: String
    public var isCollapsed: Bool
    public var sites: [PortalSiteDefinition]

    public init(
        id: UUID = UUID(),
        name: String,
        isCollapsed: Bool = false,
        sites: [PortalSiteDefinition] = []
    ) {
        self.id = id
        self.name = name
        self.isCollapsed = isCollapsed
        self.sites = sites
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, isCollapsed, sites
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        name = try container.decode(String.self, forKey: .name)
        isCollapsed = try container.decodeIfPresent(Bool.self, forKey: .isCollapsed) ?? false
        sites = try container.decodeIfPresent([PortalSiteDefinition].self, forKey: .sites) ?? []
    }
}

public enum CatalogEntryDefinition: Codable, Equatable, Sendable {
    case site(PortalSiteDefinition)
    case group(SiteGroupDefinition)

    private enum CodingKeys: String, CodingKey {
        case type
        case payload
    }

    private enum Kind: String, Codable {
        case site, group
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .site(let s):
            try container.encode(Kind.site, forKey: .type)
            try container.encode(s, forKey: .payload)
        case .group(let g):
            try container.encode(Kind.group, forKey: .type)
            try container.encode(g, forKey: .payload)
        }
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(Kind.self, forKey: .type)
        switch kind {
        case .site:
            self = .site(try container.decode(PortalSiteDefinition.self, forKey: .payload))
        case .group:
            self = .group(try container.decode(SiteGroupDefinition.self, forKey: .payload))
        }
    }
}

public struct SiteCatalogConfiguration: Codable, Equatable, Sendable {
    public var entries: [CatalogEntryDefinition]

    public init(entries: [CatalogEntryDefinition]) {
        self.entries = entries
    }

    public init(sites: [PortalSiteDefinition]) {
        self.entries = sites.map { .site($0) }
    }

    private enum CodingKeys: String, CodingKey {
        case entries, sites
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let entries = try container.decodeIfPresent([CatalogEntryDefinition].self, forKey: .entries) {
            self.entries = entries
        } else if let sites = try container.decodeIfPresent([PortalSiteDefinition].self, forKey: .sites) {
            self.entries = sites.map { .site($0) }
        } else {
            self.entries = []
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(entries, forKey: .entries)
    }
}

public extension SiteCatalog {
    init(configuration: SiteCatalogConfiguration) throws {
        let entries: [CatalogEntry] = try configuration.entries.map { definition in
            switch definition {
            case .site(let site):
                let portal = try PortalSite(
                    name: site.name,
                    label: site.label,
                    urlString: site.url,
                    isPinned: site.isPinned
                )
                return .site(portal)
            case .group(let group):
                let sites = try group.sites.map { site in
                    try PortalSite(
                        name: site.name,
                        label: site.label,
                        urlString: site.url,
                        isPinned: site.isPinned
                    )
                }
                return .group(
                    SiteGroup(
                        id: group.id,
                        name: group.name,
                        isCollapsed: group.isCollapsed,
                        sites: sites
                    )
                )
            }
        }

        self.init(entries: entries)
    }

    static func decodeConfiguration(
        from data: Data,
        using decoder: JSONDecoder = JSONDecoder()
    ) throws -> SiteCatalog {
        let configuration = try decoder.decode(SiteCatalogConfiguration.self, from: data)
        return try SiteCatalog(configuration: configuration)
    }

    static func loadConfiguration(
        at url: URL,
        using decoder: JSONDecoder = JSONDecoder()
    ) throws -> SiteCatalog {
        let data = try Data(contentsOf: url)
        return try decodeConfiguration(from: data, using: decoder)
    }
}
