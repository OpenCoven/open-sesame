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

public struct SiteCatalogConfiguration: Codable, Equatable, Sendable {
    public var sites: [PortalSiteDefinition]

    public init(sites: [PortalSiteDefinition]) {
        self.sites = sites
    }
}

public extension SiteCatalog {
    init(configuration: SiteCatalogConfiguration) throws {
        let sites = try configuration.sites.map { definition in
            try PortalSite(
                name: definition.name,
                label: definition.label,
                urlString: definition.url,
                isPinned: definition.isPinned
            )
        }

        self.init(sites: sites)
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
