//! Recovery of a response whose refresh credential has already rotated (#94).
use super::*;

pub(super) fn reply(rig: &Rig, refresh: &str) {
    let expiry = rig
        .clock
        .lock()
        .unwrap()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
        + 300;
    rig.api.refreshes.lock().unwrap().push(Ok(tokens(
        jwt(&with(claims(), "exp", json!(expiry))),
        refresh,
    )));
}

#[test]
fn refresh_retries_key_set_without_replaying_the_consumed_credential() {
    let rig = rig();
    *rig.store.token.lock().unwrap() = Some("refresh-one".into());
    reply(&rig, "refresh-two");
    rig.api.jwks_fails.store(true, Ordering::SeqCst);
    rig.auth.restore();
    assert!(!rig.auth.authenticated());
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-two"));
    assert_eq!(rig.auth.next_refresh_in(), Some(Duration::from_secs(20)));
    // Beyond WorkOS's grace window, completing this response still needs no exchange.
    rig.advance(40);
    rig.api.jwks_fails.store(false, Ordering::SeqCst);
    rig.auth.refresh();
    assert!(rig.auth.authenticated());
    assert_eq!(*rig.api.refresh_calls.lock().unwrap(), ["refresh-one"]);
    assert_eq!(rig.api.jwks_calls.load(Ordering::SeqCst), 2);
}

#[test]
fn refresh_retries_saving_the_replacement_before_another_exchange() {
    let rig = rig();
    rig.sign_in();
    rig.advance(240);
    reply(&rig, "refresh-two");
    rig.store.fail_save.store(true, Ordering::SeqCst);
    rig.auth.refresh();
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-one"));
    assert_eq!(rig.auth.next_refresh_in(), Some(Duration::from_secs(20)));
    assert!(rig.message().contains("system keychain"));
    for _ in 0..3 {
        rig.auth.refresh();
    }
    assert_eq!(*rig.api.refresh_calls.lock().unwrap(), ["refresh-one"]);
    rig.advance(20);
    rig.auth.refresh();
    assert_eq!(*rig.api.refresh_calls.lock().unwrap(), ["refresh-one"]);
    assert_eq!(rig.auth.next_refresh_in(), Some(Duration::from_secs(20)));
    rig.advance(20);
    rig.store.fail_save.store(false, Ordering::SeqCst);
    rig.auth.refresh();
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-two"));
    assert!(rig.auth.authenticated());
    assert_eq!(rig.auth.next_refresh_in(), Some(Duration::from_secs(200)));
    assert_eq!(*rig.api.refresh_calls.lock().unwrap(), ["refresh-one"]);
}

#[test]
fn refresh_after_cancel_saves_the_rotation_without_completing_the_restore() {
    let rig = rig();
    *rig.store.token.lock().unwrap() = Some("refresh-one".into());
    reply(&rig, "refresh-two");
    let auth = rig.auth.clone();
    *rig.api.during_call.lock().unwrap() = Some(Box::new(move || auth.cancel()));
    rig.auth.restore();
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-two"));
    assert!(!rig.auth.authenticated());
    assert_eq!(rig.message(), "Sign-in cancelled.");
    assert_eq!(rig.auth.next_refresh_in(), None);
}

#[test]
fn refresh_does_not_overwrite_a_newer_sign_in_completed_during_verification() {
    let rig = rig();
    rig.sign_in();
    reply(&rig, "refresh-two");
    rig.api
        .exchanges
        .lock()
        .unwrap()
        .push(Ok(tokens(jwt(&claims()), "new-account-refresh")));
    let auth = rig.auth.clone();
    *rig.api.during_jwks.lock().unwrap() = Some(Box::new(move || {
        let url = auth.begin_sign_in().unwrap();
        let state = query_value(&url, "state").unwrap();
        auth.complete_sign_in(&format!(
            "opensesame://auth/callback?code=new-code&state={state}"
        ));
    }));
    rig.auth.refresh();
    assert_eq!(rig.store.saved().as_deref(), Some("new-account-refresh"));
    assert!(rig.auth.authenticated());
    assert_eq!(rig.message(), "Signed in.");
}

#[test]
fn sign_out_during_refresh_verification_drops_every_recovery_path() {
    let rig = rig();
    rig.sign_in();
    reply(&rig, "refresh-two");
    let auth = rig.auth.clone();
    *rig.api.during_jwks.lock().unwrap() = Some(Box::new(move || {
        auth.sign_out();
    }));
    rig.auth.refresh();
    rig.advance(40);
    rig.auth.refresh();
    rig.auth.restore();
    assert!(!rig.auth.authenticated());
    assert_eq!(rig.store.saved(), None);
    assert!(rig.store.signed_out());
    assert_eq!(rig.auth.next_refresh_in(), None);
    assert_eq!(*rig.api.refresh_calls.lock().unwrap(), ["refresh-one"]);
}

#[test]
fn shutdown_drains_an_existing_refresh_before_returning_and_closes_admission() {
    use std::sync::mpsc::{channel, RecvTimeoutError};
    use std::time::Instant;
    let rig = rig();
    rig.sign_in();
    reply(&rig, "refresh-two");
    let (entered, started) = channel();
    let (release, proceed) = channel();
    let proceed = Mutex::new(proceed);
    *rig.api.during_call.lock().unwrap() = Some(Box::new(move || {
        entered.send(()).unwrap();
        proceed
            .lock()
            .unwrap()
            .recv_timeout(Duration::from_secs(10))
            .unwrap();
    }));
    let auth = rig.auth.clone();
    let refreshing = std::thread::spawn(move || auth.refresh());
    started.recv_timeout(Duration::from_secs(10)).unwrap();
    let (finished, done) = channel();
    let auth = rig.auth.clone();
    let quitting = std::thread::spawn(move || {
        auth.shutdown();
        finished.send(()).unwrap();
    });
    let deadline = Instant::now() + Duration::from_secs(10);
    while rig.status()["busy"] == json!(true) && Instant::now() < deadline {
        std::thread::yield_now();
    }
    let returned_early = !matches!(
        done.recv_timeout(Duration::from_millis(50)),
        Err(RecvTimeoutError::Timeout)
    );
    // Always release and join before asserting, including against the broken baseline.
    release.send(()).unwrap();
    refreshing.join().unwrap();
    quitting.join().unwrap();
    assert!(
        !returned_early,
        "Quit returned before the refresh could persist its rotation"
    );
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-two"));
    let calls = rig.api.refresh_calls.lock().unwrap().len();
    rig.auth.restore();
    rig.auth.refresh();
    assert_eq!(rig.auth.begin_sign_in(), Err(AuthError::Busy));
    assert_eq!(rig.api.refresh_calls.lock().unwrap().len(), calls);
    assert_eq!(rig.auth.next_refresh_in(), None);
}

#[test]
fn shutdown_retries_a_replacement_that_could_not_be_saved_earlier() {
    let rig = rig();
    rig.sign_in();
    reply(&rig, "refresh-two");
    rig.store.fail_save.store(true, Ordering::SeqCst);
    rig.auth.refresh();
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-one"));
    rig.store.fail_save.store(false, Ordering::SeqCst);
    rig.auth.shutdown();
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-two"));
    assert_eq!(*rig.api.refresh_calls.lock().unwrap(), ["refresh-one"]);
}

#[test]
fn cancelled_restore_retries_only_saving_without_signing_the_user_in() {
    let rig = rig();
    *rig.store.token.lock().unwrap() = Some("refresh-one".into());
    reply(&rig, "refresh-two");
    rig.store.fail_save.store(true, Ordering::SeqCst);
    let auth = rig.auth.clone();
    *rig.api.during_call.lock().unwrap() = Some(Box::new(move || auth.cancel()));
    rig.auth.restore();
    assert_eq!(rig.auth.next_refresh_in(), Some(Duration::from_secs(20)));
    rig.store.fail_save.store(false, Ordering::SeqCst);
    rig.advance(20);
    rig.auth.refresh();
    assert!(!rig.auth.authenticated());
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-two"));
    assert_eq!(*rig.api.refresh_calls.lock().unwrap(), ["refresh-one"]);
    assert_eq!(rig.api.jwks_calls.load(Ordering::SeqCst), 0);
    assert_eq!(rig.auth.next_refresh_in(), None);
    assert_eq!(rig.message(), "Sign-in cancelled.");
}

const EARLIER_SAVED: &str = "The new sign-in could not be completed. Your earlier sign-in is saved and will be used the next time Open Sesame starts.";

/// A restore at launch whose answer comes back after the person started a new sign-in, with a
/// credential store that refuses to save: the restore's rotated credential is held unsaved,
/// and the new sign-in then fails on the same store. Nobody is signed in afterwards, and the
/// only work left is saving the earlier credential.
fn new_sign_in_fails_over_an_unsaved_restore() -> Rig {
    let rig = rig();
    *rig.store.token.lock().unwrap() = Some("refresh-one".into());
    reply(&rig, "refresh-two");
    rig.store.fail_save.store(true, Ordering::SeqCst);
    let callback = Arc::new(Mutex::new(String::new()));
    let (auth, started) = (rig.auth.clone(), callback.clone());
    *rig.api.during_call.lock().unwrap() = Some(Box::new(move || {
        let url = auth.begin_sign_in().expect("begin sign-in");
        let state = query_value(&url, "state").expect("authorisation URL carries state");
        *started.lock().unwrap() =
            format!("opensesame://auth/callback?code=fixture-code&state={state}");
    }));
    rig.auth.restore();
    rig.api
        .exchanges
        .lock()
        .unwrap()
        .push(Ok(tokens(jwt(&claims()), "refresh-new")));
    let callback = callback.lock().unwrap().clone();
    rig.auth.complete_sign_in(&callback);
    assert!(!rig.auth.authenticated());
    assert!(rig.message().contains("system keychain"));
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-one"));
    assert_eq!(rig.auth.next_refresh_in(), Some(Duration::from_secs(20)));
    rig
}

/// What the save-only retry leaves behind: the earlier credential saved, nobody signed in,
/// nothing exchanged a second time and nothing more scheduled.
fn the_earlier_credential_is_saved_and_nothing_else(rig: &Rig) {
    rig.store.fail_save.store(false, Ordering::SeqCst);
    rig.advance(20);
    rig.auth.refresh();
    assert!(!rig.auth.authenticated());
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-two"));
    assert_eq!(*rig.api.refresh_calls.lock().unwrap(), ["refresh-one"]);
    assert_eq!(rig.auth.next_refresh_in(), None);
}

/// Decided on 16 November 2026 (#94): when a new sign-in has failed and the earlier sign-in
/// is then saved, the status says that. It used to say "Sign-in cancelled." with nobody having
/// cancelled. The behaviour is as it was: no session in this run.
#[test]
fn a_failed_new_sign_in_then_says_the_earlier_sign_in_is_saved() {
    let rig = new_sign_in_fails_over_an_unsaved_restore();
    the_earlier_credential_is_saved_and_nothing_else(&rig);
    assert_eq!(rig.message(), EARLIER_SAVED);
}

/// A real Cancel on the same path keeps the cancel sentence.
#[test]
fn a_cancel_after_a_failed_new_sign_in_still_says_cancelled() {
    let rig = new_sign_in_fails_over_an_unsaved_restore();
    rig.auth.cancel();
    assert_eq!(rig.message(), "Sign-in cancelled.");
    the_earlier_credential_is_saved_and_nothing_else(&rig);
    assert_eq!(rig.message(), "Sign-in cancelled.");
}

/// The last thing the person did decides: a Cancel, then a new sign-in that fails for want
/// of a connection, ends on the sentence for the failed sign-in.
#[test]
fn a_new_sign_in_that_fails_after_a_cancel_says_the_earlier_sign_in_is_saved() {
    let rig = rig();
    *rig.store.token.lock().unwrap() = Some("refresh-one".into());
    reply(&rig, "refresh-two");
    rig.store.fail_save.store(true, Ordering::SeqCst);
    let auth = rig.auth.clone();
    *rig.api.during_call.lock().unwrap() = Some(Box::new(move || auth.cancel()));
    rig.auth.restore();
    let callback = rig.begin();
    rig.auth.complete_sign_in(&callback); // No reply scripted: the code exchange fails.
    assert!(rig.message().starts_with("Could not complete sign-in."));
    the_earlier_credential_is_saved_and_nothing_else(&rig);
    assert_eq!(rig.message(), EARLIER_SAVED);
}

/// A new sign-in that is started again is a new attempt: while it waits in the browser the
/// sentence is the browser's, and a Cancel of it reads as a Cancel after the save. This
/// holds no rule by itself: the new attempt and the Cancel each end the failed-sign-in
/// state, and either is enough for it to pass.
#[test]
fn a_second_attempt_that_is_cancelled_says_cancelled() {
    let rig = new_sign_in_fails_over_an_unsaved_restore();
    let _callback = rig.begin();
    assert_eq!(rig.message(), "Finish signing in in your browser.");
    rig.auth.cancel();
    the_earlier_credential_is_saved_and_nothing_else(&rig);
    assert_eq!(rig.message(), "Sign-in cancelled.");
}

/// A restore that was cancelled with its renewed credential unsaved, and a new sign-in
/// waiting in the browser over it. Returns the callback the browser would send.
fn a_sign_in_waits_over_an_unsaved_restore() -> (Rig, String) {
    let rig = rig();
    *rig.store.token.lock().unwrap() = Some("refresh-one".into());
    reply(&rig, "refresh-two");
    rig.store.fail_save.store(true, Ordering::SeqCst);
    let auth = rig.auth.clone();
    *rig.api.during_call.lock().unwrap() = Some(Box::new(move || auth.cancel()));
    rig.auth.restore();
    let callback = rig.begin();
    (rig, callback)
}

/// Every way a new sign-in fails counts, and not only a failed exchange or a refused store:
/// here the person refuses in the browser, so no code comes back.
#[test]
fn a_sign_in_refused_in_the_browser_then_says_the_earlier_sign_in_is_saved() {
    let (rig, callback) = a_sign_in_waits_over_an_unsaved_restore();
    rig.auth
        .complete_sign_in(&callback.replace("code=fixture-code", "error=access_denied"));
    assert_eq!(
        rig.message(),
        "Sign-in was not completed in the browser. Try again."
    );
    the_earlier_credential_is_saved_and_nothing_else(&rig);
    assert_eq!(rig.message(), EARLIER_SAVED);
    assert!(rig.api.exchange_calls.lock().unwrap().is_empty());
}

/// And here the code is exchanged for a token that cannot be verified, signed by a key the
/// key set does not publish.
#[test]
fn a_sign_in_that_cannot_be_verified_then_says_the_earlier_sign_in_is_saved() {
    let (rig, callback) = a_sign_in_waits_over_an_unsaved_restore();
    rig.api.exchanges.lock().unwrap().push(Ok(tokens(
        sign(other_key(), &header(), &claims()),
        "refresh-new",
    )));
    rig.auth.complete_sign_in(&callback);
    assert!(rig.message().starts_with("Could not complete sign-in."));
    the_earlier_credential_is_saved_and_nothing_else(&rig);
    assert_eq!(rig.message(), EARLIER_SAVED);
}

/// A session that was open and runs out before the save: neither sentence is said. The
/// status reads that the session expired, and the next refresh renews it from the credential
/// that was saved, as it would have anyway.
#[test]
fn a_session_that_runs_out_before_the_save_says_expired_and_is_renewed() {
    let rig = rig();
    rig.sign_in();
    rig.advance(240);
    reply(&rig, "refresh-two");
    rig.store.fail_save.store(true, Ordering::SeqCst);
    rig.auth.refresh();
    let callback = rig.begin();
    rig.auth.complete_sign_in(&callback); // No reply scripted: the code exchange fails.
    assert!(rig.auth.authenticated());
    for _ in 0..2 {
        rig.advance(20);
        rig.auth.refresh();
        assert!(rig.message().contains("system keychain"));
    }
    rig.advance(20); // 300 seconds after the sign-in: the session's deadline.
    rig.store.fail_save.store(false, Ordering::SeqCst);
    rig.auth.refresh();
    assert!(!rig.auth.authenticated());
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-two"));
    assert_eq!(*rig.api.refresh_calls.lock().unwrap(), ["refresh-one"]);
    assert_eq!(
        rig.message(),
        "Your session expired. Sign in again to use your account."
    );
    assert_eq!(rig.auth.next_refresh_in(), Some(Duration::ZERO));
    reply(&rig, "refresh-three");
    rig.auth.refresh();
    assert_eq!(
        *rig.api.refresh_calls.lock().unwrap(),
        ["refresh-one", "refresh-two"]
    );
    assert!(rig.auth.authenticated());
}

#[test]
fn failed_new_sign_in_does_not_resume_an_earlier_restore_response() {
    let rig = rig();
    *rig.store.token.lock().unwrap() = Some("refresh-one".into());
    reply(&rig, "refresh-two");
    rig.api.jwks_fails.store(true, Ordering::SeqCst);
    rig.auth.restore();
    let callback = rig.begin();
    rig.auth.complete_sign_in(&callback); // No reply scripted: a transient code-exchange failure.
    rig.api.jwks_fails.store(false, Ordering::SeqCst);
    rig.advance(20);
    reply(&rig, "refresh-three");
    rig.auth.refresh();
    assert_eq!(
        *rig.api.refresh_calls.lock().unwrap(),
        ["refresh-one", "refresh-two"]
    );
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-three"));
}

#[test]
fn failed_refresh_save_remains_visible_after_the_last_verified_session_expires() {
    let rig = rig();
    rig.sign_in();
    reply(&rig, "refresh-two");
    rig.store.fail_save.store(true, Ordering::SeqCst);
    rig.auth.refresh();
    rig.advance(301);
    assert!(!rig.auth.authenticated());
    assert!(rig.message().contains("system keychain"));
}

#[test]
fn cancel_does_not_admit_a_second_refresh_while_the_first_is_still_in_flight() {
    let rig = rig();
    rig.sign_in();
    reply(&rig, "refresh-two");
    let auth = rig.auth.clone();
    *rig.api.during_call.lock().unwrap() = Some(Box::new(move || {
        auth.cancel();
        auth.refresh();
    }));
    rig.auth.refresh();
    assert_eq!(*rig.api.refresh_calls.lock().unwrap(), ["refresh-one"]);
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-two"));
    assert_eq!(rig.message(), "Sign-in cancelled.");
}

#[test]
fn late_refresh_cannot_replace_a_new_sign_in_completed_before_its_answer() {
    let rig = rig();
    rig.sign_in();
    reply(&rig, "refresh-two");
    rig.api
        .exchanges
        .lock()
        .unwrap()
        .push(Ok(tokens(jwt(&claims()), "new-account-refresh")));
    let auth = rig.auth.clone();
    *rig.api.during_call.lock().unwrap() = Some(Box::new(move || {
        let url = auth.begin_sign_in().unwrap();
        let state = query_value(&url, "state").unwrap();
        auth.complete_sign_in(&format!(
            "opensesame://auth/callback?code=new-code&state={state}"
        ));
    }));
    rig.auth.refresh();
    assert_eq!(rig.store.saved().as_deref(), Some("new-account-refresh"));
    assert!(rig.auth.authenticated());
    assert_eq!(rig.message(), "Signed in.");
}

#[test]
fn verification_failure_does_not_lose_the_rotation_across_a_restart() {
    let rig = rig();
    *rig.store.token.lock().unwrap() = Some("refresh-one".into());
    reply(&rig, "refresh-two");
    rig.api.jwks_fails.store(true, Ordering::SeqCst);
    rig.auth.restore();
    rig.auth.shutdown();
    rig.advance(40);
    rig.api.jwks_fails.store(false, Ordering::SeqCst);
    reply(&rig, "refresh-three");
    let clock = rig.clock.clone();
    let restarted = AuthController::new(AuthParts {
        api: rig.api.clone(),
        store: rig.store.clone(),
        marker: rig.store.clone(),
        clock: Arc::new(move || *clock.lock().unwrap()),
        on_change: Arc::new(|| {}),
    });
    restarted.restore();
    assert!(restarted.authenticated());
    assert_eq!(
        *rig.api.refresh_calls.lock().unwrap(),
        ["refresh-one", "refresh-two"]
    );
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-three"));
}

#[test]
fn expired_cached_access_token_cannot_open_a_session_or_stall_recovery_forever() {
    let rig = rig();
    *rig.store.token.lock().unwrap() = Some("refresh-one".into());
    reply(&rig, "refresh-two");
    rig.api.jwks_fails.store(true, Ordering::SeqCst);
    rig.auth.restore();
    rig.advance(301);
    rig.api.jwks_fails.store(false, Ordering::SeqCst);
    rig.auth.refresh();
    assert!(!rig.auth.authenticated());
    assert_eq!(*rig.api.refresh_calls.lock().unwrap(), ["refresh-one"]);
    rig.advance(20);
    reply(&rig, "refresh-three");
    rig.auth.refresh();
    assert!(rig.auth.authenticated());
    assert_eq!(
        *rig.api.refresh_calls.lock().unwrap(),
        ["refresh-one", "refresh-two"]
    );
}

#[test]
fn refresh_response_never_authenticates_an_unverified_signature_or_subject() {
    for invalid in [
        sign(other_key(), &header(), &claims()),
        jwt(&with(claims(), "sub", json!("someone_else"))),
    ] {
        let rig = rig();
        *rig.store.token.lock().unwrap() = Some("refresh-one".into());
        rig.api
            .refreshes
            .lock()
            .unwrap()
            .push(Ok(tokens(invalid, "refresh-two")));
        rig.auth.restore();
        assert!(!rig.auth.authenticated());
        assert_eq!(rig.status()["email"], json!(""));
        assert_eq!(rig.store.saved().as_deref(), Some("refresh-two"));
        assert_eq!(rig.auth.next_refresh_in(), Some(Duration::from_secs(20)));
    }
}

#[test]
fn recovery_status_contains_no_credential_or_access_token() {
    let rig = rig();
    rig.sign_in();
    reply(&rig, "private-rotated-refresh-fixture");
    rig.store.fail_save.store(true, Ordering::SeqCst);
    rig.auth.refresh();
    let saving = rig.status().to_string();
    rig.advance(20);
    rig.store.fail_save.store(false, Ordering::SeqCst);
    rig.api.jwks_fails.store(true, Ordering::SeqCst);
    rig.auth.refresh();
    for shown in [saving, rig.status().to_string()] {
        assert!(!shown.contains("private-rotated-refresh-fixture"));
        assert!(!shown.contains("refresh-one"));
        assert!(!shown.contains("eyJ"));
    }
}

#[test]
fn cancel_after_key_set_failure_clears_the_restore_retry_and_refuses_a_stale_tick() {
    let rig = rig();
    *rig.store.token.lock().unwrap() = Some("refresh-one".into());
    reply(&rig, "refresh-two");
    rig.api.jwks_fails.store(true, Ordering::SeqCst);
    rig.auth.restore();
    rig.auth.cancel();
    assert!(!rig.auth.authenticated());
    assert_eq!(rig.auth.next_refresh_in(), None);
    rig.advance(20);
    rig.api.jwks_fails.store(false, Ordering::SeqCst);
    reply(&rig, "refresh-three");
    // A scheduler tick that raced with Cancel must be harmless even if already queued.
    rig.auth.refresh();
    assert!(!rig.auth.authenticated());
    assert_eq!(*rig.api.refresh_calls.lock().unwrap(), ["refresh-one"]);
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-two"));
}

#[test]
fn failed_new_sign_in_keeps_an_earlier_unsaved_rotation_scheduled() {
    let rig = rig();
    *rig.store.token.lock().unwrap() = Some("refresh-one".into());
    reply(&rig, "refresh-two");
    rig.store.fail_save.store(true, Ordering::SeqCst);
    let auth = rig.auth.clone();
    let callback = Arc::new(Mutex::new(String::new()));
    let captured = callback.clone();
    *rig.api.during_call.lock().unwrap() = Some(Box::new(move || {
        let url = auth.begin_sign_in().unwrap();
        let state = query_value(&url, "state").unwrap();
        *captured.lock().unwrap() =
            format!("opensesame://auth/callback?code=new-code&state={state}");
    }));
    rig.auth.restore();
    rig.api
        .exchanges
        .lock()
        .unwrap()
        .push(Ok(tokens(jwt(&claims()), "new-account-refresh")));
    rig.auth.complete_sign_in(&callback.lock().unwrap());
    assert!(!rig.auth.authenticated());
    assert_eq!(rig.auth.next_refresh_in(), Some(Duration::from_secs(20)));
    rig.store.fail_save.store(false, Ordering::SeqCst);
    rig.advance(20);
    rig.auth.refresh();
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-two"));
    assert_eq!(*rig.api.refresh_calls.lock().unwrap(), ["refresh-one"]);
    assert!(
        !rig.auth.authenticated(),
        "saving an earlier credential cannot complete a failed new sign-in"
    );
    assert_eq!(rig.auth.next_refresh_in(), None);
}

// The tests below hold rules that the review of the merged change found no test for (#94).

#[test]
fn sign_out_with_an_unsaved_replacement_leaves_nothing_for_a_later_save() {
    let rig = rig();
    rig.sign_in();
    rig.advance(240);
    reply(&rig, "refresh-two");
    rig.store.fail_save.store(true, Ordering::SeqCst);
    rig.auth.refresh();
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-one"));
    rig.auth.sign_out();
    assert_eq!(rig.store.saved(), None);
    // Neither the save retry nor the final save at quit may write the replacement back.
    rig.store.fail_save.store(false, Ordering::SeqCst);
    assert_eq!(rig.auth.next_refresh_in(), None);
    rig.advance(20);
    rig.auth.refresh();
    assert_eq!(
        rig.store.saved(),
        None,
        "the save retry wrote after sign-out"
    );
    // With nothing left to save, that call must not leave the status busy.
    assert_eq!(rig.status()["busy"], json!(false));
    assert_eq!(rig.message(), "Signed out on this computer.");
    rig.auth.shutdown();
    assert_eq!(rig.store.saved(), None, "quit wrote after sign-out");
    assert_eq!(*rig.api.refresh_calls.lock().unwrap(), ["refresh-one"]);
}

/// Sign-out forgets the credential held in memory as well as the stored one. Without that, a
/// sign-in that fails after it leaves a retry due, and the retry would send the signed-out
/// credential and sign the person back in.
#[test]
fn sign_out_then_a_failed_sign_in_does_not_send_the_signed_out_credential() {
    let rig = rig();
    rig.sign_in();
    rig.auth.sign_out();
    // The new attempt's code exchange has no reply waiting and fails as a network error.
    let callback = rig.begin();
    rig.auth.complete_sign_in(&callback);
    assert!(!rig.auth.authenticated());
    reply(&rig, "refresh-two");
    rig.advance(20);
    rig.auth.refresh();
    assert_eq!(
        *rig.api.refresh_calls.lock().unwrap(),
        Vec::<String>::new(),
        "the signed-out credential was sent"
    );
    assert!(!rig.auth.authenticated());
    assert_eq!(rig.store.saved(), None);
}

#[test]
fn a_direct_refresh_inside_the_delay_does_not_try_the_store_again() {
    let rig = rig();
    rig.sign_in();
    rig.advance(240);
    reply(&rig, "refresh-two");
    rig.store.fail_save.store(true, Ordering::SeqCst);
    let before = rig.store.saves.load(Ordering::SeqCst);
    rig.auth.refresh();
    assert_eq!(rig.store.saves.load(Ordering::SeqCst) - before, 1);
    for _ in 0..3 {
        rig.auth.refresh();
    }
    assert_eq!(
        rig.store.saves.load(Ordering::SeqCst) - before,
        1,
        "a call inside the 20 seconds went to the store"
    );
    rig.advance(20);
    rig.auth.refresh();
    assert_eq!(rig.store.saves.load(Ordering::SeqCst) - before, 2);
}

/// Whether the status said busy, its message, and when the next refresh was due, each time the
/// change callback was called.
type Seen = Arc<Mutex<Vec<(bool, String, Option<Duration>)>>>;

/// A controller whose change callback records what the status says each time it is called.
fn recording() -> (Rig, Seen) {
    let api = Arc::new(FakeApi::default());
    let store = Arc::new(FakeStore::default());
    let clock = Arc::new(Mutex::new(now()));
    let changes = Arc::new(AtomicUsize::new(0));
    let seen = Arc::new(Mutex::new(Vec::new()));
    let slot: Arc<Mutex<std::sync::Weak<AuthController>>> = Arc::default();
    let (time, record, from) = (clock.clone(), seen.clone(), slot.clone());
    let auth = Arc::new(AuthController::new(AuthParts {
        api: api.clone(),
        store: store.clone(),
        marker: store.clone(),
        clock: Arc::new(move || *time.lock().unwrap()),
        on_change: Arc::new(move || {
            let auth = from.lock().unwrap().upgrade();
            if let Some(auth) = auth {
                let status = auth.status();
                record.lock().unwrap().push((
                    status["busy"].as_bool().unwrap(),
                    status["message"].as_str().unwrap().to_string(),
                    auth.next_refresh_in(),
                ));
            }
        }),
    }));
    *slot.lock().unwrap() = Arc::downgrade(&auth);
    let rig = Rig {
        api,
        store,
        clock,
        changes,
        auth,
    };
    (rig, seen)
}

#[test]
fn the_end_of_a_refresh_is_announced_once_it_is_no_longer_busy() {
    // A refresh that opens a session, and one that stops at the key set: neither path calls
    // the change callback itself, so the page hears of the end only when the flight is dropped.
    for key_set_fails in [false, true] {
        let (rig, seen) = recording();
        rig.sign_in();
        rig.advance(240);
        reply(&rig, "refresh-two");
        rig.api.jwks_fails.store(key_set_fails, Ordering::SeqCst);
        seen.lock().unwrap().clear();
        rig.auth.refresh();
        let seen = seen.lock().unwrap();
        assert_eq!(
            seen.first(),
            Some(&(true, "Refreshing sign-in…".to_string(), None)),
            "{seen:?}"
        );
        let (busy, message, due) = seen.last().unwrap();
        assert!(!busy, "the last word to the page was still busy: {seen:?}");
        assert_eq!(*message, rig.message(), "{seen:?}");
        assert_ne!(message, "Refreshing sign-in…", "{seen:?}");
        // Admission is released before the host is told, so a scheduler that asks from the
        // callback already sees when the next refresh is due.
        assert!(due.is_some(), "{seen:?}");
        assert_eq!(*due, rig.auth.next_refresh_in(), "{seen:?}");
    }
}

#[test]
fn cancel_keeps_the_save_of_an_unsaved_replacement_due() {
    let rig = rig();
    rig.sign_in();
    rig.advance(240);
    reply(&rig, "refresh-two");
    rig.store.fail_save.store(true, Ordering::SeqCst);
    rig.auth.refresh();
    assert_eq!(rig.auth.next_refresh_in(), Some(Duration::from_secs(20)));
    rig.auth.cancel();
    assert_eq!(rig.auth.next_refresh_in(), Some(Duration::from_secs(20)));
    rig.store.fail_save.store(false, Ordering::SeqCst);
    rig.advance(20);
    rig.auth.refresh();
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-two"));
    assert_eq!(*rig.api.refresh_calls.lock().unwrap(), ["refresh-one"]);
}

#[test]
fn a_second_restore_keeps_the_replacement_held_in_memory() {
    let rig = rig();
    *rig.store.token.lock().unwrap() = Some("refresh-one".into());
    reply(&rig, "refresh-two");
    rig.store.fail_save.store(true, Ordering::SeqCst);
    rig.auth.restore();
    // The store still holds the credential the exchange consumed.
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-one"));
    rig.store.fail_save.store(false, Ordering::SeqCst);
    rig.advance(20);
    rig.auth.restore();
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-two"));
    assert_eq!(*rig.api.refresh_calls.lock().unwrap(), ["refresh-one"]);
    assert!(rig.auth.authenticated());
}

/// A controller whose change callback panics while `armed` is set.
fn panicking() -> (Rig, Arc<AtomicBool>) {
    let api = Arc::new(FakeApi::default());
    let store = Arc::new(FakeStore::default());
    let clock = Arc::new(Mutex::new(now()));
    let changes = Arc::new(AtomicUsize::new(0));
    let armed = Arc::new(AtomicBool::new(false));
    let (time, flag) = (clock.clone(), armed.clone());
    let auth = Arc::new(AuthController::new(AuthParts {
        api: api.clone(),
        store: store.clone(),
        marker: store.clone(),
        clock: Arc::new(move || *time.lock().unwrap()),
        on_change: Arc::new(move || {
            if flag.load(Ordering::SeqCst) {
                panic!("the host's change callback panicked");
            }
        }),
    }));
    let rig = Rig {
        api,
        store,
        clock,
        changes,
        auth,
    };
    (rig, armed)
}

/// Whether `shutdown` returns within three seconds.
fn shutdown_returns(rig: &Rig) -> bool {
    let (done, finished) = std::sync::mpsc::channel();
    let auth = rig.auth.clone();
    std::thread::spawn(move || {
        auth.shutdown();
        let _ = done.send(());
    });
    finished.recv_timeout(Duration::from_secs(3)).is_ok()
}

#[test]
fn a_change_callback_that_panics_as_a_refresh_starts_does_not_hold_up_quit() {
    use std::panic::{catch_unwind, AssertUnwindSafe};
    let (rig, armed) = panicking();
    rig.sign_in();
    rig.advance(240);
    armed.store(true, Ordering::SeqCst);
    let auth = rig.auth.clone();
    assert!(catch_unwind(AssertUnwindSafe(move || auth.refresh())).is_err());
    armed.store(false, Ordering::SeqCst);
    assert!(
        shutdown_returns(&rig),
        "quit waits for a refresh that never ran"
    );
}

#[test]
fn a_change_callback_that_panics_as_a_restore_starts_does_not_hold_up_quit() {
    use std::panic::{catch_unwind, AssertUnwindSafe};
    let (rig, armed) = panicking();
    *rig.store.token.lock().unwrap() = Some("refresh-one".into());
    armed.store(true, Ordering::SeqCst);
    let auth = rig.auth.clone();
    assert!(catch_unwind(AssertUnwindSafe(move || auth.restore())).is_err());
    armed.store(false, Ordering::SeqCst);
    assert!(
        shutdown_returns(&rig),
        "quit waits for a refresh that never ran"
    );
}

/// A save that the store refuses once more on the way changes neither sentence: a failed
/// refresh is not a failed sign-in, and it does not end one either.
#[test]
fn a_save_refused_once_more_changes_neither_sentence() {
    let cancelled = rig();
    *cancelled.store.token.lock().unwrap() = Some("refresh-one".into());
    reply(&cancelled, "refresh-two");
    cancelled.store.fail_save.store(true, Ordering::SeqCst);
    let auth = cancelled.auth.clone();
    *cancelled.api.during_call.lock().unwrap() = Some(Box::new(move || auth.cancel()));
    cancelled.auth.restore();
    let failed = new_sign_in_fails_over_an_unsaved_restore();
    for (rig, sentence) in [(cancelled, "Sign-in cancelled."), (failed, EARLIER_SAVED)] {
        rig.advance(20);
        rig.auth.refresh();
        assert!(rig.message().contains("system keychain"), "{sentence}");
        assert_eq!(rig.auth.next_refresh_in(), Some(Duration::from_secs(20)));
        the_earlier_credential_is_saved_and_nothing_else(&rig);
        assert_eq!(rig.message(), sentence);
    }
}

/// With a session still open, a new sign-in that fails and the save that follows leave the
/// person signed in, and the status says that.
#[test]
fn with_a_session_open_a_failed_new_sign_in_then_the_save_says_signed_in() {
    let rig = rig();
    rig.sign_in();
    reply(&rig, "refresh-two");
    rig.store.fail_save.store(true, Ordering::SeqCst);
    rig.auth.refresh();
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-one"));
    let callback = rig.begin();
    rig.auth.complete_sign_in(&callback); // No reply scripted: the code exchange fails.
    assert!(rig.auth.authenticated());
    rig.store.fail_save.store(false, Ordering::SeqCst);
    rig.advance(20);
    rig.auth.refresh();
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-two"));
    assert_eq!(*rig.api.refresh_calls.lock().unwrap(), ["refresh-one"]);
    assert!(rig.auth.authenticated());
    assert_eq!(rig.message(), "Signed in.");
}

/// A controller whose change callback cancels, once, the next time it is called after `armed`
/// is set. The change callback is the one place a test can put a Cancel between a save-only
/// retry being admitted and its save (#148): `refresh` lets the state go and tells the host
/// that the retry was admitted before it takes the state again to save.
fn cancelling() -> (Rig, Arc<AtomicBool>) {
    let api = Arc::new(FakeApi::default());
    let store = Arc::new(FakeStore::default());
    let clock = Arc::new(Mutex::new(now()));
    let changes = Arc::new(AtomicUsize::new(0));
    let armed = Arc::new(AtomicBool::new(false));
    let slot: Arc<Mutex<std::sync::Weak<AuthController>>> = Arc::default();
    let (time, from, when) = (clock.clone(), slot.clone(), armed.clone());
    let auth = Arc::new(AuthController::new(AuthParts {
        api: api.clone(),
        store: store.clone(),
        marker: store.clone(),
        clock: Arc::new(move || *time.lock().unwrap()),
        on_change: Arc::new(move || {
            if when.swap(false, Ordering::SeqCst) {
                if let Some(auth) = from.lock().unwrap().upgrade() {
                    auth.cancel();
                }
            }
        }),
    }));
    *slot.lock().unwrap() = Arc::downgrade(&auth);
    let rig = Rig {
        api,
        store,
        clock,
        changes,
        auth,
    };
    (rig, armed)
}

/// A restore at launch cancelled while its renewed credential could not be saved, so that a
/// save-only retry is due in 20 seconds; then that retry is admitted and, before its save, a
/// second Cancel arrives. `save_fails` says whether the store refuses that save too.
fn a_second_cancel_before_the_retry_saves(save_fails: bool) -> Rig {
    let (rig, armed) = cancelling();
    *rig.store.token.lock().unwrap() = Some("refresh-one".into());
    reply(&rig, "refresh-two");
    rig.store.fail_save.store(true, Ordering::SeqCst);
    let auth = rig.auth.clone();
    *rig.api.during_call.lock().unwrap() = Some(Box::new(move || auth.cancel()));
    rig.auth.restore();
    assert_eq!(rig.auth.next_refresh_in(), Some(Duration::from_secs(20)));
    rig.store.fail_save.store(save_fails, Ordering::SeqCst);
    rig.advance(20);
    armed.store(true, Ordering::SeqCst);
    rig.auth.refresh();
    assert!(!armed.load(Ordering::SeqCst), "the Cancel was not made");
    rig
}

/// Issue #148: the Cancel used to see the credential as unsaved and schedule one more retry.
/// The save then succeeded, and the retry left over was no longer save-only: it sent the saved
/// credential to the server 20 seconds later and signed in the person who had cancelled.
#[test]
fn a_cancel_between_a_save_only_retry_and_its_save_leaves_nothing_that_signs_in() {
    let rig = a_second_cancel_before_the_retry_saves(false);
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-two"));
    assert_eq!(rig.message(), "Sign-in cancelled.");
    let due = rig.auth.next_refresh_in();
    rig.advance(20);
    reply(&rig, "refresh-three");
    rig.auth.refresh();
    assert_eq!(
        (
            due,
            rig.api.refresh_calls.lock().unwrap().clone(),
            rig.auth.authenticated(),
            rig.message()
        ),
        (
            None,
            vec!["refresh-one".to_string()],
            false,
            "Sign-in cancelled.".to_string()
        ),
        "a retry left over by the Cancel sent the credential to the server"
    );
}

/// The same Cancel with a save that fails again: the credential still gets its next save-only
/// retry, and that retry saves it without sending anything to the server.
#[test]
fn a_cancel_between_a_save_only_retry_and_a_failed_save_keeps_the_next_save_only_retry() {
    let rig = a_second_cancel_before_the_retry_saves(true);
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-one"));
    assert_eq!(rig.auth.next_refresh_in(), Some(Duration::from_secs(20)));
    the_earlier_credential_is_saved_and_nothing_else(&rig);
    assert_eq!(rig.api.jwks_calls.load(Ordering::SeqCst), 0);
}

/// The other half of #148's fix: a Cancel made while a refresh is out leaves the save to that
/// refresh, so a refresh that ends before it gets to the save must leave the retry itself.
/// Here the change callback cancels and then panics as the save-only retry starts.
#[test]
fn a_cancel_then_a_panic_as_a_save_only_retry_starts_keeps_the_next_save_only_retry() {
    use std::panic::{catch_unwind, AssertUnwindSafe};
    let api = Arc::new(FakeApi::default());
    let store = Arc::new(FakeStore::default());
    let clock = Arc::new(Mutex::new(now()));
    let armed = Arc::new(AtomicBool::new(false));
    let slot: Arc<Mutex<std::sync::Weak<AuthController>>> = Arc::default();
    let (time, from, when) = (clock.clone(), slot.clone(), armed.clone());
    let auth = Arc::new(AuthController::new(AuthParts {
        api: api.clone(),
        store: store.clone(),
        marker: store.clone(),
        clock: Arc::new(move || *time.lock().unwrap()),
        on_change: Arc::new(move || {
            if when.swap(false, Ordering::SeqCst) {
                if let Some(auth) = from.lock().unwrap().upgrade() {
                    auth.cancel();
                }
                panic!("the host's change callback panicked");
            }
        }),
    }));
    *slot.lock().unwrap() = Arc::downgrade(&auth);
    let rig = Rig {
        api,
        store,
        clock,
        changes: Arc::new(AtomicUsize::new(0)),
        auth,
    };
    *rig.store.token.lock().unwrap() = Some("refresh-one".into());
    reply(&rig, "refresh-two");
    rig.store.fail_save.store(true, Ordering::SeqCst);
    let auth = rig.auth.clone();
    *rig.api.during_call.lock().unwrap() = Some(Box::new(move || auth.cancel()));
    rig.auth.restore();
    rig.store.fail_save.store(false, Ordering::SeqCst);
    rig.advance(20);
    armed.store(true, Ordering::SeqCst);
    let auth = rig.auth.clone();
    assert!(catch_unwind(AssertUnwindSafe(move || auth.refresh())).is_err());
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-one"));
    assert_eq!(rig.auth.next_refresh_in(), Some(Duration::from_secs(20)));
    the_earlier_credential_is_saved_and_nothing_else(&rig);
    assert_eq!(rig.message(), "Sign-in cancelled.");
}
