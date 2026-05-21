import Foundation

/// A known-good site we ship as a starting suggestion. Defaults are seeded on
/// first launch and live in the user's catalog like any other site; socials
/// are opt-in via the Settings → Suggested tab.
public struct CuratedApp: Identifiable, Hashable, Sendable {
    public enum Category: String, Sendable {
        case `default`
        case social
    }

    public let id: String
    public let name: String
    public let urlString: String
    public let category: Category

    public init(id: String, name: String, urlString: String, category: Category) {
        self.id = id
        self.name = name
        self.urlString = urlString
        self.category = category
    }

    /// Normalized absolute URL string used for matching against catalog entries.
    public var normalizedURL: String { urlString }
}

public enum CuratedCatalog {
    public static let defaultApps: [CuratedApp] = [
        CuratedApp(
            id: "documentation",
            name: "Documentation",
            urlString: "https://docs.opencoven.ai",
            category: .default
        ),
        CuratedApp(
            id: "opencoven",
            name: "OpenCoven",
            urlString: "https://github.com/OpenCoven",
            category: .default
        ),
        CuratedApp(
            id: "castcodes",
            name: "CastCodes",
            urlString: "https://cast.codes",
            category: .default
        ),
        CuratedApp(
            id: "coven-grimoire",
            name: "Coven Grimoire",
            urlString: "https://mind.opencoven.ai",
            category: .default
        )
    ]

    public static let socialApps: [CuratedApp] = [
        CuratedApp(
            id: "reddit",
            name: "Reddit",
            urlString: "https://reddit.com/r/OpenCvn",
            category: .social
        ),
        CuratedApp(
            id: "x",
            name: "fka Twitter",
            urlString: "https://x.com/OpenCvn",
            category: .social
        ),
        CuratedApp(
            id: "telegram",
            name: "Telegram",
            urlString: "https://web.telegram.org/k",
            category: .social
        ),
        CuratedApp(
            id: "discord",
            name: "Discord",
            urlString: "https://discord.com/app",
            category: .social
        )
    ]

    public static let all: [CuratedApp] = defaultApps + socialApps

    /// Stable folder name used by the one-time social migration and by the
    /// "Suggested" toggle path so newly-enabled socials land in a known group.
    public static let socialsFolderName = "Socials"

    /// Stable folder name for the OpenCoven-branded defaults. Defaults seed
    /// here on first launch, and the V3 migration rolls any pre-existing
    /// curated default sites at root level into this folder.
    public static let covenFolderName = "Coven"
}
