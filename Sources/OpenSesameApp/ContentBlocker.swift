import Foundation
import WebKit

/// Lazy, process-wide compiler/cache for our `WKContentRuleList`. Compilation
/// is expensive (WebKit produces a bytecode blob and stores it on disk), so we
/// only do it once per launch; subsequent calls reuse the cached list.
///
/// Extend the rule set by editing `Self.encodedRules`. Bump `Self.identifier`
/// (or call `WKContentRuleListStore.default()?.removeContentRuleList(...)`)
/// whenever the rules change so WebKit rebuilds rather than serving the stale
/// compiled blob from disk.
@MainActor
final class ContentBlocker {
    static let shared = ContentBlocker()

    private static let identifier = "OpenSesameDefaultBlocker.v1"

    /// Starter rule set: common third-party ad / tracker domains. WebKit's
    /// content-blocker JSON format is documented at
    /// https://developer.apple.com/documentation/safariservices/creating-a-content-blocker
    private static let encodedRules: String = #"""
    [
      { "trigger": {"url-filter": "doubleclick\\.net"}, "action": {"type": "block"} },
      { "trigger": {"url-filter": "googlesyndication\\.com"}, "action": {"type": "block"} },
      { "trigger": {"url-filter": "googletagmanager\\.com"}, "action": {"type": "block"} },
      { "trigger": {"url-filter": "googletagservices\\.com"}, "action": {"type": "block"} },
      { "trigger": {"url-filter": "google-analytics\\.com"}, "action": {"type": "block"} },
      { "trigger": {"url-filter": "googleadservices\\.com"}, "action": {"type": "block"} },
      { "trigger": {"url-filter": "facebook\\.net"}, "action": {"type": "block"} },
      { "trigger": {"url-filter": "connect\\.facebook\\.net"}, "action": {"type": "block"} },
      { "trigger": {"url-filter": "scorecardresearch\\.com"}, "action": {"type": "block"} },
      { "trigger": {"url-filter": "quantserve\\.com"}, "action": {"type": "block"} },
      { "trigger": {"url-filter": "adnxs\\.com"}, "action": {"type": "block"} },
      { "trigger": {"url-filter": "amazon-adsystem\\.com"}, "action": {"type": "block"} },
      { "trigger": {"url-filter": "criteo\\.com"}, "action": {"type": "block"} },
      { "trigger": {"url-filter": "outbrain\\.com"}, "action": {"type": "block"} },
      { "trigger": {"url-filter": "taboola\\.com"}, "action": {"type": "block"} },
      { "trigger": {"url-filter": "hotjar\\.com"}, "action": {"type": "block"} },
      { "trigger": {"url-filter": "mixpanel\\.com"}, "action": {"type": "block"} },
      { "trigger": {"url-filter": "segment\\.io"}, "action": {"type": "block"} },
      { "trigger": {"url-filter": "fullstory\\.com"}, "action": {"type": "block"} },
      { "trigger": {"url-filter": "branch\\.io"}, "action": {"type": "block"} },
      { "trigger": {"url-filter": ".*", "if-domain": ["*"], "resource-type": ["script"], "load-type": ["third-party"], "url-filter-is-case-sensitive": false}, "action": {"type": "block-cookies"} }
    ]
    """#

    private var cached: WKContentRuleList?
    private var inflight: Task<WKContentRuleList?, Never>?

    private init() {}

    /// Returns the compiled rule list, compiling on first call. Safe to call
    /// concurrently — duplicate requests share a single in-flight compile.
    func compiled() async -> WKContentRuleList? {
        if let cached { return cached }
        if let inflight { return await inflight.value }

        let task = Task<WKContentRuleList?, Never> { @MainActor in
            guard let store = WKContentRuleListStore.default() else { return nil }

            if let existing = await Self.lookup(in: store, identifier: Self.identifier) {
                return existing
            }
            return await Self.compile(in: store, identifier: Self.identifier, encoded: Self.encodedRules)
        }

        inflight = task
        let result = await task.value
        inflight = nil
        cached = result
        return result
    }

    @MainActor
    private static func lookup(in store: WKContentRuleListStore, identifier: String) async -> WKContentRuleList? {
        await withCheckedContinuation { (cont: CheckedContinuation<WKContentRuleList?, Never>) in
            store.lookUpContentRuleList(forIdentifier: identifier) { list, _ in
                cont.resume(returning: list)
            }
        }
    }

    @MainActor
    private static func compile(in store: WKContentRuleListStore, identifier: String, encoded: String) async -> WKContentRuleList? {
        await withCheckedContinuation { (cont: CheckedContinuation<WKContentRuleList?, Never>) in
            store.compileContentRuleList(forIdentifier: identifier, encodedContentRuleList: encoded) { list, error in
                if let error {
                    NSLog("[ContentBlocker] compile failed: %@", String(describing: error))
                }
                cont.resume(returning: list)
            }
        }
    }
}
