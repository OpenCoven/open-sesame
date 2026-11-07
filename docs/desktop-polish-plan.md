# Desktop widget polish and compatibility plan

Reviewed November 6, 2026. Scope: the current local checkout, desktop launch, existing checks, and official platform/provider documentation. This is a plan for further implementation; account connections and Windows/Linux desktop builds were not performed.

Recommended order: make the Mac development loop dependable, polish the everyday widget flows, then connect providers and run a small cross-platform experiment. Preserve the existing web UI and native bridge while testing those decisions.

### Open Sesame rename follow-up

The application has now been renamed across the UI, native host/executable, bridge APIs and events, storage keys, exports/downloads, scripts, and documentation. Legacy names remain only for browser-data migration, controller command/receipt compatibility, and the stable installed bundle identifier. The source download is generated reproducibly with `npm run build:desktop-source` and refreshed by `npm run dev`.

The three stale check fixtures identified below have been repaired against the current glass, recognition, rail, and transcript-stop behavior. A rejected native speech-start request now releases controls immediately. All 20 JavaScript check scripts and syntax checks pass through `npm run check`; the Mac app builds and passes signature verification. Full PTY and GUI/device acceptance remain open. The initial review observations below are retained as a dated baseline.

## Codebase map

| Area | Current responsibility |
| --- | --- |
| `dist/` | Authored, buildless widget UI, models, styles, bundled libraries, and browser fallbacks. Despite the directory name, much of this is application source. |
| `desktop/OpenSesame.swift`, `VoiceInput.swift` | AppKit panel, menu bar, WKWebView, native dialogs, window behavior, and microphone/speech entry. |
| `desktop/bridge.py` and helper modules | Stdio RPC, POSIX PTYs/SSH, feeds/reader retrieval, CLI transcript answers, process discovery, optional message controller, and Mac controls. |
| `desktop/dev_server.py` | Loopback web preview with a same-origin WebSocket connection to the local bridge. |
| `scripts/check-*.mjs`, `desktop/tests/` | JavaScript model/simulated-DOM checks and Python unit/integration checks. |
| `vendor-src/`, `dist/vendor/` | Upstream sources and bundled browser dependencies. |

## Findings that determine priority

1. **Native build blocker fixed in this review.** The build compiles two Swift files, but `OpenSesame.swift` used executable top-level statements. An explicit `@main` launcher now compiles, retains the app delegate throughout the run loop, and produces an ad hoc signed arm64 app. Native runtime acceptance remains open because launch failed in this session.
2. **The verification baseline needs repair.** Sixteen of nineteen JavaScript check scripts pass. `check-glass.mjs:26` sends an unmodified hold while `dist/glass.js` now requires Alt for pointer-based glass adjustment; `check-live.mjs:32` uses an Element fixture without `getAttribute`; `check-workspace-interactions.mjs:9` invokes the updated rail layout with an obsolete fixture and no `getComputedStyle`. Update the fixtures to the intended behavior, retaining their assertions. Existing README claims of all checks passing are stale.
3. **Desktop authorization is incomplete.** `dist/music-auth-config.js` ships empty public client IDs. Spotify authentication in `dist/music-auth.js` explicitly requires HTTPS, while the native host loads `file://` assets. Google authorization uses the web popup flow, but the native host opens new HTTP(S) windows externally without an app callback. These are missing desktop authorization paths, beyond supplying client IDs.
4. **Some integrations exist only in a narrow form.** `dist/coven-chat.js` supplies mock conversation turns even though `desktop/live_agents.py` can answer transcript questions through Claude Code/Codex subprocesses. Spotify/YouTube account authorization currently obtains profile/channel identity; it does not import libraries or playlists through those access tokens. The Focus calendar is device-local. Desktops accepts a supplied web VNC viewer; it does not discover machines or create a VNC gateway.
5. **Platform and source boundaries need clearer organization.** `dist/bridge.js` mainly exposes one availability flag. The Python bridge imports Unix PTY modules at module load; Mac controls invoke Apple tools; speech/window code is Swift/AppKit. Windows cannot run this backend unchanged. Numerous global scripts and layered CSS overrides in `dist/index.html` also make UI changes sensitive to load order. Most application files are currently untracked; preserve this work and establish what belongs in source versus generated output before reorganizing it.

## A simple delivery sequence

| Step | Work | Finish line |
| --- | --- | --- |
| 1. Reliable development baseline | Keep the startup fix; repair the three JavaScript fixtures; diagnose the full PTY-suite stall on a usable host; add one documented check command and Mac build CI; reconcile setup docs with current mock/live behavior. | A clean checkout builds; every check has a reproducible result; a Mac user can launch, open a shell, close/reopen the widget, and quit without orphaned sessions. |
| 2. Widget polish | Review compact, expanded, floating, and Full states; unify spacing, typography, icon labels, toolbars, menus, and empty/loading/error states; keep studio settings secondary. Resolve hold-to-speak versus Alt-hold glass discoverability. Check keyboard focus/Escape, readable contrast, reduced motion/transparency, small displays, display scaling, multiple monitors, Spaces, sleep/wake, and external media failures. | Capture a note/task, start a focus session, open a shell, read an article, and play media in one consistent interface. No clipped primary controls or lost drafts/sessions when resizing or docking. Record screenshots and observed device behavior separately from simulated tests. |
| 3. Integration and portability proof | Add explicit capabilities to the bridge; complete one real integration at a time from the matrix below; compare a minimal Windows/Linux shell using the existing UI and RPC contract. | One provider completes connect → useful action → disconnect/error recovery on Mac. A separate compatibility report records measured Windows/Linux behavior and a justified shell decision. |

Keep follow-up work small: one UI surface, provider, or platform experiment per change, with its acceptance evidence beside it. The first next task should be Step 1; avoid expanding the feature set until the baseline is reproducible.

## Missing integrations and how to approach them

The Plugins catalog currently lists Spotify, Apple Music, YouTube, Claude Code, Codex, and RSS/Atom. Use it as the visible integration directory, and give each integration separate setup, authorization, and functional-readiness states. A detected CLI or an authorized account should not imply that a requested action works.

| Priority | Integration | Present today | Next bounded implementation and acceptance |
| --- | --- | --- | --- |
| First | Spotify | Embedded player, PKCE/profile authorization for configured HTTPS pages; no native callback. | Add native external-browser PKCE with a short-lived loopback callback, state verification, cancellation, and timeout. Start with existing profile access and playback. Verify identity and a playable link independently; add library scopes only for a concrete library feature. |
| First | Coven Familiars | Native CLI discovery, familiar picker, per-familiar conversations/drafts, streaming and Stop; fixture acceptance plus real local roster discovery. | Complete a device/provider chat smoke using an explicitly sent message. See the [integration happy path](coven-familiars-integration.md) and runnable example. |
| Next | Claude Code / Codex Live | Executable discovery and noninteractive transcript Q&A adapters; current tests use CLI fixtures. | Check supported CLI versions/flags and sign-in status without treating executable presence as authorization. Add cancellation and actionable failures. Verify one real request for each provider using a deliberately supplied test transcript. |
| Next | Google / YouTube | Link playback, player-derived queues, web OAuth and channel lookup; no authenticated playlist-library UI. | Use an installed-app authorization flow through the system browser with a callback. First verify account identity; then add read-only playlist listing if needed. Keep public-link playback usable without login. |
| Next | Apple Music | Embeds plus a MusicKit authorization/playback path; a developer JWT is supplied manually in memory. | Decide ownership of developer-token signing/renewal, keep the signing key out of the client, and validate MusicKit in the Mac web view. Test authorization denial, expiry, subscription eligibility, and a real queued track. |
| Later | Calendar / reminders | Local Focus scheduling; no external account or native calendar bridge. | Begin with explicit one-way calendar export; explore EventKit on Mac or Google/Microsoft adapters only after choosing the desired calendar. Verify timezone/DST and duplicate handling before bidirectional sync. |
| Later | Remote desktops | Saved HTTPS web-viewer URLs, usually a supplied noVNC gateway. | Improve setup diagnostics and show why a viewer cannot embed or connect. Validate against a configured test gateway. Treat machine discovery, tailnet integration, and raw VNC transport as separate future features. |
| Later | BlueBubbles / Photon | Opt-in receiver, deduplication/command handling, and a separate Photon adapter. | Follow `desktop/controller-setup.md`; verify provider payload/version compatibility, sender/chat restrictions, reconnect, and result handling in a dedicated test conversation before live use. |

RSS/Atom and public article retrieval already have real local helpers and tests; prioritize offline/error polish there. Notifications are currently inside the widget, screen-share exclusion is unimplemented, and items/settings have no account sync. Track native notifications, tested capture privacy, and data export/sync as separate product decisions.

Spotify permits HTTP callbacks for explicit loopback IP addresses such as `127.0.0.1`, with specific registration rules; `localhost` is not supported. Google documents restrictions on embedded user agents. These support exploring system-browser desktop authorization instead of reusing the current file-page web flow. [Spotify redirect requirements](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri), [Google desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app).

## Cross-platform exploration

Add a versioned `system.capabilities` response with explicit flags for PTY, folder/save dialogs, native speech, microphone/display audio, computer controls, agent discovery, tray/pinning, and capture privacy. Gate each action by the capability it requires. Separate shared request validation/business logic from platform adapters so an unsupported terminal implementation does not prevent feeds or other portable services from loading.

| Target | Reuse | Main work or uncertainty |
| --- | --- | --- |
| macOS | Existing AppKit/WKWebView host and Python bridge. | Establish a real GUI smoke pass, notch/safe-area and monitor behavior, permission recovery, helper packaging, and supported OS/Python versions. Build arm64/x86_64 separately before claiming both. |
| Windows | Existing HTML/CSS/models and RPC contracts. | Add a host, ConPTY-backed terminal adapter, process discovery, dialogs, tray, credentials, and packaging. Avoid assuming POSIX shells, paths, process groups, or signals. |
| Linux | Existing UI and much of the POSIX bridge, subject to tests. | Add desktop hosting/packaging; test X11 and Wayland separately for tray, always-on-top, display capture, speech, and window placement. |
| Browser | Existing preview and feature fallbacks. | Verify Chromium, Safari, and Firefox for clipboard, media, speech, file selection, pop-out, and responsive behavior. Keep a clear capability explanation wherever native services are unavailable. |

Time-box the shell comparison to one screen, one local terminal, tray/pin behavior, one file dialog, and permission-denied media behavior. Start with Tauri as the system-webview candidate and Electron as the Chromium candidate; preserve the current Mac host during the experiment. Tauri uses WebView2 on Windows, WKWebView on Mac, and WebKitGTK on Linux; Electron uses a Chromium process model with a Node main process. This means neither option removes the need for native capability work. Compare idle/active memory, startup, installed size, rendering, terminal behavior, and maintenance effort before selecting a framework. [Tauri webviews](https://v2.tauri.app/reference/webview-versions/), [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model).

## Organization to establish incrementally

- Keep the root README as a short introduction and command index; move historical validation notes to a dated archive and maintain one current capability/support matrix.
- Keep this plan as the priority index, with integration setup and platform decisions linked from it. Distinguish code implemented, local checks passed, and device acceptance completed.
- Introduce a shared bridge contract and feature folders as files are touched. Consolidate style tokens and overlapping layout overrides gradually; move authored `dist/` files to a source directory only after a reproducible asset build exists.
- Define source, vendored inputs, and generated outputs explicitly. Add intentional ignore rules for build products, caches, and `.DS_Store`; review the existing untracked files before staging anything. Add a dependency manifest/lockfile wherever optional adapters become supported features.

## Development run and verification from this review

```sh
npm run dev          # Loopback preview: http://127.0.0.1:4173
npm run dev:macos    # Compile, sign for local development, and open Open Sesame.app
python3 -m unittest discover -s desktop/tests -v
```

- **Running:** the loopback development server on port 4173. The index and all 108 referenced local script/style assets returned HTTP 200; the development bridge flag is present. Visual rendering was not verified because browser/computer access was unavailable.
- **Built:** `build/Open Sesame.app`, arm64, targeting macOS 13+, using the configured Python 3.15.1 interpreter. Signature verification and plist validation passed. The compiler reports two existing `allowedFileTypes` deprecation warnings.
- **Native launch blocked:** `open` returned Launch Services error `-10827` despite the executable being present; direct executable startup aborted with exit 134 and no diagnostic output. Computer-use service startup also failed. These observations do not establish a native runtime pass or a definitive cause.
- **JavaScript:** all top-level widget JavaScript passed syntax checks; 16/19 existing check scripts passed, with the three failures described above. The frame script exercised 720 render combinations using simulated DOM state.
- **Python:** 22 bounded checks passed across agent monitoring, allowlisted computer controls, local controller authorization/queue behavior, feed retrieval, and fixture CLI adapters. This is not live provider acceptance. The complete discovery run stalled in its first real PTY launcher test and was stopped; terminal acceptance remains open.
- **Changes made for this review:** the explicit Swift entry point, the `dev:macos` shortcut, and links to this plan. Existing application work was preserved. No commit, push, deployment, account authorization, or provider message was performed.

## Widget input and capture patch

See [widget input and Live audio](widget-input-capture.md) for the implemented v0.0.1 behavior, capability limits, and device acceptance still required.

## Plugin setup and private configuration

Each plugin now includes three setup steps, an explanation of access, and an If it does not connect disclosure. Provider setup links are available for all account-based media plugins. Installation detection remains separate from authenticated provider acceptance; no automatic test message or account authorization is performed.

| Plugin | Current happy path | Repair when setup fails |
| --- | --- | --- |
| Coven Familiars | Install/configure Coven locally, then Console → Familiars → Connect Coven → choose → explicitly Send. | Check the CLI, engine, roster, and dedicated familiar workspace in the terminal; reconnect after fixing them. Provider credentials stay with Coven. |
| Claude Code / Codex | Install the official CLI, sign in through it, reopen Open Sesame, refresh Plugins, then select it in Live and explicitly ask about a transcript. | CLI detected means the executable exists. Resolve CLI sign-in and PATH in the terminal; do not paste model keys into the plugin. |
| Spotify | Open a link in Focus for playback. Optional browser account access uses the public client ID and the exact registered redirect shown in App setup. | Use Open Sesame's HTTPS browser version, match the full redirect path and trailing slash, and check provider app access. This consumer uses PKCE without a client secret; account connection reads a profile and does not import a library or sign the embedded player in. |
| YouTube | Play a video/playlist link without connecting. Optional browser account access uses a Google web OAuth client with YouTube Data API v3 enabled and the displayed JavaScript origin registered. | Check the exact scheme/host/port, consent and test-user access, popup permission, and read-only YouTube consent. This consumer reads channel identity; playlist import is not implemented. |
| Apple Music | Open links in Focus. For browser MusicKit account playback, use a session developer JWT issued by your own server, then authorize the account. | Request a fresh, short-lived token for the browser origin; check signing configuration, expiry, and account eligibility. A signing key is never an input to Open Sesame. |
| RSS / Atom | Reader → Add → Feed or Website → follow a public, credential-free URL → refresh. | Check published RSS/Atom or Website discovery. Use the desktop companion when the browser cannot fetch across origins. |

The current native file-based host does not implement the browser OAuth return path. Music account setup therefore explains the HTTPS browser requirement instead of asking for credentials that cannot complete sign-in. Link playback remains separate. The same account flow is disabled in this consumer's HTTP development preview; this is the application's current support boundary, not a claim that every provider forbids loopback HTTP. Spotify documents an explicit loopback exception, with numeric loopback addresses and exact redirect matching. See [Spotify PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow), [Spotify redirects](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri), and [Google web authorization](https://developers.google.com/identity/oauth2/web/guides/overview).

To finish native account integrations, implement a host-owned system-browser authorization session with a verified provider-compatible callback, state binding, cancellation, and PKCE where supported. Keep persistent credentials in native secure storage and return connection metadata to the renderer. Do not embed Google authorization inside WKWebView. Apple provides [ASWebAuthenticationSession](https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession), and Google's [native OAuth guidance](https://developers.google.com/identity/protocols/oauth2/native-app#disallowed_useragent) describes the embedded-user-agent restriction. For Apple Music, evaluate native MusicKit and automatic developer-token management separately from the existing browser adapter; the browser adapter still requires a server-issued token. See [Apple developer-token guidance](https://developer.apple.com/documentation/AppleMusicAPI/generating-developer-tokens).

Only public Spotify/Google client IDs may persist in application settings or the public configuration template. Client IDs and client secrets can look similar; format validation alone cannot identify a mistakenly pasted secret. Confirm the provider field label before entering a value. Apple developer JWTs use a masked field that clears after saving, closing, or switching providers. The app uses its saved developer JWT in memory for the current tab and drops its reference on disconnect; a provider SDK can retain its own in-memory state. OAuth access tokens are not written to app settings. Spotify's temporary PKCE verifier/state stay in session storage until callback processing or tab closure. Callback parameters are removed from the page URL before validating stale or unsolicited returns. Expiry/origin checks are input checks; Apple remains responsible for cryptographic token verification.

Never put passwords, client secrets, access/refresh tokens, developer JWTs, .p8/private keys, credential-bearing URLs, or CLI auth files in source, dist, issues, screenshots, or shared reports. The source packer excludes private configuration/key filenames, and native/source builds reject such files in web assets, private-key markers, external symlinks, and nonpublic fields in the bundled music configuration. These focused checks do not replace reviewing a release diff or prove that arbitrary secrets cannot appear in other file contents. If a credential has already been shared, revoke or rotate it with its issuer before cleaning up copies; deleting a file does not invalidate that credential.

For a support report, share only the plugin name, Open Sesame version, host type (Mac / HTTPS browser / local HTTP preview), the connection-state label, and a fixed public error message. Exclude account names, transcripts, callback URLs, request headers, session storage, SDK error objects, CLI auth files, and configuration values. The application maps unexpected account SDK errors to a fixed public message rather than displaying raw diagnostics. No real credential values were used in this patch's tests or notes.
