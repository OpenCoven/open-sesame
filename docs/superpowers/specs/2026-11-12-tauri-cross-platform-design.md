# Open Sesame on Tauri: one desktop app for macOS, Windows and Linux

Status: design approved in conversation by Val on 12 November 2026. Implementation has not started. Nothing in this document has been compiled or run.

## Goal

Replace the macOS-only Swift host and the Python bridge with a single Tauri 2 application that builds and runs on macOS, Windows and Linux from one codebase. The authored UI in `dist/` stays as it is.

## Decisions

| Question | Decision |
| --- | --- |
| Platforms | macOS, Windows, Linux desktop. iOS/iPadOS stays on ADR 001. Android stays deferred. |
| Host | Tauri 2 with a Rust backend. No Python and no Swift at runtime. |
| Rollout | One cutover on one branch. The Swift host and Python bridge are deleted in the same change. No period of parallel support. |
| Existing data | None is carried over. The only current user starts with a clean workspace. |
| Feature bar | Core features only (listed below). Everything else rejects with a fixed "unavailable" error. |
| Login | Kept. WorkOS AuthKit with PKCE through the system browser, because distribution is planned. |
| Packaging | Local `tauri build` output per OS. Installers, signing, notarization and auto-update are out of scope. |

## What stays, what goes

Kept unchanged: `dist/` (apart from the transport branch in `dist/bridge.js`), `web/auth-entrypoint/`, `vendor-src/` and `dist/vendor/`, the widget checks under `scripts/check-*.mjs` that do not read host source, and the mobile documents under `docs/mobile/`. `vendor-src/workos-ios` stays because ADR 001 depends on it.

Removed at cutover: every `desktop/*.swift` file and every `desktop/*.py` file except `desktop/dev_server.py` (the browser preview behind `npm run dev`, which is a development tool and not part of the app), `desktop/tests/`, `desktop/engine/`, `desktop/build-macos.sh`, `run-macos.sh`, `desktop/photon-controller.mjs`, `examples/coven_familiars.py`, and the scripts that only build or check those (`scripts/build-workos-sdk.py`, `scripts/build-coven-engine.py`, `scripts/build-app-icon.py`, `scripts/check-app-icon.py`, `scripts/check-process-package.py`, `scripts/check-native.sh`, `scripts/check-authentication.sh`, `scripts/check-screen-notes.sh`, `scripts/check-vnc-native.sh`). Git history keeps all of it.

## Features in the first Tauri release

Ported: login (`auth.*`), `system.info`, window and tray (`window.size`, `window.focus`, `window.fullscreen`, `window.keepOpen`), local shells and SSH (`terminal.*`, `terminal.clipboard.*`, `project.chooseFolder`, `project.reveal`), Coven Familiars (`coven.*`, including the native confirmation for full-access sends and avatar replacement), GitHub monitor (`github.*`), feeds and reader (`feeds.fetch`, `reading.fetch`, `reading.pdf`, `reading.saveEPUB`, `reading.saveRSS`), Image Studio (`image.*`) and the agent monitor (`agents.*`).

Not ported: Screen notes, Protected Share, system-audio capture and recording, native speech and diarization, the notch panel with display-follow and pinning (`window.detach`, `window.display.*`), the global shortcut, Coven Computer (`computer.*`), native VNC (`vnc.*`), native Spotify login (`music.spotify.*`), embedded provider web surfaces (`webview.*`, `media.player.*`), message controllers (`controller.*`) and Claude Code/Codex Live (`live.*`). Browser fallbacks that already exist in `dist/` (for example `wss://` VNC gateways and browser speech recognition) keep working where the system webview supports them.

Platform gaps inside ported features: agent Pause/Resume uses POSIX signals and is unavailable on Windows. "Open terminal" for an agent used AppleScript and is unavailable everywhere in this release.

## Architecture

Three layers, with the wire protocol as the fixed contract between the first two.

**UI.** `dist/` is loaded by Tauri directly; there is still no build step and no npm runtime dependency. `dist/bridge.js` keeps its `{requestId, method, params}` request, its reply handling and its `open-sesame-desktop-event` events. Its WKWebView transport is replaced by a Tauri transport that uses the global `window.__TAURI__` object. The host injects `window.__OPEN_SESAME_NATIVE__ = true` and `window.__OPEN_SESAME_VERSION__` before any page script runs, because 62 places in `dist/` read the first flag.

**Tauri app (`src-tauri/`).** Owns the window, tray, deep-link handling, native dialogs, the credential store and one command, `bridge_request`. That command applies the request gate and dispatches to the core. Streaming output goes back as Tauri events on the main window.

**Core (`crates/core/`, crate `open-sesame-core`).** Plain Rust with no Tauri dependency, so it is tested headless on all three operating systems. One module per ported area. Everything that differs per OS (default shell, process listing, signals, data directory) is decided inside the module that needs it with `cfg` attributes; there is no separate abstraction layer until a second caller needs one.

### Request gate

Applied in this order for every request, matching what `desktop/OpenSesame.swift` does today:

1. The request must come from the window labelled `main`. Anything else is dropped.
2. `auth.status`, `auth.signIn`, `auth.cancel` and `auth.signOut` are always allowed.
3. `system.info` while signed out returns only `{"platform": <platform>, "authenticated": false}`.
4. Every other method except `window.focus` requires a signed-in, unexpired session, otherwise the error is `Sign in to Open Sesame before using this tool.`
5. A method on the not-ported list returns `This feature is not available in this version of Open Sesame.`
6. A ported method that the current OS cannot do returns `This feature is not available on this operating system.`
7. Any other unknown method returns `Unsupported desktop action.`

The app shows `sign-in.html` until a session is verified, then `index.html`. Sign-out or expiry returns to `sign-in.html`. Navigation away from bundled pages is blocked in the main window.

### Login

Same contract as today: public client ID only, redirect `opensesame://auth/callback`, sign-out return `opensesame://auth/signed-out`, PKCE with S256, sign-in in the system browser. The callback arrives through the Tauri deep-link plugin; on Windows and Linux the single-instance plugin forwards it from the second process to the running app. The callback validation rules are copied from `Authentication.swift`: exact scheme, host and path; no user, password, port or fragment; exactly one `state` equal to the pending one; exactly one non-empty `code` of at most 8192 bytes; no `error` parameter.

After the code exchange the access token's signature is verified against the WorkOS JWKS for this client, its subject must equal the returned user's ID, and its expiry sets the session deadline. Refresh runs 60 seconds before the deadline and retries every 20 seconds on transient failure. `invalid_grant` and `refresh_token_revoked` end the session and delete the saved credential. Only the refresh token is saved, in the OS credential store (Keychain, Windows Credential Manager, Secret Service). The user-facing messages are copied from `Authentication.swift`, with "macOS Keychain" replaced by "your system keychain" and "on this Mac" by "on this computer".

### Terminals

`portable-pty` provides POSIX PTYs and Windows ConPTY behind one API. Validation, limits and error strings are copied from `desktop/bridge.py`: pane ID pattern, 16 active sessions, launcher one of shell/coven/bash, prompt at most 2000 characters, the SSH host and user patterns, `TERM=xterm-256color`. Output is sent as base64 in `terminal.data` events, followed by `terminal.exit`. Default shell: `$SHELL`, then `/bin/zsh` on macOS or `/bin/bash` on Linux, then `/bin/sh`; on Windows `pwsh.exe` if present, otherwise `powershell.exe`. Closing a pane or quitting the app kills the pane's whole process tree.

### Subprocess-backed features

Coven Familiars, the GitHub monitor and Image Studio all drive an installed CLI. They share one bounded runner in the core: timeout, cancellation, output cap, and whole-tree termination (process group on Unix, job object on Windows). Each module is a behaviour-for-behaviour port of its Python file, and the Python test file for that module is the list of tests to translate.

## Error handling

Every failure reaches the UI as `{requestId, error: <sentence>}`; the UI already renders these. The core never panics on bad input: parameters are validated at the module boundary and unknown fields are rejected where the Python code rejected them. A missing CLI (`coven`, `gh`, `ssh`, `bash`) is a normal error with the Python wording.

## Testing

- `cargo test -p open-sesame-core` on macOS, Windows and Linux in CI. This is where almost all behaviour is tested, including real PTY sessions.
- `npm run check` keeps running the widget checks. Assertions that read Swift source are retargeted to the Rust source, or removed when the behaviour belongs to a feature that was not ported. Assertions about `dist/` stay.
- `npm run verify` runs the widget checks, the tooling tests, `cargo test`, and a `cargo build` of the app on the current OS.
- A manual smoke pass per OS for what cannot be automated: sign in through the browser, open a shell, run a command, resize, quit, confirm no leftover processes.

## Known risks

- The WorkOS endpoint paths were confirmed against the vendored Swift SDK source in `vendor-src/workos-ios`, but the request bodies and token claims have not been exercised from Rust. The login task starts by confirming them against that source.
- `dist/` was written against WKWebView. Windows uses WebView2 (Chromium) and Linux uses WebKitGTK, so some layout or media behaviour may differ. The smoke pass is where this shows up.
- Deep links on Linux need the app to be registered with the desktop environment; development builds register at runtime.
