# Desktop priorities

Updated November 8, 2026. Use the [work ledger](work-tracking.md) for executed results and the [capability matrix](capabilities.md) for present support. The [initial review](archive/2026-11-06-initial-polish-plan.md) preserves the original findings and integration research as historical context.

| Order | Bounded objective | Acceptance |
| --- | --- | --- |
| Current | Reliable Mac development and agent workflow | Bounded full verification, reproducible source package, Mac build/signature/plist, observed GUI shell/collapse/reopen/quit, tested retirement guards, and explicit cleanup dispositions. |
| Next | Everyday widget polish | Review one surface per change across compact/expanded/floating/Full states; no clipped primary controls or lost drafts/sessions; keyboard/Escape, contrast, and reduced-motion/transparency evidence. |
| Later | One real provider integration | Choose one provider; verify connect → useful action → disconnect and denied/expired/cancelled recovery. Executable detection and account identity do not imply functional readiness. |
| Later | Small portability experiment | Measure one screen, terminal, tray/pinning, file dialog, and permission denial on a chosen target; record actual platform limits before selecting a host. |

The current work fixes a reproduced macOS PTY shutdown deadlock, retains real terminal assertions, and adds one verification entry point plus local ownership and guarded retirement. Native runtime acceptance remains a separate gate when the host cannot provide a GUI session. New integrations and UI expansion should wait for this baseline.

Keep follow-ups small and evidence-backed. Native OAuth callbacks, live Coven provider/device acceptance, live CLI authorization/cancellation, calendar export, remote-viewer diagnostics, message-provider compatibility, and Windows/Linux hosts remain deferred. Each future task must define its useful action, error recovery, data boundary, and acceptance evidence before implementation. Cross-platform adapters and moving authored `dist/` files require their own design and reproducible source build.

## Widget input and capture patch

See [widget input and Live audio](widget-input-capture.md) for the implemented v0.0.1 behavior, capability limits, and device acceptance still required.

## Delivered Coven integration

Coven Familiars now has native CLI discovery, per-familiar conversations/drafts, streaming, and Stop. See the [integration happy path](coven-familiars-integration.md) for its contract and fixture evidence. Real provider inference and device chat acceptance remain separate follow-up work after the development baseline.

## Plugin setup and private configuration

Each plugin now includes three setup steps, an explanation of access, and an If it does not connect disclosure. Provider setup links are available for all account-based media plugins. Installation detection remains separate from authenticated provider acceptance; no automatic test message or account authorization is performed.

| Plugin | Current happy path | Repair when setup fails |
| --- | --- | --- |
| Coven Familiars | Install/configure Coven locally, then Console → Familiars → Connect Coven → choose → explicitly Send. | Check the CLI, engine, roster, and dedicated familiar workspace in the terminal; reconnect after fixing them. Provider credentials stay with Coven. |
| Claude Code / Codex | Install the official CLI, sign in through it, reopen Open Sesame, refresh Plugins, then select it in Live and explicitly ask about a transcript. | CLI detected means the executable exists. Resolve CLI sign-in and PATH in the terminal; do not paste model keys into the plugin. |
| Spotify | Open a link in Focus for playback. Account access uses a public client ID; the installed Mac app starts native PKCE and registers `opensesame-spotify://auth/callback`. HTTPS browsers use the exact displayed web redirect. | Register the matching client and redirect in Spotify, check provider test-user access, and keep embedded playback qualification separate. See [native setup](desktop-polish-v0.0.10.md#spotify-in-the-installed-mac-app). |
| YouTube | Play a video/playlist link without connecting. Optional browser account access uses a Google web OAuth client with YouTube Data API v3 enabled and the displayed JavaScript origin registered. | Check the exact scheme/host/port, consent and test-user access, popup permission, and read-only YouTube consent. This consumer reads channel identity; playlist import is not implemented. |
| Apple Music | Open links in Focus. For browser MusicKit account playback, use a session developer JWT issued by your own server, then authorize the account. | Request a fresh, short-lived token for the browser origin; check signing configuration, expiry, and account eligibility. A signing key is never an input to Open Sesame. |
| RSS / Atom | Reader → Add → Feed or Website → follow a public, credential-free URL → refresh. | Check published RSS/Atom or Website discovery. Use the desktop companion when the browser cannot fetch across origins. |

The native file-based host now implements a dedicated Spotify system-browser PKCE return path, with tokens held in native memory. Apple Music and Google still require their existing HTTPS browser account flows. Link playback and embedded player sessions remain separate from connecting an account. The same account panel is available through Focus and Plugins; never paste a client secret or signing key.

To finish native account integrations, implement a host-owned system-browser authorization session with a verified provider-compatible callback, state binding, cancellation, and PKCE where supported. Keep persistent credentials in native secure storage and return connection metadata to the renderer. Do not embed Google authorization inside WKWebView. Apple provides [ASWebAuthenticationSession](https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession), and Google's [native OAuth guidance](https://developers.google.com/identity/protocols/oauth2/native-app#disallowed_useragent) describes the embedded-user-agent restriction. For Apple Music, evaluate native MusicKit and automatic developer-token management separately from the existing browser adapter; the browser adapter still requires a server-issued token. See [Apple developer-token guidance](https://developer.apple.com/documentation/AppleMusicAPI/generating-developer-tokens).

Only public Spotify/Google client IDs may persist in application settings or the public configuration template. Client IDs and client secrets can look similar; format validation alone cannot identify a mistakenly pasted secret. Confirm the provider field label before entering a value. Apple developer JWTs use a masked field that clears after saving, closing, or switching providers. The app uses its saved developer JWT in memory for the current tab and drops its reference on disconnect; a provider SDK can retain its own in-memory state. OAuth access tokens are not written to app settings. Spotify's temporary PKCE verifier/state stay in session storage until callback processing or tab closure. Callback parameters are removed from the page URL before validating stale or unsolicited returns. Expiry/origin checks are input checks; Apple remains responsible for cryptographic token verification.

Never put passwords, client secrets, access/refresh tokens, developer JWTs, .p8/private keys, credential-bearing URLs, or CLI auth files in source, dist, issues, screenshots, or shared reports. The source packer excludes private configuration/key filenames, and native/source builds reject such files in web assets, private-key markers, external symlinks, and nonpublic fields in the bundled music configuration. These focused checks do not replace reviewing a release diff or prove that arbitrary secrets cannot appear in other file contents. If a credential has already been shared, revoke or rotate it with its issuer before cleaning up copies; deleting a file does not invalidate that credential.

For a support report, share only the plugin name, Open Sesame version, host type (Mac / HTTPS browser / local HTTP preview), the connection-state label, and a fixed public error message. Exclude account names, transcripts, callback URLs, request headers, session storage, SDK error objects, CLI auth files, and configuration values. The application maps unexpected account SDK errors to a fixed public message rather than displaying raw diagnostics. No real credential values were used in this patch's tests or notes.

## Flat dark UI polish

The widget now uses a fixed, opaque charcoal base (`#101113`) with matching native and web surfaces. The native visual-effect view, glass RPC, opacity gestures, their JavaScript/model/CSS, view fades, and animated edge effects have been removed. Saved legacy opacity values are no longer read. The 16:9 geometry, resize-to-collapse and outside-click behavior, speech entry, and existing sessions keep their current contracts. The final palette is owned by `dist/flat-theme.css`.

| Improvement | Implemented behavior | Verification |
| --- | --- | --- |
| Clearer navigation and selection | Primary tabs, secondary tabs, Reader rows, shells, remote sessions, and familiars use solid selection surfaces, a restrained leading marker, and consistent hover states. | Shipped selectors include Reader's actual `aria-current` state; existing navigation and frame checks remain required. |
| Readable text hierarchy | Primary text, metadata, labels, and placeholders use a smaller shared palette. Metadata has a consistent 10px base size and line height. | Primary, secondary, and muted text colors meet a computed 4.5:1 minimum against all five opaque palette surfaces; this is palette evidence, not a complete accessibility audit. |
| Consistent compact controls and menus | Cards, forms, menus, popovers, pagination, and action rows use solid fills, restrained borders, and shared corner sizes. Main actions retain one quiet accent. | Theme/source checks cover the final palette ownership and absence of decorative button gradients; existing Live, plugin, Reader, and shell behavior checks remain required. |
| Quiet, accessible feedback | A static dot replaces the animated edge. Buttons, links, selects and tabs keep a visible keyboard focus outline; text inputs keep a quiet border and visible caret, with an input indicator in forced-color mode. Disabled controls use a steady color and views do not fade. | Simulated state checks cover focus/process/microphone priority, retained preference, preview expiry and status announcements. Reduced-motion and forced-color hooks remain. |

The compact indicator reflects observed state only; it does not claim task progress or approval status. Native compilation and signed packaging are separate from visual/device acceptance. The computer-use service remained unavailable during this pass, so the new rendered surfaces, OS title bar, focus appearance, and contrast of every inherited component have not been accepted on hardware. No provider request or account authorization is needed to exercise this appearance change.

## Native previews and Console follow-up

The shared WKWebView positioning now respects the parent view's top-down coordinates. A clipped native viewport keeps YouTube and both bookmark surfaces inside their DOM content area, preserving the original page dimensions during clipping. Search bars, tabs and app dialogs retain their space. Native geometry checks cover both coordinate systems, ancestor clipping, window bounds and invalid inputs. Installed visual verification remains open because native/browser automation and the isolated WebKit rendering probe were unavailable.

Focus opens directly into Music, Timer, YouTube and Media tabs using Console's shared toolbar style; its former overview and duplicate controls have been removed. Familiars, Shells and Machines declare vertical tabs and share the same rail frame, width, 30 CSS px row height, padding, selection treatment and scroll behavior. Icon identifiers fall back to a real app glyph. Long familiar names ellipsize without a horizontal scrollbar.

Processes now uses neutral solid cards, a concise empty state and real process snapshots; Try demo and warm/red decorative trim have been removed. Search, state filters, Clear filters and Refresh retain the last snapshot and scroll position. Stale responses cannot reconnect a disconnected host. Familiars has distinct disconnected, roster-ready, new-conversation, searching and replying states. New chat clears stale history search; stopped replies are a status; late conversation loads cannot replace the current selection. Simulated-host checks cover these actions without sending real prompts or modifying familiar workspaces.

The application now also requires [WorkOS login](workos-login.md). Callback and sign-out URLs were saved and read back for the existing OpenSesame production environment. The Initiate login setting and real installed browser/Keychain flow remain explicit acceptance items in that guide.

The [v0.0.10 interface and native account guide](desktop-polish-v0.0.10.md) records Projects collection tabs, compact shell project context, fitted quick search, native Spotify setup and explicit agent process controls. Its installed/provider acceptance limits remain distinct from automated checks.
