use super::*;
use rsa::sha2::{Digest, Sha256};

#[test]
fn pkce_challenge_is_sha256_of_verifier() {
    let pkce = generate_pkce().unwrap();
    assert_eq!(pkce.verifier.len(), 43);
    assert!(pkce.verifier.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'));
    assert_eq!(pkce.challenge, b64(&Sha256::digest(pkce.verifier.as_bytes())));
    assert!(pkce.state.len() >= 43);
}

#[test]
fn pkce_values_are_fresh_each_time() {
    let (a, b) = (generate_pkce().unwrap(), generate_pkce().unwrap());
    assert_ne!(a.verifier, b.verifier);
    assert_ne!(a.state, b.state);
    assert_ne!(a.verifier, a.state);
}

#[test]
fn authorize_url_contains_required_parameters() {
    let pkce = generate_pkce().unwrap();
    let url = authorize_url(&pkce);
    assert!(url.starts_with("https://api.workos.com/user_management/authorize?"), "{url}");
    let expect = [
        ("response_type", "code".to_string()),
        ("client_id", CLIENT_ID.to_string()),
        ("redirect_uri", "opensesame%3A%2F%2Fauth%2Fcallback".to_string()),
        ("provider", "authkit".to_string()),
        ("code_challenge", pkce.challenge.clone()),
        ("code_challenge_method", "S256".to_string()),
        ("state", pkce.state.clone()),
    ];
    for (name, value) in &expect {
        assert_eq!(query_values(&url, name), vec![value.clone()], "{name}");
    }
    assert_eq!(url.split_once('?').unwrap().1.split('&').count(), expect.len());
}

/// Only the public client ID ships: no secret, API key or verifier is in the URL.
#[test]
fn authorize_url_carries_no_secret() {
    let pkce = generate_pkce().unwrap();
    let url = authorize_url(&pkce);
    assert!(!url.contains("secret") && !url.contains("api_key"));
    assert!(!url.contains(&pkce.verifier));
}

#[test]
fn logout_url_names_the_session_and_the_signed_out_page() {
    assert_eq!(
        logout_url("session 1/2"),
        "https://api.workos.com/user_management/sessions/logout?session_id=session%201%2F2&return_to=opensesame%3A%2F%2Fauth%2Fsigned-out"
    );
}

#[test]
fn constants_match_the_swift_host() {
    assert_eq!(CLIENT_ID, "client_01M6WS836GMGC87S8SVBR6X35A");
    assert_eq!(REDIRECT, "opensesame://auth/callback");
    assert_eq!(SIGNED_OUT, "opensesame://auth/signed-out");
    assert_eq!(API, "https://api.workos.com");
}
