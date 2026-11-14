//! Sign-in wiring (issue #72): joins the sign-in logic in the core (issue #69) to the system
//! browser, the callback the system hands back, the operating system's credential store and
//! the window.
//!
//! The core decides everything about a session. This module supplies what it cannot do
//! itself: the network calls ([`HttpApi`]), the saved credential ([`KeychainStore`]), the
//! signed-out flag ([`Marker`]), a browser, and two threads that pass changes to the page and
//! refresh the session when it is due.
//!
//! Sign-in is an account control, not a door (issue #60): the window opens in the workspace
//! and every local feature runs signed out. Nothing here locks anything when the network is
//! away; a refresh that cannot reach the server is tried again and the session simply lapses.
//!
//! Rules that must hold:
//!
//! - Only an address on the WorkOS API origin is ever handed to the browser.
//! - A callback is passed to the core as it arrived. The core checks it against the pending
//!   `state`; a callback from another process with no sign-in pending changes nothing.
//! - The refresh token is saved only through the operating system's credential store. No
//!   token, address, name or email is logged, printed, put in an error or sent to the page
//!   beyond the status. A development build prints two lines: the status flags with the
//!   fixed sentence, and the kind of a link that arrived.

use crate::{summon, window};
use open_sesame_core::auth::{
    authenticate_url, error_from_response, exchange_body, jwks_url, parse_jwks, parse_tokens,
    refresh_body, AuthController, AuthError, AuthParts, CredentialStore, Jwks, SignedOutMarker,
    Tokens, WorkosApi, API, CLIENT_ID, REDIRECT, SIGNED_OUT,
};
use open_sesame_core::protocol::{BridgeError, BridgeResult, Emit};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Manager, Runtime};

pub const BUSY: &str = "A sign-in is already open in your browser. Finish it there, or cancel it.";
pub const NOT_STARTED: &str = "Could not start sign-in. Try again.";
pub const NO_BROWSER: &str =
    "Could not open your browser. Check that a default browser is set, then try again.";
/// Shown on Linux when there is no Secret Service. Without one there is nowhere safe to keep a
/// sign-in, so the browser is not opened at all. It says to start again because the store is
/// opened once for as long as the application runs ([`KeychainStore::exists`]): a keyring
/// installed afterwards is not seen until then.
pub const NO_SECRET_SERVICE: &str = "Open Sesame keeps your sign-in in the system keyring, and none is available. Install a Secret Service keyring such as GNOME Keyring or KWallet, then quit Open Sesame and start it again. Everything on this computer works without signing in.";
/// Shown when the system has a credential store that would not answer: a keyring that is
/// locked, or whose prompt was dismissed.
pub const NO_KEYCHAIN: &str = "Open Sesame could not reach the system's credential store to keep your sign-in. Unlock it and try again. Everything on this computer works without signing in.";

/// The event the page receives whenever the sign-in status may have changed.
pub const CHANGED_EVENT: &str = "auth.changed";

/// The network timeout the core asks for.
const TIMEOUT: Duration = Duration::from_secs(20);
/// Larger than any answer the token or key-set endpoints give.
const MAX_ANSWER_BYTES: u64 = 1024 * 1024;
/// The longest the refresh thread sleeps before it looks at the clock again.
const TICK: Duration = Duration::from_secs(30);
/// The shortest time between two refreshes this thread starts.
const BETWEEN_ATTEMPTS: Duration = Duration::from_secs(20);

/// What an address handed to the application by the system is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Link {
    /// The browser came back from sign-in. The core validates it.
    Callback,
    /// The browser came back after the remote session was ended.
    SignedOut,
    /// Anything else. Ignored.
    Other,
}

/// Sorts an address by its exact scheme, host and path. Only what follows the path may vary:
/// nothing, a query or a fragment. The core applies the strict rules to a callback.
pub fn classify(url: &str) -> Link {
    let follows = |target: &str| {
        url.strip_prefix(target)
            .is_some_and(|rest| rest.is_empty() || rest.starts_with('?') || rest.starts_with('#'))
    };
    if follows(REDIRECT) {
        Link::Callback
    } else if follows(SIGNED_OUT) {
        Link::SignedOut
    } else {
        Link::Other
    }
}

/// Whether an address may be handed to the browser: only the WorkOS API origin, over TLS.
pub fn may_open(url: &str) -> bool {
    url.strip_prefix(API)
        .is_some_and(|rest| rest.starts_with('/'))
}

/// The WorkOS calls over HTTPS.
pub struct HttpApi {
    agent: ureq::Agent,
    authenticate: String,
    jwks: String,
}

impl HttpApi {
    /// The real endpoints.
    pub fn workos() -> HttpApi {
        HttpApi::at(authenticate_url(), jwks_url())
    }

    /// The same client against other addresses. Tests point it at a stand-in server.
    pub fn at(authenticate: String, jwks: String) -> HttpApi {
        let agent = ureq::Agent::config_builder()
            .timeout_global(Some(TIMEOUT))
            // A status is an answer to classify, not a transport failure.
            .http_status_as_error(false)
            // The endpoints do not redirect; following one could send a code elsewhere.
            .max_redirects(0)
            .build()
            .new_agent();
        HttpApi {
            agent,
            authenticate,
            jwks,
        }
    }

    fn read(mut response: ureq::http::Response<ureq::Body>) -> Result<(u16, Vec<u8>), AuthError> {
        let status = response.status().as_u16();
        let body = response
            .body_mut()
            .with_config()
            .limit(MAX_ANSWER_BYTES)
            .read_to_vec()
            .map_err(|_| AuthError::Network)?;
        Ok((status, body))
    }

    fn tokens(&self, body: Value) -> Result<Tokens, AuthError> {
        let response = self
            .agent
            .post(&self.authenticate)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .send(body.to_string())
            .map_err(|_| AuthError::Network)?;
        let (status, body) = HttpApi::read(response)?;
        if (200..300).contains(&status) {
            parse_tokens(&body)
        } else {
            Err(error_from_response(status, &body))
        }
    }
}

impl WorkosApi for HttpApi {
    fn exchange_code(&self, code: &str, verifier: &str) -> Result<Tokens, AuthError> {
        self.tokens(exchange_body(code, verifier))
    }

    fn refresh(&self, refresh_token: &str) -> Result<Tokens, AuthError> {
        self.tokens(refresh_body(refresh_token))
    }

    fn jwks(&self) -> Result<Jwks, AuthError> {
        let response = self
            .agent
            .get(&self.jwks)
            .header("Accept", "application/json")
            .call()
            .map_err(|_| AuthError::Network)?;
        let (status, body) = HttpApi::read(response)?;
        if (200..300).contains(&status) {
            parse_jwks(&body)
        } else {
            Err(AuthError::Network)
        }
    }
}

/// The refresh token in Keychain, Windows Credential Manager or the Secret Service.
pub struct KeychainStore {
    service: String,
}

impl KeychainStore {
    /// `service` names the entry. It must differ from the installed Swift app's, because a
    /// refresh token is replaced each time it is used and two applications sharing one would
    /// sign each other out.
    pub fn new(service: String) -> KeychainStore {
        KeychainStore { service }
    }

    fn entry(&self) -> Result<keyring::Entry, AuthError> {
        keyring::Entry::new(&self.service, CLIENT_ID).map_err(|_| AuthError::Store)
    }

    /// Whether the store can be reached at all. An empty store is reachable. On Linux this
    /// can take as long as a person takes to answer the keyring's unlock prompt, so it must
    /// not be asked on the main thread.
    pub fn available(&self) -> bool {
        self.load().is_ok()
    }

    /// Whether the system has a credential store at all. The `keyring` crate opens the store
    /// the first time it is asked and keeps that answer for as long as the application runs,
    /// so a Secret Service that appears later is not seen until the application starts again.
    pub fn exists() -> bool {
        keyring::Entry::store_status().is_ok()
    }
}

impl CredentialStore for KeychainStore {
    fn load(&self) -> Result<Option<String>, AuthError> {
        match self.entry()?.get_password() {
            Ok(token) => Ok(Some(token)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(AuthError::Store),
        }
    }

    fn save(&self, refresh_token: &str) -> Result<(), AuthError> {
        self.entry()?
            .set_password(refresh_token)
            .map_err(|_| AuthError::Store)
    }

    fn delete(&self) -> Result<(), AuthError> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(AuthError::Store),
        }
    }
}

/// The name of the saved credential for an application with this bundle identifier.
pub fn credential_service(identifier: &str) -> String {
    format!("{identifier}.tauri.workos.production")
}

/// The "the user signed out" flag: a small file when a folder is given, otherwise memory.
///
/// It matters only when sign-out could not delete the credential. See `summon.rs` for why a
/// release build has no folder yet (issues #87 and #105); until it has one, a credential that
/// could not be deleted is used again at the next launch.
pub struct Marker {
    path: Option<PathBuf>,
    memory: AtomicBool,
}

impl Marker {
    pub fn new(path: Option<PathBuf>) -> Marker {
        Marker {
            path,
            memory: AtomicBool::new(false),
        }
    }
}

impl SignedOutMarker for Marker {
    fn signed_out(&self) -> bool {
        match &self.path {
            Some(path) => path.exists(),
            None => self.memory.load(Ordering::SeqCst),
        }
    }

    fn set_signed_out(&self, value: bool) {
        self.memory.store(value, Ordering::SeqCst);
        if let Some(path) = &self.path {
            if value {
                if let Some(folder) = path.parent() {
                    let _ = std::fs::create_dir_all(folder);
                }
                let _ = std::fs::write(path, b"signed out\n");
            } else {
                let _ = std::fs::remove_file(path);
            }
        }
    }
}

/// Hands an address to the system browser. Returns whether the system accepted it.
pub type Browser = Arc<dyn Fn(&str) -> bool + Send + Sync>;
/// Says why sign-in cannot be kept on this computer, if it cannot.
pub type StoreCheck = Arc<dyn Fn() -> Option<&'static str> + Send + Sync>;

/// Why a sign-in could not be kept on this computer, if it could not. `answered` is whether
/// the store could be read just now and `exists` whether the system has one at all. Only a
/// Linux desktop can be without one; everywhere else, and on Linux when the keyring is there
/// but locked, the store is one to unlock.
fn store_problem(answered: bool, exists: bool) -> Option<&'static str> {
    if answered {
        None
    } else if cfg!(target_os = "linux") && !exists {
        Some(NO_SECRET_SERVICE)
    } else {
        Some(NO_KEYCHAIN)
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// How long the refresh thread sleeps before it looks again: until the refresh is due, but not
/// before the next attempt is allowed, and never longer than [`TICK`], because a timeout does
/// not count time the computer is asleep and a session's deadline does. A refresh that is due
/// while the next attempt is not yet allowed must wait for it; with no wait at all the thread
/// would spin until then.
fn pause(due: Option<Duration>, allowed_in: Duration) -> Duration {
    due.map_or(TICK, |due| due.max(allowed_in)).min(TICK)
}

/// The sign-in state the application keeps.
pub struct Auth {
    controller: Arc<AuthController>,
    browser: Browser,
    store_check: StoreCheck,
    /// Keeps a window that hides on blur in place while the person is in the browser.
    hold: Mutex<Option<summon::Hold>>,
    /// Wakes the two threads once more at shutdown, so they see `stopped` and end.
    wake: Mutex<Option<(Sender<()>, Sender<()>)>>,
    stopped: AtomicBool,
}

/// The receiving ends for [`Auth::run`].
pub struct Wakes {
    notify: Receiver<()>,
    refresh: Receiver<()>,
}

impl Auth {
    /// Builds the controller around what the host supplies.
    pub fn new(
        api: Arc<dyn WorkosApi>,
        store: Arc<dyn CredentialStore>,
        marker: Arc<dyn SignedOutMarker>,
        browser: Browser,
        store_check: StoreCheck,
    ) -> (Arc<Auth>, Wakes) {
        let (notify_tx, notify) = channel();
        let (refresh_tx, refresh) = channel();
        let senders = (notify_tx.clone(), refresh_tx.clone());
        let on_change = Arc::new(move || {
            let _ = notify_tx.send(());
            let _ = refresh_tx.send(());
        });
        let controller = Arc::new(AuthController::new(AuthParts {
            api,
            store,
            marker,
            clock: Arc::new(SystemTime::now),
            on_change,
        }));
        let auth = Arc::new(Auth {
            controller,
            browser,
            store_check,
            hold: Mutex::new(None),
            wake: Mutex::new(Some(senders)),
            stopped: AtomicBool::new(false),
        });
        (auth, Wakes { notify, refresh })
    }

    /// Whether a verified session is within its deadline. The gate asks before each request.
    pub fn authenticated(&self) -> bool {
        self.controller.authenticated()
    }

    pub fn status(&self) -> Value {
        self.controller.status()
    }

    /// Answers a sign-in method. `hold` takes the hide-on-blur guard when a browser opens.
    pub fn handle(
        &self,
        method: &str,
        hold: impl FnOnce() -> Option<summon::Hold>,
    ) -> BridgeResult {
        match method {
            "auth.status" => Ok(self.status()),
            "auth.signIn" => {
                // Checked before the browser opens: a sign-in that cannot be kept would send
                // the person through the browser for a session that is gone at the next launch.
                if let Some(problem) = (self.store_check)() {
                    return Err(BridgeError::from(problem));
                }
                let url = self.controller.begin_sign_in().map_err(|error| {
                    BridgeError::from(match error {
                        AuthError::Busy => BUSY,
                        _ => NOT_STARTED,
                    })
                })?;
                *lock(&self.hold) = hold();
                if !(may_open(&url) && (self.browser)(&url)) {
                    self.controller.cancel();
                    return Err(BridgeError::from(NO_BROWSER));
                }
                Ok(Value::Bool(true))
            }
            "auth.cancel" => {
                self.controller.cancel();
                Ok(Value::Bool(true))
            }
            "auth.signOut" => {
                // Signing out here is complete without the browser; ending the remote session
                // as well is a courtesy, so a browser that will not open is not an error.
                if let Some(url) = self.controller.sign_out() {
                    if may_open(&url) {
                        let _ = (self.browser)(&url);
                    }
                }
                Ok(Value::Bool(true))
            }
            _ => Err(BridgeError::from(open_sesame_core::gate::UNSUPPORTED)),
        }
    }

    /// An address the system handed over. Returns what it was. A callback is exchanged on a
    /// thread of its own, because that is a network call.
    pub fn link(self: &Arc<Self>, url: &str) -> Link {
        let kind = classify(url);
        if kind == Link::Callback {
            let auth = Arc::clone(self);
            let url = url.to_string();
            std::thread::spawn(move || auth.controller.complete_sign_in(&url));
        }
        kind
    }

    /// At launch: restores the saved session, off the calling thread. `ready` is asked on
    /// that thread first, because asking the credential store can wait for a person: a locked
    /// keyring shows its unlock prompt, and the window must not wait for the answer.
    pub fn restore(self: &Arc<Self>, ready: impl FnOnce() -> bool + Send + 'static) {
        let auth = Arc::clone(self);
        std::thread::spawn(move || {
            if ready() && !auth.stopped.load(Ordering::SeqCst) {
                auth.controller.restore();
            }
        });
    }

    /// Starts the two threads. `changed` is called with the new status after each change.
    pub fn run(self: &Arc<Self>, wakes: Wakes, changed: impl Fn(Value) + Send + 'static) {
        let auth = Arc::clone(self);
        std::thread::spawn(move || {
            while wakes.notify.recv().is_ok() {
                if auth.stopped.load(Ordering::SeqCst) {
                    break;
                }
                let status = auth.status();
                // The person is back from the browser, or gave up: the window may hide again.
                if status["busy"] != Value::Bool(true) {
                    lock(&auth.hold).take();
                }
                changed(status);
            }
        });
        let auth = Arc::clone(self);
        std::thread::spawn(move || {
            // No sooner than this after an attempt, whatever the controller says is due: a
            // failure it does not schedule a retry for must not become a loop of requests.
            let mut not_before = Instant::now();
            loop {
                let due = auth.controller.next_refresh_in();
                let allowed_in = not_before.saturating_duration_since(Instant::now());
                match wakes.refresh.recv_timeout(pause(due, allowed_in)) {
                    // Something changed: work out again when the next refresh is due.
                    Ok(()) => {}
                    Err(RecvTimeoutError::Disconnected) => break,
                    Err(RecvTimeoutError::Timeout) => {
                        let now = Instant::now();
                        let is_due = auth
                            .controller
                            .next_refresh_in()
                            .is_some_and(|left| left.is_zero());
                        if is_due && now >= not_before {
                            not_before = now + BETWEEN_ATTEMPTS;
                            auth.controller.refresh();
                        }
                    }
                }
                if auth.stopped.load(Ordering::SeqCst) {
                    break;
                }
            }
        });
    }

    /// At quit: discards anything in flight and stops the threads. What is saved is kept.
    pub fn shutdown(&self) {
        self.controller.shutdown();
        self.stopped.store(true, Ordering::SeqCst);
        if let Some((notify, refresh)) = lock(&self.wake).take() {
            let _ = notify.send(());
            let _ = refresh.send(());
        }
        lock(&self.hold).take();
    }
}

/// The folder for the signed-out flag, or `None` to keep it in memory. See [`Marker`].
fn marker_path() -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    if let Some(folder) = std::env::var_os("OPEN_SESAME_DEV_CONFIG_DIR") {
        return Some(PathBuf::from(folder).join("signed-out"));
    }
    None
}

/// A stand-in for the WorkOS API on this machine, for a development build only: a loopback
/// address with a port and nothing after it. Anything else is refused, so the variable cannot
/// send a code or a credential to another machine.
#[cfg(any(debug_assertions, test))]
pub fn dev_api_base(value: &str) -> Option<&str> {
    let port = value
        .strip_prefix("http://127.0.0.1:")
        .or_else(|| value.strip_prefix("http://localhost:"))?;
    let valid = !port.is_empty()
        && port.len() <= 5
        && port.bytes().all(|byte| byte.is_ascii_digit())
        && port.parse::<u16>().is_ok_and(|port| port != 0);
    valid.then_some(value)
}

/// The WorkOS calls. A release build always talks to WorkOS. A development build started with
/// `OPEN_SESAME_DEV_AUTH_API` talks to a stand-in on this machine instead, which is how the
/// launched-application checks sign in without an account.
fn workos_api() -> HttpApi {
    #[cfg(debug_assertions)]
    if let Ok(value) = std::env::var("OPEN_SESAME_DEV_AUTH_API") {
        if let Some(base) = dev_api_base(&value) {
            return HttpApi::at(
                authenticate_url().replacen(API, base, 1),
                jwks_url().replacen(API, base, 1),
            );
        }
    }
    HttpApi::workos()
}

/// Builds the real parts, restores the saved session and starts listening for callbacks.
pub fn start<R: Runtime>(app: &AppHandle<R>, emit: Emit) {
    let store = Arc::new(KeychainStore::new(credential_service(
        &app.config().identifier,
    )));
    let probe = Arc::clone(&store);
    let store_check: StoreCheck =
        Arc::new(move || store_problem(probe.available(), KeychainStore::exists()));
    let saved = Arc::clone(&store);
    let browser: Browser = Arc::new(|url| tauri_plugin_opener::open_url(url, None::<&str>).is_ok());
    let (auth, wakes) = Auth::new(
        Arc::new(workos_api()),
        store,
        Arc::new(Marker::new(marker_path())),
        browser,
        store_check,
    );
    auth.run(wakes, move |status| {
        // A development build says what changed, for the launched-application checks: the two
        // flags and the fixed sentence, never a name, an address or a credential.
        #[cfg(debug_assertions)]
        eprintln!(
            "open-sesame: sign-in authenticated={} busy={} message={}",
            status["authenticated"], status["busy"], status["message"]
        );
        emit(json!({"event": CHANGED_EVENT, "status": status}));
    });
    // On Linux a desktop without a Secret Service is ordinary, and then nothing was ever saved:
    // there is no session to restore and nothing to tell a person who never signed in. On
    // macOS and Windows the store always exists, so a failure to read it is worth saying.
    // The store is asked on the restore thread and never here: this runs on the main thread
    // before the window exists, and a locked keyring answers only after its prompt does.
    auth.restore(move || !cfg!(target_os = "linux") || saved.available());
    app.manage(Arc::clone(&auth));
    listen(app, auth);
}

/// Passes each address the system hands over to [`Auth::link`], and brings the window forward
/// when the browser comes back, since on macOS no second launch does that.
fn listen<R: Runtime>(app: &AppHandle<R>, auth: Arc<Auth>) {
    use tauri_plugin_deep_link::DeepLinkExt;
    // In a development build on Windows and Linux nothing has installed the scheme, so it is
    // registered here, for the current user, and stays registered after the run ends. A failure
    // only means callbacks will not arrive.
    #[cfg(all(debug_assertions, any(windows, target_os = "linux")))]
    let _ = app.deep_link().register_all();
    let handle = app.clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            let kind = auth.link(url.as_str());
            // Only what kind of address it was; the address itself carries the code.
            #[cfg(debug_assertions)]
            eprintln!("open-sesame: link {kind:?}");
            if kind != Link::Other {
                window::show(&handle);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn only_the_two_sign_in_addresses_are_links() {
        for url in [
            "opensesame://auth/callback?code=abc&state=xyz",
            "opensesame://auth/callback",
            "opensesame://auth/callback?error=access_denied",
            "opensesame://auth/callback#fragment",
        ] {
            assert_eq!(classify(url), Link::Callback, "{url}");
        }
        for url in [
            "opensesame://auth/signed-out",
            "opensesame://auth/signed-out?x=1",
        ] {
            assert_eq!(classify(url), Link::SignedOut, "{url}");
        }
        for url in [
            "",
            "--toggle",
            "opensesame://auth/callbackx?code=abc&state=xyz",
            "opensesame://auth/callback/extra?code=abc",
            "opensesame://auth/signed-outside",
            "opensesame://other/callback?code=abc",
            "opensesame://user@auth/callback?code=abc",
            "opensesame://auth:80/callback?code=abc",
            "OPENSESAME://auth/callback?code=abc",
            "opensesame-spotify://auth/callback?code=abc",
            "https://auth/callback?code=abc",
            " opensesame://auth/callback?code=abc",
        ] {
            assert_eq!(classify(url), Link::Other, "{url}");
        }
    }

    #[test]
    fn only_the_workos_origin_reaches_the_browser() {
        assert!(may_open(
            "https://api.workos.com/user_management/authorize?client_id=x"
        ));
        assert!(may_open(
            "https://api.workos.com/user_management/sessions/logout?session_id=x"
        ));
        for url in [
            "",
            "https://api.workos.com",
            "https://api.workos.com.example.com/user_management/authorize",
            "https://api.workos.comx/authorize",
            "http://api.workos.com/user_management/authorize",
            "https://example.com/",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "opensesame://auth/callback",
        ] {
            assert!(!may_open(url), "{url}");
        }
    }

    #[test]
    fn a_development_stand_in_is_a_loopback_port_and_nothing_else() {
        for value in [
            "http://127.0.0.1:8080",
            "http://localhost:1",
            "http://127.0.0.1:65535",
        ] {
            assert_eq!(dev_api_base(value), Some(value), "{value}");
        }
        for value in [
            "",
            "http://127.0.0.1",
            "http://127.0.0.1:",
            "http://127.0.0.1:0",
            "http://127.0.0.1:65536",
            "http://127.0.0.1:80/path",
            "http://127.0.0.1:80@example.com",
            "http://127.0.0.1.example.com:80",
            "http://localhost.example.com:80",
            "https://127.0.0.1:80",
            "http://192.0.2.1:80",
            "http://example.com:80",
            "https://api.workos.com",
            " http://127.0.0.1:80",
        ] {
            assert_eq!(dev_api_base(value), None, "{value}");
        }
    }

    #[test]
    fn the_saved_credential_is_not_the_installed_apps() {
        let service = credential_service("com.perch.widgetstudio");
        assert_eq!(service, "com.perch.widgetstudio.tauri.workos.production");
        // The Swift host's entry, in desktop/Authentication.swift.
        assert_ne!(service, "com.perch.widgetstudio.workos.production");
    }

    #[test]
    fn the_signed_out_flag_is_kept_in_a_file_when_there_is_a_folder() {
        let folder =
            std::env::temp_dir().join(format!("open-sesame-marker-{}", std::process::id()));
        let path = folder.join("nested").join("signed-out");
        let marker = Marker::new(Some(path.clone()));
        assert!(!marker.signed_out());
        marker.set_signed_out(true);
        assert!(marker.signed_out());
        // A second run of the application reads the same file.
        assert!(Marker::new(Some(path.clone())).signed_out());
        marker.set_signed_out(false);
        assert!(!marker.signed_out());
        assert!(!Marker::new(Some(path)).signed_out());
        std::fs::remove_dir_all(&folder).unwrap();

        // Without a folder it lasts only as long as the application.
        let memory = Marker::new(None);
        memory.set_signed_out(true);
        assert!(memory.signed_out());
        assert!(!Marker::new(None).signed_out());
    }

    /// A stand-in for the WorkOS API on a loopback port. Answers each request in turn with the
    /// next canned answer and records the method, path and body it received.
    struct StandIn {
        address: String,
        requests: Arc<Mutex<Vec<(String, String)>>>,
    }

    fn stand_in(answers: Vec<(&'static str, String)>) -> StandIn {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&requests);
        std::thread::spawn(move || {
            for (status, body) in answers {
                let Ok((mut stream, _)) = listener.accept() else {
                    return;
                };
                let mut received = Vec::new();
                let mut buffer = [0u8; 4096];
                // Read the head, then as much body as Content-Length says.
                let (head_end, length) = loop {
                    let count = stream.read(&mut buffer).unwrap_or(0);
                    if count == 0 {
                        break (received.len(), 0);
                    }
                    received.extend_from_slice(&buffer[..count]);
                    if let Some(end) = received.windows(4).position(|window| window == b"\r\n\r\n")
                    {
                        let head = String::from_utf8_lossy(&received[..end]).to_lowercase();
                        let length = head
                            .lines()
                            .find_map(|line| line.strip_prefix("content-length:"))
                            .and_then(|value| value.trim().parse::<usize>().ok())
                            .unwrap_or(0);
                        break (end + 4, length);
                    }
                };
                while received.len() < head_end + length {
                    let count = stream.read(&mut buffer).unwrap_or(0);
                    if count == 0 {
                        break;
                    }
                    received.extend_from_slice(&buffer[..count]);
                }
                let head =
                    String::from_utf8_lossy(&received[..head_end.min(received.len())]).to_string();
                let line = head.lines().next().unwrap_or_default().to_string();
                let body_received =
                    String::from_utf8_lossy(&received[head_end.min(received.len())..]).to_string();
                seen.lock().unwrap().push((line, body_received));
                let answer = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(answer.as_bytes());
            }
        });
        StandIn { address, requests }
    }

    fn api(server: &StandIn) -> HttpApi {
        HttpApi::at(
            format!("{}/user_management/authenticate", server.address),
            format!("{}/sso/jwks/client", server.address),
        )
    }

    const SESSION: &str = r#"{"access_token":"access-value","refresh_token":"refresh-value","user":{"id":"user_1","email":"person@example.com"}}"#;

    #[test]
    fn the_exchange_and_the_refresh_send_what_the_core_asks_for() {
        let server = stand_in(vec![("200 OK", SESSION.into()), ("200 OK", SESSION.into())]);
        let api = api(&server);
        let tokens = api.exchange_code("the-code", "the-verifier").unwrap();
        assert_eq!(tokens.user.id, "user_1");
        assert_eq!(tokens.refresh_token, "refresh-value");
        let tokens = api.refresh("old-refresh").unwrap();
        assert_eq!(tokens.access_token, "access-value");

        let requests = server.requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0].0, "POST /user_management/authenticate HTTP/1.1");
        let sent: Value = serde_json::from_str(&requests[0].1).unwrap();
        assert_eq!(sent, exchange_body("the-code", "the-verifier"));
        assert_eq!(sent["client_id"], json!(CLIENT_ID));
        assert!(
            sent.get("client_secret").is_none(),
            "no secret exists in a desktop app"
        );
        let sent: Value = serde_json::from_str(&requests[1].1).unwrap();
        assert_eq!(sent, refresh_body("old-refresh"));
    }

    #[test]
    fn a_refusal_ends_the_session_and_any_other_failure_may_be_tried_again() {
        let server = stand_in(vec![
            ("400 Bad Request", r#"{"error":"invalid_grant"}"#.into()),
            (
                "401 Unauthorized",
                r#"{"code":"refresh_token_revoked"}"#.into(),
            ),
            ("500 Internal Server Error", "{}".into()),
            ("429 Too Many Requests", "{}".into()),
            ("400 Bad Request", r#"{"error":"something_else"}"#.into()),
            ("200 OK", "not json".into()),
            (
                "200 OK",
                r#"{"access_token":"","refresh_token":"r","user":{"id":"u","email":"e"}}"#.into(),
            ),
            ("302 Found", "{}".into()),
        ]);
        let api = api(&server);
        assert_eq!(api.refresh("r").unwrap_err(), AuthError::Ended);
        assert_eq!(api.refresh("r").unwrap_err(), AuthError::Ended);
        assert_eq!(api.refresh("r").unwrap_err(), AuthError::Network);
        assert_eq!(api.refresh("r").unwrap_err(), AuthError::Network);
        assert_eq!(api.refresh("r").unwrap_err(), AuthError::Network);
        assert_eq!(api.refresh("r").unwrap_err(), AuthError::InvalidSession);
        assert_eq!(api.refresh("r").unwrap_err(), AuthError::InvalidSession);
        // A redirect is an answer, not somewhere to send the token next.
        assert_eq!(api.refresh("r").unwrap_err(), AuthError::Network);
        assert_eq!(server.requests.lock().unwrap().len(), 8);
    }

    #[test]
    fn no_network_is_a_failure_that_may_be_tried_again() {
        // A port nothing listens on.
        let port = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let api = HttpApi::at(
            format!("http://127.0.0.1:{port}/authenticate"),
            format!("http://127.0.0.1:{port}/jwks"),
        );
        assert_eq!(api.exchange_code("c", "v").unwrap_err(), AuthError::Network);
        assert_eq!(api.refresh("r").unwrap_err(), AuthError::Network);
        assert_eq!(api.jwks().unwrap_err(), AuthError::Network);
    }

    #[test]
    fn the_key_set_is_read_and_a_bad_answer_is_not_a_key_set() {
        let server = stand_in(vec![
            ("200 OK", r#"{"keys":[]}"#.into()),
            ("404 Not Found", "{}".into()),
            ("200 OK", "<html>".into()),
        ]);
        let api = api(&server);
        assert!(api.jwks().is_ok());
        assert_eq!(api.jwks().unwrap_err(), AuthError::Network);
        assert_eq!(api.jwks().unwrap_err(), AuthError::InvalidSession);
        assert_eq!(
            server.requests.lock().unwrap()[0].0,
            "GET /sso/jwks/client HTTP/1.1"
        );
    }

    /// A credential store in memory, and a browser that records what it was asked to open.
    struct Memory(Mutex<Option<String>>);
    impl CredentialStore for Memory {
        fn load(&self) -> Result<Option<String>, AuthError> {
            Ok(self.0.lock().unwrap().clone())
        }
        fn save(&self, refresh_token: &str) -> Result<(), AuthError> {
            *self.0.lock().unwrap() = Some(refresh_token.to_string());
            Ok(())
        }
        fn delete(&self) -> Result<(), AuthError> {
            *self.0.lock().unwrap() = None;
            Ok(())
        }
    }

    struct Parts {
        auth: Arc<Auth>,
        opened: Arc<Mutex<Vec<String>>>,
        changes: Receiver<Value>,
        requests: Arc<Mutex<Vec<(String, String)>>>,
    }

    /// The wiring with a stand-in server, a memory store and a recording browser.
    fn wired(
        answers: Vec<(&'static str, String)>,
        browser_works: bool,
        problem: Option<&'static str>,
    ) -> Parts {
        let server = stand_in(answers);
        let opened = Arc::new(Mutex::new(Vec::new()));
        let record = Arc::clone(&opened);
        let browser: Browser = Arc::new(move |url| {
            record.lock().unwrap().push(url.to_string());
            browser_works
        });
        let (auth, wakes) = Auth::new(
            Arc::new(api(&server)),
            Arc::new(Memory(Mutex::new(None))),
            Arc::new(Marker::new(None)),
            browser,
            Arc::new(move || problem),
        );
        let (tx, changes) = channel();
        auth.run(wakes, move |status| {
            let _ = tx.send(status);
        });
        Parts {
            auth,
            opened,
            changes,
            requests: server.requests,
        }
    }

    fn no_hold() -> Option<summon::Hold> {
        None
    }

    /// Waits for a status the page would be sent that satisfies `wanted`.
    fn until(changes: &Receiver<Value>, wanted: impl Fn(&Value) -> bool) -> Value {
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        loop {
            let left = deadline.saturating_duration_since(std::time::Instant::now());
            let status = changes
                .recv_timeout(left)
                .expect("the status never arrived");
            if wanted(&status) {
                return status;
            }
        }
    }

    #[test]
    fn signing_in_opens_the_workos_page_and_tells_the_page_it_is_waiting() {
        let parts = wired(vec![], true, None);
        assert_eq!(parts.auth.status()["authenticated"], json!(false));
        assert_eq!(parts.auth.handle("auth.signIn", no_hold), Ok(json!(true)));
        let opened = parts.opened.lock().unwrap().clone();
        assert_eq!(opened.len(), 1);
        assert!(
            opened[0].starts_with("https://api.workos.com/user_management/authorize?"),
            "{}",
            opened[0]
        );
        assert!(opened[0].contains("code_challenge="));
        assert!(opened[0].contains("redirect_uri=opensesame%3A%2F%2Fauth%2Fcallback"));
        let waiting = until(&parts.changes, |status| status["busy"] == json!(true));
        assert_eq!(
            waiting["message"],
            json!("Finish signing in in your browser.")
        );

        // A second press while the browser is open opens nothing more.
        assert_eq!(
            parts.auth.handle("auth.signIn", no_hold),
            Err(BridgeError::from(BUSY))
        );
        assert_eq!(parts.opened.lock().unwrap().len(), 1);

        assert_eq!(parts.auth.handle("auth.cancel", no_hold), Ok(json!(true)));
        let cancelled = until(&parts.changes, |status| status["busy"] == json!(false));
        assert_eq!(cancelled["authenticated"], json!(false));
    }

    #[test]
    fn a_callback_without_the_pending_state_sends_nothing_to_the_server() {
        let parts = wired(vec![("200 OK", SESSION.into())], true, None);
        // No sign-in is pending: a callback from any process changes nothing.
        assert_eq!(
            parts
                .auth
                .link("opensesame://auth/callback?code=stolen&state=guess"),
            Link::Callback
        );
        std::thread::sleep(Duration::from_millis(200));
        assert!(parts.requests.lock().unwrap().is_empty());
        assert_eq!(parts.auth.status()["busy"], json!(false));

        // A sign-in is pending, and the callback carries the wrong state: the attempt ends and
        // still nothing is sent.
        parts.auth.handle("auth.signIn", no_hold).unwrap();
        until(&parts.changes, |status| status["busy"] == json!(true));
        assert_eq!(
            parts
                .auth
                .link("opensesame://auth/callback?code=stolen&state=guess"),
            Link::Callback
        );
        let ended = until(&parts.changes, |status| status["busy"] == json!(false));
        assert_eq!(ended["authenticated"], json!(false));
        assert!(
            parts.requests.lock().unwrap().is_empty(),
            "no code left the application"
        );

        // Other addresses are not callbacks at all.
        assert_eq!(
            parts.auth.link("opensesame://auth/signed-out"),
            Link::SignedOut
        );
        assert_eq!(
            parts
                .auth
                .link("opensesame://elsewhere/callback?code=x&state=y"),
            Link::Other
        );
    }

    #[test]
    fn a_callback_with_the_right_state_reaches_the_server_and_an_unverified_answer_is_not_a_session(
    ) {
        // The stand-in's tokens are not signed by WorkOS, so the core must refuse the session.
        let parts = wired(
            vec![
                ("200 OK", SESSION.into()),
                ("200 OK", r#"{"keys":[]}"#.into()),
            ],
            true,
            None,
        );
        parts.auth.handle("auth.signIn", no_hold).unwrap();
        let opened = parts.opened.lock().unwrap()[0].clone();
        let state = opened
            .split(['?', '&'])
            .find_map(|pair| pair.strip_prefix("state="))
            .unwrap()
            .to_string();
        assert_eq!(
            parts.auth.link(&format!(
                "opensesame://auth/callback?code=the-code&state={state}"
            )),
            Link::Callback
        );
        let ended = until(&parts.changes, |status| status["busy"] == json!(false));
        assert_eq!(ended["authenticated"], json!(false));
        assert!(!parts.auth.authenticated());
        let requests = parts.requests.lock().unwrap();
        assert_eq!(requests[0].0, "POST /user_management/authenticate HTTP/1.1");
        let sent: Value = serde_json::from_str(&requests[0].1).unwrap();
        assert_eq!(sent["code"], json!("the-code"));
        assert_eq!(sent["grant_type"], json!("authorization_code"));
    }

    #[test]
    fn a_browser_that_will_not_open_leaves_nothing_pending() {
        let parts = wired(vec![], false, None);
        assert_eq!(
            parts.auth.handle("auth.signIn", no_hold),
            Err(BridgeError::from(NO_BROWSER))
        );
        assert_eq!(parts.auth.status()["busy"], json!(false));
        // And the next try is a fresh one, not refused as busy.
        assert_eq!(
            parts.auth.handle("auth.signIn", no_hold),
            Err(BridgeError::from(NO_BROWSER))
        );
        assert_eq!(parts.opened.lock().unwrap().len(), 2);
    }

    #[test]
    fn without_a_credential_store_the_browser_is_never_opened() {
        let parts = wired(vec![], true, Some(NO_SECRET_SERVICE));
        assert_eq!(
            parts.auth.handle("auth.signIn", no_hold),
            Err(BridgeError::from(NO_SECRET_SERVICE))
        );
        assert!(parts.opened.lock().unwrap().is_empty());
        assert_eq!(parts.auth.status()["busy"], json!(false));
    }

    #[test]
    fn signing_out_while_signed_out_is_quiet_and_opens_nothing() {
        let parts = wired(vec![], true, None);
        assert_eq!(parts.auth.handle("auth.signOut", no_hold), Ok(json!(true)));
        assert!(
            parts.opened.lock().unwrap().is_empty(),
            "no remote session is known"
        );
        let status = until(&parts.changes, |status| status["busy"] == json!(false));
        assert_eq!(status["message"], json!("Signed out on this computer."));
        assert_eq!(
            parts.auth.handle("auth.other", no_hold),
            Err(BridgeError::from(open_sesame_core::gate::UNSUPPORTED))
        );
    }

    #[test]
    fn with_the_network_away_nothing_locks_and_the_saved_credential_is_kept() {
        // A saved credential and a server that cannot be reached: the restore fails, the
        // application stays usable signed out, and the credential is still there for later.
        let port = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let store = Arc::new(Memory(Mutex::new(Some("kept-refresh".to_string()))));
        let (auth, wakes) = Auth::new(
            Arc::new(HttpApi::at(
                format!("http://127.0.0.1:{port}/authenticate"),
                format!("http://127.0.0.1:{port}/jwks"),
            )),
            Arc::clone(&store) as Arc<dyn CredentialStore>,
            Arc::new(Marker::new(None)),
            Arc::new(|_| true),
            Arc::new(|| None),
        );
        let (tx, changes) = channel();
        auth.run(wakes, move |status| {
            let _ = tx.send(status);
        });
        auth.restore(|| true);
        let status = until(&changes, |status| {
            status["busy"] == json!(false)
                && status["message"]
                    == json!("Could not complete sign-in. Check your connection and try again.")
        });
        assert_eq!(status["authenticated"], json!(false));
        assert!(!auth.authenticated());
        assert_eq!(store.load().unwrap().as_deref(), Some("kept-refresh"));
        // The gate decides from `authenticated`; no ported method is account-backed, so every
        // local method is still allowed (crates/core/src/gate.rs).
        let caller = open_sesame_core::gate::Caller {
            window: open_sesame_core::gate::MAIN_WINDOW,
            authenticated: auth.authenticated(),
        };
        for method in open_sesame_core::gate::PORTED
            .iter()
            .filter(|method| **method != "system.info")
        {
            assert_eq!(
                open_sesame_core::gate::gate(method, &caller),
                open_sesame_core::gate::Gate::Allow,
                "{method}"
            );
        }
        auth.shutdown();
    }

    /// Takes a little over twenty seconds: the time the core waits before a retry.
    #[test]
    fn a_restore_that_could_not_reach_the_server_is_tried_again_once_and_not_in_a_loop() {
        let failure = || ("500 Internal Server Error", String::from("{}"));
        let server = stand_in(vec![failure(), failure(), failure(), failure(), failure()]);
        let store = Arc::new(Memory(Mutex::new(Some("kept-refresh".to_string()))));
        let (auth, wakes) = Auth::new(
            Arc::new(api(&server)),
            Arc::clone(&store) as Arc<dyn CredentialStore>,
            Arc::new(Marker::new(None)),
            Arc::new(|_| true),
            Arc::new(|| None),
        );
        auth.run(wakes, |_| {});
        auth.restore(|| true);
        let started = Instant::now();
        let seen = || server.requests.lock().unwrap().len();
        while seen() < 2 && started.elapsed() < Duration::from_secs(40) {
            std::thread::sleep(Duration::from_millis(100));
        }
        assert_eq!(seen(), 2, "the retry never came");
        let retried_after = started.elapsed();
        assert!(
            retried_after >= Duration::from_secs(19),
            "{retried_after:?}"
        );
        // No third request follows at once.
        std::thread::sleep(Duration::from_secs(3));
        assert_eq!(seen(), 2);
        for (line, body) in server.requests.lock().unwrap().iter() {
            assert_eq!(line, "POST /user_management/authenticate HTTP/1.1");
            let sent: Value = serde_json::from_str(body).unwrap();
            assert_eq!(sent, refresh_body("kept-refresh"));
        }
        assert_eq!(store.load().unwrap().as_deref(), Some("kept-refresh"));
        assert!(!auth.authenticated());
        auth.shutdown();
    }

    #[test]
    fn shutting_down_stops_telling_the_page() {
        let parts = wired(vec![], true, None);
        parts.auth.handle("auth.signIn", no_hold).unwrap();
        until(&parts.changes, |status| status["busy"] == json!(true));
        parts.auth.shutdown();
        // Both threads end, so the sender they held is dropped and the channel closes.
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            match parts.changes.recv_timeout(Duration::from_millis(100)) {
                Err(RecvTimeoutError::Disconnected) => break,
                _ if Instant::now() > deadline => panic!("the threads are still running"),
                _ => {}
            }
        }
        assert_eq!(parts.auth.status()["busy"], json!(false));
    }

    #[test]
    fn a_refresh_that_is_due_but_not_yet_allowed_is_waited_for() {
        let seconds = Duration::from_secs;
        // Nothing to refresh: look again after a tick.
        assert_eq!(pause(None, Duration::ZERO), TICK);
        assert_eq!(pause(None, seconds(15)), TICK);
        // Due later: sleep until then, but never longer than a tick.
        assert_eq!(pause(Some(seconds(5)), Duration::ZERO), seconds(5));
        assert_eq!(pause(Some(seconds(240)), Duration::ZERO), TICK);
        // Due now, or sooner than the next attempt is allowed: sleep until it is allowed. A
        // wait of nothing here is a thread that spins until the next attempt.
        assert_eq!(pause(Some(Duration::ZERO), seconds(15)), seconds(15));
        assert_eq!(pause(Some(seconds(5)), seconds(15)), seconds(15));
        assert_eq!(
            pause(Some(Duration::ZERO), BETWEEN_ATTEMPTS),
            BETWEEN_ATTEMPTS
        );
        // Due and allowed: at once.
        assert_eq!(pause(Some(Duration::ZERO), Duration::ZERO), Duration::ZERO);
        // The longest wait between two attempts still fits in one sleep.
        assert!(BETWEEN_ATTEMPTS <= TICK);
    }

    #[test]
    fn a_missing_store_and_a_locked_one_are_told_apart() {
        assert_eq!(store_problem(true, true), None);
        assert_eq!(store_problem(true, false), None);
        // A store that is there and would not answer is one to unlock, on every system.
        assert_eq!(store_problem(false, true), Some(NO_KEYCHAIN));
        assert!(NO_KEYCHAIN.contains("Unlock it and try again"));
        // Only Linux can be without one, and a keyring installed while the application runs
        // is not seen until it starts again, so the sentence must not say to try again.
        let missing = store_problem(false, false);
        if cfg!(target_os = "linux") {
            assert_eq!(missing, Some(NO_SECRET_SERVICE));
        } else {
            assert_eq!(missing, Some(NO_KEYCHAIN));
        }
        assert!(NO_SECRET_SERVICE.contains("start it again"));
        assert!(!NO_SECRET_SERVICE.contains("try again"));
        for sentence in [NO_SECRET_SERVICE, NO_KEYCHAIN] {
            assert!(sentence.contains("works without signing in"), "{sentence}");
        }
    }

    #[test]
    fn the_restore_does_not_keep_its_caller_waiting_for_the_credential_store() {
        // A store that answers only when it is told to, as a locked keyring answers only after
        // its unlock prompt: `ready` is where the application asks it.
        let wired = |answers| {
            let server = stand_in(answers);
            let store = Arc::new(Memory(Mutex::new(Some("kept-refresh".to_string()))));
            let (auth, wakes) = Auth::new(
                Arc::new(api(&server)),
                store,
                Arc::new(Marker::new(None)),
                Arc::new(|_| true),
                Arc::new(|| None),
            );
            let (tx, changes) = channel();
            auth.run(wakes, move |status| {
                let _ = tx.send(status);
            });
            (auth, changes, server.requests)
        };

        // The prompt is dismissed: nothing is restored and nothing is said.
        let (auth, changes, requests) = wired(vec![]);
        let (answer, asked) = channel::<bool>();
        let started = Instant::now();
        auth.restore(move || asked.recv().unwrap_or(false));
        assert!(
            started.elapsed() < Duration::from_secs(1),
            "the caller waited for the store"
        );
        std::thread::sleep(Duration::from_millis(300));
        assert!(
            changes.try_recv().is_err(),
            "nothing happens before the store answers"
        );
        answer.send(false).unwrap();
        std::thread::sleep(Duration::from_millis(300));
        assert!(changes.try_recv().is_err());
        assert!(requests.lock().unwrap().is_empty());
        assert_eq!(auth.status()["message"], json!(""));
        auth.shutdown();

        // The prompt is answered: the saved credential is used, after the answer and not before.
        let (auth, changes, requests) =
            wired(vec![("500 Internal Server Error", String::from("{}"))]);
        let (answer, asked) = channel::<bool>();
        auth.restore(move || asked.recv().unwrap_or(false));
        std::thread::sleep(Duration::from_millis(300));
        assert!(requests.lock().unwrap().is_empty());
        answer.send(true).unwrap();
        until(&changes, |status| {
            status["busy"] == json!(false) && status["message"] != json!("")
        });
        let requests = requests.lock().unwrap();
        assert_eq!(requests.len(), 1);
        let sent: Value = serde_json::from_str(&requests[0].1).unwrap();
        assert_eq!(sent, refresh_body("kept-refresh"));
        auth.shutdown();
    }

    /// Asks the real WorkOS API for this application's public signing keys: one request with
    /// no credential in it, to show that the HTTPS client and its certificate roots work
    /// against the real server. Ignored by default because it needs the network.
    #[test]
    #[ignore = "contacts the real WorkOS API"]
    fn the_real_key_set_is_reachable_over_tls() {
        let keys = HttpApi::workos().jwks().expect("the key set");
        assert!(!keys.keys.is_empty());
    }

    /// Reads and writes the real credential store of the machine the test runs on, under a
    /// name used by nothing else, with a value that is not a token, and removes it. Ignored by
    /// default: a machine without a store, or with a locked one, cannot run it.
    #[test]
    #[ignore = "uses the operating system's credential store"]
    fn the_real_credential_store_keeps_replaces_and_removes_a_value() {
        let store = KeychainStore::new(format!(
            "open-sesame-test-{}.tauri.workos.test",
            std::process::id()
        ));
        assert!(store.available());
        assert_eq!(store.load(), Ok(None));
        store.save("not-a-token-1").unwrap();
        assert_eq!(store.load(), Ok(Some("not-a-token-1".to_string())));
        store.save("not-a-token-2").unwrap();
        assert_eq!(store.load(), Ok(Some("not-a-token-2".to_string())));
        store.delete().unwrap();
        assert_eq!(store.load(), Ok(None));
        store.delete().unwrap();
    }
}
