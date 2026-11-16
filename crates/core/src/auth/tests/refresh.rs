//! Recovery of a response whose refresh credential has already rotated (#94).
use super::*;

fn reply(rig: &Rig, refresh: &str) {
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
    assert_eq!(rig.message(), "Sign in to continue.");
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
    assert_eq!(rig.message(), "Sign in to continue.");
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
