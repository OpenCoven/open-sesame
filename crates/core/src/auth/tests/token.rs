use super::*;

fn verify(token: &str) -> Result<Verified, AuthError> {
    verify_access_token(token, &jwks(), USER_ID, now())
}

fn invalid(token: &str) -> bool {
    verify(token) == Err(AuthError::InvalidSession)
}

#[test]
fn valid_token_yields_expiry_and_session_id() {
    let verified = verify(&jwt(&claims())).unwrap();
    assert_eq!(
        verified.expires,
        UNIX_EPOCH + Duration::from_secs(NOW + 300)
    );
    assert_eq!(verified.session_id, SESSION_ID);
}

#[test]
fn token_for_another_user_is_rejected() {
    assert!(invalid(&jwt(&with(claims(), "sub", json!("user_other")))));
    assert_eq!(
        verify_access_token(&jwt(&claims()), &jwks(), "user_other", now()),
        Err(AuthError::InvalidSession)
    );
}

#[test]
fn expired_token_is_rejected() {
    assert!(invalid(&jwt(&with(claims(), "exp", json!(1)))));
    assert!(invalid(&jwt(&with(claims(), "exp", json!(NOW)))));
    assert!(verify(&jwt(&with(claims(), "exp", json!(NOW + 1)))).is_ok());
}

#[test]
fn non_user_token_is_rejected() {
    assert!(invalid(&jwt(&with(claims(), "sub_type", json!("agent")))));
    assert!(invalid(&jwt(&with(
        claims(),
        "sub_profile",
        json!("agent")
    ))));
    assert!(invalid(&jwt(&with(claims(), "sub_profile", Value::Null))));
    assert!(verify(&jwt(&with(claims(), "sub_profile", json!("user")))).is_ok());
    let mut no_sid = claims();
    no_sid.as_object_mut().unwrap().remove("sid");
    assert!(invalid(&jwt(&no_sid)));
    let mut no_auth_time = claims();
    no_auth_time.as_object_mut().unwrap().remove("auth_time");
    assert!(invalid(&jwt(&no_auth_time)));
}

#[test]
fn forged_token_is_rejected() {
    let token = jwt(&claims());
    let parts: Vec<&str> = token.split('.').collect();
    let forged = with(claims(), "sub", json!("user_other"));
    let tampered = format!(
        "{}.{}.{}",
        parts[0],
        b64(forged.to_string().as_bytes()),
        parts[2]
    );
    assert_eq!(
        verify_access_token(&tampered, &jwks(), "user_other", now()),
        Err(AuthError::InvalidSession)
    );
    assert!(invalid(&tampered));
}

#[test]
fn token_with_wrong_signature_is_rejected() {
    assert!(invalid(&sign(other_key(), &header(), &claims())));
    let token = jwt(&claims());
    let (rest, _) = token.rsplit_once('.').unwrap();
    assert!(invalid(&format!("{rest}.")));
    assert!(invalid(&format!("{rest}.{}", b64(&[0u8; 256]))));
}

#[test]
fn token_with_unexpected_header_is_rejected() {
    for header in [
        json!({ "alg": "none", "kid": KID }),
        json!({ "alg": "HS256", "kid": KID }),
        json!({ "alg": "RS256" }),
        json!({ "alg": "RS256", "kid": "" }),
        json!({ "alg": "RS256", "kid": "unknown" }),
        json!({ "alg": "RS256", "kid": KID, "crit": ["exp"] }),
        json!({ "alg": "RS256", "kid": KID, "b64": false }),
    ] {
        assert!(invalid(&sign(key(), &header, &claims())), "{header}");
    }
}

#[test]
fn malformed_token_is_rejected() {
    let token = jwt(&claims());
    for bad in [
        "",
        "a.b",
        "a.b.c.d",
        "...",
        "not a token",
        &format!("{token}."),
        &format!("{token}="),
    ] {
        assert!(invalid(bad), "{bad}");
    }
    let huge = with(claims(), "padding", json!("x".repeat(70_000)));
    assert!(invalid(&jwt(&huge)));
}

#[test]
fn token_with_bad_claim_types_is_rejected() {
    for (name, value) in [
        ("exp", json!("1800000300")),
        ("exp", json!(true)),
        ("exp", json!(1_800_000_300.5)),
        ("exp", Value::Null),
        ("sub", json!("")),
        ("sub", json!(7)),
        ("sid", json!(7)),
        ("sid", json!("")),
        ("auth_time", json!("then")),
        ("nbf", json!(NOW + 60)),
        ("nbf", json!("soon")),
    ] {
        assert!(
            invalid(&jwt(&with(claims(), name, value.clone()))),
            "{name}={value}"
        );
    }
    assert!(verify(&jwt(&with(claims(), "nbf", json!(NOW)))).is_ok());
}

#[test]
fn key_set_must_publish_exactly_one_matching_signing_key() {
    let token = jwt(&claims());
    let check = |keys: Value| {
        let set: Jwks = serde_json::from_value(json!({ "keys": keys })).unwrap();
        verify_access_token(&token, &set, USER_ID, now())
    };
    assert!(check(json!([jwk_json(KID)])).is_ok());
    assert!(check(json!([jwk_json("other"), jwk_json(KID)])).is_ok());
    assert_eq!(check(json!([])), Err(AuthError::InvalidSession));
    assert_eq!(
        check(json!([jwk_json(KID), jwk_json(KID)])),
        Err(AuthError::InvalidSession)
    );
    for (name, value) in [
        ("alg", json!("RS512")),
        ("kty", json!("EC")),
        ("use", json!("enc")),
        ("n", json!("")),
        ("e", json!("")),
        ("n", json!("***")),
    ] {
        let mut jwk = jwk_json(KID);
        jwk[name] = value.clone();
        assert_eq!(
            check(json!([jwk])),
            Err(AuthError::InvalidSession),
            "{name}={value}"
        );
    }
    let mut no_use = jwk_json(KID);
    no_use.as_object_mut().unwrap().remove("use");
    assert_eq!(check(json!([no_use])), Err(AuthError::InvalidSession));
}
