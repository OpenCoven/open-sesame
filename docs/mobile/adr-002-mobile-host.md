# ADR 002: Tauri 2 iOS target for iPhone and iPad

Status: **Decided by Val on 12 November 2026 in [#35](https://github.com/OpenCoven/open-sesame/issues/35); supersedes the host choice in [ADR 001](adr-001-mobile-host.md).** Nothing in this document has been compiled or run. It authorises no store submission, Apple enrolment, WorkOS change, release or spending.

## Decision

The iPhone and iPad app is a Tauri 2 iOS target of the same application as the desktop restart ([design](../superpowers/specs/2026-11-12-tauri-cross-platform-design.md)). It shares the Rust core, the request gate, storage and the sign-in logic with the desktop. Swift is used only inside a first-party Tauri mobile plugin where native APIs are needed: the system authentication session and the Keychain.

ADR 001 chose a thin Swift and WKWebView host and listed Tauri 2 as the option to reconsider if a Rust core needed direct embedding. The desktop restart makes that the case. Both hosts render in WKWebView on iOS, so the rendering engine does not change.

## Condition: spike first, with a return to ADR 001

[#38](https://github.com/OpenCoven/open-sesame/issues/38) starts with a short spike that builds the desktop walking skeleton for the iOS simulator on the current Xcode and proves three things: navigation away from the bundled assets is blocked, only the main frame of the app's own webview can reach the request gate, and a credential survives a Keychain round trip. If the spike fails, the decision returns to the ADR 001 Swift host and goes back to the owner, in a comment on #38, before more host work is done.

Known risks the spike exists to test, as checked on 12 November 2026: Tauri has no official plugin for the system authentication session or the Keychain; [tauri issue 15066](https://github.com/tauri-apps/tauri/issues/15066) (iOS build failure with Xcode 26) is open; scene state restoration is not covered by Tauri's lifecycle events; and no App Store review of a Tauri app has been tested for this project. The evidence is in the [decision brief](https://github.com/OpenCoven/open-sesame/issues/35#issuecomment-6818595768).

## Requirements kept from ADR 001

These still apply and are acceptance requirements for #38, #39, #44 and #45.

- The first deployment minimums are iOS 18.0 and iPadOS 18.0, with iPhone and iPad in one application.
- One renderer and one workspace model, with no second mobile database. Which renderer is decided in #61.
- Only bundled, reviewed assets are loaded, offline, with no web root beyond the asset directory and no remote replacement for bundled UI.
- Unexpected navigation is blocked. Provider pages open in the system browser, never in the document that can reach the gate.
- Every request is checked for the owned webview, main frame, origin, session state, method and parameters. Tauri has no per-document nonce, so this is proven by test against the core gate and the capability configuration.
- No development socket, generic RPC proxy or forwarded CLI arguments. Desktop-only methods return the not-available message.
- One self-contained package. App Review Guidelines 2.5.2, 2.5.6 and 4.2 are assessed before any store work.
- Storage is durable and acknowledged beneath the existing models, and the app hydrates before any default is written. The core's storage in #75 delivers this.
- Credentials live only in native protected storage outside JavaScript. Sign-in uses PKCE and a verified session. An existing callback registration is not presumed valid for the mobile bundle; registering one is an owner action.
- Suspension, scene disconnection, web content process termination and restart are normal recovery paths that keep drafts and never report interrupted work as completed.
- Focus state is recomputed from stored times after suspension or clock changes.
- One writable scene, unless writes become revision-aware.
- Accessibility is qualified on a real iPhone and iPad, not inferred from WKWebView.
- Android stays deferred, with no minimum version chosen.

## Requirements changed or dropped

- Offline access with a verified, unexpired session now follows the decision in [#60](https://github.com/OpenCoven/open-sesame/issues/60) instead of ADR 001's own rule.
- The separate companion transport and pairing requirements no longer apply: #42 and #43 are closed as not planned.
- The thin Swift, UIKit and WKWebView host, its XcodeGen project and its Swift receiver are not built, unless the spike returns the decision to ADR 001.

## Pull request #54

[Pull request #54](https://github.com/OpenCoven/open-sesame/pull/54) contains a Swift host and storage written under ADR 001. Under this decision its system-browser sign-in presentation, Keychain service and session clock may be reused inside the Swift plugin with attribution, and its boundary, lifecycle and storage tests become the list of cases to translate. Its host, generation store and project files are not reused. What happens to the pull request itself is the owner's decision.
