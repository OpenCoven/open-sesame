//! Pause, resume and stop, bound to the exact process that was listed (`authorize_controls` and
//! `control_process` in `agent_monitor.py`).

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use base64::Engine;
use ring::digest;
use ring::rand::{SecureRandom, SystemRandom};
use serde::Serialize;
use serde_json::Value;

use super::list::Agent;
use super::recognize::Provider;
use crate::gate::NOT_ON_OS;

/// How long a listed agent's control token stays valid.
pub const TOKEN_LIFETIME: Duration = Duration::from_secs(120);
/// At most this many tokens are held at once.
pub const MAX_TOKENS: usize = 1024;

pub const SELECT_CURRENT: &str = "Refresh and select a current agent process.";
pub const CHOOSE_ACTION: &str = "Choose Pause, Resume or Stop.";
pub const EXPIRED: &str = "This process snapshot expired. Refresh before trying again.";
pub const CHANGED: &str = "Process changed or exited. Refresh before trying again.";
pub const NOT_CHANGED: &str = "The process could not be changed. Refresh to check its state.";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Pause,
    Resume,
    Stop,
}

/// The actions a system can perform: all three with POSIX signals, Stop alone on Windows.
pub fn actions_for(unix: bool) -> &'static [Action] {
    if unix {
        &[Action::Pause, Action::Resume, Action::Stop]
    } else {
        &[Action::Stop]
    }
}

impl Action {
    fn parse(text: &str) -> Option<Self> {
        match text {
            "pause" => Some(Action::Pause),
            "resume" => Some(Action::Resume),
            "stop" => Some(Action::Stop),
            _ => None,
        }
    }
}

/// The actions this system can perform.
pub fn actions() -> &'static [Action] {
    actions_for(cfg!(unix))
}

/// What a control is bound to. Arguments are not part of it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Identity {
    pub pid: u32,
    pub user: String,
    pub start_time: u64,
    pub executable: String,
    pub provider: Provider,
}

impl Identity {
    /// A stable ID for a listed agent: the same on every poll and after the process is reparented,
    /// different when its PID is reused.
    pub fn agent_id(&self, machine: &str) -> String {
        let text = format!(
            "{machine}\0{}\0{}\0{}",
            self.pid, self.user, self.start_time
        );
        let hash = digest::digest(&digest::SHA256, text.as_bytes());
        hash.as_ref()[..12]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }
}

/// Reads a process again and acts on it. The system implementation is
/// [`SystemAccess`](super::SystemAccess); tests use a stand-in that never signals anything.
pub trait ProcessAccess {
    /// The process's identity now, or `None` when it is gone, another user's or not an agent.
    fn identity(&self, pid: u32) -> Option<Identity>;
    /// Performs the action on the process `identity` names, or returns the sentence to show.
    fn send(&self, identity: &Identity, action: Action) -> Result<(), &'static str>;
}

/// The reply to a control that was carried out.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlResult {
    pub pid: u32,
    pub action: Action,
    pub signal_sent: bool,
}

/// The short-lived tokens that bind controls to listed processes.
pub struct Controls {
    unix: bool,
    random: SystemRandom,
    tokens: Mutex<HashMap<String, Entry>>,
}

struct Entry {
    identity: Identity,
    expires: Instant,
}

impl Default for Controls {
    fn default() -> Self {
        Self::for_os(cfg!(unix))
    }
}

impl Controls {
    pub fn new() -> Self {
        Self::default()
    }

    /// Controls with the action table of a Unix (`true`) or Windows (`false`) system.
    pub fn for_os(unix: bool) -> Self {
        Self {
            unix,
            random: SystemRandom::new(),
            tokens: Mutex::new(HashMap::new()),
        }
    }

    fn tokens(&self) -> MutexGuard<'_, HashMap<String, Entry>> {
        self.tokens.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// 32 random bytes, URL-safe, as Python's `secrets.token_urlsafe(32)`.
    fn new_token(&self) -> Option<String> {
        let mut bytes = [0u8; 32];
        self.random.fill(&mut bytes).ok()?;
        Some(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
    }

    /// The actions these controls can carry out.
    pub fn actions(&self) -> &'static [Action] {
        actions_for(self.unix)
    }

    /// Gives each agent whose identity is known a token and an ID. A token is reused while it is
    /// valid for the same identity.
    pub fn authorize(
        &self,
        agents: &mut [Agent],
        identities: &HashMap<u32, Identity>,
        machine: &str,
        now: Instant,
    ) {
        let mut tokens = self.tokens();
        tokens.retain(|_, entry| entry.expires >= now);
        for agent in agents {
            let Some(identity) = identities
                .get(&agent.pid)
                .filter(|identity| identity.provider == agent.provider)
            else {
                continue;
            };
            let held = tokens
                .iter()
                .find(|(_, entry)| entry.identity == *identity)
                .map(|(token, _)| token.clone());
            let token = match held {
                Some(token) => token,
                None if tokens.len() < MAX_TOKENS => {
                    let Some(token) = self.new_token() else {
                        continue;
                    };
                    tokens.insert(
                        token.clone(),
                        Entry {
                            identity: identity.clone(),
                            expires: now + TOKEN_LIFETIME,
                        },
                    );
                    token
                }
                None => continue,
            };
            agent.control_token = Some(token);
            agent.id = Some(identity.agent_id(machine));
        }
    }

    /// Carries out `{pid, token, action}` when the token is current and the process still has the
    /// identity it was listed with.
    pub fn control(
        &self,
        params: &Value,
        access: &dyn ProcessAccess,
        now: Instant,
    ) -> Result<ControlResult, &'static str> {
        let pid = params
            .get("pid")
            .and_then(Value::as_u64)
            .filter(|pid| *pid > 1)
            .and_then(|pid| u32::try_from(pid).ok());
        let token = params
            .get("token")
            .and_then(Value::as_str)
            .filter(|token| token.len() <= 128);
        let (Some(pid), Some(token)) = (pid, token) else {
            return Err(SELECT_CURRENT);
        };
        let action = params
            .get("action")
            .and_then(Value::as_str)
            .and_then(Action::parse)
            .ok_or(CHOOSE_ACTION)?;
        if !self.actions().contains(&action) {
            return Err(NOT_ON_OS);
        }
        let mut tokens = self.tokens();
        let identity = match tokens.get(token) {
            Some(entry) if entry.identity.pid == pid && entry.expires >= now => {
                entry.identity.clone()
            }
            _ => return Err(EXPIRED),
        };
        if access.identity(pid).as_ref() != Some(&identity) {
            tokens.remove(token);
            return Err(CHANGED);
        }
        access.send(&identity, action)?;
        tokens.remove(token);
        Ok(ControlResult {
            pid,
            action,
            signal_sent: true,
        })
    }
}
