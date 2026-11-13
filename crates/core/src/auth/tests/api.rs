use super::*;

#[test]
fn request_urls_match_the_vendored_sdk() {
    assert_eq!(authenticate_url(), "https://api.workos.com/user_management/authenticate");
    assert_eq!(jwks_url(), format!("https://api.workos.com/sso/jwks/{CLIENT_ID}"));
}

#[test]
fn exchange_body_matches_the_vendored_sdk() {
    assert_eq!(
        exchange_body("the-code", "the-verifier"),
        json!({ "grant_type": "authorization_code", "client_id": CLIENT_ID, "code": "the-code", "code_verifier": "the-verifier" })
    );
}

#[test]
fn refresh_body_matches_the_vendored_sdk() {
    assert_eq!(
        refresh_body("the-refresh-token"),
        json!({ "grant_type": "refresh_token", "client_id": CLIENT_ID, "refresh_token": "the-refresh-token" })
    );
}

#[test]
fn request_bodies_carry_no_secret() {
    for body in [exchange_body("c", "v"), refresh_body("r")] {
        let keys: Vec<&String> = body.as_object().unwrap().keys().collect();
        assert!(keys.iter().all(|key| !key.contains("secret") && !key.contains("api_key")), "{keys:?}");
    }
}

#[test]
fn token_response_is_parsed() {
    let body = json!({
        "user": { "object": "user", "id": USER_ID, "email": "fixture@example.invalid", "first_name": "Fixture", "last_name": null, "email_verified": true },
        "organization_id": null,
        "access_token": "synthetic-access-token",
        "refresh_token": "synthetic-refresh-token",
        "authentication_method": "OAuth",
    });
    let parsed = parse_tokens(body.to_string().as_bytes()).unwrap();
    assert_eq!(parsed.access_token, "synthetic-access-token");
    assert_eq!(parsed.refresh_token, "synthetic-refresh-token");
    assert_eq!(parsed.user, user());
}

#[test]
fn incomplete_token_response_is_rejected() {
    for body in [
        json!({}),
        json!({ "access_token": "a", "refresh_token": "r" }),
        json!({ "user": { "id": USER_ID, "email": "e" }, "access_token": "a" }),
        json!({ "user": { "id": USER_ID, "email": "e" }, "access_token": "", "refresh_token": "r" }),
        json!({ "user": { "id": USER_ID, "email": "e" }, "access_token": "a", "refresh_token": "" }),
        json!({ "user": { "id": "", "email": "e" }, "access_token": "a", "refresh_token": "r" }),
    ] {
        assert_eq!(parse_tokens(body.to_string().as_bytes()), Err(AuthError::InvalidSession), "{body}");
    }
    assert_eq!(parse_tokens(b"not json"), Err(AuthError::InvalidSession));
}

#[test]
fn key_set_response_is_parsed() {
    let body = json!({ "keys": [jwk_json(KID)] });
    assert_eq!(parse_jwks(body.to_string().as_bytes()).unwrap().keys.len(), 1);
    assert_eq!(parse_jwks(b"{}"), Err(AuthError::InvalidSession));
}

/// The server ends a session with `invalid_grant` or `refresh_token_revoked`, either as the API
/// error `code` or as the OAuth `error` field, at HTTP 400 or 401. Everything else can be retried.
#[test]
fn error_responses_are_classified() {
    let ended = [
        (400, json!({ "error": "invalid_grant", "error_description": "Session has already ended." })),
        (400, json!({ "code": "invalid_grant", "message": "x" })),
        (401, json!({ "error": "invalid_grant" })),
        (400, json!({ "code": "refresh_token_revoked" })),
        (400, json!({ "error": "refresh_token_revoked" })),
    ];
    for (status, body) in ended {
        assert_eq!(error_from_response(status, body.to_string().as_bytes()), AuthError::Ended, "{status} {body}");
    }
    let transient = [
        (400, json!({ "error": "invalid_request" })),
        (400, json!({ "code": "other", "error": "invalid_grant" })),
        (403, json!({ "error": "invalid_grant" })),
        (429, json!({ "error": "invalid_grant" })),
        (500, json!({ "error": "invalid_grant" })),
        (400, json!({ "error": 7 })),
        (400, json!([])),
    ];
    for (status, body) in transient {
        assert_eq!(error_from_response(status, body.to_string().as_bytes()), AuthError::Network, "{status} {body}");
    }
    assert_eq!(error_from_response(400, b"<html>"), AuthError::Network);
    assert_eq!(error_from_response(400, b""), AuthError::Network);
}

/// Tokens never appear in debug output, so they cannot reach a log or a test failure message.
#[test]
fn tokens_are_redacted_in_debug_output() {
    let shown = format!("{:?}", tokens("synthetic-access-token".into(), "synthetic-refresh-token"));
    assert!(!shown.contains("synthetic-access-token") && !shown.contains("synthetic-refresh-token"), "{shown}");
    assert!(shown.contains(USER_ID));
}
