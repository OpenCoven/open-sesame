//! Tests for the sign-in logic. No browser, keychain, network or real account is used: the
//! WorkOS API and both stores are fakes, and tokens are signed by an RSA key generated for the run.

mod api;
mod callback;
mod controller;
mod pkce;
mod token;

use super::*;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rsa::traits::PublicKeyParts;
use rsa::{Pkcs1v15Sign, RsaPrivateKey};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub(super) const USER_ID: &str = "user_fixture";
pub(super) const SESSION_ID: &str = "session_fixture";
pub(super) const KID: &str = "fixture";
/// A fixed "now" so no test depends on the wall clock.
pub(super) const NOW: u64 = 1_800_000_000;

pub(super) fn now() -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(NOW)
}

pub(super) fn b64(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn generate() -> RsaPrivateKey {
    RsaPrivateKey::new(&mut rand::thread_rng(), 2048).expect("generate an ephemeral RSA key")
}

/// The signing key the fixture key set publishes.
pub(super) fn key() -> &'static RsaPrivateKey {
    static KEY: OnceLock<RsaPrivateKey> = OnceLock::new();
    KEY.get_or_init(generate)
}

/// A second key that the fixture key set does not publish.
pub(super) fn other_key() -> &'static RsaPrivateKey {
    static KEY: OnceLock<RsaPrivateKey> = OnceLock::new();
    KEY.get_or_init(generate)
}

pub(super) fn jwk_json(kid: &str) -> Value {
    let public = key().to_public_key();
    json!({
        "kty": "RSA", "kid": kid, "alg": "RS256", "use": "sig",
        "n": b64(&public.n().to_bytes_be()), "e": b64(&public.e().to_bytes_be()),
        "x5c": [], "x5t#S256": "fixture",
    })
}

pub(super) fn jwks() -> Jwks {
    serde_json::from_value(json!({ "keys": [jwk_json(KID)] })).unwrap()
}

pub(super) fn sign(key: &RsaPrivateKey, header: &Value, claims: &Value) -> String {
    use rsa::sha2::{Digest, Sha256};
    let input = format!(
        "{}.{}",
        b64(header.to_string().as_bytes()),
        b64(claims.to_string().as_bytes())
    );
    let signature = key
        .sign(
            Pkcs1v15Sign::new::<Sha256>(),
            &Sha256::digest(input.as_bytes()),
        )
        .expect("sign the fixture token");
    format!("{input}.{}", b64(&signature))
}

pub(super) fn header() -> Value {
    json!({ "alg": "RS256", "kid": KID })
}

/// The claims of a valid user access token that expires 300 seconds after [`NOW`].
pub(super) fn claims() -> Value {
    json!({ "sub": USER_ID, "exp": NOW + 300, "sid": SESSION_ID, "auth_time": NOW })
}

pub(super) fn jwt(claims: &Value) -> String {
    sign(key(), &header(), claims)
}

pub(super) fn with(mut claims: Value, name: &str, value: Value) -> Value {
    claims[name] = value;
    claims
}

pub(super) fn user() -> User {
    User {
        id: USER_ID.into(),
        email: "fixture@example.invalid".into(),
        name: None,
        first_name: Some("Fixture".into()),
        last_name: None,
    }
}

pub(super) fn tokens(access_token: String, refresh_token: &str) -> Tokens {
    Tokens {
        access_token,
        refresh_token: refresh_token.into(),
        user: user(),
    }
}

type Reply = Result<Tokens, AuthError>;

/// A scripted WorkOS API. Each call pops the next scripted reply and records what it was sent.
#[derive(Default)]
pub(super) struct FakeApi {
    pub exchanges: Mutex<Vec<Reply>>,
    pub refreshes: Mutex<Vec<Reply>>,
    pub exchange_calls: Mutex<Vec<(String, String)>>,
    pub refresh_calls: Mutex<Vec<String>>,
    pub jwks_fails: AtomicBool,
    /// Runs inside `exchange_code` and `refresh`, before the reply is returned.
    #[allow(clippy::type_complexity)]
    pub during_call: Mutex<Option<Box<dyn Fn() + Send + Sync>>>,
}

impl FakeApi {
    fn interrupt(&self) {
        if let Some(hook) = self.during_call.lock().unwrap().as_ref() {
            hook();
        }
    }
}

impl WorkosApi for FakeApi {
    fn exchange_code(&self, code: &str, verifier: &str) -> Reply {
        self.exchange_calls
            .lock()
            .unwrap()
            .push((code.into(), verifier.into()));
        self.interrupt();
        self.exchanges
            .lock()
            .unwrap()
            .pop()
            .unwrap_or(Err(AuthError::Network))
    }
    fn refresh(&self, refresh_token: &str) -> Reply {
        self.refresh_calls
            .lock()
            .unwrap()
            .push(refresh_token.into());
        self.interrupt();
        self.refreshes
            .lock()
            .unwrap()
            .pop()
            .unwrap_or(Err(AuthError::Network))
    }
    fn jwks(&self) -> Result<Jwks, AuthError> {
        if self.jwks_fails.load(Ordering::SeqCst) {
            return Err(AuthError::Network);
        }
        Ok(jwks())
    }
}

/// An in-memory credential store and signed-out marker.
#[derive(Default)]
pub(super) struct FakeStore {
    pub token: Mutex<Option<String>>,
    pub signed_out: AtomicBool,
    pub fail_load: AtomicBool,
    pub fail_save: AtomicBool,
    pub fail_delete: AtomicBool,
}

impl FakeStore {
    pub fn saved(&self) -> Option<String> {
        self.token.lock().unwrap().clone()
    }
}

impl CredentialStore for FakeStore {
    fn load(&self) -> Result<Option<String>, AuthError> {
        if self.fail_load.load(Ordering::SeqCst) {
            return Err(AuthError::Store);
        }
        Ok(self.saved())
    }
    fn save(&self, refresh_token: &str) -> Result<(), AuthError> {
        if self.fail_save.load(Ordering::SeqCst) {
            return Err(AuthError::Store);
        }
        *self.token.lock().unwrap() = Some(refresh_token.into());
        Ok(())
    }
    fn delete(&self) -> Result<(), AuthError> {
        if self.fail_delete.load(Ordering::SeqCst) {
            return Err(AuthError::Store);
        }
        *self.token.lock().unwrap() = None;
        Ok(())
    }
}

impl SignedOutMarker for FakeStore {
    fn signed_out(&self) -> bool {
        self.signed_out.load(Ordering::SeqCst)
    }
    fn set_signed_out(&self, value: bool) {
        self.signed_out.store(value, Ordering::SeqCst);
    }
}

/// A controller wired to fakes, with a clock the test can move.
pub(super) struct Rig {
    pub api: Arc<FakeApi>,
    pub store: Arc<FakeStore>,
    pub clock: Arc<Mutex<SystemTime>>,
    pub changes: Arc<AtomicUsize>,
    pub auth: Arc<AuthController>,
}

pub(super) fn rig() -> Rig {
    let api = Arc::new(FakeApi::default());
    let store = Arc::new(FakeStore::default());
    let clock = Arc::new(Mutex::new(now()));
    let changes = Arc::new(AtomicUsize::new(0));
    let (time, count) = (clock.clone(), changes.clone());
    let auth = Arc::new(AuthController::new(AuthParts {
        api: api.clone(),
        store: store.clone(),
        marker: store.clone(),
        clock: Arc::new(move || *time.lock().unwrap()),
        on_change: Arc::new(move || {
            count.fetch_add(1, Ordering::SeqCst);
        }),
    }));
    Rig {
        api,
        store,
        clock,
        changes,
        auth,
    }
}

impl Rig {
    pub fn advance(&self, seconds: u64) {
        *self.clock.lock().unwrap() += Duration::from_secs(seconds);
    }
    pub fn status(&self) -> Value {
        self.auth.status()
    }
    pub fn message(&self) -> String {
        self.status()["message"].as_str().unwrap().to_string()
    }
    /// Starts a sign-in and returns a callback URL carrying the right `state`.
    pub fn begin(&self) -> String {
        let url = self.auth.begin_sign_in().expect("begin sign-in");
        let state = query_value(&url, "state").expect("authorisation URL carries state");
        format!("opensesame://auth/callback?code=fixture-code&state={state}")
    }
    /// A complete, successful sign-in.
    pub fn sign_in(&self) {
        self.api
            .exchanges
            .lock()
            .unwrap()
            .push(Ok(tokens(jwt(&claims()), "refresh-one")));
        let callback = self.begin();
        self.auth.complete_sign_in(&callback);
    }
}

/// The raw values of one query parameter in a URL.
pub(super) fn query_values(url: &str, name: &str) -> Vec<String> {
    let query = url.split_once('?').map(|(_, q)| q).unwrap_or("");
    query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .filter(|(key, _)| *key == name)
        .map(|(_, value)| value.to_string())
        .collect()
}

pub(super) fn query_value(url: &str, name: &str) -> Option<String> {
    let mut values = query_values(url, name);
    if values.len() == 1 {
        values.pop()
    } else {
        None
    }
}
