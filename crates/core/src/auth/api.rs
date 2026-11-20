//! The WorkOS requests sign-in makes, as data, and the trait the host's HTTP client implements.
//!
//! Paths and bodies were confirmed against the vendored SDK source in `vendor-src/workos-ios`
//! (`Helpers/AuthKitHelpers.swift`, `Helpers/PublicClient.swift`, `Helpers/JWKSHelpers.swift`).

use super::pkce::encode;
use super::{AuthError, Jwks, API, CLIENT_ID};
use serde::Deserialize;
use serde_json::{json, Value};
use std::fmt;

/// The signed-in user, as WorkOS returns it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct User {
    pub id: String,
    pub email: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub first_name: Option<String>,
    #[serde(default)]
    pub last_name: Option<String>,
}

/// A successful answer from the token endpoint. Its debug output never shows a token.
#[derive(Clone, PartialEq, Eq, Deserialize)]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: String,
    pub user: User,
}

impl fmt::Debug for Tokens {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Tokens")
            .field("access_token", &"<redacted>")
            .field("refresh_token", &"<redacted>")
            .field("user", &self.user)
            .finish()
    }
}

/// The network calls sign-in needs. Implementations use a 20 second timeout, send
/// [`exchange_body`] or [`refresh_body`] as JSON to [`authenticate_url`], read [`jwks_url`], and
/// turn answers into values with [`parse_tokens`], [`parse_jwks`] and [`error_from_response`].
/// A failure to connect or a timeout is [`AuthError::Network`].
pub trait WorkosApi: Send + Sync {
    fn exchange_code(&self, code: &str, verifier: &str) -> Result<Tokens, AuthError>;
    fn refresh(&self, refresh_token: &str) -> Result<Tokens, AuthError>;
    fn jwks(&self) -> Result<Jwks, AuthError>;
}

/// `POST` target for both the code exchange and the refresh.
pub fn authenticate_url() -> String {
    format!("{API}/user_management/authenticate")
}

/// `GET` target for the key set that signs access tokens.
pub fn jwks_url() -> String {
    format!("{API}/sso/jwks/{}", encode(CLIENT_ID))
}

pub fn exchange_body(code: &str, verifier: &str) -> Value {
    json!({ "grant_type": "authorization_code", "client_id": CLIENT_ID, "code": code, "code_verifier": verifier })
}

pub fn refresh_body(refresh_token: &str) -> Value {
    json!({ "grant_type": "refresh_token", "client_id": CLIENT_ID, "refresh_token": refresh_token })
}

/// Parses a 2xx answer from the token endpoint.
pub fn parse_tokens(body: &[u8]) -> Result<Tokens, AuthError> {
    let tokens: Tokens = serde_json::from_slice(body).map_err(|_| AuthError::InvalidSession)?;
    if tokens.access_token.is_empty()
        || tokens.refresh_token.is_empty()
        || tokens.user.id.is_empty()
    {
        return Err(AuthError::InvalidSession);
    }
    Ok(tokens)
}

/// Parses a 2xx answer from the key-set endpoint.
pub fn parse_jwks(body: &[u8]) -> Result<Jwks, AuthError> {
    serde_json::from_slice(body).map_err(|_| AuthError::InvalidSession)
}

/// Classifies a non-2xx answer from the token endpoint.
///
/// The session is over only when a 400 or 401 names `invalid_grant` or `refresh_token_revoked`,
/// in the API error `code` or, when there is no `code`, in the OAuth `error` field. Anything else
/// (rate limits, server errors, unreadable bodies) may be retried.
pub fn error_from_response(status: u16, body: &[u8]) -> AuthError {
    if status != 400 && status != 401 {
        return AuthError::Network;
    }
    let fields: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
    let code = match fields.get("code") {
        Some(code) if !code.is_null() => code.as_str(),
        _ => fields.get("error").and_then(Value::as_str),
    };
    match code {
        Some("invalid_grant" | "refresh_token_revoked") => AuthError::Ended,
        _ => AuthError::Network,
    }
}
