//! PKCE values and the URLs the host opens in the system browser.

use super::{AuthError, API, CLIENT_ID, REDIRECT, SIGNED_OUT};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ring::digest::{digest, SHA256};
use ring::rand::{SecureRandom, SystemRandom};
use std::fmt;

/// The secrets of one sign-in attempt. The verifier never leaves the app except in the code
/// exchange; the challenge and the state go in the authorisation URL.
pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
    pub state: String,
}

impl fmt::Debug for Pkce {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Pkce(<redacted>)")
    }
}

fn random() -> Result<String, AuthError> {
    let mut bytes = [0u8; 32];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| AuthError::Random)?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

/// A fresh verifier (43 characters from 32 random bytes), its S256 challenge and a fresh state.
pub fn generate_pkce() -> Result<Pkce, AuthError> {
    let verifier = random()?;
    let challenge = URL_SAFE_NO_PAD.encode(digest(&SHA256, verifier.as_bytes()));
    Ok(Pkce {
        verifier,
        challenge,
        state: random()?,
    })
}

/// The AuthKit authorisation URL for this attempt.
pub fn authorize_url(pkce: &Pkce) -> String {
    let query = [
        ("response_type", "code"),
        ("client_id", CLIENT_ID),
        ("redirect_uri", REDIRECT),
        ("provider", "authkit"),
        ("code_challenge", &pkce.challenge),
        ("code_challenge_method", "S256"),
        ("state", &pkce.state),
    ];
    let query: Vec<String> = query
        .iter()
        .map(|(name, value)| format!("{name}={}", encode(value)))
        .collect();
    format!("{API}/user_management/authorize?{}", query.join("&"))
}

/// The URL that ends the remote session and returns the browser to the signed-out page.
pub fn logout_url(session_id: &str) -> String {
    format!(
        "{API}/user_management/sessions/logout?session_id={}&return_to={}",
        encode(session_id),
        encode(SIGNED_OUT)
    )
}

/// Percent-encodes everything except the RFC 3986 unreserved characters.
pub(super) fn encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}
