import Foundation
import SwiftUI
import WebKit

/// Lazy, process-wide compiler/cache for our `WKContentRuleList`. Compilation
/// is expensive (WebKit produces a bytecode blob and stores it on disk), so we
/// only do it once per launch; subsequent calls reuse the cached list.
///
/// Extend the rule set by editing `Self.blockedDomains`. Bump `Self.identifier`
/// whenever the domain list changes so WebKit rebuilds rather than serving the
/// stale compiled blob from disk.
@MainActor
final class ContentBlocker {
    static let shared = ContentBlocker()

    private static let identifier = "OpenSesameDefaultBlocker.v2"

    /// Single source of truth for blocked third-party ad / tracker hosts. Used
    /// both for the WKContentRuleList JSON and for the in-page tally script —
    /// they need to agree, since the script counts JS-visible failures for
    /// requests heading to these domains.
    static let blockedDomains: [String] = [
        "doubleclick.net",
        "googlesyndication.com",
        "googletagmanager.com",
        "googletagservices.com",
        "google-analytics.com",
        "googleadservices.com",
        "facebook.net",
        "scorecardresearch.com",
        "quantserve.com",
        "adnxs.com",
        "amazon-adsystem.com",
        "criteo.com",
        "outbrain.com",
        "taboola.com",
        "hotjar.com",
        "mixpanel.com",
        "segment.io",
        "fullstory.com",
        "branch.io"
    ]

    /// WebKit's content-blocker JSON format is documented at
    /// https://developer.apple.com/documentation/safariservices/creating-a-content-blocker
    private static var encodedRules: String {
        let blocks = blockedDomains.map { domain -> String in
            let escaped = domain.replacingOccurrences(of: ".", with: "\\\\.")
            return #"{ "trigger": {"url-filter": "\#(escaped)"}, "action": {"type": "block"} }"#
        }
        let thirdPartyCookies = #"{ "trigger": {"url-filter": ".*", "resource-type": ["script"], "load-type": ["third-party"]}, "action": {"type": "block-cookies"} }"#
        return "[\n  \(blocks.joined(separator: ",\n  ")),\n  \(thirdPartyCookies)\n]"
    }

    /// Injected at document-start. Listens for resource-load errors against
    /// our blocked-domain list and posts a `1` to `blockCounter` for each.
    /// This is a proxy for actual blocks — WebKit doesn't expose a callback
    /// when a content-rule-list rule fires, so we count the JS-visible side
    /// effect instead.
    static let blockTallyScript: WKUserScript = {
        let json = (try? JSONSerialization.data(withJSONObject: blockedDomains)) ?? Data()
        let listLiteral = String(data: json, encoding: .utf8) ?? "[]"
        let source = """
        (function() {
          var domains = \(listLiteral);
          function matches(u) {
            if (!u) return false;
            for (var i = 0; i < domains.length; i++) {
              if (String(u).indexOf(domains[i]) !== -1) return true;
            }
            return false;
          }
          function bump() {
            try { window.webkit.messageHandlers.blockCounter.postMessage(1); } catch (e) {}
          }
          document.addEventListener('error', function(evt) {
            var t = evt.target;
            if (!t) return;
            var url = t.src || t.href || '';
            if (matches(url)) bump();
          }, true);
          var origFetch = window.fetch;
          if (origFetch) {
            window.fetch = function() {
              var a0 = arguments[0];
              var url = (a0 && a0.url) ? a0.url : String(a0 || '');
              var result = origFetch.apply(this, arguments);
              if (matches(url)) {
                result.then(function(r){ if (!r || !r.ok) bump(); }, function(){ bump(); });
              }
              return result;
            };
          }
          var origOpen = XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.open = function(method, url) {
            if (matches(url)) this.addEventListener('error', bump);
            return origOpen.apply(this, arguments);
          };
        })();
        """
        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: false)
    }()

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

/// Process-wide tally of attempted tracker-domain requests that failed at the
/// network layer (the strongest proxy we have for "blocked by our rule list").
/// Receives deltas from `ContentBlocker.blockTallyScript` via `WKScriptMessageHandler`.
@MainActor
final class BlockCounter: NSObject, ObservableObject, WKScriptMessageHandler {
    static let shared = BlockCounter()

    @Published private(set) var count: Int = 0

    private override init() { super.init() }

    func reset() {
        count = 0
    }

    func userContentController(
        _ controller: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == "blockCounter" else { return }
        let delta = (message.body as? Int) ?? (message.body as? NSNumber)?.intValue ?? 0
        guard delta > 0 else { return }
        count += delta
    }
}
