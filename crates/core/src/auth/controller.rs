//! The sign-in state machine.
//!
//! The controller never opens a browser, starts a timer or touches the network itself. The host
//! opens the URL [`AuthController::begin_sign_in`] returns, passes the callback to
//! [`AuthController::complete_sign_in`], and calls [`AuthController::refresh`] when
//! [`AuthController::next_refresh_in`] says so.
//!
//! Stale work is discarded with an epoch counter, as in the Swift host: starting a sign-in,
//! cancelling, signing out and shutting down each advance it, and the result of a network call
//! or of reading the credential store is applied only if the epoch is still the one it started
//! under. Both run without the state lock held, so the UI can read the status or cancel while
//! one is in flight.

use super::{
    authorization_code, authorize_url, generate_pkce, logout_url, verify_access_token, AuthError,
    CredentialStore, SignedOutMarker, Tokens, User, WorkosApi,
};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, SystemTime};

// Sign-in is an account control, not a door (issue #60): these sentences say what happened to
// the session and never tell a person they must sign in to carry on. Before any attempt there
// is nothing to say.
const START: &str = "";
const IN_BROWSER: &str = "Finish signing in in your browser.";
const SIGNED_IN: &str = "Signed in.";
const REFRESHING: &str = "Refreshing sign-in…";
const RESTORING: &str = "Restoring your sign-in…";
const CANCELLED: &str = "Sign-in cancelled.";
const EXPIRED: &str = "Your session expired. Sign in again to use your account.";
const ENDED: &str = "Your sign-in has ended. Sign in again to use your account.";
const FAILED: &str = "Could not complete sign-in. Check your connection and try again.";
const STORE_UNREADABLE: &str =
    "The saved sign-in could not be read from the system's credential store.";
const STORE_UNWRITABLE: &str =
    "Could not save your sign-in in your system keychain. Unlock it and try again.";
const SIGNED_OUT: &str = "Signed out on this computer.";
const SIGNED_OUT_NOT_REMOVED: &str =
    "Signed out. The saved credential could not be removed; sign in again to replace it.";

/// Refresh this long before the access token expires.
const REFRESH_MARGIN: Duration = Duration::from_secs(60);
/// Try again this long after a failure that may be temporary.
const RETRY_AFTER: Duration = Duration::from_secs(20);

/// What the host supplies.
pub struct AuthParts {
    pub api: Arc<dyn WorkosApi>,
    pub store: Arc<dyn CredentialStore>,
    pub marker: Arc<dyn SignedOutMarker>,
    /// The current time. Injected so tests do not depend on the wall clock.
    pub clock: Arc<dyn Fn() -> SystemTime + Send + Sync>,
    /// Called, without any lock held, whenever [`AuthController::status`] may have changed.
    pub on_change: Arc<dyn Fn() + Send + Sync>,
}

/// One sign-in attempt waiting for its callback.
struct Pending {
    state: String,
    verifier: String,
}

#[derive(Clone, Copy, PartialEq)]
enum Phase {
    SignIn,
    Refresh,
}

struct State {
    epoch: u64,
    pending: Option<Pending>,
    busy: bool,
    restoring: bool,
    message: &'static str,
    user: Option<User>,
    expires: Option<SystemTime>,
    session_id: Option<String>,
    /// The refresh token, held in memory between refreshes. Persisted only through the store.
    saved: Option<String>,
    retry_at: Option<SystemTime>,
}

impl State {
    fn authenticated(&self, now: SystemTime) -> bool {
        self.user.is_some() && self.expires.is_some_and(|deadline| deadline > now)
    }

    /// Ends whatever is in flight. The caller sets the message.
    fn interrupt(&mut self) {
        self.epoch += 1;
        self.pending = None;
        self.busy = false;
        self.restoring = false;
    }
}

pub struct AuthController {
    parts: AuthParts,
    state: Mutex<State>,
}

impl AuthController {
    pub fn new(parts: AuthParts) -> Self {
        let state = State {
            epoch: 0,
            pending: None,
            busy: false,
            restoring: false,
            message: START,
            user: None,
            expires: None,
            session_id: None,
            saved: None,
            retry_at: None,
        };
        Self {
            parts,
            state: Mutex::new(state),
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn now(&self) -> SystemTime {
        (self.parts.clock)()
    }

    fn changed(&self) {
        (self.parts.on_change)();
    }

    /// True while a verified session is within its deadline.
    pub fn authenticated(&self) -> bool {
        self.lock().authenticated(self.now())
    }

    /// The `auth.status` reply: `{authenticated, busy, message, name, email}`. Never a token.
    pub fn status(&self) -> Value {
        let now = self.now();
        let state = self.lock();
        let authenticated = state.authenticated(now);
        let user = state.user.as_ref().filter(|_| authenticated);
        let name = user.and_then(|user| user.name.clone().or_else(|| user.first_name.clone()));
        let expired = state.user.is_some() && !authenticated && !state.busy;
        json!({
            "authenticated": authenticated,
            "busy": state.busy,
            "message": if expired { EXPIRED } else { state.message },
            "name": name.unwrap_or_default(),
            "email": user.map(|user| user.email.clone()).unwrap_or_default(),
        })
    }

    /// Starts a sign-in and returns the URL to open in the system browser.
    ///
    /// A sign-in the user asks for takes precedence over a background restore, which is
    /// cancelled. While another sign-in is pending this returns [`AuthError::Busy`].
    pub fn begin_sign_in(&self) -> Result<String, AuthError> {
        let pkce = generate_pkce()?;
        let url = authorize_url(&pkce);
        {
            let mut state = self.lock();
            if state.restoring {
                state.interrupt();
            }
            if state.busy {
                return Err(AuthError::Busy);
            }
            state.epoch += 1;
            state.pending = Some(Pending {
                state: pkce.state,
                verifier: pkce.verifier,
            });
            state.busy = true;
            state.retry_at = None;
            state.message = IN_BROWSER;
        }
        self.changed();
        Ok(url)
    }

    /// Handles the callback URL the browser was redirected to.
    ///
    /// A callback with no sign-in pending (after cancel, sign-out, a completed attempt or a
    /// failed one) is ignored and changes nothing. A callback that fails validation ends the
    /// pending attempt and leaves the app signed out; no code is sent anywhere.
    pub fn complete_sign_in(&self, callback: &str) {
        let (ticket, outcome) = {
            let mut state = self.lock();
            let Some(pending) = state.pending.take() else {
                return;
            };
            let outcome =
                authorization_code(callback, &pending.state).map(|code| (code, pending.verifier));
            (state.epoch, outcome)
        };
        let result =
            outcome.and_then(|(code, verifier)| self.parts.api.exchange_code(&code, &verifier));
        match result {
            Ok(tokens) => self.accept(tokens, ticket, Phase::SignIn),
            Err(error) => self.failed(error, ticket, Phase::SignIn),
        }
    }

    /// At launch: signs in from the saved credential, unless the user signed out.
    pub fn restore(&self) {
        let ticket = {
            let state = self.lock();
            (!state.busy).then_some(state.epoch)
        };
        let ticket = ticket.filter(|_| !self.parts.marker.signed_out());
        let started = ticket.and_then(|ticket| {
            // The store is read without the lock held, so what it returns is used only if no
            // sign-in, cancel, sign-out or shutdown happened while it was being read. Otherwise
            // a credential read before a sign-out would sign the user back in after it.
            let loaded = self.parts.store.load();
            let mut state = self.lock();
            if state.epoch != ticket {
                return None;
            }
            match loaded {
                Ok(Some(token)) if !token.is_empty() => {
                    // A credential already held in memory is at least as new as the stored one.
                    state.saved.get_or_insert(token);
                    self.start_refresh(&mut state)
                }
                Ok(_) => None,
                Err(_) => {
                    if !state.busy {
                        state.message = STORE_UNREADABLE;
                    }
                    None
                }
            }
        });
        self.changed();
        if let Some((ticket, token)) = started {
            self.run_refresh(ticket, &token);
        }
    }

    /// Exchanges the saved refresh token for a new session. Does nothing while busy or when no
    /// credential is held.
    pub fn refresh(&self) {
        let started = self.start_refresh(&mut self.lock());
        if let Some((ticket, token)) = started {
            self.changed();
            self.run_refresh(ticket, &token);
        }
    }

    /// Marks a refresh as in flight and returns its ticket and the token to send, unless the
    /// controller is busy or holds no credential.
    fn start_refresh(&self, state: &mut State) -> Option<(u64, String)> {
        if state.busy {
            return None;
        }
        let token = state.saved.clone()?;
        state.busy = true;
        state.restoring = true;
        state.retry_at = None;
        state.message = if state.authenticated(self.now()) {
            REFRESHING
        } else {
            RESTORING
        };
        Some((state.epoch, token))
    }

    /// The network half of a refresh. Runs without the state lock held.
    fn run_refresh(&self, ticket: u64, token: &str) {
        match self.parts.api.refresh(token) {
            Ok(tokens) => self.accept(tokens, ticket, Phase::Refresh),
            Err(error) => self.failed(error, ticket, Phase::Refresh),
        }
    }

    /// Verifies the server's answer and, only then, saves the credential and opens the session.
    fn accept(&self, tokens: Tokens, ticket: u64, phase: Phase) {
        let verified = self.parts.api.jwks().and_then(|jwks| {
            verify_access_token(&tokens.access_token, &jwks, &tokens.user.id, self.now())
        });
        let verified = match verified {
            Ok(verified) => verified,
            Err(error) => return self.failed(error, ticket, phase),
        };
        {
            let mut state = self.lock();
            if state.epoch != ticket {
                return;
            }
            // The lock is held across the save so a cancel or sign-out cannot land between the
            // save and the state change and leave a credential behind.
            if self.parts.store.save(&tokens.refresh_token).is_err() {
                self.fail(&mut state, AuthError::Store, phase);
            } else {
                self.parts.marker.set_signed_out(false);
                state.saved = Some(tokens.refresh_token);
                state.user = Some(tokens.user);
                state.expires = Some(verified.expires);
                state.session_id = Some(verified.session_id);
                state.busy = false;
                state.restoring = false;
                state.retry_at = None;
                state.message = SIGNED_IN;
            }
        }
        self.changed();
    }

    fn failed(&self, error: AuthError, ticket: u64, phase: Phase) {
        {
            let mut state = self.lock();
            if state.epoch != ticket {
                return;
            }
            self.fail(&mut state, error, phase);
        }
        self.changed();
    }

    fn fail(&self, state: &mut State, error: AuthError, phase: Phase) {
        state.busy = false;
        state.restoring = false;
        state.pending = None;
        // Only a refresh can end the session. A code exchange the server refuses is a failed
        // sign-in attempt and must not delete a credential that is still good.
        let ended = phase == Phase::Refresh && error == AuthError::Ended;
        if ended {
            state.user = None;
            state.expires = None;
            state.session_id = None;
            state.saved = None;
            let _ = self.parts.store.delete();
        }
        let store_failure = error == AuthError::Store;
        state.message = if store_failure {
            STORE_UNWRITABLE
        } else if ended {
            ENDED
        } else {
            FAILED
        };
        let retry = !ended && !store_failure && state.saved.is_some();
        state.retry_at = retry.then(|| self.now() + RETRY_AFTER);
    }

    /// Cancels a pending sign-in or restore. Its late callback or late answer is ignored.
    pub fn cancel(&self) {
        {
            let mut state = self.lock();
            state.interrupt();
            state.message = CANCELLED;
        }
        self.changed();
    }

    /// Signs out locally and returns the URL that ends the remote session, when a verified
    /// session ID is known. The host opens it in the system browser.
    pub fn sign_out(&self) -> Option<String> {
        let url = {
            let mut state = self.lock();
            state.interrupt();
            state.retry_at = None;
            state.saved = None;
            state.user = None;
            state.expires = None;
            // The marker is set before the delete so a credential that cannot be removed is
            // still not restored at the next launch.
            self.parts.marker.set_signed_out(true);
            state.message = match self.parts.store.delete() {
                Ok(()) => SIGNED_OUT,
                Err(_) => SIGNED_OUT_NOT_REMOVED,
            };
            state
                .session_id
                .take()
                .map(|session_id| logout_url(&session_id))
        };
        self.changed();
        url
    }

    /// At quit: discards anything in flight without changing what is saved.
    pub fn shutdown(&self) {
        self.lock().interrupt();
    }

    /// How long until the host should call [`AuthController::refresh`]: 20 seconds after a
    /// failure that may be temporary, otherwise 60 seconds before the session's deadline.
    /// `None` while busy or when there is nothing to refresh.
    pub fn next_refresh_in(&self) -> Option<Duration> {
        let now = self.now();
        let state = self.lock();
        if state.busy {
            return None;
        }
        let due = match state.retry_at {
            Some(retry_at) => retry_at,
            None => {
                state.saved.as_ref()?;
                state.user.as_ref()?;
                state.expires?.checked_sub(REFRESH_MARGIN)?
            }
        };
        Some(due.duration_since(now).unwrap_or(Duration::ZERO))
    }
}
