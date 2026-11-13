use super::*;

const S: &str = "fixture-state";

fn rejected(url: &str) -> bool {
    authorization_code(url, S) == Err(AuthError::InvalidCallback)
}

#[test]
fn callback_accepts_exact_url() {
    let code = authorization_code(
        "opensesame://auth/callback?state=fixture-state&code=fixture-code",
        S,
    );
    assert_eq!(code.as_deref(), Ok("fixture-code"));
    let reordered =
        authorization_code("opensesame://auth/callback?code=abc&state=fixture-state", S);
    assert_eq!(reordered.as_deref(), Ok("abc"));
}

#[test]
fn callback_accepts_percent_encoded_values() {
    let code = authorization_code(
        "opensesame://auth/callback?state=fixture%2Dstate&code=a%2Fb",
        S,
    );
    assert_eq!(code.as_deref(), Ok("a/b"));
}

/// The nine rejections in `desktop/tests/AuthenticationTests.swift`, in the same order.
#[test]
fn callback_rejects_every_case_the_swift_tests_reject() {
    for url in [
        "https://auth/callback?state=fixture-state&code=x",
        "opensesame://other/callback?state=fixture-state&code=x",
        "opensesame://auth/login?state=fixture-state&code=x",
        "opensesame://auth/callback?state=wrong&code=x",
        "opensesame://auth/callback?state=fixture-state&state=fixture-state&code=x",
        "opensesame://auth/callback?state=fixture-state&code=x&code=y",
        "opensesame://auth/callback?state=fixture-state&error=denied&code=x",
        "opensesame://auth/callback?state=fixture-state&code=",
        "opensesame://auth/callback?state=fixture-state&code=x#fragment",
    ] {
        assert!(rejected(url), "{url}");
    }
}

#[test]
fn callback_rejects_wrong_state() {
    assert!(rejected("opensesame://auth/callback?code=abc&state=other"));
    assert!(rejected(
        "opensesame://auth/callback?code=abc&state=fixture-state%20"
    ));
    assert!(rejected(
        "opensesame://auth/callback?code=abc&state=FIXTURE-STATE"
    ));
}

#[test]
fn callback_rejects_missing_state() {
    assert!(rejected("opensesame://auth/callback?code=abc"));
    assert!(rejected("opensesame://auth/callback?code=abc&state"));
    assert!(rejected("opensesame://auth/callback?code=abc&state="));
}

#[test]
fn callback_rejects_duplicate_state() {
    assert!(rejected(
        "opensesame://auth/callback?code=abc&state=fixture-state&state=fixture-state"
    ));
    assert!(rejected(
        "opensesame://auth/callback?state=other&code=abc&state=fixture-state"
    ));
    // A percent-encoded name is still the same parameter.
    assert!(rejected(
        "opensesame://auth/callback?code=abc&state=fixture-state&st%61te=other"
    ));
}

#[test]
fn callback_rejects_duplicate_code() {
    assert!(rejected(
        "opensesame://auth/callback?code=a&code=b&state=fixture-state"
    ));
    assert!(rejected(
        "opensesame://auth/callback?code=a&c%6Fde=a&state=fixture-state"
    ));
}

#[test]
fn callback_rejects_error_parameter() {
    assert!(rejected(
        "opensesame://auth/callback?code=abc&state=fixture-state&error=access_denied"
    ));
    assert!(rejected(
        "opensesame://auth/callback?code=abc&state=fixture-state&error"
    ));
    assert!(rejected(
        "opensesame://auth/callback?code=abc&state=fixture-state&err%6Fr=x"
    ));
}

#[test]
fn callback_rejects_other_scheme_host_path_port_user_fragment() {
    for url in [
        "https://auth/callback?code=a&state=fixture-state",
        "OpenSesame://auth/callback?code=a&state=fixture-state",
        "opensesame://evil/callback?code=a&state=fixture-state",
        "opensesame://AUTH/callback?code=a&state=fixture-state",
        "opensesame://auth/other?code=a&state=fixture-state",
        "opensesame://auth/callback/?code=a&state=fixture-state",
        "opensesame://auth/callback/extra?code=a&state=fixture-state",
        "opensesame://auth:8/callback?code=a&state=fixture-state",
        "opensesame://u@auth/callback?code=a&state=fixture-state",
        "opensesame://u:p@auth/callback?code=a&state=fixture-state",
        "opensesame://auth/callback?code=a&state=fixture-state#f",
        "opensesame://auth/callback#?code=a&state=fixture-state",
        "opensesame:/auth/callback?code=a&state=fixture-state",
        "opensesame:auth/callback?code=a&state=fixture-state",
        " opensesame://auth/callback?code=a&state=fixture-state",
        "opensesame://auth/callback",
        "",
    ] {
        assert!(rejected(url), "{url}");
    }
}

#[test]
fn callback_rejects_empty_and_oversized_code() {
    assert!(rejected(
        "opensesame://auth/callback?code=&state=fixture-state"
    ));
    let at_limit = format!(
        "opensesame://auth/callback?code={}&state=fixture-state",
        "a".repeat(8192)
    );
    assert_eq!(
        authorization_code(&at_limit, S).map(|code| code.len()),
        Ok(8192)
    );
    let over = format!(
        "opensesame://auth/callback?code={}&state=fixture-state",
        "a".repeat(8193)
    );
    assert!(rejected(&over));
}

#[test]
fn callback_rejects_malformed_percent_encoding() {
    assert!(rejected(
        "opensesame://auth/callback?code=%zz&state=fixture-state"
    ));
    assert!(rejected(
        "opensesame://auth/callback?code=%4&state=fixture-state"
    ));
    assert!(rejected(
        "opensesame://auth/callback?code=%ff&state=fixture-state"
    ));
}

#[test]
fn callback_rejects_an_empty_expected_state() {
    assert_eq!(
        authorization_code("opensesame://auth/callback?code=a&state=", ""),
        Err(AuthError::InvalidCallback)
    );
}
