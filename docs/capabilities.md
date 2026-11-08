# Current capability and acceptance matrix

This matrix distinguishes implemented surfaces from evidence of operation. Consult [work-tracking.md](work-tracking.md) for exact source and check receipts. Historical browser reviews do not establish native or physical-device acceptance.

| Surface | Implementation | Current acceptance boundary |
| --- | --- | --- |
| Browser widget / local preview | Authored HTML/CSS/JavaScript and browser fallbacks; local HTTP serves sign-in and downloads with machine operations disabled. | Automated widget/model checks; authenticated native operation and fresh visual/device review are separate. |
| macOS companion | AppKit/WKWebView, WorkOS-gated native tools, Keychain sessions, dialogs/window behavior, and Python stdio bridge. | Compilation, signature, and plist checks; GUI runtime is blocked on this host. |
| Local terminal / SSH | Real POSIX PTY and system shell/OpenSSH, resize/input/cleanup, origin validation in loopback preview. | Local real-PTY integration checks; actual remote SSH authentication is separate. |
| Feeds / reading | Bounded HTTP retrieval and reader helpers; browser CORS fallback. | Local HTTP integration fixtures; publisher/network behavior varies. |
| Coven Familiars | Installed CLI transport in the authenticated native host, familiar discovery, per-familiar conversations, streaming, and cancellation; static hosted pages require a desktop connection. | Isolated CLI fixture-process checks; real provider inference and native GUI chat remain separate. See the [integration contract](coven-familiars-integration.md). |
| Claude Code / Codex Live | Executable discovery and subprocess transcript-answer adapters. | CLI fixtures only; real sign-in, provider response, and cancellation need a dedicated task. |
| Music providers / YouTube | Embeds and optional HTTPS-browser account adapters; plugin setup explains host and private-configuration limits. | Native OAuth callbacks, account-backed useful actions, codecs, and playback require provider/device qualification. See the [setup notes](desktop-polish-plan.md#plugin-setup-and-private-configuration). |
| Voice / live audio | Explicit capture controls and native/browser speech paths. | Microphone, speech-service, and permission behavior require a usable GUI/device. |
| Agent monitor | Read-only recognized local-process discovery. | Tests cover scope, errors, and privacy; OS state is not inferred task/approval progress. |
| Remote desktops / message controllers | Supplied web VNC viewers; opt-in BlueBubbles/Photon adapters. | External gateways and live providers require their own explicit setup and acceptance. |
| Windows / Linux desktop | No qualified packaged host. | Portable tests do not establish desktop support. |

Items/settings are local to the device. Account sync, system reminders, native notifications, and screen-share capture exclusion are not qualified features. Never display a protective or connected state based solely on a preview, executable presence, or successful compilation.
