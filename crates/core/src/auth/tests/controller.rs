use super::*;

const GENERIC: &str = "Could not complete sign-in. Check your connection and try again.";
const ENDED: &str = "Your sign-in has ended. Sign in again to use your account.";

fn signed_out(rig: &Rig) -> bool {
    !rig.auth.authenticated()
        && rig.status()["authenticated"] == json!(false)
        && rig.status()["email"] == json!("")
}

#[test]
fn starts_signed_out() {
    let rig = rig();
    assert_eq!(
        rig.status(),
        json!({ "authenticated": false, "busy": false, "message": "", "name": "", "email": "" })
    );
    assert_eq!(rig.auth.next_refresh_in(), None);
}

#[test]
fn begin_sign_in_returns_the_authorisation_url_and_reports_busy() {
    let rig = rig();
    let url = rig.auth.begin_sign_in().unwrap();
    assert!(url.starts_with("https://api.workos.com/user_management/authorize?"));
    assert_eq!(rig.status()["busy"], json!(true));
    assert_eq!(rig.message(), "Finish signing in in your browser.");
    assert_eq!(rig.changes.load(Ordering::SeqCst), 1);
    // A second request while one is pending does not start another.
    assert_eq!(rig.auth.begin_sign_in(), Err(AuthError::Busy));
}

#[test]
fn sign_in_saves_refresh_token_and_reports_user() {
    let rig = rig();
    rig.store.signed_out.store(true, Ordering::SeqCst);
    rig.sign_in();
    assert!(rig.auth.authenticated());
    assert_eq!(
        rig.status(),
        json!({ "authenticated": true, "busy": false, "message": "Signed in.", "name": "Fixture", "email": "fixture@example.invalid" })
    );
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-one"));
    assert!(!rig.store.signed_out());
    // The code and the verifier that matches the challenge were sent, once.
    let calls = rig.api.exchange_calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0, "fixture-code");
    assert_eq!(calls[0].1.len(), 43);
    // Refresh is due 60 seconds before the 300-second expiry.
    assert_eq!(rig.auth.next_refresh_in(), Some(Duration::from_secs(240)));
}

#[test]
fn callback_with_bad_state_or_error_leaves_the_app_signed_out() {
    let oversized = format!("&code={}", "a".repeat(8193));
    let cases: [&dyn Fn(&str) -> String; 5] = [
        &|state| format!("opensesame://auth/callback?code=x&state={state}x"),
        &|_| "opensesame://auth/callback?code=x".to_string(),
        &|state| format!("opensesame://auth/callback?code=x&state={state}&state={state}"),
        &|state| format!("opensesame://auth/callback?code=x&state={state}&error=access_denied"),
        &|state| format!("opensesame://auth/callback?state={state}{oversized}"),
    ];
    for case in cases {
        let rig = rig();
        rig.api
            .exchanges
            .lock()
            .unwrap()
            .push(Ok(tokens(jwt(&claims()), "refresh-one")));
        let good = rig.begin();
        let state = query_value(&good, "state").unwrap();
        let bad = case(&state);
        rig.auth.complete_sign_in(&bad);
        assert!(signed_out(&rig), "{bad}");
        assert_eq!(rig.status()["busy"], json!(false));
        assert_eq!(rig.message(), GENERIC);
        assert!(
            rig.api.exchange_calls.lock().unwrap().is_empty(),
            "no code was sent for {bad}"
        );
        assert_eq!(rig.store.saved(), None);
        // The attempt is over: the genuine callback arriving afterwards is ignored too.
        rig.auth.complete_sign_in(&good);
        assert!(signed_out(&rig));
        assert!(rig.api.exchange_calls.lock().unwrap().is_empty());
    }
}

#[test]
fn token_for_another_user_is_rejected() {
    let rig = rig();
    let other = jwt(&with(claims(), "sub", json!("user_other")));
    rig.api
        .exchanges
        .lock()
        .unwrap()
        .push(Ok(tokens(other, "refresh-one")));
    let callback = rig.begin();
    rig.auth.complete_sign_in(&callback);
    assert!(signed_out(&rig));
    assert_eq!(rig.store.saved(), None);
    assert_eq!(rig.message(), GENERIC);
}

#[test]
fn expired_token_is_rejected() {
    let rig = rig();
    rig.api.exchanges.lock().unwrap().push(Ok(tokens(
        jwt(&with(claims(), "exp", json!(NOW - 1))),
        "refresh-one",
    )));
    let callback = rig.begin();
    rig.auth.complete_sign_in(&callback);
    assert!(signed_out(&rig));
    assert_eq!(rig.store.saved(), None);
}

#[test]
fn token_with_wrong_signature_is_rejected() {
    let rig = rig();
    rig.api.exchanges.lock().unwrap().push(Ok(tokens(
        sign(other_key(), &header(), &claims()),
        "refresh-one",
    )));
    let callback = rig.begin();
    rig.auth.complete_sign_in(&callback);
    assert!(signed_out(&rig));
    assert_eq!(rig.store.saved(), None);
}

#[test]
fn unreachable_key_set_fails_closed() {
    let rig = rig();
    rig.api.jwks_fails.store(true, Ordering::SeqCst);
    rig.api
        .exchanges
        .lock()
        .unwrap()
        .push(Ok(tokens(jwt(&claims()), "refresh-one")));
    let callback = rig.begin();
    rig.auth.complete_sign_in(&callback);
    assert!(signed_out(&rig));
    assert_eq!(rig.store.saved(), None);
}

#[test]
fn cancel_then_late_callback_is_ignored() {
    let rig = rig();
    rig.api
        .exchanges
        .lock()
        .unwrap()
        .push(Ok(tokens(jwt(&claims()), "refresh-one")));
    let callback = rig.begin();
    rig.auth.cancel();
    assert_eq!(rig.message(), "Sign-in cancelled.");
    let before = rig.changes.load(Ordering::SeqCst);
    rig.auth.complete_sign_in(&callback);
    assert!(signed_out(&rig));
    assert_eq!(rig.status()["busy"], json!(false));
    assert_eq!(rig.message(), "Sign-in cancelled.");
    assert!(rig.api.exchange_calls.lock().unwrap().is_empty());
    assert_eq!(rig.store.saved(), None);
    assert_eq!(
        rig.changes.load(Ordering::SeqCst),
        before,
        "an ignored callback changes nothing"
    );
}

#[test]
fn callback_from_an_earlier_attempt_is_ignored() {
    let rig = rig();
    let first = rig.begin();
    rig.auth.cancel();
    rig.api
        .exchanges
        .lock()
        .unwrap()
        .push(Ok(tokens(jwt(&claims()), "refresh-one")));
    let second = rig.begin();
    // The first attempt's callback carries the wrong state for the second attempt.
    rig.auth.complete_sign_in(&first);
    assert!(signed_out(&rig));
    assert!(rig.api.exchange_calls.lock().unwrap().is_empty());
    let _ = second;
}

#[test]
fn callback_without_a_pending_sign_in_is_ignored() {
    let rig = rig();
    rig.auth
        .complete_sign_in("opensesame://auth/callback?code=x&state=anything");
    assert!(signed_out(&rig));
    assert_eq!(rig.message(), "");
    assert_eq!(rig.changes.load(Ordering::SeqCst), 0);
    assert!(rig.api.exchange_calls.lock().unwrap().is_empty());
}

#[test]
fn second_callback_for_the_same_attempt_is_ignored() {
    let rig = rig();
    rig.sign_in();
    let calls = rig.api.exchange_calls.lock().unwrap().len();
    rig.auth
        .complete_sign_in("opensesame://auth/callback?code=replayed&state=anything");
    assert_eq!(rig.api.exchange_calls.lock().unwrap().len(), calls);
    assert!(rig.auth.authenticated());
}

#[test]
fn cancel_during_the_code_exchange_discards_the_result() {
    let rig = rig();
    rig.api
        .exchanges
        .lock()
        .unwrap()
        .push(Ok(tokens(jwt(&claims()), "refresh-one")));
    let callback = rig.begin();
    let auth = rig.auth.clone();
    *rig.api.during_call.lock().unwrap() = Some(Box::new(move || auth.cancel()));
    rig.auth.complete_sign_in(&callback);
    assert!(signed_out(&rig));
    assert_eq!(rig.store.saved(), None);
    assert_eq!(rig.message(), "Sign-in cancelled.");
}

#[test]
fn sign_out_during_the_code_exchange_discards_the_result() {
    let rig = rig();
    rig.api
        .exchanges
        .lock()
        .unwrap()
        .push(Ok(tokens(jwt(&claims()), "refresh-one")));
    let callback = rig.begin();
    let auth = rig.auth.clone();
    *rig.api.during_call.lock().unwrap() = Some(Box::new(move || {
        auth.sign_out();
    }));
    rig.auth.complete_sign_in(&callback);
    assert!(signed_out(&rig));
    assert_eq!(rig.store.saved(), None);
    assert!(rig.store.signed_out());
}

/// The answer to a refresh that was in flight when the user signed out is discarded: no session
/// comes back and the rotated token is not saved.
#[test]
fn sign_out_during_a_refresh_discards_the_result() {
    let rig = rig();
    rig.sign_in();
    rig.advance(240);
    let later = with(claims(), "exp", json!(NOW + 240 + 300));
    rig.api
        .refreshes
        .lock()
        .unwrap()
        .push(Ok(tokens(jwt(&later), "refresh-two")));
    let auth = rig.auth.clone();
    *rig.api.during_call.lock().unwrap() = Some(Box::new(move || {
        auth.sign_out();
    }));
    rig.auth.refresh();
    assert_eq!(rig.api.refresh_calls.lock().unwrap().len(), 1);
    assert!(signed_out(&rig));
    assert_eq!(rig.store.saved(), None);
    assert!(rig.store.signed_out());
    assert_eq!(rig.message(), "Signed out on this computer.");
    assert_eq!(rig.auth.next_refresh_in(), None);
}

#[test]
fn failed_code_exchange_keeps_an_existing_credential() {
    let rig = rig();
    rig.sign_in();
    rig.api
        .exchanges
        .lock()
        .unwrap()
        .push(Err(AuthError::Ended));
    let callback = rig.begin();
    rig.auth.complete_sign_in(&callback);
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-one"));
    assert_eq!(rig.message(), GENERIC);
}

#[test]
fn restore_with_saved_token_signs_in() {
    let rig = rig();
    *rig.store.token.lock().unwrap() = Some("refresh-saved".into());
    rig.api
        .refreshes
        .lock()
        .unwrap()
        .push(Ok(tokens(jwt(&claims()), "refresh-rotated")));
    rig.auth.restore();
    assert!(rig.auth.authenticated());
    assert_eq!(rig.status()["email"], json!("fixture@example.invalid"));
    assert_eq!(
        *rig.api.refresh_calls.lock().unwrap(),
        vec!["refresh-saved".to_string()]
    );
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-rotated"));
}

#[test]
fn restore_without_a_saved_token_stays_signed_out() {
    let rig = rig();
    rig.auth.restore();
    assert!(signed_out(&rig));
    assert!(rig.api.refresh_calls.lock().unwrap().is_empty());
    assert_eq!(rig.message(), "");
}

#[test]
fn restore_after_sign_out_does_not_use_a_leftover_credential() {
    let rig = rig();
    *rig.store.token.lock().unwrap() = Some("refresh-leftover".into());
    rig.store.signed_out.store(true, Ordering::SeqCst);
    rig.auth.restore();
    assert!(signed_out(&rig));
    assert!(rig.api.refresh_calls.lock().unwrap().is_empty());
}

#[test]
fn restore_with_an_unreadable_store_reports_it() {
    let rig = rig();
    rig.store.fail_load.store(true, Ordering::SeqCst);
    rig.auth.restore();
    assert!(signed_out(&rig));
    assert_eq!(
        rig.message(),
        "The saved sign-in could not be read from the system's credential store."
    );
}

/// The store is read without the state lock held. A credential read before a sign-out, a cancel
/// or a shutdown is dropped, so it cannot sign the user back in afterwards.
#[test]
fn restore_drops_a_credential_read_before_a_sign_out_cancel_or_shutdown() {
    type Interrupt = fn(&AuthController);
    let interrupts: [(&str, Interrupt); 3] = [
        ("sign-out", |auth| drop(auth.sign_out())),
        ("cancel", AuthController::cancel),
        ("shutdown", AuthController::shutdown),
    ];
    for (name, interrupt) in interrupts {
        let rig = rig();
        *rig.store.token.lock().unwrap() = Some("refresh-saved".into());
        rig.api
            .refreshes
            .lock()
            .unwrap()
            .push(Ok(tokens(jwt(&claims()), "refresh-rotated")));
        let auth = rig.auth.clone();
        *rig.store.during_load.lock().unwrap() = Some(Box::new(move || interrupt(&auth)));
        rig.auth.restore();
        assert!(signed_out(&rig), "{name}");
        assert_eq!(rig.status()["busy"], json!(false), "{name}");
        assert!(rig.api.refresh_calls.lock().unwrap().is_empty(), "{name}");
        assert_eq!(rig.auth.next_refresh_in(), None, "{name}");
        if name == "sign-out" {
            assert_eq!(rig.store.saved(), None);
            assert!(rig.store.signed_out());
            assert_eq!(rig.message(), "Signed out on this computer.");
        } else {
            assert_eq!(
                rig.store.saved().as_deref(),
                Some("refresh-saved"),
                "{name}"
            );
        }
    }
}

/// A sign-in that completes while the store is being read is not replaced by the account whose
/// credential was stored before it.
#[test]
fn restore_does_not_replace_a_sign_in_completed_while_the_store_was_read() {
    let rig = rig();
    *rig.store.token.lock().unwrap() = Some("refresh-earlier".into());
    let mut earlier = tokens(
        jwt(&with(claims(), "sub", json!("user_earlier"))),
        "refresh-earlier-rotated",
    );
    earlier.user.id = "user_earlier".into();
    earlier.user.email = "earlier@example.invalid".into();
    rig.api.refreshes.lock().unwrap().push(Ok(earlier));
    rig.api
        .exchanges
        .lock()
        .unwrap()
        .push(Ok(tokens(jwt(&claims()), "refresh-one")));
    let auth = rig.auth.clone();
    *rig.store.during_load.lock().unwrap() = Some(Box::new(move || {
        let url = auth.begin_sign_in().expect("begin sign-in");
        let state = query_value(&url, "state").unwrap();
        auth.complete_sign_in(&format!(
            "opensesame://auth/callback?code=fixture-code&state={state}"
        ));
    }));
    rig.auth.restore();
    assert!(rig.auth.authenticated());
    assert_eq!(rig.status()["email"], json!("fixture@example.invalid"));
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-one"));
    assert!(rig.api.refresh_calls.lock().unwrap().is_empty());
}

#[test]
fn restore_with_revoked_token_deletes_it() {
    let rig = rig();
    *rig.store.token.lock().unwrap() = Some("refresh-saved".into());
    rig.api
        .refreshes
        .lock()
        .unwrap()
        .push(Err(AuthError::Ended));
    rig.auth.restore();
    assert!(signed_out(&rig));
    assert_eq!(rig.store.saved(), None);
    assert_eq!(rig.message(), ENDED);
    assert_eq!(rig.auth.next_refresh_in(), None);
}

#[test]
fn revoked_token_ends_a_live_session() {
    let rig = rig();
    rig.sign_in();
    rig.api
        .refreshes
        .lock()
        .unwrap()
        .push(Err(AuthError::Ended));
    rig.auth.refresh();
    assert!(signed_out(&rig));
    assert_eq!(rig.store.saved(), None);
    assert_eq!(rig.message(), ENDED);
}

#[test]
fn transient_refresh_failure_keeps_token_and_retries() {
    let rig = rig();
    *rig.store.token.lock().unwrap() = Some("refresh-saved".into());
    rig.api
        .refreshes
        .lock()
        .unwrap()
        .push(Err(AuthError::Network));
    rig.auth.restore();
    assert!(signed_out(&rig));
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-saved"));
    assert_eq!(rig.message(), GENERIC);
    assert_eq!(rig.auth.next_refresh_in(), Some(Duration::from_secs(20)));
    // The retry uses the same saved token and succeeds.
    rig.advance(20);
    assert_eq!(rig.auth.next_refresh_in(), Some(Duration::ZERO));
    rig.api
        .refreshes
        .lock()
        .unwrap()
        .push(Ok(tokens(jwt(&claims()), "refresh-rotated")));
    rig.auth.refresh();
    assert!(rig.auth.authenticated());
    assert_eq!(rig.api.refresh_calls.lock().unwrap().len(), 2);
}

#[test]
fn transient_failure_keeps_a_live_session_until_it_expires() {
    let rig = rig();
    rig.sign_in();
    rig.advance(240);
    rig.api
        .refreshes
        .lock()
        .unwrap()
        .push(Err(AuthError::Network));
    rig.auth.refresh();
    assert!(
        rig.auth.authenticated(),
        "the verified session is still within its deadline"
    );
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-one"));
    assert_eq!(rig.auth.next_refresh_in(), Some(Duration::from_secs(20)));
    rig.advance(60);
    assert!(signed_out(&rig));
    assert_eq!(
        rig.message(),
        "Your session expired. Sign in again to use your account."
    );
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-one"));
}

#[test]
fn refresh_rotates_the_saved_token_and_extends_the_deadline() {
    let rig = rig();
    rig.sign_in();
    rig.advance(240);
    assert_eq!(rig.auth.next_refresh_in(), Some(Duration::ZERO));
    let later = with(claims(), "exp", json!(NOW + 240 + 300));
    rig.api
        .refreshes
        .lock()
        .unwrap()
        .push(Ok(tokens(jwt(&later), "refresh-two")));
    rig.auth.refresh();
    assert!(rig.auth.authenticated());
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-two"));
    assert_eq!(rig.auth.next_refresh_in(), Some(Duration::from_secs(240)));
    assert_eq!(
        *rig.api.refresh_calls.lock().unwrap(),
        vec!["refresh-one".to_string()]
    );
}

#[test]
fn refresh_that_returns_another_user_is_rejected() {
    let rig = rig();
    rig.sign_in();
    let mut other = tokens(jwt(&claims()), "refresh-two");
    other.user.id = "user_other".into();
    rig.api.refreshes.lock().unwrap().push(Ok(other));
    rig.auth.refresh();
    assert_eq!(
        rig.store.saved().as_deref(),
        Some("refresh-one"),
        "the unverified token is not saved"
    );
    assert_eq!(rig.message(), GENERIC);
}

#[test]
fn refresh_without_a_saved_token_does_nothing() {
    let rig = rig();
    rig.auth.refresh();
    assert!(rig.api.refresh_calls.lock().unwrap().is_empty());
    assert_eq!(rig.changes.load(Ordering::SeqCst), 0);
}

#[test]
fn sign_in_takes_precedence_over_a_restore_in_progress() {
    let rig = rig();
    *rig.store.token.lock().unwrap() = Some("refresh-saved".into());
    rig.api
        .refreshes
        .lock()
        .unwrap()
        .push(Ok(tokens(jwt(&claims()), "refresh-rotated")));
    let auth = rig.auth.clone();
    let started = Arc::new(Mutex::new(None));
    let seen = started.clone();
    *rig.api.during_call.lock().unwrap() = Some(Box::new(move || {
        *seen.lock().unwrap() = Some(auth.begin_sign_in());
    }));
    rig.auth.restore();
    assert!(
        matches!(*started.lock().unwrap(), Some(Ok(_))),
        "sign-in started while restoring"
    );
    assert!(signed_out(&rig), "the restore result was discarded");
    assert_eq!(rig.status()["busy"], json!(true));
    assert_eq!(rig.message(), "Finish signing in in your browser.");
    assert_eq!(rig.store.saved().as_deref(), Some("refresh-saved"));
}

#[test]
fn sign_out_deletes_token_and_returns_logout_url() {
    let rig = rig();
    rig.sign_in();
    let url = rig
        .auth
        .sign_out()
        .expect("a logout URL for the verified session");
    assert_eq!(
        query_values(&url, "session_id"),
        vec![SESSION_ID.to_string()]
    );
    assert_eq!(
        query_values(&url, "return_to"),
        vec!["opensesame%3A%2F%2Fauth%2Fsigned-out".to_string()]
    );
    assert!(signed_out(&rig));
    assert_eq!(rig.store.saved(), None);
    assert!(rig.store.signed_out());
    assert_eq!(rig.message(), "Signed out on this computer.");
    assert_eq!(rig.auth.next_refresh_in(), None);
}

#[test]
fn sign_out_without_a_verified_session_has_no_logout_url() {
    let rig = rig();
    *rig.store.token.lock().unwrap() = Some("refresh-saved".into());
    assert_eq!(rig.auth.sign_out(), None);
    assert_eq!(rig.store.saved(), None);
    assert!(rig.store.signed_out());
}

#[test]
fn sign_out_reports_a_credential_that_could_not_be_removed() {
    let rig = rig();
    rig.sign_in();
    rig.store.fail_delete.store(true, Ordering::SeqCst);
    rig.auth.sign_out();
    assert!(signed_out(&rig));
    assert_eq!(
        rig.message(),
        "Signed out. The saved credential could not be removed; sign in again to replace it."
    );
    assert!(
        rig.store.signed_out(),
        "the marker keeps the leftover credential from being restored"
    );
}

#[test]
fn late_callback_after_sign_out_is_ignored() {
    let rig = rig();
    rig.api
        .exchanges
        .lock()
        .unwrap()
        .push(Ok(tokens(jwt(&claims()), "refresh-one")));
    let callback = rig.begin();
    rig.auth.sign_out();
    rig.auth.complete_sign_in(&callback);
    assert!(signed_out(&rig));
    assert_eq!(rig.store.saved(), None);
    assert!(rig.api.exchange_calls.lock().unwrap().is_empty());
}

#[test]
fn store_failure_reports_keychain_message() {
    let rig = rig();
    rig.store.fail_save.store(true, Ordering::SeqCst);
    rig.api
        .exchanges
        .lock()
        .unwrap()
        .push(Ok(tokens(jwt(&claims()), "refresh-one")));
    let callback = rig.begin();
    rig.auth.complete_sign_in(&callback);
    assert!(signed_out(&rig));
    assert_eq!(
        rig.message(),
        "Could not save your sign-in in your system keychain. Unlock it and try again."
    );
    assert_eq!(rig.auth.next_refresh_in(), None);
}

#[test]
fn shutdown_discards_work_in_flight() {
    let rig = rig();
    rig.api
        .exchanges
        .lock()
        .unwrap()
        .push(Ok(tokens(jwt(&claims()), "refresh-one")));
    let callback = rig.begin();
    let auth = rig.auth.clone();
    *rig.api.during_call.lock().unwrap() = Some(Box::new(move || auth.shutdown()));
    rig.auth.complete_sign_in(&callback);
    assert!(signed_out(&rig));
    assert_eq!(rig.store.saved(), None);
}

/// No token reaches the status the UI reads, in any state.
#[test]
fn status_never_contains_a_token() {
    let rig = rig();
    rig.sign_in();
    let shown = rig.status().to_string();
    assert!(
        !shown.contains("refresh-one") && !shown.contains("eyJ"),
        "{shown}"
    );
    let mut keys: Vec<String> = rig.status().as_object().unwrap().keys().cloned().collect();
    keys.sort();
    assert_eq!(keys, ["authenticated", "busy", "email", "message", "name"]);
}
