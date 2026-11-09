# Current capability and acceptance matrix

This matrix distinguishes implemented surfaces from evidence of operation. Consult [work-tracking.md](work-tracking.md) for exact source and check receipts. Historical browser reviews do not establish native or physical-device acceptance.

| Surface | Implementation | Current acceptance boundary |
| --- | --- | --- |
| Browser widget / local preview | Authored HTML/CSS/JavaScript and browser fallbacks; local HTTP serves sign-in and downloads with machine operations disabled. | Automated widget/model checks; authenticated native operation and fresh visual/device review are separate. |
| macOS companion | AppKit/WKWebView, WorkOS-gated native tools, Keychain sessions, dialogs/window behavior, and Python stdio bridge. | Compilation, signature, and plist checks; GUI runtime is blocked on this host. |
| Protected Share | Explicit native video-only ScreenCaptureKit stream excluding this process, rendered in a window for Google Meet's window sharing; start/stop/cancel/display-change lifecycle and bounded frame queue. | Synthetic native frame/policy/lifecycle and renderer checks; actual Screen Recording permission, filtered output and Meet recipient preview remain device/provider acceptance gates. Entire-display capture by another app is not controlled. See [setup](protected-share.md). |
| Local terminal / SSH | Real POSIX PTY and system shell/OpenSSH, resize/input/cleanup, origin validation in loopback preview. | Local real-PTY integration checks; actual remote SSH authentication is separate. |
| Feeds / reading | Bounded HTTP retrieval and reader helpers; browser CORS fallback. | Local HTTP integration fixtures; publisher/network behavior varies. |
| Coven Familiars | Installed CLI transport in the authenticated native host, familiar discovery, canonical workspace avatar loading/explicit editing, persistent per-familiar conversations identified as Open Sesame, supported local/Coven slash commands, streaming, and cancellation; static hosted pages require a desktop connection. | Isolated CLI fixture-process checks; real provider inference and native GUI chat remain separate. See the [integration contract](coven-familiars-integration.md). |
| Claude Code / Codex Live | Executable discovery and subprocess transcript-answer adapters. | CLI fixtures only; real sign-in, provider response, and cancellation need a dedicated task. |
| Music providers / YouTube | Embeds, native Spotify system-browser PKCE, and optional HTTPS-browser Apple/Google account adapters; setup distinguishes account access from player sessions. | Native Spotify PKCE/callback checks pass with synthetic data; client registration, live authorization, account-backed actions and playback require provider/device qualification. See [native setup](desktop-polish-v0.0.10.md#spotify-in-the-installed-mac-app). |
| Voice / live audio | Explicit capture controls, native ScreenCaptureKit system/mixed audio, AAC recording and native/browser speech paths. | Synthetic PCM/mixing and capability checks; actual microphone/system sound, speech-service, permission prompts and exported fidelity require a usable GUI/device. See [native capture](system-audio-and-media.md). |
| Agent monitor | Recognized current-user process discovery, contextual Pause/Resume and confirmed SIGTERM Stop, with fresh identity and short-lived capability checks. | Tests mock signals and cover ownership, expiry, PID reuse, stale confirmations and privacy. Live user process control remains separate; OS state is not task/approval progress. |
| Remote desktops / message controllers | Supplied web VNC viewers; opt-in BlueBubbles/Photon adapters. | External gateways and live providers require their own explicit setup and acceptance. |
| Windows / Linux desktop | No qualified packaged host. | Portable tests do not establish desktop support. |

Items/settings are local to the device. Account sync, system reminders and native notifications are not qualified features. Protected Share readiness means filtered video reached its output window; it does not establish that a meeting app is sharing that window or exclude Open Sesame from another app's entire-display capture. Never display a protective or connected state based solely on a preview, executable presence, or successful compilation.

## Built-in remote desktops

Console → Desktops supports direct VNC host/port connections in the authenticated Mac app, secure `wss://` RFB gateways in Mac and browser, and existing HTTPS web viewers. The native bridge opens only explicitly requested sessions from the bundled main document; it does not expose a network listener. Ordinary direct TCP does not encrypt the desktop stream; use a trusted network or an independently secured transport. Tailnet and Local labels do not discover machines or establish network access.

Connect explicitly, enter credentials when requested, and optionally remember them in macOS Keychain. Browser credentials stay in memory. Sessions offer fit/actual size, view-only, fullscreen, Ctrl-Alt-Del, manual text clipboard transfer, disconnect and reconnect. Up to four built-in connections can remain open while switching tools. Logout, reload and exit close them. Existing HTTPS viewer pages retain their separate authentication and cannot report an RFB handshake to Open Sesame.

Real installed-app, macOS Screen Sharing, standard VNC server and secure gateway acceptance remains pending; local transport and controller tests alone do not establish interoperability.

Reusable declarative tools provide local import, fixture preview, expandable/pinned collection cards, launcher navigation and explicit approved actions. GitHub summaries use existing connected repositories; feed headlines use saved Reader data. See [tool creation and submissions](tools.md). Automated contract/UI tests and native compilation do not establish rendered layout or live-provider acceptance.
