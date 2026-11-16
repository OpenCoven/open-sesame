//! The sign-in state machine.
//!
//! The controller never opens a browser, starts a timer or touches the network itself. The host
//! opens the URL [`AuthController::begin_sign_in`] returns, passes the callback to
//! [`AuthController::complete_sign_in`], and calls [`AuthController::refresh`] when
//! [`AuthController::next_refresh_in`] says so.
//!
//! Session updates use an epoch counter. Refresh credential rotation has a separate lineage:
//! cancel and a new pending sign-in cannot throw away a replacement for an already consumed
//! credential. Sign-out and a completed newer sign-in invalidate that lineage too. Network
//! calls run without the state lock; credential writes are serialized with lineage changes.
//! Shutdown closes admission and drains an already running refresh before the host exits.
//!
//! The credential store can wait for a person: a locked keyring shows its unlock prompt and
//! answers when the prompt does, or never (issue #130). So that nothing else waits with it:
//! [`AuthController::authenticated`] and [`AuthController::status`] answer from a copy of the
//! state and never take the state's lock; every store call runs on a thread of its own and is
//! given up after a limit; and the three things a person can ask for while a write is waited
//! for ([`AuthController::begin_sign_in`], [`AuthController::cancel_now`] and
//! [`AuthController::sign_out_now`]) answer [`AuthError::StoreBusy`] instead of waiting.

use super::{
    authorization_code, authorize_url, generate_pkce, logout_url, verify_access_token, AuthError,
    CredentialStore, SignedOutMarker, Tokens, User, WorkosApi,
};
use serde_json::{json, Value};
use std::ops::{Deref, DerefMut};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, TryLockError};
use std::time::{Duration, Instant, SystemTime};

// Sign-in is an account control, not a door (issue #60): these sentences say what happened to
// the session and never tell a person they must sign in to carry on. Before any attempt there
// is nothing to say.
const START: &str = "";
const IN_BROWSER: &str = "Finish signing in in your browser.";
const SIGNED_IN: &str = "Signed in.";
const REFRESHING: &str = "Refreshing sign-in…";
const RESTORING: &str = "Restoring your sign-in…";
const CANCELLED: &str = "Sign-in cancelled.";
// After a new sign-in has failed and the earlier sign-in's credential has then been saved:
// nobody is signed in for the rest of this run, and the next launch restores that sign-in
// (issue #94, decided on 16 November 2026).
const EARLIER_SAVED: &str = "The new sign-in could not be completed. Your earlier sign-in is saved and will be used the next time Open Sesame starts.";
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

// Shown while a call to the credential store has been waited for longer than a moment: on a
// locked keyring that is the time its unlock prompt is open (issue #130).
const WAITING_FOR_STORE: &str =
    "Waiting for your system keychain. If it is asking for your password, answer it and this will finish.";

/// How long a call to the credential store is waited for before the status says so, and how
/// long a request from the page waits for the state before it is told the store is busy. A
/// store that answers does so in far less; a prompt takes a person far longer.
const STORE_SOON: Duration = Duration::from_secs(2);
/// How long a call to the credential store is waited for at all. It has to cover a person
/// reading the keyring's prompt and typing a password. No request from the page waits this
/// long: a request waits `STORE_SOON` at most, which has to stay below the page's own limit.
const STORE_LIMIT: Duration = Duration::from_secs(120);

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
    /// Called whenever [`AuthController::status`] may have changed. It may read the status and
    /// ask whether the person is signed in. It must not call anything else on the controller
    /// before it returns: it is also called while a store call is being waited for, and the
    /// state's lock may be held then.
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

/// Work already admitted by the refresh scheduler.
enum RefreshWork {
    Exchange(String),
    Verify(Tokens),
    Persist,
}

#[derive(Clone, Copy)]
struct RefreshTicket {
    epoch: u64,
    credential_epoch: u64,
}

struct State {
    epoch: u64,
    credential_epoch: u64,
    /// Unlike UI busy, this stays set across cancel and a new pending sign-in.
    refreshing: bool,
    closed: bool,
    /// The newest refresh credential must be saved before another exchange.
    unsaved: bool,
    /// A returned refresh response waiting for saving or a transient JWKS retry.
    verification: Option<Tokens>,
    pending: Option<Pending>,
    busy: bool,
    restoring: bool,
    /// The last thing the person asked for was a new sign-in, and it failed. A Cancel ends
    /// it; a failed refresh neither sets nor ends it. A new attempt, a sign-out and an opened
    /// session end it too, for tidiness only: after each of those the save-only retry that
    /// reads it cannot come before a Cancel or another failed sign-in has set it again. It
    /// decides only which sentence follows a save-only retry with nobody signed in.
    sign_in_failed: bool,
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
        self.verification = None;
        self.busy = false;
        self.restoring = false;
    }
}

/// What [`AuthController::status`] and [`AuthController::authenticated`] answer from: a copy
/// of the parts of the state they need. It is made each time the state's lock is released,
/// and before each store call made with that lock held, so the two never wait for the store.
#[derive(Clone)]
struct Seen {
    user: Option<User>,
    expires: Option<SystemTime>,
    busy: bool,
    unsaved: bool,
    message: &'static str,
}

impl Seen {
    fn of(state: &State) -> Self {
        Self {
            user: state.user.clone(),
            expires: state.expires,
            busy: state.busy,
            unsaved: state.unsaved,
            message: state.message,
        }
    }

    fn authenticated(&self, now: SystemTime) -> bool {
        self.user.is_some() && self.expires.is_some_and(|deadline| deadline > now)
    }
}

/// The state with its lock held. When it is let go, what was done is copied to [`Seen`].
struct Locked<'a> {
    state: Option<MutexGuard<'a, State>>,
    seen: &'a Mutex<Seen>,
}

impl Deref for Locked<'_> {
    type Target = State;
    fn deref(&self) -> &State {
        self.state.as_ref().expect("held until dropped")
    }
}

impl DerefMut for Locked<'_> {
    fn deref_mut(&mut self) -> &mut State {
        self.state.as_mut().expect("held until dropped")
    }
}

impl<'a> Locked<'a> {
    /// Lets the state go until `changed` is signalled, then holds it again.
    fn wait(mut self, changed: &Condvar) -> Self {
        let state = self.state.take().expect("held until dropped");
        *unpoisoned(self.seen) = Seen::of(&state);
        self.state = Some(
            changed
                .wait(state)
                .unwrap_or_else(|poisoned| poisoned.into_inner()),
        );
        self
    }
}

impl Drop for Locked<'_> {
    fn drop(&mut self) {
        if let Some(state) = &self.state {
            *unpoisoned(self.seen) = Seen::of(state);
        }
    }
}

fn unpoisoned<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// How one store call stands between the thread that makes it and the one that waits for it.
#[derive(Clone, Copy, PartialEq)]
enum Call {
    Out,
    Answered,
    GivenUp,
}

/// The store calls that were given up at the limit and have not returned since.
#[derive(Default)]
struct Out {
    /// How many there are. While there is one, every store call fails at once and no sign-in
    /// is begun.
    stuck: usize,
    /// A removal was asked for meanwhile and could not be made. It is made when the last of
    /// those calls returns, so that a save given up before a sign-out does not outlive it.
    removal_owed: bool,
}

/// A call that was given up has returned, or will never return because it panicked. A
/// removal that was asked for while it was out is made now, on the call's own thread and
/// before any other store call is let through.
fn returned(out: &Mutex<Out>, store: &dyn CredentialStore) {
    loop {
        let mut out = unpoisoned(out);
        if out.removal_owed && out.stuck == 1 {
            out.removal_owed = false;
            drop(out);
            let _ = catch_unwind(AssertUnwindSafe(|| store.delete()));
            continue;
        }
        out.stuck -= 1;
        break;
    }
}

pub struct AuthController {
    parts: AuthParts,
    state: Mutex<State>,
    seen: Mutex<Seen>,
    drained: Condvar,
    /// Store calls that have been waited for longer than a moment and are still waited for.
    store_waits: AtomicUsize,
    store_out: Arc<Mutex<Out>>,
    store_soon: Duration,
    store_limit: Duration,
}

/// Release refresh admission even if the work of a refresh or the change callback panics. It
/// is made before the host hears that a refresh was admitted, so that a change callback that
/// panics there is covered too; the injected clock is read just before that, under no guard.
/// What it releases is admission only: after a panic at that point the status stays busy
/// until Cancel, sign-out or a new sign-in.
struct RefreshFlight<'a>(&'a AuthController);

impl Drop for RefreshFlight<'_> {
    fn drop(&mut self) {
        self.0.lock().refreshing = false;
        self.0.drained.notify_all();
        if std::thread::panicking() {
            // A second panic while the first unwinds would end the process.
            let _ = catch_unwind(AssertUnwindSafe(|| self.0.changed()));
        } else {
            self.0.changed();
        }
    }
}

impl AuthController {
    pub fn new(parts: AuthParts) -> Self {
        let state = State {
            epoch: 0,
            credential_epoch: 0,
            refreshing: false,
            closed: false,
            unsaved: false,
            verification: None,
            pending: None,
            busy: false,
            restoring: false,
            sign_in_failed: false,
            message: START,
            user: None,
            expires: None,
            session_id: None,
            saved: None,
            retry_at: None,
        };
        Self {
            parts,
            seen: Mutex::new(Seen::of(&state)),
            state: Mutex::new(state),
            drained: Condvar::new(),
            store_waits: AtomicUsize::new(0),
            store_out: Arc::new(Mutex::new(Out::default())),
            store_soon: STORE_SOON,
            store_limit: STORE_LIMIT,
        }
    }

    /// Replaces the two times a store call is measured against: `soon`, after which the status
    /// says the store is being waited for and a request from the page is told so, and `limit`,
    /// after which the call is given up. For tests; the host keeps the defaults.
    pub fn store_limits(mut self, soon: Duration, limit: Duration) -> Self {
        self.store_soon = soon;
        self.store_limit = limit;
        self
    }

    /// How long a request from the page waits before it is told the store is busy. The host
    /// measures its own look at the store against the same time.
    pub fn store_soon(&self) -> Duration {
        self.store_soon
    }

    /// How long a store call is waited for before it is given up. The host gives its own look
    /// at the store up after the same time.
    pub fn store_limit(&self) -> Duration {
        self.store_limit
    }

    fn lock(&self) -> Locked<'_> {
        Locked {
            state: Some(unpoisoned(&self.state)),
            seen: &self.seen,
        }
    }

    /// The state for a request from the page, or `None` when something has held it for longer
    /// than a moment. Only a store call holds it that long.
    fn lock_soon(&self) -> Option<Locked<'_>> {
        let started = Instant::now();
        loop {
            match self.state.try_lock() {
                Ok(state) => break Some(state),
                Err(TryLockError::Poisoned(poisoned)) => break Some(poisoned.into_inner()),
                Err(TryLockError::WouldBlock) if started.elapsed() >= self.store_soon => {
                    break None
                }
                Err(TryLockError::WouldBlock) => std::thread::sleep(Duration::from_millis(5)),
            }
        }
        .map(|state| Locked {
            state: Some(state),
            seen: &self.seen,
        })
    }

    /// One call to the credential store, on a thread of its own, waited for no longer than
    /// the limit. `held` is the state when the call is made with its lock held; what it says
    /// by now is published first, so that the status and the gate do not show the time before.
    ///
    /// A call given up is not ended: nothing can end a keyring call that waits for its prompt.
    /// Its thread stays until the store answers, and what it was asked to do may still happen
    /// then: a save given up may so land later. While such a call is out the store is not
    /// asked again, because a second call would only wait behind the first; every call fails
    /// at once until it returns, and no sign-in is begun. A removal asked for meanwhile is
    /// made when it returns ([`returned`]), so that such a save does not outlive a sign-out.
    fn store<T: Send + 'static>(
        &self,
        held: Option<&State>,
        call: impl FnOnce(&dyn CredentialStore) -> Result<T, AuthError> + Send + 'static,
    ) -> Result<T, AuthError> {
        self.store_as(held, false, call)
    }

    /// Removes the saved credential, as [`AuthController::store`] makes any call. A removal
    /// that cannot be made because a call given up is still out is owed: it is made when that
    /// call returns, since what the call was asked to save may land then.
    fn remove(&self, held: Option<&State>) -> Result<(), AuthError> {
        self.store_as(held, true, |store| store.delete())
    }

    fn store_as<T: Send + 'static>(
        &self,
        held: Option<&State>,
        removal: bool,
        call: impl FnOnce(&dyn CredentialStore) -> Result<T, AuthError> + Send + 'static,
    ) -> Result<T, AuthError> {
        if let Some(state) = held {
            *unpoisoned(&self.seen) = Seen::of(state);
        }
        {
            let mut out = unpoisoned(&self.store_out);
            if out.stuck > 0 {
                out.removal_owed |= removal;
                return Err(AuthError::Store);
            }
        }
        let (tell, told) = channel();
        let standing = Arc::new(Mutex::new(Call::Out));
        let (store, out, theirs) = (
            self.parts.store.clone(),
            self.store_out.clone(),
            standing.clone(),
        );
        let started = std::thread::Builder::new()
            .name("credential-store".into())
            .spawn(move || {
                // A call that panics has ended too: it must not count as out for ever.
                let answer = catch_unwind(AssertUnwindSafe(|| call(store.as_ref())));
                let mut standing = unpoisoned(&theirs);
                if *standing == Call::GivenUp {
                    drop(standing);
                    returned(&out, store.as_ref());
                } else {
                    // Also for a call that panicked: it has ended, and the waiting side must
                    // not give it up after this and count it as out.
                    *standing = Call::Answered;
                    if let Ok(answer) = answer {
                        let _ = tell.send(answer);
                    }
                }
            });
        if started.is_err() {
            return Err(AuthError::Store);
        }
        let answer = match told.recv_timeout(self.store_soon) {
            Err(RecvTimeoutError::Timeout) => {
                self.store_waits.fetch_add(1, Ordering::SeqCst);
                // The state's lock may be held here; a callback that panics must not unwind
                // through whoever holds it.
                let _ = catch_unwind(AssertUnwindSafe(|| self.changed()));
                let rest = self.store_limit.saturating_sub(self.store_soon);
                let answer = told.recv_timeout(rest);
                self.store_waits.fetch_sub(1, Ordering::SeqCst);
                answer
            }
            answer => answer,
        };
        match answer {
            Ok(answer) => answer,
            // The call panicked: it will never answer, and it is not out either.
            Err(RecvTimeoutError::Disconnected) => Err(AuthError::Store),
            Err(RecvTimeoutError::Timeout) => {
                let mut standing = unpoisoned(&standing);
                if *standing == Call::Answered {
                    // It answered between the limit and here.
                    told.try_recv().unwrap_or(Err(AuthError::Store))
                } else {
                    *standing = Call::GivenUp;
                    unpoisoned(&self.store_out).stuck += 1;
                    Err(AuthError::Store)
                }
            }
        }
    }

    fn now(&self) -> SystemTime {
        (self.parts.clock)()
    }

    fn changed(&self) {
        (self.parts.on_change)();
    }

    /// True while a verified session is within its deadline.
    pub fn authenticated(&self) -> bool {
        let now = self.now();
        unpoisoned(&self.seen).authenticated(now)
    }

    /// The `auth.status` reply: `{authenticated, busy, message, name, email}`. Never a token.
    pub fn status(&self) -> Value {
        let now = self.now();
        let state = unpoisoned(&self.seen).clone();
        let authenticated = state.authenticated(now);
        let user = state.user.as_ref().filter(|_| authenticated);
        let name = user.and_then(|user| user.name.clone().or_else(|| user.first_name.clone()));
        let expired = state.user.is_some() && !authenticated && !state.busy && !state.unsaved;
        let message = if self.store_waits.load(Ordering::SeqCst) > 0 {
            WAITING_FOR_STORE
        } else if expired {
            EXPIRED
        } else {
            state.message
        };
        json!({
            "authenticated": authenticated,
            "busy": state.busy,
            "message": message,
            "name": name.unwrap_or_default(),
            "email": user.map(|user| user.email.clone()).unwrap_or_default(),
        })
    }

    /// Starts a sign-in and returns the URL to open in the system browser.
    ///
    /// A sign-in the user asks for takes precedence over a background restore, which is
    /// cancelled. While another sign-in is pending this returns [`AuthError::Busy`], and
    /// while the credential store is being waited for, [`AuthError::StoreBusy`].
    pub fn begin_sign_in(&self) -> Result<String, AuthError> {
        // With a store call given up and still out, a new sign-in could not be saved: the
        // browser is not opened for one.
        if unpoisoned(&self.store_out).stuck > 0 {
            return Err(AuthError::StoreBusy);
        }
        let pkce = generate_pkce()?;
        let url = authorize_url(&pkce);
        {
            let mut state = self.lock_soon().ok_or(AuthError::StoreBusy)?;
            if state.closed {
                return Err(AuthError::Busy);
            }
            if state.restoring {
                state.interrupt();
            }
            if state.busy {
                return Err(AuthError::Busy);
            }
            state.epoch += 1;
            state.verification = None;
            state.sign_in_failed = false;
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
            Ok(tokens) => self.accept_sign_in(tokens, ticket),
            Err(error) => self.failed(error, ticket, Phase::SignIn),
        }
    }

    /// At launch: signs in from the saved credential, unless the user signed out.
    pub fn restore(&self) {
        let ticket = {
            let state = self.lock();
            (!state.busy && !state.closed).then_some(state.epoch)
        };
        let ticket = ticket.filter(|_| !self.parts.marker.signed_out());
        let started = ticket.and_then(|ticket| {
            // The store is read without the lock held, so what it returns is used only if no
            // sign-in, cancel, sign-out or shutdown happened while it was being read. Otherwise
            // a credential read before a sign-out would sign the user back in after it.
            let loaded = self.store(None, |store| store.load());
            let mut state = self.lock();
            if state.epoch != ticket || state.closed {
                return None;
            }
            match loaded {
                Ok(Some(token)) if !token.is_empty() => {
                    // A credential already held in memory is at least as new as the stored one.
                    state.saved.get_or_insert(token);
                    self.start_refresh(&mut state, true)
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
        let flight = started.is_some().then(|| RefreshFlight(self));
        self.changed();
        if let (Some(flight), Some((ticket, work))) = (flight, started) {
            self.run_refresh(flight, ticket, work);
        }
    }

    /// Renews an existing session or retries admitted restore/recovery work. A cancelled
    /// signed-out restore needs a new explicit `restore`, not a stale scheduler tick.
    pub fn refresh(&self) {
        let started = self.start_refresh(&mut self.lock(), false);
        if let Some((ticket, work)) = started {
            let flight = RefreshFlight(self);
            self.changed();
            self.run_refresh(flight, ticket, work);
        }
    }

    /// Admit at most one refresh, including recovery of a returned response. Backoff applies
    /// even when a caller asks directly rather than consulting `next_refresh_in`.
    fn start_refresh(
        &self,
        state: &mut State,
        explicit_restore: bool,
    ) -> Option<(RefreshTicket, RefreshWork)> {
        if state.closed
            || state.busy
            || state.refreshing
            || state.retry_at.is_some_and(|due| due > self.now())
            // A queued scheduler tick cannot revive a cancelled signed-out restore. A new
            // explicit restore may start it again; save-only work remains admissible.
            || (!explicit_restore && state.user.is_none() && state.retry_at.is_none() && !state.unsaved)
        {
            return None;
        }
        let work = match &state.verification {
            Some(tokens) => RefreshWork::Verify(tokens.clone()),
            None if state.unsaved => RefreshWork::Persist,
            None => RefreshWork::Exchange(state.saved.clone()?),
        };
        state.busy = true;
        state.restoring = true;
        state.refreshing = true;
        state.retry_at = None;
        state.message = if state.authenticated(self.now()) {
            REFRESHING
        } else {
            RESTORING
        };
        Some((
            RefreshTicket {
                epoch: state.epoch,
                credential_epoch: state.credential_epoch,
            },
            work,
        ))
    }

    /// Persist the newest credential before verification or another exchange. A stale UI
    /// attempt may still save its rotation, but cannot overwrite sign-out or a newer account.
    fn persist_refresh(&self, ticket: RefreshTicket) -> bool {
        let mut state = self.lock();
        if state.credential_epoch != ticket.credential_epoch {
            return false;
        }
        if state.unsaved {
            let Some(token) = state.saved.clone() else {
                return false;
            };
            if self
                .store(Some(&state), move |store| store.save(&token))
                .is_err()
            {
                if state.epoch == ticket.epoch && !state.closed {
                    self.fail(&mut state, AuthError::Store, Phase::Refresh);
                } else if !state.busy && !state.closed {
                    state.retry_at = Some(self.now() + RETRY_AFTER);
                    state.message = STORE_UNWRITABLE;
                }
                return false;
            }
            state.unsaved = false;
        }
        true
    }

    fn refresh_current(&self, ticket: RefreshTicket) -> bool {
        let state = self.lock();
        !state.closed
            && state.epoch == ticket.epoch
            && state.credential_epoch == ticket.credential_epoch
    }

    /// The network half runs unlocked. A successful exchange consumes its input credential,
    /// so checkpoint the replacement before any fallible JWKS work, even after cancellation.
    fn run_refresh(&self, _flight: RefreshFlight<'_>, ticket: RefreshTicket, work: RefreshWork) {
        if !self.persist_refresh(ticket) {
            return;
        }
        if !self.refresh_current(ticket) {
            return;
        }
        let tokens = match work {
            RefreshWork::Persist => {
                let mut state = self.lock();
                if !state.closed && state.epoch == ticket.epoch {
                    state.busy = false;
                    state.restoring = false;
                    state.retry_at = None;
                    // Reached after a Cancel, and after a new sign-in that failed. With a
                    // session still open the save changes nothing a person sees. With nobody
                    // signed in, the sentence says which of the two it was.
                    state.message = if state.authenticated(self.now()) {
                        SIGNED_IN
                    } else if state.sign_in_failed {
                        EARLIER_SAVED
                    } else {
                        CANCELLED
                    };
                }
                return;
            }
            RefreshWork::Verify(tokens) => tokens,
            RefreshWork::Exchange(token) => match self.parts.api.refresh(&token) {
                Ok(tokens) => {
                    {
                        let mut state = self.lock();
                        if state.credential_epoch != ticket.credential_epoch {
                            return;
                        }
                        state.saved = Some(tokens.refresh_token.clone());
                        state.unsaved = true;
                        if state.epoch == ticket.epoch && !state.closed {
                            state.verification = Some(tokens.clone());
                        }
                    }
                    if !self.persist_refresh(ticket) {
                        return;
                    }
                    tokens
                }
                Err(error) => return self.failed(error, ticket.epoch, Phase::Refresh),
            },
        };
        if !self.refresh_current(ticket) {
            return;
        }
        let verified = self.parts.api.jwks().and_then(|jwks| {
            verify_access_token(&tokens.access_token, &jwks, &tokens.user.id, self.now())
        });
        {
            let mut state = self.lock();
            if state.closed
                || state.epoch != ticket.epoch
                || state.credential_epoch != ticket.credential_epoch
            {
                return;
            }
            match verified {
                Ok(verified) => {
                    state.verification = None;
                    self.open_session(&mut state, tokens, verified);
                }
                Err(error) => {
                    // A malformed, mismatched or expired access token is never reused. The
                    // rotated refresh credential survives; the next attempt exchanges it.
                    if error != AuthError::Network {
                        state.verification = None;
                    }
                    self.fail(&mut state, error, Phase::Refresh);
                }
            }
        }
    }

    fn open_session(&self, state: &mut State, tokens: Tokens, verified: super::Verified) {
        self.parts.marker.set_signed_out(false);
        state.user = Some(tokens.user);
        state.expires = Some(verified.expires);
        state.session_id = Some(verified.session_id);
        state.busy = false;
        state.restoring = false;
        state.sign_in_failed = false;
        state.retry_at = None;
        state.message = SIGNED_IN;
    }

    /// New sign-ins still verify before saving or replacing the credential lineage.
    fn accept_sign_in(&self, tokens: Tokens, ticket: u64) {
        let verified = self.parts.api.jwks().and_then(|jwks| {
            verify_access_token(&tokens.access_token, &jwks, &tokens.user.id, self.now())
        });
        let verified = match verified {
            Ok(verified) => verified,
            Err(error) => return self.failed(error, ticket, Phase::SignIn),
        };
        {
            let mut state = self.lock();
            if state.epoch != ticket || state.closed {
                return;
            }
            // The lock is held across the save so a cancel or sign-out cannot land between the
            // save and the state change and leave a credential behind. The page's Cancel and
            // Sign out do not wait for it: they are told the store is busy.
            let token = tokens.refresh_token.clone();
            if self
                .store(Some(&state), move |store| store.save(&token))
                .is_err()
            {
                self.fail(&mut state, AuthError::Store, Phase::SignIn);
            } else {
                state.credential_epoch += 1;
                state.saved = Some(tokens.refresh_token.clone());
                state.unsaved = false;
                state.verification = None;
                self.open_session(&mut state, tokens, verified);
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
        if phase == Phase::SignIn {
            state.sign_in_failed = true;
        }
        // Only a refresh can end the session. A code exchange the server refuses is a failed
        // sign-in attempt and must not delete a credential that is still good.
        let ended = phase == Phase::Refresh && error == AuthError::Ended;
        if ended {
            state.user = None;
            state.expires = None;
            state.session_id = None;
            state.saved = None;
            state.unsaved = false;
            state.verification = None;
            state.credential_epoch += 1;
            // Said before the store is asked, so that the status does not show the time
            // before while the removal is waited for.
            state.message = ENDED;
            let _ = self.remove(Some(state));
        }
        let store_failure = error == AuthError::Store;
        state.message = if store_failure {
            STORE_UNWRITABLE
        } else if ended {
            ENDED
        } else {
            FAILED
        };
        let retry = !ended
            && state.saved.is_some()
            && (phase == Phase::Refresh || !store_failure || state.unsaved);
        state.retry_at = retry.then(|| self.now() + RETRY_AFTER);
    }

    /// Cancels session updates from pending work. A sent refresh still saves its replacement.
    /// This waits for a store call that holds the state; a request from the page uses
    /// [`AuthController::cancel_now`].
    pub fn cancel(&self) {
        self.cancel_in(self.lock());
    }

    /// As [`AuthController::cancel`], for a request from the page: while the credential store
    /// is being waited for nothing is cancelled and the answer is [`AuthError::StoreBusy`].
    pub fn cancel_now(&self) -> Result<(), AuthError> {
        self.cancel_in(self.lock_soon().ok_or(AuthError::StoreBusy)?);
        Ok(())
    }

    fn cancel_in(&self, mut state: Locked<'_>) {
        state.interrupt();
        state.sign_in_failed = false;
        state.message = CANCELLED;
        state.retry_at = (state.unsaved && !state.closed).then(|| self.now() + RETRY_AFTER);
        drop(state);
        self.changed();
    }

    /// Signs out locally and returns the URL that ends the remote session, when a verified
    /// session ID is known. The host opens it in the system browser. This waits for a store
    /// call that holds the state; a request from the page uses
    /// [`AuthController::sign_out_now`].
    pub fn sign_out(&self) -> Option<String> {
        let mut url = None;
        self.sign_out_in(self.lock(), |ends| url = ends);
        url
    }

    /// As [`AuthController::sign_out`], for a request from the page: while the credential
    /// store is being waited for nothing changes and the answer is [`AuthError::StoreBusy`].
    /// Otherwise `began` is called once, with the URL that ends the remote session when there
    /// is one, as soon as the person is signed out here and before the saved credential is
    /// removed, which is the part that can wait for a prompt. It is called with the state
    /// held and must not call the controller.
    pub fn sign_out_now(&self, began: impl FnOnce(Option<String>)) -> Result<(), AuthError> {
        self.sign_out_in(self.lock_soon().ok_or(AuthError::StoreBusy)?, began);
        Ok(())
    }

    fn sign_out_in(&self, mut state: Locked<'_>, began: impl FnOnce(Option<String>)) {
        state.interrupt();
        state.sign_in_failed = false;
        state.retry_at = None;
        state.saved = None;
        state.unsaved = false;
        state.credential_epoch += 1;
        state.user = None;
        state.expires = None;
        // The marker is set before the delete so a credential that cannot be removed is
        // still not restored at the next launch.
        self.parts.marker.set_signed_out(true);
        // The person is signed out from here on, whatever the store then does: the gate and
        // the status say so while the delete is waited for.
        state.message = SIGNED_OUT;
        let url = state
            .session_id
            .take()
            .map(|session_id| logout_url(&session_id));
        began(url);
        if self.remove(Some(&state)).is_err() {
            state.message = SIGNED_OUT_NOT_REMOVED;
        }
        drop(state);
        self.changed();
    }

    /// At quit: close admission and drain an already sent refresh through its save attempt.
    /// Call on the host's exit thread, never reentrantly from a WorkosApi or on_change callback.
    /// The host must keep the process alive until this returns. Network calls must have the
    /// timeout required by WorkosApi; a locked credential store may need its unlock prompt,
    /// which is waited for no longer than the limit every store call has.
    /// Failed secure writes and forced process termination cannot promise durable recovery.
    pub fn shutdown(&self) {
        let mut state = self.lock();
        state.closed = true;
        state.interrupt();
        state.retry_at = None;
        while state.refreshing {
            state = state.wait(&self.drained);
        }
        // A previous save may have failed while the app stayed open. Give that exact
        // replacement one final secure-store attempt; never exchange a credential at Quit.
        if state.unsaved {
            let saved = state.saved.clone().is_some_and(|token| {
                self.store(Some(&state), move |store| store.save(&token))
                    .is_ok()
            });
            if saved {
                state.unsaved = false;
            } else {
                state.message = STORE_UNWRITABLE;
            }
        }
    }

    /// How long until the host should call [`AuthController::refresh`]: 20 seconds after a
    /// failure that may be temporary, otherwise 60 seconds before the session's deadline.
    /// `None` while busy or when there is nothing to refresh.
    pub fn next_refresh_in(&self) -> Option<Duration> {
        let now = self.now();
        let state = self.lock();
        if state.closed || state.busy || state.refreshing {
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
