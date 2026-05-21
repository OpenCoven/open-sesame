import Foundation

public enum CatalogEntry: Identifiable, Hashable, Sendable {
    case site(PortalSite)
    case group(SiteGroup)

    public var id: UUID {
        switch self {
        case .site(let site): return site.id
        case .group(let group): return group.id
        }
    }
}

extension CatalogEntry: Codable {
    private enum CodingKeys: String, CodingKey {
        case type
        case payload
    }

    private enum EntryKind: String, Codable {
        case site, group
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .site(let site):
            try container.encode(EntryKind.site, forKey: .type)
            try container.encode(site, forKey: .payload)
        case .group(let group):
            try container.encode(EntryKind.group, forKey: .type)
            try container.encode(group, forKey: .payload)
        }
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(EntryKind.self, forKey: .type)
        switch kind {
        case .site:
            self = .site(try container.decode(PortalSite.self, forKey: .payload))
        case .group:
            self = .group(try container.decode(SiteGroup.self, forKey: .payload))
        }
    }
}
