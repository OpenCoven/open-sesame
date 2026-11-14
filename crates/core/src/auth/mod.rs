//! Sign-in logic: WorkOS AuthKit with PKCE through the system browser (issue #69).
//!
//! This is the logic of `desktop/Authentication.swift` without a browser, a keychain or a network
//! stack. The host supplies those through [`WorkosApi`], [`CredentialStore`] and
//! [`SignedOutMarker`], opens the URLs this module returns, and passes the callback back in. The
//! wiring to the system browser, deep links and the operating system's credential store is
//! issue #72.
//!
//! Rules that must hold:
//!
//! - Only the public client ID ships. No API key or client secret exists in this code.
//! - A callback is accepted only when it matches the redirect exactly and carries exactly one
//!   `state` equal to the pending one and exactly one usable `code` ([`authorization_code`]).
//! - A session exists only after the access token's signature has been verified against the
//!   WorkOS key set and its subject equals the returned user ([`verify_access_token`]).
//! - Only the refresh token is saved, and only through [`CredentialStore`]. Tokens are never
//!   logged, printed, put in an error or returned to the UI.

mod api;
mod callback;
mod controller;
mod pkce;
mod store;
mod token;

#[cfg(test)]
mod tests;

pub use api::{
    authenticate_url, error_from_response, exchange_body, jwks_url, parse_jwks, parse_tokens,
    refresh_body, Tokens, User, WorkosApi,
};
pub use callback::authorization_code;
pub use controller::{AuthController, AuthParts};
pub use pkce::{authorize_url, generate_pkce, logout_url, Pkce};
pub use store::{CredentialStore, SignedOutMarker};
pub use token::{verify_access_token, Jwk, Jwks, Verified};

/// The public client ID. WorkOS API keys never belong in a desktop bundle.
pub const CLIENT_ID: &str = "client_01M6WS836GMGC87S8SVBR6X35A";
/// Where WorkOS sends the browser after sign-in.
pub const REDIRECT: &str = "opensesame://auth/callback";
/// Where WorkOS sends the browser after the remote session is ended.
pub const SIGNED_OUT: &str = "opensesame://auth/signed-out";
/// The WorkOS API origin.
pub const API: &str = "https://api.workos.com";

/// Why a sign-in step failed. No variant carries a token, a code or a server message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthError {
    /// The callback URL did not match the redirect, the pending `state` or the `code` rules.
    InvalidCallback,
    /// The server's answer or the access token could not be verified.
    InvalidSession,
    /// The credential store could not read, save or delete.
    Store,
    /// The server answered `invalid_grant` or `refresh_token_revoked`: the session is over.
    Ended,
    /// A failure that may succeed if tried again: no network, a timeout, a server error.
    Network,
    /// A sign-in is already in progress.
    Busy,
    /// The operating system's random number source failed.
    Random,
}
