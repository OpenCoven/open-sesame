import Foundation

public struct PortalSite: Identifiable, Hashable, Sendable {
    public enum ValidationError: Error, Equatable {
        case missingName
        case missingURL
        case unsupportedScheme(String?)
    }

    public let id: UUID
    public var name: String
    public var label: String
    public var url: URL
    public var isPinned: Bool

    public init(
        id: UUID = UUID(),
        name: String,
        label: String = "",
        urlString: String,
        isPinned: Bool = false
    ) throws {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedLabel = label.trimmingCharacters(in: .whitespacesAndNewlines)
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
        self.label = trimmedLabel
        self.url = parsedURL
        self.isPinned = isPinned
    }
}
