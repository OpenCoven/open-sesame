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
//!   beyond the status. A development build prints one line here, the status flags with the
//!   fixed sentence; link.rs prints the kind of a link that arrived and nothing of the link.

use crate::summon;
use open_sesame_core::auth::{
    authenticate_url, error_from_response, exchange_body, jwks_url, parse_jwks, parse_tokens,
    refresh_body, AuthController, AuthError, AuthParts, CredentialStore, Jwks, SignedOutMarker,
    Tokens, WorkosApi, API, CLIENT_ID, REDIRECT, SIGNED_OUT,
};
use open_sesame_core::protocol::{BridgeError, BridgeResult, Emit};
use serde_json::{json, Value};
use std::panic::{catch_unwind, AssertUnwindSafe};
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
/// sign-in, so the browser is not opened at all. It says to try again because the store is
/// looked for again each time it is asked ([`KeychainStore::exists`]): a keyring that is
/// installed or started while the application runs is found by a later press of Sign in
/// (issue #116). One press may not ask: an answer that came after its own press had been
/// refused is given to the next press within thirty seconds (issue #130).
pub const NO_SECRET_SERVICE: &str = "Open Sesame keeps your sign-in in the system keyring, and none is available. Install a Secret Service keyring such as GNOME Keyring or KWallet, then try again. Everything on this computer works without signing in.";
/// Shown when the system has a credential store that would not answer: a keyring that is
/// locked, or whose prompt was dismissed.
pub const NO_KEYCHAIN: &str = "Open Sesame could not reach the system's credential store to keep your sign-in. Unlock it and try again. Everything on this computer works without signing in.";

/// Shown when Sign in, Cancel or Sign out is pressed while the credential store is being
/// waited for, which on a locked keyring is while its unlock prompt is open (issue #130).
/// Nothing was changed by the press, so it says to try again.
pub const KEYCHAIN_WAITING: &str = "Open Sesame is waiting for your system keychain. If it is asking for your password, answer it, then try again.";

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

/// After a sign-out here: opens the address that ends the remote session too, when there is
/// one. Signing out here is complete without the browser, so this is a courtesy and a browser
/// that will not open is not an error. Like every address, it is opened only at the WorkOS
/// origin.
fn end_remote_session(browser: &Browser, url: Option<String>) {
    if let Some(url) = url.filter(|url| may_open(url)) {
        let _ = browser(&url);
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

/// A credential store that is opened when it is first needed and opened again after it has
/// failed (issue #116).
///
/// The `keyring` crate opens the system's store once and keeps that answer, a failure included,
/// for as long as the application runs. On Linux the store is a connection to the Secret
/// Service: with no keyring at the first look, Sign in stayed refused until the application
/// was started again, and a keyring that was restarted left every later read and write of the
/// sign-in failing on the old connection. So on Linux the store is held here instead:
///
/// - It is opened when first asked. If that fails, the next ask opens it again.
/// - If a store that was opened earlier answers with a platform failure, which is what a lost
///   connection or a restarted service gives, it is dropped, opened again, and asked once
///   more. That second answer stands.
/// - Any other answer stands at once. In particular "no access", which is what gnome-keyring
///   gives for a locked keyring or a dismissed unlock prompt, is never asked twice: the person
///   would be prompted twice. That was measured with gnome-keyring 46.1 only, and with a
///   stand-in program in place of the unlock dialog. By reading, the store crate turns some
///   other failures of a prompt into a platform failure, which this rule would ask again.
///
/// Two cases this does not reach, both seen in a container: a keyring that was just installed
/// and has no default collection passes the look and then refuses the save, and a keyring
/// that dies while its unlock prompt is open leaves the call waiting, because the library
/// waits for the prompt with no limit.
///
/// Nothing here keeps a secret, and there is no other place a secret is written when the store
/// cannot be reached.
#[cfg(any(test, target_os = "linux"))]
struct Reopening<S> {
    open: Box<dyn Fn() -> keyring::Result<S> + Send + Sync>,
    store: Mutex<Option<S>>,
}

#[cfg(any(test, target_os = "linux"))]
impl<S: Clone> Reopening<S> {
    fn new(open: impl Fn() -> keyring::Result<S> + Send + Sync + 'static) -> Reopening<S> {
        Reopening {
            open: Box::new(open),
            store: Mutex::new(None),
        }
    }

    /// The store, and whether it was opened by this call.
    fn get(&self) -> keyring::Result<(S, bool)> {
        let mut store = lock(&self.store);
        if let Some(store) = store.as_ref() {
            return Ok((store.clone(), false));
        }
        let opened = (self.open)()?;
        *store = Some(opened.clone());
        Ok((opened, true))
    }

    /// Asks the store one thing, by the rules above.
    fn with<T>(&self, ask: impl Fn(&S) -> keyring::Result<T>) -> keyring::Result<T> {
        let (store, opened_now) = self.get()?;
        match ask(&store) {
            Err(keyring::Error::PlatformFailure(_)) if !opened_now => {
                *lock(&self.store) = None;
                ask(&self.get()?.0)
            }
            answer => answer,
        }
    }
}

/// The refresh token in Keychain, Windows Credential Manager or the Secret Service.
pub struct KeychainStore {
    service: String,
    #[cfg(target_os = "linux")]
    secrets: Reopening<Arc<zbus_secret_service_keyring_store::Store>>,
}

impl KeychainStore {
    /// `service` names the entry. It must differ from the installed Swift app's, because a
    /// refresh token is replaced each time it is used and two applications sharing one would
    /// sign each other out.
    pub fn new(service: String) -> KeychainStore {
        KeychainStore {
            service,
            #[cfg(target_os = "linux")]
            secrets: Reopening::new(zbus_secret_service_keyring_store::Store::new),
        }
    }

    /// Asks this application's entry in the system's store one thing.
    #[cfg(not(target_os = "linux"))]
    fn ask<T>(
        &self,
        ask: impl Fn(&keyring_core::Entry) -> keyring::Result<T>,
    ) -> keyring::Result<T> {
        ask(&keyring::Entry::new(&self.service, CLIENT_ID)?.inner)
    }

    /// Asks this application's entry in the Secret Service one thing. The entry is the one
    /// `keyring` builds: the same store, service and user, so a sign-in saved by an earlier
    /// build is found.
    #[cfg(target_os = "linux")]
    fn ask<T>(
        &self,
        ask: impl Fn(&keyring_core::Entry) -> keyring::Result<T>,
    ) -> keyring::Result<T> {
        use keyring_core::api::CredentialStoreApi;
        self.secrets
            .with(|store| ask(&store.build(&self.service, CLIENT_ID, None)?))
    }

    /// Whether the store can be reached at all. An empty store is reachable. On Linux this
    /// can take as long as a person takes to answer the keyring's unlock prompt, so it must
    /// not be asked on the main thread.
    pub fn available(&self) -> bool {
        self.load().is_ok()
    }

    /// Whether the system has a credential store at all. On Linux this looks again each time
    /// it is asked while no store has been opened, so a Secret Service that appears while the
    /// application runs is seen. Elsewhere the system always has one, and the `keyring`
    /// crate's one answer is used.
    pub fn exists(&self) -> bool {
        #[cfg(target_os = "linux")]
        {
            self.secrets.get().is_ok()
        }
        #[cfg(not(target_os = "linux"))]
        {
            keyring::Entry::store_status().is_ok()
        }
    }
}

impl CredentialStore for KeychainStore {
    fn load(&self) -> Result<Option<String>, AuthError> {
        match self.ask(|entry| entry.get_password()) {
            Ok(token) => Ok(Some(token)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(AuthError::Store),
        }
    }

    fn save(&self, refresh_token: &str) -> Result<(), AuthError> {
        self.ask(|entry| entry.set_password(refresh_token))
            .map_err(|_| AuthError::Store)
    }

    fn delete(&self) -> Result<(), AuthError> {
        match self.ask(|entry| entry.delete_credential()) {
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
/// It matters only when sign-out could not delete the credential. A release build gives it no
/// folder yet: the restart data folder of issue #105 (`data.rs`) is not wired to it, so until it
/// is, a credential that could not be deleted is used again at the next launch.
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

/// How long an answer that came after its press had been refused is good for.
const LOOK_KEPT: Duration = Duration::from_secs(30);

/// Where the look at the credential store stands. It is made for Sign in, on a thread of its
/// own, because on a locked keyring it can wait for the unlock prompt.
#[derive(Default)]
struct Look {
    /// When the look that has not answered yet began.
    began: Option<Instant>,
    /// Which look that is, so that one given up does not end the one made after it.
    turn: u64,
    /// The last answer that no press was waiting for any more, and when it came. The next
    /// press takes it, once.
    kept: Option<(Instant, Option<&'static str>)>,
}

/// What the sign-out thread says, in order: that it was refused, or that it began, with the
/// address that ends the remote session, and then that it is done.
enum SignOut {
    Refused,
    Began(Option<String>),
    Done,
}

/// The sign-in state the application keeps.
pub struct Auth {
    controller: Arc<AuthController>,
    browser: Browser,
    store_check: StoreCheck,
    /// The look at the credential store made for Sign in.
    look: Arc<Mutex<Look>>,
    /// How long a request from the page waits for the credential store before it is told the
    /// store is being waited for.
    soon: Duration,
    /// How long a look at the store is waited for before the store is asked again.
    limit: Duration,
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
        Auth::with_limits(api, store, marker, browser, store_check, None)
    }

    /// As [`Auth::new`], with the two times a store call is measured against replaced
    /// (`AuthController::store_limits`). For tests; the application keeps the core's own.
    fn with_limits(
        api: Arc<dyn WorkosApi>,
        store: Arc<dyn CredentialStore>,
        marker: Arc<dyn SignedOutMarker>,
        browser: Browser,
        store_check: StoreCheck,
        limits: Option<(Duration, Duration)>,
    ) -> (Arc<Auth>, Wakes) {
        let (notify_tx, notify) = channel();
        let (refresh_tx, refresh) = channel();
        let senders = (notify_tx.clone(), refresh_tx.clone());
        let on_change = Arc::new(move || {
            let _ = notify_tx.send(());
            let _ = refresh_tx.send(());
        });
        let controller = AuthController::new(AuthParts {
            api,
            store,
            marker,
            clock: Arc::new(SystemTime::now),
            on_change,
        });
        let controller = Arc::new(match limits {
            Some((soon, limit)) => controller.store_limits(soon, limit),
            None => controller,
        });
        let auth = Arc::new(Auth {
            soon: controller.store_soon(),
            limit: controller.store_limit(),
            controller,
            browser,
            store_check,
            look: Arc::new(Mutex::new(Look::default())),
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
                // A store call the controller gave up is still out: no sign-in can be saved,
                // and another read would only wait behind it. One it is waiting for still is
                // the same for this press: the status says so already, and a read made beside
                // it would wait behind the same prompt, or fail there and name another trouble.
                if self.controller.store_busy() {
                    return Err(BridgeError::from(KEYCHAIN_WAITING));
                }
                if let Some(problem) = self.look_at_store()? {
                    return Err(BridgeError::from(problem));
                }
                let url = self.controller.begin_sign_in().map_err(|error| {
                    BridgeError::from(match error {
                        AuthError::Busy => BUSY,
                        AuthError::StoreBusy => KEYCHAIN_WAITING,
                        _ => NOT_STARTED,
                    })
                })?;
                *lock(&self.hold) = hold();
                if !(may_open(&url) && (self.browser)(&url)) {
                    self.cancel_unasked();
                    return Err(BridgeError::from(NO_BROWSER));
                }
                Ok(Value::Bool(true))
            }
            "auth.cancel" => match self.controller.cancel_now() {
                Ok(()) => Ok(Value::Bool(true)),
                Err(_) => Err(BridgeError::from(KEYCHAIN_WAITING)),
            },
            "auth.signOut" => self.sign_out(),
            _ => Err(BridgeError::from(open_sesame_core::gate::UNSUPPORTED)),
        }
    }

    /// Asks whether a sign-in could be kept on this computer, for Sign in. The question reads
    /// the credential store, and a locked keyring answers a read only when its unlock prompt
    /// is answered, so it is asked on a thread of its own and waited for no longer than a
    /// request from the page waits for the store anywhere (issue #130). While one such look
    /// has not answered the store is not asked again: a second read would wait behind the
    /// first. The press is then refused with the sentence about the keychain, and nothing was
    /// started by it.
    fn look_at_store(&self) -> Result<Option<&'static str>, BridgeError> {
        let turn = {
            let mut look = lock(&self.look);
            // An answer that came after its own press was refused is this press's answer.
            if let Some((came, answer)) = look.kept.take() {
                if came.elapsed() < LOOK_KEPT {
                    return Ok(answer);
                }
            }
            // A look that is out is waited for no longer than any store call: past that it is
            // given up, and the store is asked again by one more thread.
            if look.began.is_some_and(|began| began.elapsed() < self.limit) {
                return Err(BridgeError::from(KEYCHAIN_WAITING));
            }
            look.began = Some(Instant::now());
            look.turn += 1;
            look.turn
        };
        let (shared, check) = (Arc::clone(&self.look), Arc::clone(&self.store_check));
        let (tell, told) = channel();
        let started = std::thread::Builder::new()
            .name("credential-store-look".into())
            .spawn(move || {
                let answer = catch_unwind(AssertUnwindSafe(|| check()));
                let mut look = lock(&shared);
                // A look that was given up is nobody's any more: another has been made since,
                // and what this one found is older than what that one finds.
                if look.turn != turn {
                    return;
                }
                look.began = None;
                // The answer is kept and not sent: a press that has stopped waiting must not
                // take it with it. A question that panicked has no answer to keep.
                if let Ok(answer) = answer {
                    look.kept = Some((Instant::now(), answer));
                    drop(look);
                    let _ = tell.send(());
                }
            });
        if started.is_err() {
            let mut look = lock(&self.look);
            if look.turn == turn {
                look.began = None;
            }
            return Err(BridgeError::from(NOT_STARTED));
        }
        match told.recv_timeout(self.soon) {
            Ok(()) => match lock(&self.look).kept.take() {
                Some((_, answer)) => Ok(answer),
                // Another press took it between the word and here.
                None => Err(BridgeError::from(KEYCHAIN_WAITING)),
            },
            Err(RecvTimeoutError::Timeout) => Err(BridgeError::from(KEYCHAIN_WAITING)),
            // The question panicked; it is not being waited for.
            Err(RecvTimeoutError::Disconnected) => Err(BridgeError::from(NOT_STARTED)),
        }
    }

    /// The host's own cancel, when the browser would not open for a sign-in that had just
    /// begun. The person has been told about the browser already, so this must not fail or
    /// wait: when the store is being waited for it is left to a thread, which cancels when the
    /// store has answered.
    fn cancel_unasked(&self) {
        if self.controller.cancel_now().is_err() {
            let controller = Arc::clone(&self.controller);
            let _ = std::thread::Builder::new()
                .name("auth-cancel".into())
                .spawn(move || controller.cancel());
        }
    }

    /// Sign out, for a request from the page. Signing out removes the saved credential, and on
    /// a locked keyring the removal waits for the unlock prompt (issue #130). So it runs on a
    /// thread of its own, and the request is answered as soon as that thread says how it
    /// began: refused, with nothing changed, because another store call already holds things
    /// up; or begun, which is when the person is signed out here and before the store is
    /// asked. The address that ends the remote session is opened then, on this thread, and
    /// the status says the rest: the keychain being waited for, and how the removal ended.
    ///
    /// That first word is not given a time of the host's own. The controller gives a request
    /// its own short time to begin, so a refusal that comes late is still a refusal.
    fn sign_out(&self) -> BridgeResult {
        let controller = Arc::clone(&self.controller);
        let (tell, told) = channel();
        let started = std::thread::Builder::new()
            .name("auth-sign-out".into())
            .spawn(move || {
                let began = tell.clone();
                let ended = controller.sign_out_now(move |url| {
                    let _ = began.send(SignOut::Began(url));
                });
                let _ = tell.send(match ended {
                    Ok(()) => SignOut::Done,
                    Err(_) => SignOut::Refused,
                });
            });
        if started.is_err() {
            // No thread to be had: here, waiting as long as the store does.
            return match self
                .controller
                .sign_out_now(|url| end_remote_session(&self.browser, url))
            {
                Ok(()) => Ok(Value::Bool(true)),
                Err(_) => Err(BridgeError::from(KEYCHAIN_WAITING)),
            };
        }
        match told.recv() {
            Ok(SignOut::Began(url)) => {
                end_remote_session(&self.browser, url);
                Ok(Value::Bool(true))
            }
            Ok(SignOut::Refused) => Err(BridgeError::from(KEYCHAIN_WAITING)),
            // The thread ended without saying how it began: the controller panicked, and
            // what it left is in the status.
            Ok(SignOut::Done) | Err(_) => Ok(Value::Bool(true)),
        }
    }

    /// An address the system handed over. Returns what it was. A callback is exchanged on a
    /// thread of its own, because that is a network call.
    pub fn link(self: &Arc<Self>, url: &str) -> Link {
        self.link_started(url).0
    }

    /// [`Auth::link`], and the thread a callback was given to, so that a test can wait for the
    /// core to have finished with it instead of waiting a fixed time.
    fn link_started(self: &Arc<Self>, url: &str) -> (Link, Option<std::thread::JoinHandle<()>>) {
        let kind = classify(url);
        let thread = (kind == Link::Callback).then(|| {
            let auth = Arc::clone(self);
            let url = url.to_string();
            std::thread::spawn(move || auth.controller.complete_sign_in(&url))
        });
        (kind, thread)
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

    /// At quit: waits for a refresh that was already sent, so that its replacement credential
    /// is saved, tries once more to save one an earlier attempt could not, and stops the
    /// threads. It can therefore wait for one request and write the credential store.
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
        Arc::new(move || store_problem(probe.available(), probe.exists()));
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
    // Links reach `Auth::link` through link.rs, which finds this in the application's state.
    app.manage(auth);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::AtomicUsize;

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

    /// A credential store whose removal waits until it is let go, as a locked keyring's does
    /// while its unlock prompt is open.
    struct Prompting {
        asked: Sender<()>,
        answer: Mutex<Receiver<()>>,
    }
    impl CredentialStore for Prompting {
        fn load(&self) -> Result<Option<String>, AuthError> {
            Ok(None)
        }
        fn save(&self, _: &str) -> Result<(), AuthError> {
            Ok(())
        }
        fn delete(&self) -> Result<(), AuthError> {
            let _ = self.asked.send(());
            let _ = self.answer.lock().unwrap().recv();
            Ok(())
        }
    }

    /// How long a request from the page may take in these tests. The page's own limit is 15
    /// seconds; the store calls here wait until the test lets them go.
    const ANSWERED_WITHIN: Duration = Duration::from_secs(8);

    /// Answers a request on a thread of its own and says how it was answered, or panics when
    /// it was not answered in time.
    fn answered(auth: &Arc<Auth>, method: &'static str) -> BridgeResult {
        let (tell, told) = channel();
        let auth = Arc::clone(auth);
        std::thread::spawn(move || {
            let _ = tell.send(auth.handle(method, no_hold));
        });
        told.recv_timeout(ANSWERED_WITHIN)
            .unwrap_or_else(|_| panic!("{method} was not answered while the store waited"))
    }

    #[test]
    fn while_the_keyring_prompt_is_open_for_sign_out_every_request_is_answered() {
        let (asked, was_asked) = channel();
        let (answer, held) = channel();
        let opened = Arc::new(Mutex::new(Vec::new()));
        let record = Arc::clone(&opened);
        let browser: Browser = Arc::new(move |url| {
            record.lock().unwrap().push(url.to_string());
            true
        });
        let (auth, wakes) = Auth::with_limits(
            Arc::new(api(&stand_in(vec![]))),
            Arc::new(Prompting {
                asked,
                answer: Mutex::new(held),
            }),
            Arc::new(Marker::new(None)),
            browser,
            Arc::new(|| None),
            Some((Duration::from_millis(200), Duration::from_secs(60))),
        );
        let (tx, changes) = channel();
        auth.run(wakes, move |status| {
            let _ = tx.send(status);
        });

        // Sign out is answered though the store has not answered: the person is signed out
        // here, and only the removal of the saved credential is still waited for.
        assert_eq!(answered(&auth, "auth.signOut"), Ok(json!(true)));
        was_asked
            .recv_timeout(Duration::from_secs(10))
            .expect("the store was asked to remove the credential");
        let waiting = until(&changes, |status| {
            status["message"]
                .as_str()
                .is_some_and(|message| message.starts_with("Waiting for your system keychain"))
        });
        assert_eq!(waiting["authenticated"], json!(false));
        assert!(!auth.authenticated());

        // Everything else is answered too, with a sentence about the keychain and never by
        // waiting: nothing here may reach the page's own time limit.
        for method in ["auth.signIn", "auth.cancel", "auth.signOut"] {
            assert_eq!(
                answered(&auth, method),
                Err(BridgeError::from(KEYCHAIN_WAITING)),
                "{method}"
            );
        }
        assert_eq!(
            answered(&auth, "auth.status").unwrap()["authenticated"],
            json!(false)
        );
        assert!(opened.lock().unwrap().is_empty(), "no browser was opened");

        // The prompt is answered: the removal ends and the next press is an ordinary one.
        answer.send(()).unwrap();
        let done = until(&changes, |status| {
            status["message"] == json!("Signed out on this computer.")
        });
        assert_eq!(done["busy"], json!(false));
        assert_eq!(answered(&auth, "auth.signIn"), Ok(json!(true)));
        assert_eq!(opened.lock().unwrap().len(), 1);
        auth.shutdown();
    }

    #[test]
    fn a_look_at_the_store_that_waits_does_not_hold_sign_in() {
        let (answer, held) = channel::<()>();
        let held = Mutex::new(held);
        let looks = Arc::new(AtomicUsize::new(0));
        let count = Arc::clone(&looks);
        let opened = Arc::new(Mutex::new(Vec::new()));
        let record = Arc::clone(&opened);
        let browser: Browser = Arc::new(move |url| {
            record.lock().unwrap().push(url.to_string());
            true
        });
        // The first look waits until it is let go, as a read of a locked keyring does; the
        // looks after it answer at once.
        let (auth, wakes) = Auth::with_limits(
            Arc::new(api(&stand_in(vec![]))),
            Arc::new(Memory(Mutex::new(None))),
            Arc::new(Marker::new(None)),
            browser,
            Arc::new(move || {
                if count.fetch_add(1, Ordering::SeqCst) == 0 {
                    let _ = held.lock().unwrap().recv();
                }
                None
            }),
            Some((Duration::from_millis(200), Duration::from_secs(60))),
        );
        let (tx, _changes) = channel();
        auth.run(wakes, move |status| {
            let _ = tx.send(status);
        });

        for press in 1..=2 {
            assert_eq!(
                answered(&auth, "auth.signIn"),
                Err(BridgeError::from(KEYCHAIN_WAITING)),
                "press {press}"
            );
        }
        assert_eq!(
            looks.load(Ordering::SeqCst),
            1,
            "the store is not asked again while the first look is out"
        );
        assert!(opened.lock().unwrap().is_empty(), "no browser was opened");
        assert_eq!(auth.status()["busy"], json!(false));

        answer.send(()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        while lock(&auth.look).began.is_some() {
            assert!(Instant::now() < deadline, "the look never ended");
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(answered(&auth, "auth.signIn"), Ok(json!(true)));
        assert_eq!(opened.lock().unwrap().len(), 1);
        auth.shutdown();
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
        // The callback goes in where the host takes one, `link`, which hands it to the core on
        // a thread of its own; the test waits for that thread to end, not for a fixed time.
        let forged = "opensesame://auth/callback?code=stolen&state=guess";
        let through_the_host = || {
            let (kind, thread) = parts.auth.link_started(forged);
            assert_eq!(kind, Link::Callback);
            thread
                .expect("a callback is given to a thread")
                .join()
                .unwrap();
        };
        // No sign-in is pending: a callback from any process changes nothing.
        through_the_host();
        assert!(parts.requests.lock().unwrap().is_empty());
        assert_eq!(parts.auth.status()["busy"], json!(false));

        // A sign-in is pending, and the callback carries the wrong state: nothing is sent, and
        // the attempt keeps waiting for the browser's own callback (issue #116).
        parts.auth.handle("auth.signIn", no_hold).unwrap();
        until(&parts.changes, |status| status["busy"] == json!(true));
        through_the_host();
        let status = parts.auth.status();
        assert_eq!(status["busy"], json!(true), "the sign-in is still waiting");
        assert_eq!(
            status["message"],
            json!("Finish signing in in your browser.")
        );
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

    /// The wiring with a memory store, a recording browser and `check` as the look at the
    /// store, measured against `soon` and given up after `limit`.
    fn looking_with(
        check: StoreCheck,
        soon: Duration,
        limit: Duration,
    ) -> (Arc<Auth>, Arc<Mutex<Vec<String>>>) {
        let opened = Arc::new(Mutex::new(Vec::new()));
        let record = Arc::clone(&opened);
        let browser: Browser = Arc::new(move |url| {
            record.lock().unwrap().push(url.to_string());
            true
        });
        let (auth, wakes) = Auth::with_limits(
            Arc::new(api(&stand_in(vec![]))),
            Arc::new(Memory(Mutex::new(None))),
            Arc::new(Marker::new(None)),
            browser,
            check,
            Some((soon, limit)),
        );
        auth.run(wakes, |_| {});
        (auth, opened)
    }

    /// Whether the status says the keychain is being waited for.
    fn says_waiting(auth: &Auth) -> bool {
        auth.status()["message"]
            .as_str()
            .is_some_and(|message| message.starts_with("Waiting for your system keychain"))
    }

    fn until_no_look_is_out(auth: &Auth) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while lock(&auth.look).began.is_some() {
            assert!(Instant::now() < deadline, "the look never ended");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    /// A store that always takes longer to answer than a press waits must still let a person
    /// sign in: the answer that came too late for one press is the next press's answer, once.
    #[test]
    fn an_answer_that_comes_after_its_press_is_the_next_presss_answer_once() {
        let looks = Arc::new(AtomicUsize::new(0));
        let count = Arc::clone(&looks);
        let (auth, opened) = looking_with(
            Arc::new(move || {
                count.fetch_add(1, Ordering::SeqCst);
                std::thread::sleep(Duration::from_millis(600));
                None
            }),
            Duration::from_millis(200),
            Duration::from_secs(60),
        );
        assert_eq!(
            answered(&auth, "auth.signIn"),
            Err(BridgeError::from(KEYCHAIN_WAITING))
        );
        until_no_look_is_out(&auth);
        assert_eq!(answered(&auth, "auth.signIn"), Ok(json!(true)));
        assert_eq!(looks.load(Ordering::SeqCst), 1, "the kept answer was used");
        assert_eq!(opened.lock().unwrap().len(), 1);
        assert_eq!(answered(&auth, "auth.cancel"), Ok(json!(true)));
        // Once: the press after that asks the store again.
        assert_eq!(
            answered(&auth, "auth.signIn"),
            Err(BridgeError::from(KEYCHAIN_WAITING))
        );
        assert_eq!(looks.load(Ordering::SeqCst), 2);
        until_no_look_is_out(&auth);
        auth.shutdown();
    }

    /// And when what came too late is that there is no keyring, the next press says so.
    #[test]
    fn a_problem_found_after_its_press_was_refused_is_shown_to_the_next_press() {
        let (auth, opened) = looking_with(
            Arc::new(|| {
                std::thread::sleep(Duration::from_millis(600));
                Some(NO_SECRET_SERVICE)
            }),
            Duration::from_millis(200),
            Duration::from_secs(60),
        );
        assert_eq!(
            answered(&auth, "auth.signIn"),
            Err(BridgeError::from(KEYCHAIN_WAITING))
        );
        until_no_look_is_out(&auth);
        assert_eq!(
            answered(&auth, "auth.signIn"),
            Err(BridgeError::from(NO_SECRET_SERVICE))
        );
        assert!(opened.lock().unwrap().is_empty());
        until_no_look_is_out(&auth);
        auth.shutdown();
    }

    /// A look that never answers, as with a keyring that died while its prompt was open, is
    /// given up at the limit: the store is asked again then, and not before.
    #[test]
    fn a_look_that_never_answers_is_given_up_at_the_limit() {
        let (answer, held) = channel::<()>();
        let held = Mutex::new(held);
        let looks = Arc::new(AtomicUsize::new(0));
        let count = Arc::clone(&looks);
        let limit = Duration::from_secs(2);
        let (auth, opened) = looking_with(
            Arc::new(move || {
                if count.fetch_add(1, Ordering::SeqCst) == 0 {
                    let _ = held.lock().unwrap().recv();
                }
                None
            }),
            Duration::from_millis(200),
            limit,
        );
        let began = Instant::now();
        for press in 1..=2 {
            assert_eq!(
                answered(&auth, "auth.signIn"),
                Err(BridgeError::from(KEYCHAIN_WAITING)),
                "press {press}"
            );
        }
        assert!(began.elapsed() < limit, "the two presses took too long");
        assert_eq!(looks.load(Ordering::SeqCst), 1);
        // The limit runs from when the look began, which is later than `began` by however
        // long the first press took to start.
        let look_began = lock(&auth.look).began.expect("a look is out");
        // Not before: a press well into the limit, and still short of it, asks nothing. It
        // is made 600 ms short so that a busy machine does not carry it past the limit, which
        // leaves a look given up in the last 600 ms of its two seconds unseen here.
        let short = limit - Duration::from_millis(600);
        std::thread::sleep(short.saturating_sub(look_began.elapsed()));
        let late = answered(&auth, "auth.signIn");
        assert!(
            look_began.elapsed() < limit,
            "the late press was answered too late to tell"
        );
        assert_eq!(late, Err(BridgeError::from(KEYCHAIN_WAITING)), "late press");
        assert_eq!(looks.load(Ordering::SeqCst), 1, "asked before the limit");
        std::thread::sleep(limit.saturating_sub(look_began.elapsed()) + Duration::from_millis(50));
        assert_eq!(answered(&auth, "auth.signIn"), Ok(json!(true)));
        assert_eq!(looks.load(Ordering::SeqCst), 2);
        assert_eq!(opened.lock().unwrap().len(), 1);
        answer.send(()).unwrap();
        auth.shutdown();
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

    /// The browser will not open, and by then a store call holds things up: the host's own
    /// cancel must not wait for it, because the request has not been answered yet. It is left
    /// to a thread, and the person is told about the browser at once.
    #[test]
    fn a_browser_that_will_not_open_is_reported_while_the_store_waits() {
        let (asked, was_asked) = channel();
        let (answer, held) = channel();
        let was_asked = Mutex::new(was_asked);
        let slot: Arc<Mutex<Option<Arc<Auth>>>> = Arc::new(Mutex::new(None));
        let theirs = Arc::clone(&slot);
        // The browser stands in for the moment between the sign-in beginning and the cancel:
        // it starts a removal that waits, and says the browser did not open.
        let browser: Browser = Arc::new(move |_| {
            let auth = theirs.lock().unwrap().clone().expect("the wiring");
            std::thread::spawn(move || auth.controller.sign_out());
            was_asked
                .lock()
                .unwrap()
                .recv_timeout(Duration::from_secs(10))
                .expect("the store was asked to remove the credential");
            false
        });
        let (auth, wakes) = Auth::with_limits(
            Arc::new(api(&stand_in(vec![]))),
            Arc::new(Prompting {
                asked,
                answer: Mutex::new(held),
            }),
            Arc::new(Marker::new(None)),
            browser,
            Arc::new(|| None),
            Some((Duration::from_millis(200), Duration::from_secs(60))),
        );
        auth.run(wakes, |_| {});
        *slot.lock().unwrap() = Some(Arc::clone(&auth));
        assert_eq!(
            answered(&auth, "auth.signIn"),
            Err(BridgeError::from(NO_BROWSER))
        );
        // That the thread then cancels is not shown here: the removal that stands in for the
        // store call has already ended the sign-in, and no host test has a session whose
        // save could hold things up instead. check-tauri-sign-in.mjs reads that the thread
        // is started and what it calls.
        answer.send(()).unwrap();
        slot.lock().unwrap().take();
        auth.shutdown();
    }

    /// A look that was given up answers after another was made. Its answer is older than
    /// what the later look will find, so it is not kept, and it does not end the later look:
    /// the next press is still told to wait, and the store is not asked a third time.
    #[test]
    fn a_look_given_up_that_answers_later_changes_nothing() {
        let (first, first_held) = channel::<()>();
        let (second, second_held) = channel::<()>();
        let (first_held, second_held) = (Mutex::new(first_held), Mutex::new(second_held));
        let looks = Arc::new(AtomicUsize::new(0));
        let count = Arc::clone(&looks);
        let limit = Duration::from_secs(2);
        let (auth, opened) = looking_with(
            Arc::new(move || match count.fetch_add(1, Ordering::SeqCst) {
                0 => {
                    let _ = first_held.lock().unwrap().recv();
                    Some(NO_KEYCHAIN)
                }
                1 => {
                    let _ = second_held.lock().unwrap().recv();
                    None
                }
                _ => None,
            }),
            Duration::from_millis(200),
            limit,
        );
        let waiting = Err(BridgeError::from(KEYCHAIN_WAITING));
        assert_eq!(answered(&auth, "auth.signIn"), waiting, "the first look");
        let look_began = lock(&auth.look).began.expect("a look is out");
        std::thread::sleep(limit.saturating_sub(look_began.elapsed()) + Duration::from_millis(50));
        assert_eq!(answered(&auth, "auth.signIn"), waiting, "the second look");
        assert_eq!(looks.load(Ordering::SeqCst), 2);
        // The first look answers now, with a problem. Nothing shows when its thread has
        // ended, so this waits for it.
        first.send(()).unwrap();
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(
            answered(&auth, "auth.signIn"),
            waiting,
            "after the late answer"
        );
        assert_eq!(looks.load(Ordering::SeqCst), 2, "the store was asked again");
        assert!(
            lock(&auth.look).began.is_some(),
            "the second look was ended"
        );
        // The second look answers: that is the answer the next press gets.
        second.send(()).unwrap();
        until_no_look_is_out(&auth);
        assert_eq!(answered(&auth, "auth.signIn"), Ok(json!(true)));
        assert_eq!(looks.load(Ordering::SeqCst), 2);
        assert_eq!(opened.lock().unwrap().len(), 1);
        auth.shutdown();
    }

    /// With a store call the controller gave up still out, a press of Sign in is refused
    /// without the store being asked: nothing could be saved, and a read would only wait.
    #[test]
    fn sign_in_does_not_ask_the_store_while_a_call_given_up_is_out() {
        let (asked, was_asked) = channel();
        let (answer, held) = channel();
        let looks = Arc::new(AtomicUsize::new(0));
        let count = Arc::clone(&looks);
        let opened = Arc::new(Mutex::new(Vec::new()));
        let record = Arc::clone(&opened);
        let browser: Browser = Arc::new(move |url| {
            record.lock().unwrap().push(url.to_string());
            true
        });
        let (auth, wakes) = Auth::with_limits(
            Arc::new(api(&stand_in(vec![]))),
            Arc::new(Prompting {
                asked,
                answer: Mutex::new(held),
            }),
            Arc::new(Marker::new(None)),
            browser,
            Arc::new(move || {
                count.fetch_add(1, Ordering::SeqCst);
                None
            }),
            Some((Duration::from_millis(200), Duration::from_millis(600))),
        );
        auth.run(wakes, |_| {});
        assert_eq!(answered(&auth, "auth.signOut"), Ok(json!(true)));
        was_asked
            .recv_timeout(Duration::from_secs(10))
            .expect("the store was asked to remove the credential");
        let deadline = Instant::now() + Duration::from_secs(10);
        while !auth.controller.store_given_up() {
            assert!(Instant::now() < deadline, "the removal was never given up");
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(
            answered(&auth, "auth.signIn"),
            Err(BridgeError::from(KEYCHAIN_WAITING))
        );
        assert_eq!(looks.load(Ordering::SeqCst), 0, "the store was asked");
        assert!(opened.lock().unwrap().is_empty());
        // The removal returns: the next press is an ordinary one, and asks.
        answer.send(()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        while auth.controller.store_given_up() {
            assert!(Instant::now() < deadline, "the removal never returned");
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(answered(&auth, "auth.signIn"), Ok(json!(true)));
        assert_eq!(looks.load(Ordering::SeqCst), 1);
        assert_eq!(opened.lock().unwrap().len(), 1);
        assert_eq!(answered(&auth, "auth.cancel"), Ok(json!(true)));
        auth.shutdown();
    }

    /// The same while a store call is still being waited for, before it is given up: the
    /// status says the keychain is being waited for, and a read made beside it would wait
    /// behind the same prompt or fail there and name the wrong trouble. The look here answers
    /// with that trouble, so a press that asks is seen by its sentence as well as its count.
    #[test]
    fn sign_in_does_not_ask_the_store_while_a_call_is_waited_for() {
        let (asked, was_asked) = channel();
        let (answer, held) = channel();
        let looks = Arc::new(AtomicUsize::new(0));
        let count = Arc::clone(&looks);
        let opened = Arc::new(Mutex::new(Vec::new()));
        let record = Arc::clone(&opened);
        let browser: Browser = Arc::new(move |url| {
            record.lock().unwrap().push(url.to_string());
            true
        });
        let (auth, wakes) = Auth::with_limits(
            Arc::new(api(&stand_in(vec![]))),
            Arc::new(Prompting {
                asked,
                answer: Mutex::new(held),
            }),
            Arc::new(Marker::new(None)),
            browser,
            Arc::new(move || {
                count.fetch_add(1, Ordering::SeqCst);
                Some(NO_KEYCHAIN)
            }),
            Some((Duration::from_millis(200), Duration::from_secs(60))),
        );
        auth.run(wakes, |_| {});
        assert_eq!(answered(&auth, "auth.signOut"), Ok(json!(true)));
        was_asked
            .recv_timeout(Duration::from_secs(10))
            .expect("the store was asked to remove the credential");
        let deadline = Instant::now() + Duration::from_secs(10);
        while !says_waiting(&auth) {
            assert!(Instant::now() < deadline, "the status never said so");
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(!auth.controller.store_given_up());
        for press in 1..=2 {
            assert_eq!(
                answered(&auth, "auth.signIn"),
                Err(BridgeError::from(KEYCHAIN_WAITING)),
                "press {press}"
            );
        }
        assert_eq!(looks.load(Ordering::SeqCst), 0, "the store was asked");
        assert!(opened.lock().unwrap().is_empty());
        // The removal returns: the next press is an ordinary one, and asks.
        answer.send(()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        while says_waiting(&auth) {
            assert!(Instant::now() < deadline, "the removal never returned");
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(
            answered(&auth, "auth.signIn"),
            Err(BridgeError::from(NO_KEYCHAIN))
        );
        assert_eq!(looks.load(Ordering::SeqCst), 1);
        assert!(opened.lock().unwrap().is_empty());
        auth.shutdown();
    }

    /// A store whose read waits until the test lets it go, as the read at launch does on a
    /// locked keyring.
    struct SlowRead {
        asked: Sender<()>,
        answer: Mutex<Receiver<()>>,
    }
    impl CredentialStore for SlowRead {
        fn load(&self) -> Result<Option<String>, AuthError> {
            let _ = self.asked.send(());
            let _ = self.answer.lock().unwrap().recv();
            Ok(None)
        }
        fn save(&self, _: &str) -> Result<(), AuthError> {
            Ok(())
        }
        fn delete(&self) -> Result<(), AuthError> {
            Ok(())
        }
    }

    /// The controller's read at launch holds no state, so nothing but the host's question
    /// refuses a press made while that read waits for the prompt: without it the look is
    /// made, and when it answers a sign-in is begun beside the prompt.
    #[test]
    fn sign_in_does_not_ask_the_store_while_the_read_at_launch_is_waited_for() {
        let (asked, was_asked) = channel();
        let (answer, held) = channel();
        let looks = Arc::new(AtomicUsize::new(0));
        let count = Arc::clone(&looks);
        let opened = Arc::new(Mutex::new(Vec::new()));
        let record = Arc::clone(&opened);
        let browser: Browser = Arc::new(move |url| {
            record.lock().unwrap().push(url.to_string());
            true
        });
        let (auth, wakes) = Auth::with_limits(
            Arc::new(api(&stand_in(vec![]))),
            Arc::new(SlowRead {
                asked,
                answer: Mutex::new(held),
            }),
            Arc::new(Marker::new(None)),
            browser,
            Arc::new(move || {
                count.fetch_add(1, Ordering::SeqCst);
                None
            }),
            Some((Duration::from_millis(200), Duration::from_secs(60))),
        );
        auth.run(wakes, |_| {});
        auth.restore(|| true);
        was_asked
            .recv_timeout(Duration::from_secs(10))
            .expect("the store was read at launch");
        let deadline = Instant::now() + Duration::from_secs(10);
        while !says_waiting(&auth) {
            assert!(Instant::now() < deadline, "the status never said so");
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(
            answered(&auth, "auth.signIn"),
            Err(BridgeError::from(KEYCHAIN_WAITING))
        );
        assert_eq!(looks.load(Ordering::SeqCst), 0, "the store was asked");
        assert!(opened.lock().unwrap().is_empty());
        // The read returns: the next press is an ordinary one.
        answer.send(()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        while says_waiting(&auth) {
            assert!(Instant::now() < deadline, "the read never returned");
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(answered(&auth, "auth.signIn"), Ok(json!(true)));
        assert_eq!(looks.load(Ordering::SeqCst), 1);
        assert_eq!(opened.lock().unwrap().len(), 1);
        assert_eq!(answered(&auth, "auth.cancel"), Ok(json!(true)));
        auth.shutdown();
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

    /// No host test has a verified session, which is what gives a sign-out an address to
    /// open, so the opening is tested by itself; that Sign out calls it is held by
    /// check-tauri-sign-in.mjs.
    #[test]
    fn a_sign_out_opens_only_the_address_that_ends_the_remote_session() {
        let opened = Arc::new(Mutex::new(Vec::new()));
        let record = Arc::clone(&opened);
        let browser: Browser = Arc::new(move |url| {
            record.lock().unwrap().push(url.to_string());
            false
        });
        let ends = open_sesame_core::auth::logout_url("session_01");
        end_remote_session(&browser, None);
        end_remote_session(&browser, Some("https://example.com/logout".to_string()));
        assert!(opened.lock().unwrap().is_empty());
        // A browser that will not open is not an error: nothing is returned to fail on.
        end_remote_session(&browser, Some(ends.clone()));
        assert_eq!(*opened.lock().unwrap(), vec![ends]);
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
        // Only Linux can be without one. A keyring installed while the application runs is
        // found by the next attempt, so the sentence says to try again, not to start again.
        let missing = store_problem(false, false);
        if cfg!(target_os = "linux") {
            assert_eq!(missing, Some(NO_SECRET_SERVICE));
        } else {
            assert_eq!(missing, Some(NO_KEYCHAIN));
        }
        assert!(NO_SECRET_SERVICE.contains("then try again"));
        assert!(!NO_SECRET_SERVICE.contains("start it again"));
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

    /// A stand-in for a store that is a connection: each opening gets the next number, the
    /// first `refused` openings fail, and both openings and questions are counted.
    struct Connections {
        opened: Arc<std::sync::atomic::AtomicUsize>,
        store: Reopening<usize>,
    }

    fn connections(refused: usize) -> Connections {
        let opened = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let count = Arc::clone(&opened);
        let store = Reopening::new(move || {
            let number = count.fetch_add(1, Ordering::SeqCst) + 1;
            if number <= refused {
                Err(keyring::Error::PlatformFailure("no service".into()))
            } else {
                Ok(number)
            }
        });
        Connections { opened, store }
    }

    fn gone<T>() -> keyring::Result<T> {
        Err(keyring::Error::PlatformFailure(
            "the service went away".into(),
        ))
    }

    /// With no keyring at the first look, the next look finds one that has appeared, and a
    /// store that is open is not opened again (issue #116).
    #[test]
    fn a_store_that_could_not_be_opened_is_looked_for_again() {
        let connections = connections(2);
        let number = |store: &usize| Ok(*store);
        assert!(connections.store.with(number).is_err());
        assert!(connections.store.get().is_err());
        assert_eq!(connections.store.with(number).unwrap(), 3);
        assert_eq!(connections.store.with(number).unwrap(), 3);
        assert_eq!(connections.store.get().unwrap(), (3, false));
        assert_eq!(connections.opened.load(Ordering::SeqCst), 3);
    }

    /// A keyring that was restarted leaves the open connection failing. The store is opened
    /// again and asked once more, and that second answer stands, whatever it is.
    #[test]
    fn a_store_that_fails_after_it_was_opened_is_opened_again_and_asked_once_more() {
        let connections = connections(0);
        assert_eq!(connections.store.with(|store| Ok(*store)).unwrap(), 1);
        let asked = std::cell::Cell::new(0);
        let only_the_new_one = |store: &usize| {
            asked.set(asked.get() + 1);
            if *store == 1 {
                gone()
            } else {
                Ok(*store)
            }
        };
        assert_eq!(connections.store.with(only_the_new_one).unwrap(), 2);
        assert_eq!(asked.get(), 2);
        assert_eq!(connections.opened.load(Ordering::SeqCst), 2);

        // A service that stays away: one more opening and one more question, not a loop.
        asked.set(0);
        let never = |_: &usize| {
            asked.set(asked.get() + 1);
            gone::<usize>()
        };
        assert!(matches!(
            connections.store.with(never),
            Err(keyring::Error::PlatformFailure(_))
        ));
        assert_eq!(asked.get(), 2);
        assert_eq!(connections.opened.load(Ordering::SeqCst), 3);
    }

    /// A failure from a store that was opened for this very question is the answer: opening
    /// it yet again would only repeat what just happened.
    #[test]
    fn a_store_opened_for_this_question_is_not_asked_twice() {
        let connections = connections(0);
        let asked = std::cell::Cell::new(0);
        let never = |_: &usize| {
            asked.set(asked.get() + 1);
            gone::<usize>()
        };
        assert!(connections.store.with(never).is_err());
        assert_eq!(asked.get(), 1);
        assert_eq!(connections.opened.load(Ordering::SeqCst), 1);
    }

    /// A locked keyring, a dismissed unlock prompt and a missing entry are answers, not lost
    /// connections: the store is kept and the person is not prompted a second time.
    #[test]
    fn a_locked_store_or_a_missing_entry_is_not_asked_twice() {
        let connections = connections(0);
        assert_eq!(connections.store.with(|store| Ok(*store)).unwrap(), 1);
        let asked = std::cell::Cell::new(0);
        let locked = |_: &usize| {
            asked.set(asked.get() + 1);
            Err::<usize, _>(keyring::Error::NoStorageAccess("locked".into()))
        };
        assert!(matches!(
            connections.store.with(locked),
            Err(keyring::Error::NoStorageAccess(_))
        ));
        let missing = |_: &usize| {
            asked.set(asked.get() + 1);
            Err::<usize, _>(keyring::Error::NoEntry)
        };
        assert!(matches!(
            connections.store.with(missing),
            Err(keyring::Error::NoEntry)
        ));
        assert_eq!(asked.get(), 2);
        assert_eq!(connections.opened.load(Ordering::SeqCst), 1);
    }

    /// For the two tests below, which start and stop a real keyring service. Nothing in the
    /// repository or in hosted CI runs them: they are run by hand in a disposable Linux
    /// container, one test to a process (`cargo test -- --ignored --exact <name>`), on a
    /// private session bus (`dbus-launch`) where gnome-keyring is installed and is not started
    /// on demand (its D-Bus service files moved aside). They end every `gnome-keyring-daemon`
    /// of the user and write to whatever keyring is running, so they refuse to run unless
    /// `OPEN_SESAME_DISPOSABLE_KEYRING` is `1`; never set it on a desktop.
    #[cfg(target_os = "linux")]
    mod with_a_real_keyring {
        use super::*;

        fn sh(command: &str) -> bool {
            std::process::Command::new("sh")
                .args(["-c", command])
                .status()
                .is_ok_and(|status| status.success())
        }

        fn running() -> bool {
            sh("pgrep -x gnome-keyring-d > /dev/null")
        }

        fn eventually(mut done: impl FnMut() -> bool) -> bool {
            let until = Instant::now() + Duration::from_secs(10);
            loop {
                if done() {
                    return true;
                }
                if Instant::now() >= until {
                    return false;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        }

        fn start() {
            assert!(
                sh("printf check | gnome-keyring-daemon --unlock --components=secrets > /dev/null 2>&1"),
                "the keyring service could not be started"
            );
        }

        fn stop() {
            sh("pkill -x gnome-keyring-d");
            assert!(
                eventually(|| !running()),
                "the keyring service did not stop"
            );
        }

        /// A failure and not a silent pass: a test that did not run shows nothing.
        fn disposable() {
            assert_eq!(
                std::env::var("OPEN_SESAME_DISPOSABLE_KEYRING").as_deref(),
                Ok("1"),
                "this test ends the user's keyring service; it runs only in a disposable container with OPEN_SESAME_DISPOSABLE_KEYRING=1"
            );
        }

        fn store(name: &str) -> KeychainStore {
            KeychainStore::new(format!(
                "open-sesame-test-{name}-{}.tauri.workos.test",
                std::process::id()
            ))
        }

        /// With no Secret Service at the first look, one that starts afterwards is used by
        /// the next attempt, without the application being started again (issue #116).
        #[test]
        #[ignore = "ends the user's gnome-keyring-daemon; by hand in a disposable container only"]
        fn a_keyring_started_after_the_first_look_is_used() {
            disposable();
            assert!(
                !running(),
                "this test starts with no keyring service running"
            );
            let store = store("late");
            assert!(!store.available(), "a Secret Service answered already");
            start();
            assert!(
                eventually(|| store.available()),
                "the keyring that started after the first look was never seen"
            );
            store.save("not-a-token-1").unwrap();
            assert_eq!(store.load(), Ok(Some("not-a-token-1".to_string())));
            store.delete().unwrap();
            stop();
        }

        /// A keyring service that is restarted while the application runs is reached again,
        /// and what was saved before the restart is read after it (issue #116).
        #[test]
        #[ignore = "ends the user's gnome-keyring-daemon; by hand in a disposable container only"]
        fn a_keyring_that_restarts_is_reached_again() {
            disposable();
            if !running() {
                start();
            }
            let store = store("restart");
            assert!(
                eventually(|| store.available()),
                "no Secret Service answered"
            );
            store.save("not-a-token-1").unwrap();
            stop();
            assert_eq!(store.load(), Err(AuthError::Store), "read with no service");
            start();
            assert!(
                eventually(|| store.load() == Ok(Some("not-a-token-1".to_string()))),
                "after the restart the saved value could not be read: {:?}",
                store.load()
            );
            store.save("not-a-token-2").unwrap();
            assert_eq!(store.load(), Ok(Some("not-a-token-2".to_string())));
            store.delete().unwrap();
            assert_eq!(store.load(), Ok(None));
            stop();
        }

        /// The login keyring locked and holding one value of this service: the state in
        /// which removing the saved sign-in shows the keyring's unlock prompt first.
        fn locked_with_a_value(store: &KeychainStore) {
            if !running() {
                start();
            }
            assert!(
                eventually(|| store.available()),
                "no Secret Service answered"
            );
            store.save("not-a-token-1").unwrap();
            assert!(
                sh("dbus-send --session --print-reply --dest=org.freedesktop.secrets /org/freedesktop/secrets org.freedesktop.Secret.Service.Lock array:objpath:/org/freedesktop/secrets/collection/login > /dev/null 2>&1"),
                "the login keyring could not be locked"
            );
            assert!(
                sh("dbus-send --session --print-reply --dest=org.freedesktop.secrets /org/freedesktop/secrets/collection/login org.freedesktop.DBus.Properties.Get string:org.freedesktop.Secret.Collection string:Locked | grep -q 'boolean true'"),
                "the login keyring is not locked"
            );
        }

        /// The wiring the application has, with this keyring as the store and as the look
        /// before Sign in, a stand-in server that is never asked and a recording browser.
        fn wired_to(
            store: &Arc<KeychainStore>,
            limits: Option<(Duration, Duration)>,
        ) -> (Arc<Auth>, Receiver<Value>, Arc<Mutex<Vec<String>>>) {
            let opened = Arc::new(Mutex::new(Vec::new()));
            let record = Arc::clone(&opened);
            let browser: Browser = Arc::new(move |url| {
                record.lock().unwrap().push(url.to_string());
                true
            });
            let probe = Arc::clone(store);
            let (auth, wakes) = Auth::with_limits(
                Arc::new(api(&stand_in(vec![]))),
                Arc::clone(store) as Arc<dyn CredentialStore>,
                Arc::new(Marker::new(None)),
                browser,
                Arc::new(move || store_problem(probe.available(), probe.exists())),
                limits,
            );
            let (tx, changes) = channel();
            auth.run(wakes, move |status| {
                let _ = tx.send(status);
            });
            (auth, changes, opened)
        }

        fn within(
            changes: &Receiver<Value>,
            time: Duration,
            wanted: impl Fn(&Value) -> bool,
        ) -> Value {
            let deadline = Instant::now() + time;
            loop {
                let left = deadline.saturating_duration_since(Instant::now());
                let status = changes
                    .recv_timeout(left)
                    .expect("the status never arrived");
                if wanted(&status) {
                    return status;
                }
            }
        }

        fn says_waiting(status: &Value) -> bool {
            status["message"]
                .as_str()
                .is_some_and(|message| message.starts_with("Waiting for your system keychain"))
        }

        /// While the keyring's unlock prompt is left open after Sign out, every request is
        /// answered, with the times the application has (issue #130). A stand-in prompter
        /// must own the keyring's prompter name and answer "yes" with the password after
        /// `OPEN_SESAME_PROMPT_SECONDS` seconds; it shows nothing and is not a person.
        #[test]
        #[ignore = "ends the user's gnome-keyring-daemon; by hand in a disposable container only"]
        fn with_the_unlock_prompt_left_open_sign_out_and_every_request_are_answered() {
            disposable();
            let open_for = Duration::from_secs(
                std::env::var("OPEN_SESAME_PROMPT_SECONDS")
                    .ok()
                    .and_then(|seconds| seconds.parse().ok())
                    .expect("OPEN_SESAME_PROMPT_SECONDS says how long the prompter waits"),
            );
            let store = Arc::new(store("prompt"));
            locked_with_a_value(&store);
            let (auth, changes, opened) = wired_to(&store, None);

            // Sign out is answered though the prompt is open: the person is signed out here.
            let began = Instant::now();
            assert_eq!(answered(&auth, "auth.signOut"), Ok(json!(true)));
            let first = began.elapsed();
            assert!(says_waiting(&within(
                &changes,
                Duration::from_secs(10),
                says_waiting
            )));

            // For as long as the prompt stays open, every press and the status are answered.
            let (mut rounds, mut slowest) = (0, first);
            while began.elapsed() + Duration::from_secs(6) < open_for {
                for method in ["auth.signIn", "auth.cancel", "auth.signOut"] {
                    let asked = Instant::now();
                    assert_eq!(
                        answered(&auth, method),
                        Err(BridgeError::from(KEYCHAIN_WAITING)),
                        "{method} after {:?}",
                        began.elapsed()
                    );
                    slowest = slowest.max(asked.elapsed());
                }
                let asked = Instant::now();
                let status = answered(&auth, "auth.status").unwrap();
                slowest = slowest.max(asked.elapsed());
                assert_eq!(status["authenticated"], json!(false));
                assert!(says_waiting(&status), "{status}");
                assert!(!auth.authenticated());
                rounds += 1;
                std::thread::sleep(Duration::from_secs(1));
            }
            assert!(rounds >= 3, "the prompt was open for too short a time");
            assert!(opened.lock().unwrap().is_empty(), "no browser was opened");
            println!(
                "PROBE prompt open for {open_for:?}: Sign out answered in {first:?}; {rounds} rounds of Sign in, Cancel, Sign out and the status, the slowest answer {slowest:?}"
            );

            // The prompt is answered: the saved value is removed and a press is ordinary.
            let done = within(&changes, open_for + Duration::from_secs(20), |status| {
                status["message"] == json!("Signed out on this computer.")
            });
            assert_eq!(done["busy"], json!(false));
            println!(
                "PROBE the removal ended {:?} after Sign out",
                began.elapsed()
            );
            assert_eq!(store.load(), Ok(None));
            assert!(
                eventually(|| lock(&auth.look).began.is_none()),
                "the look before Sign in never ended"
            );
            assert_eq!(answered(&auth, "auth.signIn"), Ok(json!(true)));
            assert_eq!(opened.lock().unwrap().len(), 1);
            assert_eq!(answered(&auth, "auth.cancel"), Ok(json!(true)));
            auth.shutdown();
            stop();
        }

        /// A prompt that is never answered: the removal is given up at the limit, here ten
        /// seconds in place of the application's two minutes, and the status says the saved
        /// value could not be removed (issue #130). The stand-in prompter must wait longer
        /// than this test runs.
        #[test]
        #[ignore = "ends the user's gnome-keyring-daemon; by hand in a disposable container only"]
        fn a_prompt_that_is_never_answered_is_given_up_at_the_limit() {
            disposable();
            let store = Arc::new(store("never"));
            locked_with_a_value(&store);
            let limit = Duration::from_secs(10);
            let (auth, changes, opened) = wired_to(&store, Some((Duration::from_secs(2), limit)));

            let began = Instant::now();
            assert_eq!(answered(&auth, "auth.signOut"), Ok(json!(true)));
            let done = within(&changes, limit + Duration::from_secs(10), |status| {
                status["message"]
                    == json!("Signed out. The saved credential could not be removed; sign in again to replace it.")
            });
            let ended = began.elapsed();
            println!("PROBE a prompt never answered: given up {ended:?} after Sign out");
            assert!(ended >= limit, "given up before the limit: {ended:?}");
            assert_eq!(done["authenticated"], json!(false));
            assert_eq!(done["busy"], json!(false));
            // The status is answered, and a press is no longer told to wait for the keychain.
            assert!(!says_waiting(&answered(&auth, "auth.status").unwrap()));
            assert_eq!(answered(&auth, "auth.cancel"), Ok(json!(true)));
            // With that call still out a sign-in could not be saved: none is begun, and the
            // browser is not opened.
            assert_eq!(
                answered(&auth, "auth.signIn"),
                Err(BridgeError::from(KEYCHAIN_WAITING))
            );
            assert!(opened.lock().unwrap().is_empty());
            // The call that was given up is still out, so the process is not shut down in an
            // orderly way here: the keyring is ended, which is what ends that call.
            stop();
        }
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
