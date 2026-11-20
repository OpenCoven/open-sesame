//! Verification of the WorkOS access token.
//!
//! The rules follow `SessionTokenVerification.verify` and `Session.authenticateVerified` in the
//! vendored SDK: an RS256 signature by exactly one published signing key, a user access token
//! (not an agent or widget token), a subject equal to the returned user, and an unexpired `exp`.
//! Nothing in the token is read as a claim before the signature has been checked.

use super::AuthError;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ring::signature::{RsaPublicKeyComponents, RSA_PKCS1_2048_8192_SHA256};
use serde::Deserialize;
use serde_json::Value;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MAX_PAYLOAD_CHARS: usize = 65536;

/// One key of the WorkOS key set. Missing fields read as empty and fail verification.
#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
#[serde(default)]
pub struct Jwk {
    pub kid: String,
    pub kty: String,
    pub alg: String,
    #[serde(rename = "use")]
    pub usage: String,
    pub n: String,
    pub e: String,
}

/// The WorkOS key set.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Jwks {
    pub keys: Vec<Jwk>,
}

/// What a verified access token establishes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Verified {
    /// The token's `exp`: the deadline of the session.
    pub expires: SystemTime,
    /// The token's `sid`, used to end the remote session at sign-out.
    pub session_id: String,
}

/// Verifies `token` for `user_id` at `now`.
pub fn verify_access_token(
    token: &str,
    jwks: &Jwks,
    user_id: &str,
    now: SystemTime,
) -> Result<Verified, AuthError> {
    verify(token, jwks, user_id, now).ok_or(AuthError::InvalidSession)
}

fn decode(part: &str) -> Option<Vec<u8>> {
    URL_SAFE_NO_PAD.decode(part).ok()
}

fn positive(bytes: Vec<u8>) -> Option<Vec<u8>> {
    let start = bytes.iter().position(|byte| *byte != 0)?;
    Some(bytes[start..].to_vec())
}

fn verify(token: &str, jwks: &Jwks, user_id: &str, now: SystemTime) -> Option<Verified> {
    let parts: Vec<&str> = token.split('.').collect();
    let [header_part, payload_part, signature_part] = parts[..] else {
        return None;
    };
    if payload_part.len() > MAX_PAYLOAD_CHARS {
        return None;
    }
    let header: Value = serde_json::from_slice(&decode(header_part)?).ok()?;
    let payload = decode(payload_part)?;
    let signature = decode(signature_part)?;
    if signature.is_empty() {
        return None;
    }
    let header = header.as_object()?;
    if header.contains_key("crit")
        || header.contains_key("b64")
        || header.get("alg")?.as_str()? != "RS256"
    {
        return None;
    }
    let kid = header.get("kid")?.as_str()?;
    if kid.is_empty() {
        return None;
    }

    let mut matches = jwks.keys.iter().filter(|key| key.kid == kid);
    let (Some(key), None) = (matches.next(), matches.next()) else {
        return None;
    };
    if key.alg != "RS256" || key.kty != "RSA" || key.usage != "sig" {
        return None;
    }
    let (n, e) = (positive(decode(&key.n)?)?, positive(decode(&key.e)?)?);
    let signed = &token[..header_part.len() + 1 + payload_part.len()];
    RsaPublicKeyComponents { n: &n, e: &e }
        .verify(&RSA_PKCS1_2048_8192_SHA256, signed.as_bytes(), &signature)
        .ok()?;

    // Claims are read only after the signature has been checked.
    let claims: Value = serde_json::from_slice(&payload).ok()?;
    let claims = claims.as_object()?;
    let subject = claims.get("sub")?.as_str()?;
    if subject.is_empty() || subject != user_id {
        return None;
    }
    // A user access token has a session ID and an authentication time, and is not marked as
    // belonging to an agent or another kind of subject.
    let session_id = claims.get("sid")?.as_str()?;
    if session_id.is_empty()
        || !claims.get("auth_time")?.is_number()
        || claims.contains_key("sub_type")
    {
        return None;
    }
    if let Some(profile) = claims.get("sub_profile") {
        if profile.as_str()? != "user" {
            return None;
        }
    }
    match claims.get("nbf") {
        None | Some(Value::Null) => {}
        Some(not_before) => {
            if UNIX_EPOCH.checked_add(Duration::from_secs(not_before.as_u64()?))? > now {
                return None;
            }
        }
    }
    let expires = UNIX_EPOCH.checked_add(Duration::from_secs(claims.get("exp")?.as_u64()?))?;
    if expires <= now {
        return None;
    }
    Some(Verified {
        expires,
        session_id: session_id.to_string(),
    })
}
