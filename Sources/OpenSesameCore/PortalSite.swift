import Foundation

public struct PortalSite: Identifiable, Hashable, Sendable {
    public enum ValidationError: Error, Equatable {
        case missingName
        case missingURL
        case unsupportedScheme(String?)
    }

    public let id: UUID
    public var name: String
    public var url: URL
    public var isPinned: Bool
    public var iconData: Data?

    public init(
        id: UUID = UUID(),
        name: String,
        urlString: String,
        isPinned: Bool = false,
        iconData: Data? = nil
    ) throws {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedURL = urlString.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !trimmedName.isEmpty else {
            throw ValidationError.missingName
        }

        guard let parsedURL = URL(string: trimmedURL) else {
            throw ValidationError.missingURL
        }

        guard parsedURL.scheme == "http" || parsedURL.scheme == "https" else {
            throw ValidationError.unsupportedScheme(parsedURL.scheme)
        }

        self.id = id
        self.name = trimmedName
        self.url = parsedURL
        self.isPinned = isPinned
        self.iconData = iconData
    }
}

extension PortalSite: Codable {
    private enum CodingKeys: String, CodingKey {
        case id, name, url, isPinned, iconData
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let id = try container.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        let name = try container.decode(String.self, forKey: .name)
        let url = try container.decode(String.self, forKey: .url)
        let isPinned = try container.decodeIfPresent(Bool.self, forKey: .isPinned) ?? false
        let iconData = try container.decodeIfPresent(Data.self, forKey: .iconData)

        do {
            try self.init(
                id: id,
                name: name,
                urlString: url,
                isPinned: isPinned,
                iconData: iconData
            )
        } catch let error as ValidationError {
            let context = DecodingError.Context(
                codingPath: decoder.codingPath,
                debugDescription: "PortalSite validation failed: \(error)"
            )
            throw DecodingError.dataCorrupted(context)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(name, forKey: .name)
        try container.encode(url.absoluteString, forKey: .url)
        try container.encode(isPinned, forKey: .isPinned)
        try container.encodeIfPresent(iconData, forKey: .iconData)
    }
}
