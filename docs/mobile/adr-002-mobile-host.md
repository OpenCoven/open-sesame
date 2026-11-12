# ADR 002: iOS and iPadOS as a Tauri 2 target of the desktop app

Status: **Decided by Val on 12 November 2026; nothing in this document has been compiled or run.** The decision is recorded in [#35](https://github.com/OpenCoven/open-sesame/issues/35#issuecomment-6821332033), under the mobile epic [#33](https://github.com/OpenCoven/open-sesame/issues/33). This ADR supersedes [ADR 001](adr-001-mobile-host.md) as the host decision and keeps the requirements of ADR 001 that are still valid. It authorises no spending, enrolment, WorkOS or Apple configuration change, store submission or release.

## Why the decision was reopened

ADR 001 chose a thin Swift UIKit and WKWebView host that reused the authored `dist/` renderer beside a Swift desktop host and a Python bridge. The desktop restart in [#58](https://github.com/OpenCoven/open-sesame/issues/58) replaces those with one Tauri 2 application and a Rust core that owns the request gate ([#67](https://github.com/OpenCoven/open-sesame/issues/67)), sign-in logic ([#69](https://github.com/OpenCoven/open-sesame/issues/69)) and storage ([#75](https://github.com/OpenCoven/open-sesame/issues/75)). ADR 001 itself listed Tauri 2 as the option to reconsider if a Rust core needed direct embedding, which is now the case. The options, evidence and sources are in the [decision brief on #35](https://github.com/OpenCoven/open-sesame/issues/35#issuecomment-6818595768).

## Decision

iPhone and iPad are an iOS target of the same Tauri 2 application as the desktop. The core crate, the request gate, storage and sign-in logic are used directly, not through a binding layer and not reimplemented. Swift is written only inside one first-party Tauri mobile plugin, for the system authentication session, the Keychain and any other native API the app needs. The rendering engine does not change: Tauri uses WKWebView on iOS.

The first deployment minimums stay iOS 18.0 and iPadOS 18.0, with iPhone and iPad in one application. Android stays deferred with no minimum chosen; this decision selects nothing for it.

## Condition and fallback

[#38](https://github.com/OpenCoven/open-sesame/issues/38) starts with a spike that builds the walking skeleton for the iOS simulator on the current Xcode and proves three things: navigation away from bundled assets is blocked, only the main frame of the owned webview reaches the gate, and a credential survives a Keychain round trip. If the spike fails, #38 stops and reports, and the fallback is the host in ADR 001. The spike is evidence about a simulator build, not about a device.

Mobile work starts after the desktop walking skeleton passes its smoke pass in [#78](https://github.com/OpenCoven/open-sesame/issues/78), because it reuses the core that milestone proves.

## Requirements kept from ADR 001

Each line is a requirement on the implementation, not a claim that it is met.

| Requirement | How it applies under this ADR |
| --- | --- |
| One renderer and one workspace model, with no second item, Focus or identity database | The UI shell from the desktop restart is the renderer; the core's storage is the only persistence owner. |
| Bundled, reviewed assets only, loaded offline, with fonts and licences | Assets ship in the app bundle; no remote replacement for bundled UI and no downloaded executable plugins. |
| Unexpected navigation is blocked; provider pages open in the system browser | Enforced by the host's navigation handler, with a test for new-window requests. |
| Every request is checked for the owned webview, main frame, bundled origin, session, method and parameters | The core gate plus Tauri capabilities; proven by tests translated from the receiver cases in pull request #54. A native flag set by a caller grants nothing. |
| No development socket, generic RPC proxy or forwarded CLI arguments | Desktop-only methods (terminals, SSH, agent processes, CLIs, familiars) return the not-available-on-this-OS message. |
| Durable storage with acknowledged writes; saved state is shown only after acknowledgement; webview storage is not the durability contract | Provided by the core's SQLite from #75 in the app container. |
| Credentials only in native protected storage, never in the renderer, URLs or logs; public-client PKCE with a verified session | The Keychain through the Swift plugin; sign-in logic from #69. A callback registration for the mobile bundle is not presumed and is an owner action. |
| Suspension, scene disconnection, web content process termination and device restart are normal recovery paths; an interrupted request is uncertain, not retried automatically | Handled in #38 with tests for suspension and content process termination; drafts are kept on each edit, not only at backgrounding. |
| Focus is recomputed from stored start, deadline and pause times | Implemented in [#39](https://github.com/OpenCoven/open-sesame/issues/39). |
| One writable scene unless writes are revision-aware | A single window until concurrent editing is separately reviewed. |
| No permission prompt merely from launch; notifications, push and background modes need their own review | Unchanged. |
| Accessibility is qualified on a real iPhone and iPad, not inferred from WKWebView | Qualified in [#44](https://github.com/OpenCoven/open-sesame/issues/44). |
| App Review Guidelines 2.5.2, 2.5.6 and minimum functionality are assessed before store preparation; signing, entitlements, privacy declarations and submission need separate authority | Gates of [#45](https://github.com/OpenCoven/open-sesame/issues/45). |

## What no longer applies from ADR 001

- The thin Swift UIKit host as the selected host. It remains the fallback if the spike fails.
- Offline access only while a verified session is unexpired: this policy now follows the sign-in decision in [#60](https://github.com/OpenCoven/open-sesame/issues/60).
- The companion transport, pairing and connected-familiars milestone: #42 and #43 are closed as not planned, and familiars show as unavailable on mobile.
- Dependence on the vendored WorkOS Swift SDK for the mobile build. The sign-in work in #69 still checks the WorkOS endpoints against that source.

## Pull request #54

[Pull request #54](https://github.com/OpenCoven/open-sesame/pull/54) implements the ADR 001 host. Under this ADR its system-browser sign-in presentation, Keychain accessibility policy, continuous-time session clock, file export and import UI and its test cases are candidates for reuse inside the Swift plugin, with attribution. Its scene controller, receiver, `WorkspaceStore`, project definition and preparation script are replaced by Tauri and by #75. The owner decides what happens to the pull request itself.

## Known risks

These were found while preparing the decision and were not tested: there is no official Tauri plugin for the system authentication session or the Keychain; [tauri issue 15066](https://github.com/tauri-apps/tauri/issues/15066) reports an iOS build failure with Xcode 26; scene state restoration is not covered by Tauri's documented lifecycle support; App Store review of a Tauri app has not been tested for this project; and the gate rule in the restart design that trusts the window labelled `main` has to be shown to exclude subframes on iOS.

## Verification scope

This change is documentation only. `npm run check:docs` checks its local links. No mobile build, simulator run, installed device, real sign-in or store submission has been executed by writing this ADR; that evidence belongs to #38, #44 and #45.
