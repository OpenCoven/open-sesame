//! Requests do not wait behind the credential store (#130). A keyring that is locked shows a
//! prompt and its call returns when the person answers, which can be minutes or never; the
//! fake store here waits the same way.
use super::refresh::reply;
use super::*;
use std::sync::mpsc::{channel, Receiver};
use std::sync::Condvar;
use std::time::Instant;

/// Makes every write to the fake store wait until [`Held::open`], as a locked keyring does.
struct Held {
    entered: Receiver<()>,
    gate: Arc<(Mutex<bool>, Condvar)>,
}

impl Held {
    /// Waits until a write has reached the store and is waiting there.
    fn entered(&self) {
        self.entered
            .recv_timeout(Duration::from_secs(10))
            .expect("no write reached the store");
    }
    /// Lets the waiting write, and every later one, go on.
    fn open(&self) {
        *self.gate.0.lock().unwrap() = true;
        self.gate.1.notify_all();
    }
    /// Lets the store go by itself after `TOO_LONG`, so that a test of the limit whose call
    /// was never given up ends on its own assertion about the time and does not wait for ever.
    fn open_when_too_long(&self) {
        let gate = self.gate.clone();
        std::thread::spawn(move || {
            std::thread::sleep(TOO_LONG);
            *gate.0.lock().unwrap() = true;
            gate.1.notify_all();
        });
    }
}

fn waiter() -> (Held, Arc<dyn Fn() + Send + Sync>) {
    let (tell, entered) = channel();
    let tell = Mutex::new(tell);
    let gate = Arc::new((Mutex::new(false), Condvar::new()));
    let inner = gate.clone();
    let hook = Arc::new(move || {
        let _ = tell.lock().unwrap().send(());
        let mut open = inner.0.lock().unwrap();
        while !*open {
            open = inner.1.wait(open).unwrap();
        }
    });
    (Held { entered, gate }, hook)
}

const WAITING: &str =
    "Waiting for your system keychain. If it is asking for your password, answer it and this will finish.";
/// A store call is said to be waited for after this long, in the tests that look at that.
const SOON: Duration = Duration::from_millis(50);
/// Longer than any test here waits before it lets the store go.
const LONG: Duration = Duration::from_secs(60);
/// The limit in the tests where the store never answers.
const SHORT: Duration = Duration::from_millis(400);
/// Far past that limit: a call still out by then was not given up.
const TOO_LONG: Duration = Duration::from_secs(10);

fn until(what: &str, holds: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !holds() {
        assert!(Instant::now() < deadline, "never: {what}");
        std::thread::sleep(Duration::from_millis(5));
    }
}

/// Makes the first write to the fake store wait until [`Held::open`]; every write after it
/// runs `later` instead and then goes on.
fn hold_first_write(rig: &Rig, later: impl Fn() + Send + Sync + 'static) -> Held {
    let (held, hook) = waiter();
    let first = std::sync::atomic::AtomicBool::new(true);
    *rig.store.before_write.lock().unwrap() = Some(Arc::new(move || {
        if first.swap(false, Ordering::SeqCst) {
            hook()
        } else {
            later()
        }
    }));
    held
}

fn hold_writes(rig: &Rig) -> Held {
    let (held, hook) = waiter();
    *rig.store.before_write.lock().unwrap() = Some(hook);
    held
}

/// What `ask` answers, or `None` if it has not answered within two seconds.
fn answers<T: Send + 'static>(ask: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    let (tell, told) = channel();
    std::thread::spawn(move || {
        let _ = tell.send(ask());
    });
    told.recv_timeout(Duration::from_secs(2)).ok()
}

/// The save of a new sign-in runs after the browser, and on a locked keyring that is where
/// the unlock prompt comes. Whether the person is signed in is asked before every request the
/// page makes, so while it waited behind the save nothing at all was answered.
#[test]
fn the_gate_and_the_status_answer_while_a_new_sign_ins_save_waits() {
    let rig = rig();
    let held = hold_writes(&rig);
    rig.api
        .exchanges
        .lock()
        .unwrap()
        .push(Ok(tokens(jwt(&claims()), "refresh-one")));
    let callback = rig.begin();
    let auth = rig.auth.clone();
    let signing_in = std::thread::spawn(move || auth.complete_sign_in(&callback));
    held.entered();
    let auth = rig.auth.clone();
    let gate = answers(move || auth.authenticated());
    let auth = rig.auth.clone();
    let status = answers(move || auth.status());
    // Always let the save go and join before asserting, also against the code as it was.
    held.open();
    signing_in.join().unwrap();
    assert_eq!(gate, Some(false), "the gate waited for the store");
    let status = status.expect("the status waited for the store");
    assert_eq!(status["authenticated"], json!(false));
    assert_eq!(status["busy"], json!(true));
    assert!(rig.auth.authenticated());
    assert_eq!(rig.message(), "Signed in.");
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-one"));
}

/// Sign out removes the saved sign-in, which a locked keyring also asks about first. The
/// person is signed out from the moment they ask, not from the moment the keyring answers.
#[test]
fn signing_out_closes_the_gate_before_the_store_answers() {
    let rig = rig();
    rig.sign_in();
    assert!(rig.auth.authenticated());
    let held = hold_writes(&rig);
    let auth = rig.auth.clone();
    let signing_out = std::thread::spawn(move || auth.sign_out());
    held.entered();
    let auth = rig.auth.clone();
    let gate = answers(move || auth.authenticated());
    let auth = rig.auth.clone();
    let status = answers(move || auth.status());
    held.open();
    signing_out.join().unwrap();
    assert_eq!(gate, Some(false), "the gate waited for the store");
    let status = status.expect("the status waited for the store");
    assert_eq!(status["authenticated"], json!(false));
    assert_eq!(rig.message(), "Signed out on this computer.");
    assert_eq!(rig.store.saved(), None);
}

/// What a person can ask for while a write waits at the keyring's prompt is answered at once,
/// with the reason, and changes nothing; and the status says what is being waited for.
#[test]
fn cancel_sign_out_and_sign_in_are_told_the_store_is_busy_while_a_save_waits() {
    let rig = rig_with(Some((SOON, LONG)));
    let held = hold_writes(&rig);
    rig.api
        .exchanges
        .lock()
        .unwrap()
        .push(Ok(tokens(jwt(&claims()), "refresh-one")));
    let callback = rig.begin();
    let changes = rig.changes.load(Ordering::SeqCst);
    let auth = rig.auth.clone();
    let signing_in = std::thread::spawn(move || auth.complete_sign_in(&callback));
    held.entered();
    until("the status says the store is waited for", || {
        rig.message() == WAITING
    });
    let told = rig.changes.load(Ordering::SeqCst) > changes;
    let auth = rig.auth.clone();
    let cancel = answers(move || auth.cancel_now());
    let auth = rig.auth.clone();
    let sign_out = answers(move || auth.sign_out_now(|_| ()));
    let auth = rig.auth.clone();
    let sign_in = answers(move || auth.begin_sign_in());
    let busy = rig.status()["busy"].clone();
    held.open();
    signing_in.join().unwrap();
    assert!(told, "the host was not told the status had changed");
    assert_eq!(cancel, Some(Err(AuthError::StoreBusy)));
    assert_eq!(sign_out, Some(Err(AuthError::StoreBusy)));
    assert_eq!(sign_in, Some(Err(AuthError::StoreBusy)));
    assert_eq!(busy, json!(true));
    // None of the three did anything: the sign-in went through and nothing was removed.
    assert!(rig.auth.authenticated());
    assert_eq!(rig.message(), "Signed in.");
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-one"));
    assert!(!rig.store.signed_out.load(Ordering::SeqCst));
    // With nothing waiting they do what they always did.
    assert_eq!(rig.auth.cancel_now(), Ok(()));
    let mut ends = None;
    assert_eq!(rig.auth.sign_out_now(|url| ends = url), Ok(()));
    assert!(ends.is_some(), "the address that ends the remote session");
    assert!(!rig.auth.authenticated());
    assert_eq!(rig.store.saved(), None);
}

/// A refresh saves its replacement credential with nobody having pressed anything. While
/// that save waits the person stays signed in and the page is served.
#[test]
fn a_refresh_whose_save_waits_leaves_the_session_readable() {
    let rig = rig_with(Some((SOON, LONG)));
    rig.sign_in();
    rig.advance(240);
    reply(&rig, "refresh-two");
    let held = hold_writes(&rig);
    let auth = rig.auth.clone();
    let refreshing = std::thread::spawn(move || auth.refresh());
    held.entered();
    let auth = rig.auth.clone();
    let gate = answers(move || auth.authenticated());
    let auth = rig.auth.clone();
    let cancel = answers(move || auth.cancel_now());
    held.open();
    refreshing.join().unwrap();
    assert_eq!(gate, Some(true), "the gate waited for the store");
    assert_eq!(cancel, Some(Err(AuthError::StoreBusy)));
    assert!(rig.auth.authenticated());
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-two"));
}

/// A keyring that dies while its prompt is open never answers. The save is given up at the
/// limit and reported as a store failure; while it is still out no sign-in is begun and the
/// store is not asked again; and when it does return, late, the store is asked again.
#[test]
fn a_save_that_never_returns_is_given_up_at_the_limit() {
    let rig = rig_with(Some((SOON, SHORT)));
    let held = hold_writes(&rig);
    held.open_when_too_long();
    let attempt = |refresh: &str| {
        rig.api
            .exchanges
            .lock()
            .unwrap()
            .push(Ok(tokens(jwt(&claims()), refresh)));
        let callback = rig.begin();
        let started = Instant::now();
        rig.auth.complete_sign_in(&callback);
        started.elapsed()
    };
    let took = attempt("refresh-one");
    assert!(
        took >= SHORT && took < TOO_LONG,
        "the sign-in returned after {took:?}"
    );
    assert!(!rig.auth.authenticated());
    assert!(rig.message().contains("system keychain"));
    assert_ne!(rig.message(), WAITING);
    assert_eq!(rig.status()["busy"], json!(false));
    assert_eq!(rig.store.saves.load(Ordering::SeqCst), 1);

    // While that call is out no sign-in is begun, so the store is not asked again.
    assert_eq!(rig.auth.begin_sign_in(), Err(AuthError::StoreBusy));
    assert!(!rig.auth.authenticated());
    assert!(rig.message().contains("system keychain"));
    assert_eq!(
        rig.store.saves.load(Ordering::SeqCst),
        1,
        "the store was asked again while a call was still out"
    );

    // The prompt is answered at last: the save that was given up lands.
    held.open();
    until("the save that was given up lands", || {
        rig.store.saved().as_deref() == Some("refresh-one")
    });
    until_the_store_is_asked_again(&rig);
    attempt("refresh-three");
    assert!(rig.auth.authenticated());
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-three"));
}

/// The read at launch is given up at the limit too, and nothing is exchanged.
#[test]
fn a_read_that_never_returns_is_given_up_at_the_limit() {
    let rig = rig_with(Some((SOON, SHORT)));
    *rig.store.token.lock().unwrap() = Some("refresh-one".into());
    let (held, hook) = waiter();
    *rig.store.during_load.lock().unwrap() = Some(Box::new(move || hook()));
    held.open_when_too_long();
    let started = Instant::now();
    rig.auth.restore();
    let took = started.elapsed();
    held.open();
    assert!(
        took >= SHORT && took < TOO_LONG,
        "the restore returned after {took:?}"
    );
    assert!(!rig.auth.authenticated());
    assert!(rig.message().contains("could not be read"));
    assert!(rig.api.refresh_calls.lock().unwrap().is_empty());
}

/// From when a store call is said to be waited for until it has returned, the controller says
/// the store is held up, with no moment in between where the wait has been counted back and
/// the call is not yet counted as given up. The host refuses Sign in on this answer, and a
/// press in such a moment would ask the store behind the prompt. The read at launch is used
/// because it holds no state, so nothing else refuses a press then.
#[test]
fn the_store_is_held_up_from_the_wait_to_the_return_with_no_gap() {
    let rig = rig_with(Some((
        Duration::from_millis(20),
        Duration::from_millis(150),
    )));
    *rig.store.token.lock().unwrap() = Some("refresh-one".into());
    let (held, hook) = waiter();
    *rig.store.during_load.lock().unwrap() = Some(Box::new(move || hook()));
    held.open_when_too_long();
    assert!(!rig.auth.store_busy());
    let auth = rig.auth.clone();
    let restore = std::thread::spawn(move || auth.restore());
    held.entered();
    until("the read is said to be waited for", || {
        rig.auth.store_waited_for()
    });
    assert!(!rig.auth.store_given_up());
    let started = Instant::now();
    let mut polls = 0_u64;
    while !rig.auth.store_given_up() {
        assert!(
            rig.auth.store_busy(),
            "neither waited for nor given up, at poll {polls}"
        );
        assert!(started.elapsed() < TOO_LONG, "the read was never given up");
        polls += 1;
    }
    assert!(rig.auth.store_busy());
    // Both can be so for a moment: the wait is counted back after the call is counted as out.
    until("the wait is counted back", || !rig.auth.store_waited_for());
    assert!(rig.auth.store_busy(), "given up, and still out");
    held.open();
    until("the read returns", || !rig.auth.store_busy());
    restore.join().unwrap();
}

/// Quit makes one last attempt to save a replacement that could not be saved earlier. It
/// does not wait for ever for it.
#[test]
fn quit_gives_the_last_save_up_at_the_limit() {
    let rig = rig_with(Some((SOON, SHORT)));
    rig.sign_in();
    reply(&rig, "refresh-two");
    rig.store.fail_save.store(true, Ordering::SeqCst);
    rig.auth.refresh();
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-one"));
    rig.store.fail_save.store(false, Ordering::SeqCst);
    let held = hold_writes(&rig);
    held.open_when_too_long();
    let started = Instant::now();
    rig.auth.shutdown();
    let took = started.elapsed();
    held.open();
    assert!(
        took >= SHORT && took < TOO_LONG,
        "quit returned after {took:?}"
    );
}

/// Until a call that was given up returns, `begin_sign_in` answers that the store is busy.
fn until_the_store_is_asked_again(rig: &Rig) {
    until("the call that was given up returns", || {
        match rig.auth.begin_sign_in() {
            Ok(_) => {
                rig.auth.cancel();
                true
            }
            Err(error) => {
                assert_eq!(error, AuthError::StoreBusy);
                false
            }
        }
    });
}

/// A refresh's replacement is saved after the prompt was left open past the limit, and the
/// person signs out meanwhile. The removal cannot be made while that save is out, and the
/// save lands when the prompt is answered: the removal is made then, so that the next launch
/// does not restore a sign-in the person signed out of.
#[test]
fn a_save_given_up_does_not_outlive_a_sign_out() {
    let rig = rig_with(Some((SOON, SHORT)));
    rig.sign_in();
    rig.advance(240);
    reply(&rig, "refresh-two");
    let held = hold_writes(&rig);
    held.open_when_too_long();
    rig.auth.refresh();
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-one"));

    let mut began = false;
    assert_eq!(rig.auth.sign_out_now(|_| began = true), Ok(()));
    assert!(began);
    assert!(!rig.auth.authenticated());
    assert_eq!(
        rig.message(),
        "Signed out. The saved credential could not be removed; sign in again to replace it."
    );
    assert!(rig.store.signed_out.load(Ordering::SeqCst));
    assert_eq!(
        rig.store.saved().as_deref(),
        Some("refresh-one"),
        "nothing can be removed while the save is out"
    );

    held.open();
    until_the_store_is_asked_again(&rig);
    assert_eq!(
        rig.store.saved(),
        None,
        "the save that was given up landed after the sign-out and stayed"
    );
}

/// With a call given up and still out a new sign-in could not be saved, so none is begun:
/// the person is not sent through the browser for nothing.
#[test]
fn no_sign_in_is_begun_while_a_call_given_up_is_out() {
    let rig = rig_with(Some((SOON, SHORT)));
    let held = hold_writes(&rig);
    held.open_when_too_long();
    rig.api
        .exchanges
        .lock()
        .unwrap()
        .push(Ok(tokens(jwt(&claims()), "refresh-one")));
    let callback = rig.begin();
    rig.auth.complete_sign_in(&callback);
    assert!(!rig.auth.authenticated());
    assert_eq!(rig.auth.begin_sign_in(), Err(AuthError::StoreBusy));
    assert_eq!(rig.status()["busy"], json!(false));
    held.open();
    until_the_store_is_asked_again(&rig);
}

/// A call that panics after it was given up has ended as well: it does not count as out
/// for the rest of the run.
#[test]
fn a_call_given_up_that_panics_is_not_out_for_ever() {
    let rig = rig_with(Some((SOON, SHORT)));
    let (held, hook) = waiter();
    held.open_when_too_long();
    *rig.store.before_write.lock().unwrap() = Some(Arc::new(move || {
        hook();
        panic!("the store call panicked, as this test asks it to");
    }));
    rig.api
        .exchanges
        .lock()
        .unwrap()
        .push(Ok(tokens(jwt(&claims()), "refresh-one")));
    let callback = rig.begin();
    rig.auth.complete_sign_in(&callback);
    assert_eq!(rig.auth.begin_sign_in(), Err(AuthError::StoreBusy));
    held.open();
    until_the_store_is_asked_again(&rig);
}

/// A refresh's save has the limit too, and nobody pressed anything to start it: the session
/// stays as it was, the replacement stays unsaved, and the status says so.
#[test]
fn a_refresh_whose_save_never_returns_is_given_up_at_the_limit() {
    let rig = rig_with(Some((SOON, SHORT)));
    rig.sign_in();
    rig.advance(240);
    reply(&rig, "refresh-two");
    let held = hold_writes(&rig);
    held.open_when_too_long();
    let auth = rig.auth.clone();
    let started = Instant::now();
    let refreshing = std::thread::spawn(move || auth.refresh());
    held.entered();
    until("the status says the keychain is waited for", || {
        rig.message() == WAITING
    });
    assert!(rig.auth.authenticated(), "the gate waited for the store");
    refreshing.join().unwrap();
    let took = started.elapsed();
    assert!(
        took >= SHORT && took < TOO_LONG,
        "the refresh returned after {took:?}"
    );
    assert_ne!(rig.message(), WAITING);
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-one"));
}

/// A session the server has ended is removed from the store, and that removal can wait for a
/// prompt as any other: the gate is closed and the status says the session ended before the
/// store is asked, and the removal is given up at the limit.
#[test]
fn an_ended_sessions_removal_closes_the_gate_first_and_has_the_limit() {
    let rig = rig_with(Some((SOON, SHORT)));
    rig.sign_in();
    rig.advance(240);
    rig.api
        .refreshes
        .lock()
        .unwrap()
        .push(Err(AuthError::Ended));
    let held = hold_writes(&rig);
    held.open_when_too_long();
    let auth = rig.auth.clone();
    let started = Instant::now();
    let refreshing = std::thread::spawn(move || auth.refresh());
    held.entered();
    let auth = rig.auth.clone();
    assert_eq!(
        answers(move || auth.authenticated()),
        Some(false),
        "the gate stayed open, or waited, while the removal waited"
    );
    until("the status says the keychain is waited for", || {
        rig.message() == WAITING
    });
    refreshing.join().unwrap();
    let took = started.elapsed();
    assert!(
        took >= SHORT && took < TOO_LONG,
        "the refresh returned after {took:?}"
    );
    assert!(!rig.auth.authenticated());
    assert!(
        rig.message().contains("ended"),
        "the status reads {:?}",
        rig.message()
    );
}

/// Sign out says that it began, with the address that ends the remote session, before the
/// store is asked: the host opens that address and answers the page then, and the removal may
/// take as long as a prompt does.
#[test]
fn sign_out_says_it_began_before_the_removal_is_asked() {
    let rig = rig();
    rig.sign_in();
    let held = hold_writes(&rig);
    let (tell, told) = channel();
    let auth = rig.auth.clone();
    let seen = rig.auth.clone();
    let signing_out = std::thread::spawn(move || {
        auth.sign_out_now(move |url| {
            // What the gate and the status say at the moment the caller is told: the host
            // answers the page on this word, and the page asks for the status next.
            let _ = tell.send((url, seen.authenticated(), seen.status()));
        })
    });
    let (url, authenticated, status) = told
        .recv_timeout(Duration::from_secs(2))
        .expect("sign-out waited for the store before it said it began");
    assert!(url.is_some_and(|url| url.contains("/sessions/logout")));
    assert!(
        !authenticated,
        "the gate was open when sign-out said it began"
    );
    assert_eq!(status["message"], json!("Signed out on this computer."));
    assert_eq!(status["authenticated"], json!(false));
    assert!(!rig.auth.authenticated());
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-one"));
    held.open();
    assert_eq!(signing_out.join().unwrap(), Ok(()));
    assert_eq!(rig.store.saved(), None);
}

/// Before the status says the keychain is waited for, it must not go on saying that the
/// sign-in is being refreshed: the session has ended, and the status says so from the moment
/// the removal is asked.
#[test]
fn an_ended_session_is_said_before_its_removal_is_asked() {
    let rig = rig_with(Some((TOO_LONG, 2 * TOO_LONG)));
    rig.sign_in();
    rig.advance(240);
    rig.api
        .refreshes
        .lock()
        .unwrap()
        .push(Err(AuthError::Ended));
    let held = hold_writes(&rig);
    let auth = rig.auth.clone();
    let refreshing = std::thread::spawn(move || auth.refresh());
    held.entered();
    assert_eq!(
        rig.message(),
        "Your sign-in has ended. Sign in again to use your account."
    );
    held.open();
    refreshing.join().unwrap();
    assert_eq!(rig.store.saved(), None);
}

/// A read and a write can be out together: the read at launch holds no lock, so a new sign-in
/// can be saved while it waits. A removal owed is made when the last of them returns: made
/// when the read returns, it would come before the save lands, and the save would stay.
#[test]
fn a_removal_owed_waits_for_the_last_call_that_is_out() {
    let rig = rig_with(Some((SOON, Duration::from_secs(2))));
    // Made before the read starts: signing the first token of a run makes the key, which
    // can take longer than the read's limit.
    rig.api
        .exchanges
        .lock()
        .unwrap()
        .push(Ok(tokens(jwt(&claims()), "refresh-one")));
    let (read, hook) = waiter();
    *rig.store.during_load.lock().unwrap() = Some(Box::new(move || hook()));
    read.open_when_too_long();
    let auth = rig.auth.clone();
    let restoring = std::thread::spawn(move || auth.restore());
    read.entered();
    // Only the save waits here. A removal made too early must go straight through, so that
    // it comes before the save lands and not in a race with it.
    let written = hold_first_write(&rig, || ());
    written.open_when_too_long();
    let callback = rig.begin();
    rig.auth.complete_sign_in(&callback);
    restoring.join().unwrap();
    assert_eq!(rig.store.saved(), None, "the save was not given up");
    assert_eq!(rig.auth.sign_out_now(|_| ()), Ok(()));

    // Nothing can be seen of the read's return when the rule holds, so this waits for it:
    // a removal made at that return has half a second to be made before the save lands.
    read.open();
    std::thread::sleep(Duration::from_millis(500));
    written.open();
    until_the_store_is_asked_again(&rig);
    assert_eq!(
        rig.store.saved(),
        None,
        "the removal was made before the save landed"
    );
}

/// A refresh's save that was given up, and a sign-out after it: the state both tests below
/// start from. The first write, the save, waits at the returned gate.
fn a_save_given_up_and_then_a_sign_out(
    rig: &Rig,
    later: impl Fn() + Send + Sync + 'static,
) -> Held {
    rig.sign_in();
    rig.advance(240);
    reply(rig, "refresh-two");
    let held = hold_first_write(rig, later);
    held.open_when_too_long();
    rig.auth.refresh();
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-one"));
    assert_eq!(rig.auth.sign_out_now(|_| ()), Ok(()));
    held
}

/// The removal owed is made before any other store call is let through: while it is being
/// made, the call it follows still counts as out.
#[test]
fn nothing_is_let_through_while_the_removal_owed_is_made() {
    let rig = rig_with(Some((SOON, SHORT)));
    let (removal, hook) = waiter();
    removal.open_when_too_long();
    let held = a_save_given_up_and_then_a_sign_out(&rig, move || hook());
    held.open();
    removal.entered();
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-two"));
    assert_eq!(rig.auth.begin_sign_in(), Err(AuthError::StoreBusy));
    removal.open();
    until_the_store_is_asked_again(&rig);
    assert_eq!(rig.store.saved(), None);
}

/// A removal owed that panics ends the wait as well: the store is asked again afterwards.
#[test]
fn a_removal_owed_that_panics_does_not_leave_a_call_out() {
    let rig = rig_with(Some((SOON, SHORT)));
    let held = a_save_given_up_and_then_a_sign_out(&rig, || {
        panic!("the removal owed panicked, as this test asks it to")
    });
    held.open();
    until_the_store_is_asked_again(&rig);
}

/// The removal of a session the server ended is owed in the same way as a sign-out's. What
/// is removed is whatever is saved when the call given up returns: here the second sign-in,
/// whose save the person was told had failed.
#[test]
fn an_ended_sessions_removal_is_owed_while_a_call_given_up_is_out() {
    let rig = rig_with(Some((SOON, SHORT)));
    rig.sign_in();
    let held = hold_writes(&rig);
    held.open_when_too_long();
    rig.api
        .exchanges
        .lock()
        .unwrap()
        .push(Ok(tokens(jwt(&claims()), "refresh-b")));
    let callback = rig.begin();
    rig.auth.complete_sign_in(&callback);
    assert_eq!(rig.auth.begin_sign_in(), Err(AuthError::StoreBusy));
    rig.advance(240);
    rig.api
        .refreshes
        .lock()
        .unwrap()
        .push(Err(AuthError::Ended));
    rig.auth.refresh();
    assert!(rig.message().contains("ended"), "{}", rig.message());
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-one"));
    held.open();
    until_the_store_is_asked_again(&rig);
    assert_eq!(
        rig.store.saved(),
        None,
        "the removal for the ended session was not owed"
    );
}
