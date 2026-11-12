# Open Sesame on Tauri Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the macOS Swift host and Python bridge with one Tauri 2 app that builds and runs on macOS, Windows and Linux, keeping the `dist/` UI unchanged.

**Architecture:** `dist/bridge.js` keeps its `{requestId, method, params}` envelope and talks to a single Tauri command, `bridge_request`. That command applies a request gate and dispatches to `open-sesame-core`, a plain Rust crate with one module per feature area and no Tauri dependency. Streaming output returns as Tauri events on the main window.

**Tech Stack:** Tauri 2, Rust stable, `portable-pty`, `ureq`, `jsonwebtoken`, `keyring`, `serde_json`, Tauri plugins `deep-link`, `single-instance`, `opener`, `dialog`, `clipboard-manager`. Node 22 for the existing widget checks.

**Spec:** `docs/superpowers/specs/2026-11-12-tauri-cross-platform-design.md`

## Global Constraints

- No Python and no Swift at runtime. No npm runtime dependency and no build step for `dist/`; use `app.withGlobalTauri: true` and `window.__TAURI__`, never `@tauri-apps/api` imports.
- Method names, the request/reply envelope and event names are unchanged from the current bridge.
- User-facing error strings are copied verbatim from the Python or Swift source being ported, except the three gate messages and the keychain wording defined in the spec.
- WorkOS: client ID `client_01M6WS836GMGC87S8SVBR6X35A`, redirect `opensesame://auth/callback`, signed-out return `opensesame://auth/signed-out`. Only the public client ID ships.
- Bundle identifier stays `com.perch.widgetstudio`. Product name `Open Sesame`.
- Add crates with `cargo add` so versions resolve at execution time; commit `Cargo.lock`. CI uses `--locked`.
- The Tauri CLI is a developer prerequisite installed once with `cargo install tauri-cli --locked`; it provides `cargo tauri dev`, `cargo tauri build` and `cargo tauri icon`. CI does not need it because it compiles with plain `cargo build`.
- No data migration, installers, signing, notarization or auto-update.
- Every module that drives a CLI takes the binary path as `Option<PathBuf>` in its constructor (`None` resolves from `PATH`); tests inject the fixture binary this way.
- Follow the repository's own rules in `AGENTS.md`: one task branch or worktree, claim the task, write prose as one line per paragraph, and do not commit, push or merge beyond the authority the session was given.
- This plan was written without compiling anything. Treat every Tauri API name as something to confirm against the current Tauri 2 documentation when it first fails to compile.

## Review Focus

1. A sign-in callback that arrives as a second process on Windows or Linux must reach the running app and complete sign-in, not open a second window. Pinned in Task 4.
2. A callback with a wrong, missing or duplicated `state`, an `error` parameter, or an oversized `code` must be rejected and leave the app signed out. Pinned in Task 2.
3. Quitting the app or closing a pane must leave no shell, SSH or CLI child process behind, including grandchildren. Pinned in Tasks 5 and 6.
4. A missing CLI (`coven`, `gh`, `ssh`, `bash`) or a project folder with spaces or non-ASCII characters in its path must produce the documented error or work normally, never a panic. Pinned in Tasks 5 and 7.
5. A request for a not-ported method, a request while signed out, or a request from any window other than `main` must return the fixed gate message and run nothing. Pinned in Tasks 1 and 3.

## File Structure

```
Cargo.toml                         workspace: crates/core, src-tauri
crates/core/
  Cargo.toml                       package open-sesame-core
  src/lib.rs                       Core: owns modules, dispatches ported methods
  src/protocol.rs                  Request, Reply, Emit, BridgeError
  src/gate.rs                      request gate and method lists
  src/auth/{mod,pkce,callback,token,store,controller}.rs
  src/process.rs                   bounded subprocess runner with tree kill
  src/terminal.rs                  PTY sessions
  src/coven.rs  src/avatars.rs     Coven Familiars
  src/github.rs                    GitHub monitor
  src/reading.rs                   feeds and reader fetch
  src/image.rs                     Image Studio
  src/agents.rs                    agent monitor
  src/bin/fixture_cli.rs           test-only fake CLI
  tests/                           integration tests using the fixture binary
src-tauri/
  Cargo.toml  build.rs  tauri.conf.json  capabilities/default.json  icons/
  src/main.rs                      entry point
  src/lib.rs                       builder, plugins, state, window, tray
  src/router.rs                    bridge_request, host-side methods
  src/login.rs                     deep link, browser, timers, page switching
dist/bridge.js                     transport branch replaced
scripts/check-tauri-bridge.mjs     new widget check for the transport
```

---

### Task 1: Workspace, protocol and request gate

**Files:**
- Create: `Cargo.toml`, `crates/core/Cargo.toml`, `crates/core/src/lib.rs`, `crates/core/src/protocol.rs`, `crates/core/src/gate.rs`
- Modify: `.gitignore` (add `/target`)

**Interfaces:**
- Produces, in `protocol.rs`:
  - `pub struct Request { pub request_id: String, pub method: String, pub params: serde_json::Map<String, Value> }` with serde names `requestId`, `method`, `params` (`params` defaults to empty).
  - `pub struct Reply` serializing to `{"requestId", "result"}` or `{"requestId", "error"}`; `Reply::ok(id: &str, result: Value) -> Reply`, `Reply::err(id: &str, message: impl Into<String>) -> Reply`.
  - `pub struct BridgeError(pub String)` implementing `Display` and `From<&str>`/`From<String>`; `pub type BridgeResult = Result<Value, BridgeError>`.
  - `pub type Emit = Arc<dyn Fn(Value) + Send + Sync>`; every emitted value is an object with an `"event"` key.
- Produces, in `gate.rs`:
  - `pub const SIGN_IN_REQUIRED: &str = "Sign in to Open Sesame before using this tool.";`
  - `pub const NOT_IN_VERSION: &str = "This feature is not available in this version of Open Sesame.";`
  - `pub const NOT_ON_OS: &str = "This feature is not available on this operating system.";`
  - `pub const UNSUPPORTED: &str = "Unsupported desktop action.";`
  - `pub fn platform() -> &'static str` returning `"darwin"`, `"win32"` or `"linux"`.
  - `pub enum Gate { Allow, SignedOutInfo, Deny(&'static str) }`
  - `pub fn gate(method: &str, authenticated: bool) -> Gate`
  - `pub const PORTED: &[&str]` with exactly: `auth.status auth.signIn auth.cancel auth.signOut system.info window.size window.focus window.fullscreen window.keepOpen terminal.open terminal.input terminal.resize terminal.close terminal.clipboard.read terminal.clipboard.write project.chooseFolder project.reveal coven.status coven.familiars coven.send coven.cancel coven.command coven.open coven.avatar.set coven.permissions.cancel github.status github.add github.remove github.snapshot feeds.fetch reading.fetch reading.pdf reading.saveEPUB reading.saveRSS image.status image.generate image.cancel image.save agents.snapshot agents.control agents.history.clear`
  - `pub const NOT_PORTED_PREFIXES: &[&str]` with exactly: `computer. native. screen.notes. privacy. speech. diarization. record. voice. vnc. music. webview. media.player. controller. live. window.detach window.display. agents.terminal capture.`

- [ ] **Step 1: Write the failing tests** in `gate.rs` and `protocol.rs` `#[cfg(test)]` modules:

```rust
#[test] fn signed_out_allows_auth_methods() {
    for m in ["auth.status", "auth.signIn", "auth.cancel", "auth.signOut"] { assert!(matches!(gate(m, false), Gate::Allow)); }
}
#[test] fn signed_out_system_info_is_limited() { assert!(matches!(gate("system.info", false), Gate::SignedOutInfo)); }
#[test] fn signed_out_window_focus_is_allowed() { assert!(matches!(gate("window.focus", false), Gate::Allow)); }
#[test] fn signed_out_denies_everything_else() {
    for m in ["terminal.open", "coven.send", "window.size", "speech.start", "nope.nothing"] { assert!(matches!(gate(m, false), Gate::Deny(SIGN_IN_REQUIRED))); }
}
#[test] fn signed_in_allows_every_ported_method() { for m in PORTED { assert!(matches!(gate(m, true), Gate::Allow), "{m}"); } }
#[test] fn signed_in_denies_not_ported_methods() {
    for m in ["computer.start", "native.computer.prepare", "screen.notes.capture", "privacy.start", "speech.start", "diarization.start", "record.start", "vnc.open", "music.spotify.status", "webview.open", "media.player.open", "controller.start", "live.ask", "window.detach", "window.display.status", "agents.terminal"] {
        assert!(matches!(gate(m, true), Gate::Deny(NOT_IN_VERSION)), "{m}");
    }
}
#[test] fn signed_in_denies_unknown_methods() { assert!(matches!(gate("nope.nothing", true), Gate::Deny(UNSUPPORTED))); }
#[test] fn request_without_params_deserializes() {
    let r: Request = serde_json::from_str(r#"{"requestId":"a","method":"system.info"}"#).unwrap();
    assert!(r.params.is_empty());
}
#[test] fn reply_shapes() {
    assert_eq!(serde_json::to_string(&Reply::ok("a", json!(true))).unwrap(), r#"{"requestId":"a","result":true}"#);
    assert_eq!(serde_json::to_string(&Reply::err("a", "x")).unwrap(), r#"{"requestId":"a","error":"x"}"#);
}
```

- [ ] **Step 2: Run** `cargo test -p open-sesame-core`. Expected: fails to compile (items not defined).
- [ ] **Step 3: Implement** `protocol.rs` and `gate.rs` to the signatures above. `gate` order: auth methods, `system.info` signed out, `window.focus`, sign-in requirement, `PORTED`, `NOT_PORTED_PREFIXES`, else `UNSUPPORTED`.
- [ ] **Step 4: Run** `cargo test -p open-sesame-core`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(core): protocol types and request gate`.

---

### Task 2: Login logic (headless)

**Files:**
- Create: `crates/core/src/auth/mod.rs`, `pkce.rs`, `callback.rs`, `token.rs`, `store.rs`, `controller.rs`

**Interfaces:**
- Produces:
  - `pub const CLIENT_ID`, `REDIRECT`, `SIGNED_OUT` with the values in Global Constraints; `pub const API: &str = "https://api.workos.com";`
  - `pub struct Pkce { pub verifier: String, pub challenge: String, pub state: String }`; `pub fn generate_pkce() -> Pkce` (verifier: 32 random bytes as unpadded base64url; challenge: unpadded base64url of SHA-256 of the verifier; state: 32 random bytes as unpadded base64url).
  - `pub fn authorize_url(pkce: &Pkce) -> String` building `{API}/user_management/authorize` with `response_type=code`, `client_id`, `redirect_uri`, `provider=authkit`, `code_challenge`, `code_challenge_method=S256`, `state`.
  - `pub fn authorization_code(callback: &str, state: &str) -> Result<String, AuthError>`
  - `pub struct User { pub id: String, pub email: String, pub first_name: Option<String>, pub last_name: Option<String> }`; `pub struct Tokens { pub access_token: String, pub refresh_token: String, pub user: User }`
  - `pub enum AuthError { InvalidCallback, InvalidSession, Store, Ended, Network }` where `Ended` means the server answered `invalid_grant` or `refresh_token_revoked`.
  - `pub trait WorkosApi: Send + Sync { fn exchange_code(&self, code: &str, verifier: &str) -> Result<Tokens, AuthError>; fn refresh(&self, refresh_token: &str) -> Result<Tokens, AuthError>; fn jwks(&self) -> Result<jsonwebtoken::jwk::JwkSet, AuthError>; }` and `pub struct HttpWorkos` implementing it with `ureq` (20 second timeout): `POST {API}/user_management/authenticate` with JSON `{client_id, grant_type: "authorization_code", code, code_verifier}` or `{client_id, grant_type: "refresh_token", refresh_token}`; `GET {API}/sso/jwks/{CLIENT_ID}`.
  - `pub fn verify(tokens: &Tokens, jwks: &JwkSet, now: SystemTime) -> Result<(SystemTime, String), AuthError>` returning the expiry and the `sid` claim after checking the RS256 signature, `sub == tokens.user.id`, and `exp > now`.
  - `pub fn logout_url(session_id: &str) -> String` building `{API}/user_management/sessions/logout?session_id=…&return_to={SIGNED_OUT}`.
  - `pub trait CredentialStore: Send + Sync { fn load(&self) -> Result<Option<String>, AuthError>; fn save(&self, refresh_token: &str) -> Result<(), AuthError>; fn delete(&self) -> Result<(), AuthError>; }` and `pub struct KeyringStore` using the `keyring` crate with service `com.perch.widgetstudio.workos.tauri` and account `CLIENT_ID`.
  - `pub struct AuthController` with `new(api: Arc<dyn WorkosApi>, store: Arc<dyn CredentialStore>, on_change: Arc<dyn Fn() + Send + Sync>)`, and methods `status(&self) -> Value`, `authenticated(&self) -> bool`, `begin_sign_in(&self) -> Result<String, AuthError>` (returns the URL to open), `complete_sign_in(&self, callback: &str)`, `restore(&self)`, `refresh(&self)`, `cancel(&self)`, `sign_out(&self) -> Option<String>` (returns the logout URL to open), `next_refresh_in(&self) -> Option<Duration>` (deadline minus 60 seconds, or 20 seconds after a transient failure).
  - `status()` returns `{authenticated, busy, message, name, email}`. Messages are those in `desktop/Authentication.swift`, with "macOS Keychain" replaced by "your system keychain", "Unlock your Keychain" by "Unlock it", and "on this Mac" by "on this computer".

- [ ] **Step 1: Confirm the endpoints.** Extract `vendor-src/workos-ios/sources.tar.gz` to a temporary directory and check `Sources/WorkOS/Resources/UserManagement.swift` and `Sources/WorkOS/Helpers/SessionHelpers.swift` for the request bodies and the `sid` claim name. Paths confirmed while writing this plan: `user_management/authorize`, `user_management/authenticate`, `sso/jwks/{clientId}`, `user_management/sessions/logout` with `session_id` and `return_to`.
- [ ] **Step 2: Write the failing tests.** Translate every case in `desktop/tests/AuthenticationTests.swift` to a Rust test of the same name, and add:

```rust
const S: &str = "state123";
#[test] fn callback_accepts_exact_url() { assert_eq!(authorization_code("opensesame://auth/callback?code=abc&state=state123", S).unwrap(), "abc"); }
#[test] fn callback_rejects_wrong_state() { assert!(authorization_code("opensesame://auth/callback?code=abc&state=other", S).is_err()); }
#[test] fn callback_rejects_duplicate_state() { assert!(authorization_code("opensesame://auth/callback?code=abc&state=state123&state=state123", S).is_err()); }
#[test] fn callback_rejects_duplicate_code() { assert!(authorization_code("opensesame://auth/callback?code=a&code=b&state=state123", S).is_err()); }
#[test] fn callback_rejects_error_parameter() { assert!(authorization_code("opensesame://auth/callback?code=abc&state=state123&error=access_denied", S).is_err()); }
#[test] fn callback_rejects_other_scheme_host_path_port_user_fragment() {
    for u in ["https://auth/callback?code=a&state=state123", "opensesame://evil/callback?code=a&state=state123", "opensesame://auth/other?code=a&state=state123", "opensesame://auth:8/callback?code=a&state=state123", "opensesame://u@auth/callback?code=a&state=state123", "opensesame://auth/callback?code=a&state=state123#f"] { assert!(authorization_code(u, S).is_err(), "{u}"); }
}
#[test] fn callback_rejects_empty_and_oversized_code() {
    assert!(authorization_code("opensesame://auth/callback?code=&state=state123", S).is_err());
    assert!(authorization_code(&format!("opensesame://auth/callback?code={}&state=state123", "a".repeat(8193)), S).is_err());
}
#[test] fn pkce_challenge_is_sha256_of_verifier() { /* recompute and compare; verifier is 43 chars */ }
#[test] fn authorize_url_contains_required_parameters() { /* each parameter listed above appears exactly once */ }
```

Controller tests use a fake `WorkosApi` and an in-memory `CredentialStore`, with tokens signed by a test RSA key whose public half the fake returns from `jwks()`:

```rust
#[test] fn sign_in_saves_refresh_token_and_reports_user()      // status.authenticated == true, email set, store holds the refresh token
#[test] fn token_for_another_user_is_rejected()                // sub != user.id -> not authenticated, store empty
#[test] fn expired_token_is_rejected()
#[test] fn token_with_wrong_signature_is_rejected()
#[test] fn cancel_then_late_callback_is_ignored()              // begin, cancel, complete -> still signed out
#[test] fn restore_with_saved_token_signs_in()
#[test] fn restore_with_revoked_token_deletes_it()             // fake returns Ended -> store empty, message "Your sign-in has ended. Sign in again to continue."
#[test] fn transient_refresh_failure_keeps_token_and_retries() // fake returns Network -> store unchanged, next_refresh_in() == Some(20s)
#[test] fn sign_out_deletes_token_and_returns_logout_url()     // URL contains session_id=<sid> and return_to
#[test] fn store_failure_reports_keychain_message()
```

- [ ] **Step 3: Run** `cargo test -p open-sesame-core auth`. Expected: fails to compile.
- [ ] **Step 4: Implement** the six files to the signatures above. Stale work is discarded with an epoch counter incremented by `begin_sign_in`, `cancel` and `sign_out`, as in the Swift code.
- [ ] **Step 5: Run** `cargo test -p open-sesame-core auth`. Expected: all pass.
- [ ] **Step 6: Commit** `feat(core): WorkOS PKCE login logic`.

---

### Task 3: Tauri shell, bridge transport, window and tray

**Files:**
- Create: `src-tauri/Cargo.toml` (package `open-sesame`), `src-tauri/build.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/router.rs`, `scripts/check-tauri-bridge.mjs`
- Create with `cargo tauri icon dist/assets/open-sesame-logo.png`: `src-tauri/icons/`
- Modify: `dist/bridge.js` (replace the `window.webkit.messageHandlers` branch), `package.json` (scripts `dev:app`: `cargo tauri dev`, `build:app`: `cargo tauri build`; remove `dev:macos`), `crates/core/src/lib.rs`

**Interfaces:**
- Consumes: `Request`, `Reply`, `Emit`, `gate`, `Gate`, `platform`, `AuthController` from Tasks 1 and 2.
- Produces:
  - In core: `pub struct Core`; `Core::new(data_dir: PathBuf, emit: Emit) -> Core`; `pub fn handle(&self, method: &str, params: &Map<String, Value>) -> BridgeResult` (blocking; returns `UNSUPPORTED` for methods no module claims yet); `pub fn shutdown(&self)`. `system.info` returns `{"available": true, "authenticated": true, "platform": platform(), "machine": <hostname>, "home": <home dir>, "shell": <default shell>}`.
  - In the app: `pub struct AppState { pub core: Arc<Core>, pub auth: Arc<AuthController> }`.
  - `#[tauri::command] async fn bridge_request(window: tauri::WebviewWindow, app: tauri::AppHandle, state: tauri::State<'_, AppState>, message: Request) -> Result<Reply, ()>`. It drops requests whose window label is not `main`, applies `gate`, answers `auth.status` from `state.auth.status()`, answers host-side methods itself, and runs `core.handle` on `tauri::async_runtime::spawn_blocking`.
  - Event names: `open-sesame-message` (payload is the event object, forwarded to `window.__openSesameReceive`) and `open-sesame-auth-changed` (no payload).
  - Host-side methods in this task: `window.size` (same parameters as the `window.size` branch in `desktop/OpenSesame.swift`, applied as the inner size), `window.focus` (show, unminimize, focus), `window.fullscreen` (toggle), `window.keepOpen` (always-on-top on or off).
- `tauri.conf.json` values: `productName` `Open Sesame`; `identifier` `com.perch.widgetstudio`; `build.frontendDist` `../dist`; `app.withGlobalTauri` `true`; `app.windows` `[]`; `bundle.active` `true`, `bundle.targets` `all`.
- Main window, created in `setup` so the initialization script can be attached: label `main`, title `Open Sesame`, URL `sign-in.html`, inner size 1090 by 613, minimum 800 by 450, resizable. Initialization script: `window.__OPEN_SESAME_NATIVE__=true;window.__OPEN_SESAME_VERSION__=<JSON string of the package version>;`. Navigation to anything outside the bundled pages is cancelled.
- Tray icon with a menu of `Show or hide` and `Quit`. Closing the window quits the app. Quit calls `core.shutdown()`.
- `capabilities/default.json`: windows `["main"]`, permissions `core:default` plus the default permission of each plugin as it is added.

- [ ] **Step 1: Write the failing widget check** `scripts/check-tauri-bridge.mjs`. It loads `dist/bridge.js` in a `node:vm` context with a fake `window` (the pattern used by the existing `scripts/check-*.mjs` files) and asserts:

```js
// fake: window.__OPEN_SESAME_NATIVE__ = true; window.__TAURI__ = { core: { invoke }, event: { listen } }
// 1. on load, invoke was called once with ('bridge_request', { message: { requestId, method: 'system.info', params: {} } })
// 2. resolving that invoke with { requestId, result: { platform: 'linux' } } resolves openSesameBridge.ready and sets openSesameBridge.available === true
// 3. listen was called with 'open-sesame-message'; calling its handler with { payload: { event: 'terminal.data', id: 'p', data: '' } } dispatches 'open-sesame-desktop-event' with that detail
// 4. listen was called with 'open-sesame-auth-changed'; calling its handler dispatches a window event of that name
// 5. when invoke rejects with 'boom', the pending request rejects with Error('boom')
// 6. without window.__TAURI__, openSesameBridge.ready resolves to { available: false }
// 7. the file no longer contains 'messageHandlers'
```

- [ ] **Step 2: Run** `node scripts/check-tauri-bridge.mjs`. Expected: fails on assertion 1.
- [ ] **Step 3: Replace the native branch in `dist/bridge.js`** with:

```js
if(window.__OPEN_SESAME_NATIVE__&&window.__TAURI__?.core?.invoke){const tauri=window.__TAURI__;tauri.event.listen('open-sesame-message',event=>window.__openSesameReceive(event.payload));tauri.event.listen('open-sesame-auth-changed',()=>window.dispatchEvent(new Event('open-sesame-auth-changed')));send=message=>{tauri.core.invoke('bridge_request',{message}).then(window.__openSesameReceive,error=>window.__openSesameReceive({requestId:message.requestId,error:String(error)}))};document.documentElement.classList.add('native-desktop');ready=request('system.info').then(info=>{available=true;return info})}
```

Update the comment at the top of the file to name the Tauri host instead of Swift and `desktop/bridge.py`.

- [ ] **Step 4: Run** `node scripts/check-tauri-bridge.mjs` and `npm run check`. Expected: the new check passes. Checks that read Swift source may still pass because those files exist until Task 11.
- [ ] **Step 5: Write failing router tests** in `src-tauri/src/router.rs` against a pure function `fn route(method: &str, authenticated: bool, window_label: &str) -> Route` where `enum Route { Drop, Reply(Value), Error(&'static str), Auth, Host, Core }`:

```rust
#[test] fn other_windows_are_dropped() { assert!(matches!(route("system.info", true, "popup"), Route::Drop)); }
#[test] fn signed_out_system_info_is_minimal() { /* Route::Reply(json!({"platform": platform(), "authenticated": false})) */ }
#[test] fn signed_out_terminal_open_is_refused() { assert!(matches!(route("terminal.open", false, "main"), Route::Error(SIGN_IN_REQUIRED))); }
#[test] fn not_ported_method_is_refused() { assert!(matches!(route("speech.start", true, "main"), Route::Error(NOT_IN_VERSION))); }
#[test] fn window_methods_stay_in_the_host() { assert!(matches!(route("window.size", true, "main"), Route::Host)); }
#[test] fn terminal_methods_go_to_core() { assert!(matches!(route("terminal.open", true, "main"), Route::Core)); }
```

- [ ] **Step 6: Implement** the Tauri app to the interfaces above. `bridge_request` calls `route` and acts on the result. The core's `Emit` closure calls `app.emit_to("main", "open-sesame-message", value)`. `auth.signIn`, `auth.cancel` and `auth.signOut` reply `true` and are wired in Task 4.
- [ ] **Step 7: Run** `cargo test --workspace`, then `cargo tauri dev`. Expected: tests pass; a window titled Open Sesame opens on the sign-in page; the tray icon toggles it; closing it exits the process.
- [ ] **Step 8: Commit** `feat(app): Tauri shell, bridge transport, window and tray`.

---

### Task 4: Login wiring

**Files:**
- Create: `src-tauri/src/login.rs`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/src/router.rs`, `src-tauri/tauri.conf.json` (`plugins.deep-link.desktop.schemes`: `["opensesame"]`), `src-tauri/capabilities/default.json`, `src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: `AuthController`, `HttpWorkos`, `KeyringStore`, `AppState`.
- Produces: `pub fn install(app: &tauri::App, auth: Arc<AuthController>)` which registers the deep-link handler, calls `auth.restore()` on a background thread, and owns a refresh timer driven by `auth.next_refresh_in()`. The controller's `on_change` callback emits `open-sesame-auth-changed` and loads `index.html` when `authenticated()` becomes true or `sign-in.html` when it becomes false.
- Plugin order in the builder: `tauri_plugin_single_instance` (with its `deep-link` feature) first, then `tauri_plugin_deep_link`, then `tauri_plugin_opener`. In debug builds on Windows and Linux call `app.deep_link().register_all()` so the scheme works under `cargo tauri dev`.
- Router: `auth.signIn` opens `auth.begin_sign_in()` in the system browser; `auth.cancel` calls `cancel()`; `auth.signOut` calls `sign_out()` and opens the returned URL if there is one. Each replies `true` immediately, as the Swift host does.
- Every URL received from the deep-link handler or from single-instance arguments that starts with `opensesame://auth/callback` goes to `auth.complete_sign_in(url)`. `opensesame://auth/signed-out` only focuses the window. Anything else is ignored.

- [ ] **Step 1: Write the failing test** in `login.rs` for the pure function `fn classify(url: &str) -> Link` with `enum Link { Callback, SignedOut, Ignore }`:

```rust
#[test] fn callback_urls_are_callbacks() { assert!(matches!(classify("opensesame://auth/callback?code=a&state=b"), Link::Callback)); }
#[test] fn signed_out_url_is_recognised() { assert!(matches!(classify("opensesame://auth/signed-out"), Link::SignedOut)); }
#[test] fn other_urls_and_arguments_are_ignored() {
    for u in ["opensesame://other", "https://example.com", "--flag", ""] { assert!(matches!(classify(u), Link::Ignore), "{u}"); }
}
```

- [ ] **Step 2: Run** `cargo test -p open-sesame login`. Expected: fails to compile.
- [ ] **Step 3: Implement** `login.rs` and the router changes.
- [ ] **Step 4: Run** `cargo test --workspace`. Expected: pass.
- [ ] **Step 5: Manual check on each OS** with `cargo tauri dev`: Sign in opens the browser; after approval the app shows the workspace without a second window appearing; quit and relaunch restores the session without the browser; Sign out returns to the sign-in page and relaunch stays signed out. On Windows and Linux, also run `start opensesame://auth/signed-out` or `xdg-open opensesame://auth/signed-out` while the app is running and confirm the existing window is focused and no second instance stays open.
- [ ] **Step 6: Commit** `feat(app): browser sign-in through deep links`.

---

### Task 5: Terminals, SSH, clipboard and folder picker

**Files:**
- Create: `crates/core/src/terminal.rs`, `crates/core/tests/terminal.rs`
- Modify: `crates/core/src/lib.rs`, `src-tauri/src/router.rs`, `src-tauri/Cargo.toml`, `src-tauri/capabilities/default.json`

**Interfaces:**
- Produces: `pub struct Terminals`; `Terminals::new(emit: Emit) -> Terminals`; `pub fn handle(&self, method: &str, params: &Map<String, Value>) -> BridgeResult` for `terminal.open`, `terminal.input`, `terminal.resize`, `terminal.close`; `pub fn close_all(&self)`.
- `terminal.open` returns `{"id", "pid", "machine"}` where `machine` is the hostname for local mode and the `host` parameter for SSH.
- Events: `{"event": "terminal.data", "id", "data": <base64>}`, `{"event": "terminal.exit", "id"}`, `{"event": "terminal.error", "id", "message": "Terminal stream ended."}`.
- Validation and messages copied from `Session.__init__` and the `terminal.*` branches of `Bridge.handle` in `desktop/bridge.py`: ID pattern `[A-Za-z0-9_-]{1,80}` (`Invalid pane ID.`), at most 16 open sessions, launcher, prompt, cwd, SSH host and user patterns, `Open this shell before sending input.` Reopening an existing ID closes the old session first.
- Environment `TERM=xterm-256color`, `COLORTERM=truecolor`. Shell selection as in the spec. On Windows the shell launcher runs the shell with no arguments, the `bash` launcher fails with `Bash is not installed on this machine.` when `bash` is not on `PATH`, and the `coven` launcher runs `coven` with the task as its single argument.
- `terminal.input` takes `data` and `binary`; when `binary` is true `data` is base64, as in `Session.write`.
- Host-side methods added to the router: `terminal.clipboard.read` and `terminal.clipboard.write` (clipboard-manager plugin, same parameters and limits as `desktop/TerminalClipboard.swift`), `project.chooseFolder` (dialog plugin folder picker; returns what the Swift branch returns), `project.reveal` (opener plugin reveal; the path must exist, otherwise `Folder unavailable.`).

- [ ] **Step 1: Write the failing tests** in `crates/core/tests/terminal.rs`. Translate the four tests in `desktop/tests/test_bridge.py` under the same names, and add:

```rust
#[test] fn rejects_invalid_pane_id()                 // "bad id!" -> "Invalid pane ID."
#[test] fn rejects_missing_folder()                  // cwd that does not exist -> "Project folder not found on this machine. Choose an existing folder."
#[test] fn rejects_invalid_ssh_host()                // host "a b" -> "Enter an SSH hostname, tailnet name, or IP address."
#[test] fn rejects_seventeenth_session()             // "Close a shell before opening more than 16 active sessions."
#[test] fn input_before_open_is_refused()            // "Open this shell before sending input."
#[test] fn echoes_a_marker_through_the_shell()       // open, write "echo open-sesame-marker\r\n", collect terminal.data until the decoded output contains the marker (10 s limit)
#[test] fn opens_in_a_folder_with_spaces_and_unicode() // temp dir "open sesame ünï"; print the working directory; output contains the folder name
#[test] fn exit_emits_terminal_exit()                // write "exit\r\n" -> terminal.exit for that id
#[test] fn close_kills_the_whole_process_tree()      // start a shell, start a long sleep child, close, assert both PIDs are gone within 3 s
#[test] fn close_all_leaves_no_children()            // three sessions, close_all, all three PIDs gone
```

- [ ] **Step 2: Run** `cargo test -p open-sesame-core --test terminal`. Expected: fails to compile.
- [ ] **Step 3: Implement** `terminal.rs` on `portable-pty` (`native_pty_system`, `CommandBuilder`, one reader thread per session). Tree kill: on Unix signal the session's process group with SIGHUP then SIGKILL after one second; on Windows drop the ConPTY and terminate the child, which ends its attached processes.
- [ ] **Step 4: Wire** `Core::handle` to `Terminals`, `Core::shutdown` to `close_all`, and add the four host-side methods to the router.
- [ ] **Step 5: Run** `cargo test --workspace`. Expected: pass on the current OS.
- [ ] **Step 6: Manual check** following "Local shell smoke pass" in `desktop/README.md` steps 1, 2 and 4.
- [ ] **Step 7: Commit** `feat: terminal and SSH panes on portable-pty`.

---

### Task 6: Bounded subprocess runner and fixture CLI

**Files:**
- Create: `crates/core/src/process.rs`, `crates/core/src/bin/fixture_cli.rs`, `crates/core/tests/process.rs`

**Interfaces:**
- Produces:
  - `pub struct Cancel` (cloneable flag) with `Cancel::new()`, `cancel(&self)`, `is_cancelled(&self) -> bool`.
  - `pub struct Run { pub program: PathBuf, pub args: Vec<String>, pub cwd: Option<PathBuf>, pub env: Vec<(String, String)>, pub stdin: Option<Vec<u8>>, pub timeout: Duration, pub max_output: usize, pub cancel: Option<Cancel> }`
  - `pub struct Output { pub status: Option<i32>, pub stdout: Vec<u8>, pub stderr: Vec<u8> }`
  - `pub enum RunError { NotFound, Timeout, Cancelled, TooLarge, Io(String) }`
  - `pub fn run(run: Run, on_line: Option<&mut dyn FnMut(&str)>) -> Result<Output, RunError>`; `on_line` receives each complete stdout line as it arrives.
  - `pub fn resolve(name: &str, explicit: Option<&Path>) -> Option<PathBuf>` (explicit path if given, otherwise a `PATH` search that honours `PATHEXT` on Windows).
  - The child runs in its own process group on Unix and its own job object on Windows; every exit path (timeout, cancel, output cap, drop) kills the whole tree.
- `fixture_cli` is a Rust port of `desktop/tests/fixtures/coven_cli.py` with these extra subcommands for the runner tests: `sleep <seconds>`, `spawn-child-and-sleep` (prints the child PID on the first line), `flood <bytes>`, `lines <n>`.

- [ ] **Step 1: Write the failing tests** in `crates/core/tests/process.rs`, using `env!("CARGO_BIN_EXE_fixture_cli")`:

```rust
#[test] fn missing_program_is_not_found()
#[test] fn captures_stdout_and_exit_status()
#[test] fn streams_lines_in_order()                 // `lines 3` -> on_line called with "1","2","3"
#[test] fn timeout_kills_the_child()                // `sleep 30`, timeout 300 ms -> RunError::Timeout in under 3 s
#[test] fn cancel_kills_the_child()                 // cancel from another thread after 200 ms -> RunError::Cancelled
#[test] fn output_cap_is_enforced()                 // `flood 1000000`, max_output 1024 -> RunError::TooLarge
#[test] fn grandchild_is_killed_on_timeout()        // `spawn-child-and-sleep`; read the PID from on_line; after Timeout that PID is gone within 3 s
#[test] fn runs_in_a_cwd_with_spaces_and_unicode()
```

- [ ] **Step 2: Run** `cargo test -p open-sesame-core --test process`. Expected: fails to compile.
- [ ] **Step 3: Implement** `process.rs` and `fixture_cli.rs`.
- [ ] **Step 4: Run** the same command. Expected: pass.
- [ ] **Step 5: Commit** `feat(core): bounded subprocess runner`.

---

### Task 7: Coven Familiars

**Files:**
- Create: `crates/core/src/coven.rs`, `crates/core/src/avatars.rs`, `crates/core/tests/coven.rs`, `crates/core/tests/avatars.rs`
- Modify: `crates/core/src/lib.rs`, `src-tauri/src/router.rs`

**Interfaces:**
- Consumes: `process::{run, Run, Cancel, resolve}`, `Emit`.
- Produces: `pub struct Coven`; `Coven::new(data_dir: PathBuf, cli: Option<PathBuf>, emit: Emit) -> Coven`; methods named after `CovenRuntime` in `desktop/coven_runtime.py`: `status`, `familiars`, `open`, `command`, `send`, `cancel`, `set_avatar`, `prepare_permission(&self, operation: &str, params: &Map<String, Value>) -> Result<Permission, BridgeError>`, `finish_permission(&self, token: &str, approved: bool) -> BridgeResult`, `close`. `pub struct Permission { pub token: String, pub title: String, pub message: String }`.
- State directory: `data_dir/familiars`, where `data_dir` is Tauri's `app_data_dir()`.
- Avatars are resized to 128 pixels and written as PNG with the `image` crate, replacing `sips`.
- Router: `coven.avatar.set`, and `coven.send` when `params.permission == "full"`, call `prepare_permission`, show a native confirm dialog (dialog plugin) with the returned title and message, then call `finish_permission` with the answer. `coven.permissions.cancel` dismisses a pending confirmation as declined. All other `coven.*` methods go straight to the core.

- [ ] **Step 1: Write the failing tests.** Translate all 32 tests in `desktop/tests/test_coven_runtime.py` into `crates/core/tests/coven.rs` and all 5 in `desktop/tests/test_familiar_avatars.py` into `crates/core/tests/avatars.rs`, keeping each test's name and assertions and pointing `cli` at the fixture binary. Add:

```rust
#[test] fn missing_cli_reports_the_python_message()   // cli: Some("/nonexistent/coven") -> the same sentence resolve_cli() produces
#[test] fn full_access_send_without_approval_runs_nothing() // prepare, finish(token, false) -> error; fixture records no invocation
#[test] fn permission_token_cannot_be_reused()
```

- [ ] **Step 2: Run** `cargo test -p open-sesame-core --test coven --test avatars`. Expected: fails to compile.
- [ ] **Step 3: Implement** `coven.rs` and `avatars.rs` as a behaviour-for-behaviour port of `coven_runtime.py` and `familiar_avatars.py`: same CLI arguments, limits, timeouts, event shapes and error strings.
- [ ] **Step 4: Wire** `Core::handle`, `Core::shutdown` (`close`) and the router confirmation flow.
- [ ] **Step 5: Run** `cargo test --workspace`. Expected: pass.
- [ ] **Step 6: Commit** `feat: Coven Familiars on the Rust core`.

---

### Task 8: GitHub monitor

**Files:**
- Create: `crates/core/src/github.rs`, `crates/core/tests/github.rs`
- Modify: `crates/core/src/lib.rs`, `crates/core/src/bin/fixture_cli.rs` (add the `gh` responses the tests need)

**Interfaces:**
- Consumes: `process::{run, Run, resolve}`.
- Produces: `pub struct GitHub`; `GitHub::new(data_dir: PathBuf, cli: Option<PathBuf>) -> GitHub`; `status(force: bool)`, `add(repository: &str)`, `remove(repository: &str)`, `snapshot(repository: &str, force: bool)`, each returning `BridgeResult`. Allowed parameter sets per method are those in the `github.*` branch of `Bridge.handle`; extra parameters are rejected.
- Settings file permissions: keep the owner-only checks from `github_monitor.py` on Unix; on Windows skip the mode check.

- [ ] **Step 1: Write the failing tests.** Translate all 10 tests in `desktop/tests/test_github_monitor.py`, same names and assertions.
- [ ] **Step 2: Run** `cargo test -p open-sesame-core --test github`. Expected: fails to compile.
- [ ] **Step 3: Implement** `github.rs` as a port of `desktop/github_monitor.py` and wire `Core::handle`.
- [ ] **Step 4: Run** the same command. Expected: pass.
- [ ] **Step 5: Commit** `feat: GitHub monitor on the Rust core`.

---

### Task 9: Feeds and reader

**Files:**
- Create: `crates/core/src/reading.rs`, `crates/core/tests/reading.rs`
- Modify: `crates/core/src/lib.rs`, `src-tauri/src/router.rs`

**Interfaces:**
- Produces: `pub fn fetch_feed(params: &Map<String, Value>) -> BridgeResult` (`feeds.fetch`), `pub fn fetch_page(params: &Map<String, Value>) -> BridgeResult` (`reading.fetch`), `pub fn fetch_pdf(params: &Map<String, Value>) -> BridgeResult` (`reading.pdf`). Same URL rules, size limits, timeouts and result shapes as `desktop/feeds.py` and `desktop/reader.py`. HTTP through `ureq`.
- Host-side: `reading.saveEPUB` and `reading.saveRSS` show a save dialog and write the bytes supplied by the UI, with the parameters and limits of the Swift branches of the same names.

- [ ] **Step 1: Write the failing tests.** Translate the 3 tests in `desktop/tests/test_feeds.py` and the 3 in `desktop/tests/test_reading_bash.py`, serving fixtures from a `std::net::TcpListener` on `127.0.0.1` inside the test.
- [ ] **Step 2: Run** `cargo test -p open-sesame-core --test reading`. Expected: fails to compile.
- [ ] **Step 3: Implement** and wire.
- [ ] **Step 4: Run** the same command. Expected: pass.
- [ ] **Step 5: Commit** `feat: feeds and reader on the Rust core`.

---

### Task 10: Image Studio and agent monitor

**Files:**
- Create: `crates/core/src/image.rs`, `crates/core/src/agents.rs`, `crates/core/tests/image.rs`, `crates/core/tests/agents.rs`
- Modify: `crates/core/src/lib.rs`, `src-tauri/src/router.rs`

**Interfaces:**
- Consumes: `process::{run, Run, Cancel, resolve}`, `gate::NOT_ON_OS`.
- Produces:
  - `pub struct Images`; `Images::new(cli: Option<PathBuf>) -> Images`; `status()`, `generate(params)`, `cancel()` as in `desktop/image_generation.py`. Host-side `image.save` shows a save dialog and writes the PNG, with the checks in `desktop/ImageExport.swift`.
  - `pub struct Agents`; `Agents::new(data_dir: PathBuf) -> Agents`; `snapshot(params)`, `control(params)`, `clear_history(params)` as in `desktop/agent_monitor.py`, `desktop/agent_activity.py` and `desktop/process_workspace.py`.
  - Process listing uses the `sysinfo` crate on all three operating systems instead of parsing `ps`. `control` with Pause or Resume returns `NOT_ON_OS` on Windows; Stop uses SIGTERM on Unix and process termination on Windows. The identity and short-lived capability checks before any signal are kept exactly.

- [ ] **Step 1: Write the failing tests.** Translate the 8 tests in `desktop/tests/test_image_generation.py`, the 10 in `test_agent_monitor.py`, the 5 in `test_agent_controls.py`, the 4 in `test_agent.py` and the 6 in `test_process_workspace.py`, same names and assertions. Tests that fed `ps` text to the parser instead build the equivalent process records directly. Add:

```rust
#[cfg(windows)] #[test] fn pause_is_unavailable_on_windows()   // control {action: "pause"} -> NOT_ON_OS
#[test] fn stop_refuses_a_process_owned_by_another_user()
```

- [ ] **Step 2: Run** `cargo test -p open-sesame-core --test image --test agents`. Expected: fails to compile.
- [ ] **Step 3: Implement** and wire.
- [ ] **Step 4: Run** `cargo test --workspace`. Expected: pass.
- [ ] **Step 5: Commit** `feat: Image Studio and agent monitor on the Rust core`.

---

### Task 11: Remove the old hosts and retarget checks, CI and docs

**Files:**
- Delete: `desktop/*.swift`, `desktop/*.py` except `desktop/dev_server.py`, `desktop/tests/` except `test_login_preview.py`, `desktop/engine/`, `desktop/build-macos.sh`, `desktop/photon-controller.mjs`, `desktop/diarization-constraints.txt`, `desktop/controller-setup.md`, `run-macos.sh`, `examples/coven_familiars.py`, `scripts/build-workos-sdk.py`, `scripts/build-coven-engine.py`, `scripts/build-app-icon.py`, `scripts/check-app-icon.py`, `scripts/check-process-package.py`, `scripts/check-native.sh`, `scripts/check-authentication.sh`, `scripts/check-screen-notes.sh`, `scripts/check-vnc-native.sh`, `scripts/fixtures/vnc-transport.swift`, `scripts/review-media-native.swift`, `scripts/tests/test_embedded_engine_build.py`
- Keep: `desktop/dev_server.py` is the one Python file that stays, because `npm run dev` (the browser preview) uses it and it is not part of the shipped app. Keep `desktop/tests/test_login_preview.py` with it, moved to `scripts/tests/`.
- Modify: `scripts/check-auth-entrypoint.mjs`, `scripts/check-auth-ui.mjs`, `scripts/check-app-version.mjs`, `scripts/check-branding.mjs`, `scripts/check-computer-agent.mjs`, `scripts/check-controller.mjs`, `scripts/check-escape.mjs`, `scripts/check-familiar-rail.mjs`, `scripts/check-familiars-ui.mjs`, `scripts/check-flat-theme.mjs`, `scripts/check-media-drop.mjs`, `scripts/check-widget-input.mjs`, `scripts/check-workspace-interactions.mjs`, `scripts/check-protected-share.mjs`, `scripts/check-public-spotify-client.mjs`, `scripts/check-native-surfaces.mjs`, `scripts/verify.py`, `scripts/distribution_safety.py`, `scripts/build-desktop-source.py`, `.github/workflows/verify.yml`, `package.json`, `README.md`, `AGENTS.md`, `desktop/README.md`, `desktop/AGENTS.md`, `dist/AGENTS.md`, `scripts/AGENTS.md`, `docs/capabilities.md`, `docs/repository-map.md`, `docs/workos-login.md`, `docs/README.md`, and every other file under `docs/` that `npm run check:docs` reports after the deletions

**Rules for the modified checks:** in each listed `check-*.mjs`, every assertion that reads a `desktop/*.swift` file is either pointed at the Rust file that now owns that behaviour (for example the client ID and redirect in `crates/core/src/auth/mod.rs`, the gate messages in `crates/core/src/gate.rs`, the version injection in `src-tauri/src/lib.rs`) or removed when the behaviour belongs to a not-ported feature. Assertions about `dist/` files are left alone.

- [ ] **Step 1: Delete** the files listed above.
- [ ] **Step 2: Run** `npm run check`. Expected: failures only in the sixteen `check-*.mjs` files listed under Modify.
- [ ] **Step 3: Update** those checks by the rules above until `npm run check` passes.
- [ ] **Step 4: Update `scripts/verify.py`.** Remove the Swift, embedded-engine, Mac bundle, icon and process-package steps. Add `cargo test --workspace --locked` (300 second limit) and `cargo build -p open-sesame --locked` (600 second limit) on every platform it runs on. Record `rustc --version` and `cargo --version` in the report in place of the Swift version. `--portable` skips only `cargo build`.
- [ ] **Step 5: Update `.github/workflows/verify.yml`.** Matrix `ubuntu-24.04`, `macos-15`, `windows-2025`. On Linux install `libwebkit2gtk-4.1-dev build-essential libssl-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev lsof` (confirm the first six against the Tauri prerequisites page). Remove the Xcode step. Linux and macOS run `npm run verify`. Windows runs `cargo test --workspace --locked` and `cargo build -p open-sesame --locked` directly, because `scripts/run_bounded.py` uses `os.waitid`. Raise `timeout-minutes` to 30.
- [ ] **Step 6: Update the documents.** `README.md`, `desktop/README.md` and `docs/repository-map.md` describe the Tauri app, `npm run dev:app`, `npm run build:app` and the Rust prerequisites. `docs/capabilities.md` replaces the macOS companion and Windows/Linux rows with one desktop row, and marks each not-ported surface as "not in the Tauri app". `docs/workos-login.md` names the system keychain and the deep-link plugin. A document that describes only a not-ported feature (for example `docs/protected-share.md`) moves to `docs/archive/2026-11-12-<name>.md` and is dropped from `docs/README.md`. In every remaining document, a link to a deleted source file becomes plain code text naming the file.
- [ ] **Step 7: Run** `npm run check:docs`, `npm run check`, `cargo test --workspace --locked` and `npm run verify`. Expected: all pass.
- [ ] **Step 8: Run** `git grep -nE "\.swift|bridge\.py|build-macos|python-path" -- . ":!docs/archive" ":!docs/mobile" ":!docs/superpowers" ":!vendor-src"`. Expected: no output.
- [ ] **Step 9: Commit** `chore: remove Swift and Python hosts; retarget checks, CI and docs`.

---

### Task 12: Build and smoke-test on all three operating systems

**Files:**
- Create: `docs/desktop-smoke-pass.md`

**Interfaces:**
- Consumes: the finished app.

- [ ] **Step 1: Write `docs/desktop-smoke-pass.md`** as a checklist with one column per OS: build with `npm run build:app`; launch the built app; sign in; open a local shell in a connected project and run a command; resize the pane; Tab completion; Ctrl+C on a long command; open an SSH pane to a known host; connect Coven and send one message to a familiar; open the GitHub monitor; fetch one feed; press a voice control and confirm it reports the "not available in this version" message without breaking the page; quit and confirm no shell, SSH or CLI process started by the app is still running; relaunch and confirm the session is restored.
- [ ] **Step 2: Run the checklist** on macOS, Windows and Linux and record the result of each line with the commit hash tested.
- [ ] **Step 3: File or fix** every layout or behaviour difference found on WebView2 and WebKitGTK. Fixes go in `dist/` with a matching `scripts/check-*.mjs` assertion.
- [ ] **Step 4: Commit** `docs: desktop smoke pass results`.
