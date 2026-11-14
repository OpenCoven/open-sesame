//! Local shell and SSH panes on real pseudo-terminals (issue #74).
//!
//! [`Terminals`] owns every pane. `terminal.open` starts a program on a pseudo-terminal
//! (`portable-pty`: POSIX PTYs and Windows ConPTY) and streams its output to the [`Sink`] the
//! caller supplies, which the application backs with one ordered channel per pane. Output is
//! raw bytes, batched by time and size, and paced by the acknowledgements the terminal emulator
//! sends with `terminal.ack` (see [`HIGH_WATER`]). Closing a pane, replacing it, or
//! [`Terminals::close_all`] on quit kills the pane's whole process tree before returning.
//!
//! Validation, limits and messages are those of `desktop/bridge.py`, which this replaces.

mod launch;
mod session;
mod tree;

use crate::protocol::{BridgeError, BridgeResult};
use base64::Engine;
use serde_json::{json, Map, Value};
use session::Session;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};

/// The sender stops when the emulator has this many bytes it has not acknowledged.
pub const HIGH_WATER: u64 = 1024 * 1024;
/// A stopped sender starts again when the unacknowledged bytes are down to this many.
pub const LOW_WATER: u64 = 256 * 1024;
/// How many panes may run at once.
pub const MAX_SESSIONS: usize = 16;
/// The most characters one `terminal.input` request may carry.
pub const INPUT_LIMIT: usize = 131_072;

const INVALID_ID: &str = "Invalid pane ID.";
const NOT_OPEN: &str = "Open this shell before sending input.";
const TOO_MANY: &str = "Close a shell before opening more than 16 active sessions.";
const INPUT_TOO_LARGE: &str = "Terminal input is too large.";
const INPUT_INVALID: &str = "Terminal input is not valid.";
/// `terminal.open` reached the core without a channel for the pane's output.
pub const NO_CHANNEL: &str = "This shell has no output channel.";

/// One message on a pane's output stream. Messages arrive in the order they were produced, and
/// `Exit` is always the last.
#[derive(Debug, PartialEq, Eq)]
pub enum Output {
    /// Bytes the program wrote, exactly as written.
    Data(Vec<u8>),
    /// The stream broke for a reason other than the program ending. `Exit` follows.
    Error(&'static str),
    /// The pane has ended and its processes are gone.
    Exit,
}

/// Where a pane's output goes. Called from the pane's sender thread, one message at a time.
pub type Sink = Arc<dyn Fn(Output) + Send + Sync>;

/// Programs to use in place of the ones found on this machine. Tests set these; the app leaves
/// them empty.
#[derive(Clone, Debug, Default)]
pub struct Config {
    /// The shell for local panes. `None`: `$SHELL`, then the platform default, then `/bin/sh`;
    /// on Windows PowerShell 7 when installed, otherwise Windows PowerShell.
    pub shell: Option<PathBuf>,
    /// The SSH client. `None`: `ssh` from the search path and the usual install locations.
    pub ssh: Option<PathBuf>,
    /// The Bash the Bash launcher runs. `None`: `bash` from the search path.
    pub bash: Option<PathBuf>,
}

/// Every open pane.
#[derive(Default)]
pub struct Terminals {
    config: Config,
    sessions: Mutex<HashMap<String, Arc<Session>>>,
}

impl std::fmt::Debug for Terminals {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("Terminals").finish_non_exhaustive()
    }
}

impl Terminals {
    pub fn new() -> Terminals {
        Terminals::default()
    }

    pub fn with(config: Config) -> Terminals {
        Terminals {
            config,
            sessions: Mutex::default(),
        }
    }

    /// The methods [`Terminals::handle`] and [`Terminals::open`] answer between them.
    pub const METHODS: [&'static str; 5] = [
        "terminal.open",
        "terminal.input",
        "terminal.resize",
        "terminal.close",
        "terminal.ack",
    ];

    fn sessions(&self) -> MutexGuard<'_, HashMap<String, Arc<Session>>> {
        self.sessions
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// `terminal.open`: starts a pane and returns `{"id", "pid", "machine"}`. Reopening an ID
    /// closes the pane that had it first.
    pub fn open(&self, params: &Map<String, Value>, sink: Sink) -> BridgeResult {
        let id = pane_id(params)?;
        let previous = self.sessions().remove(id);
        if let Some(previous) = previous {
            previous.close();
        }
        let launch = launch::plan(params, &self.config)?;
        let (cols, rows) = size(params);
        let mut sessions = self.sessions();
        if sessions
            .values()
            .filter(|session| !session.closed())
            .count()
            >= MAX_SESSIONS
        {
            return Err(BridgeError::from(TOO_MANY));
        }
        let session = Session::start(&launch, cols, rows, sink)?;
        let pid = session.pid;
        sessions.insert(id.to_string(), Arc::new(session));
        Ok(json!({"id": id, "pid": pid, "machine": launch.machine}))
    }

    /// `terminal.input`, `terminal.resize`, `terminal.close` and `terminal.ack`.
    pub fn handle(&self, method: &str, params: &Map<String, Value>) -> BridgeResult {
        let id = pane_id(params)?;
        if method == "terminal.open" {
            return Err(BridgeError::from(NO_CHANNEL));
        }
        let session = self.sessions().get(id).cloned();
        let Some(session) = session else {
            // An acknowledgement for a pane that has just been closed is not an error.
            return if method == "terminal.ack" {
                Ok(Value::Bool(true))
            } else {
                Err(BridgeError::from(NOT_OPEN))
            };
        };
        match method {
            "terminal.input" => session.write(&input(params)?)?,
            "terminal.resize" => {
                let (cols, rows) = size(params);
                session.resize(cols, rows);
            }
            "terminal.ack" => {
                session.acknowledge(params.get("bytes").and_then(Value::as_u64).unwrap_or(0))
            }
            "terminal.close" => {
                session.close();
                self.sessions().remove(id);
            }
            _ => return Err(BridgeError::from(crate::gate::UNSUPPORTED)),
        }
        Ok(Value::Bool(true))
    }

    /// Closes every pane and returns when all their processes are gone. Panes close side by
    /// side, so quitting with many panes takes as long as the slowest one.
    pub fn close_all(&self) {
        let sessions: Vec<Arc<Session>> = self
            .sessions()
            .drain()
            .map(|(_, session)| session)
            .collect();
        std::thread::scope(|scope| {
            for session in &sessions {
                scope.spawn(move || session.close());
            }
        });
    }
}

impl Drop for Terminals {
    fn drop(&mut self) {
        self.close_all();
    }
}

/// `[A-Za-z0-9_-]{1,80}`
fn pane_id(params: &Map<String, Value>) -> Result<&str, BridgeError> {
    match params.get("id") {
        Some(Value::String(id))
            if (1..=80).contains(&id.len())
                && id.chars().all(|character| {
                    character.is_ascii_alphanumeric() || "_-".contains(character)
                }) =>
        {
            Ok(id)
        }
        _ => Err(BridgeError::from(INVALID_ID)),
    }
}

/// Columns and rows, clamped to 10 to 400 and 3 to 200 as the Python bridge clamps them.
fn size(params: &Map<String, Value>) -> (u16, u16) {
    let whole = |name: &str, default: f64, low: f64, high: f64| {
        let value = params.get(name).and_then(Value::as_f64).unwrap_or(default);
        let value = if value.is_finite() {
            value.trunc()
        } else {
            default
        };
        value.clamp(low, high) as u16
    };
    (
        whole("cols", 80.0, 10.0, 400.0),
        whole("rows", 24.0, 3.0, 200.0),
    )
}

/// The bytes of a `terminal.input` request: text as UTF-8, or base64 when `binary` is true.
fn input(params: &Map<String, Value>) -> Result<Vec<u8>, BridgeError> {
    let data = match params.get("data") {
        None => "",
        Some(Value::String(data)) if data.chars().count() <= INPUT_LIMIT => data.as_str(),
        Some(_) => return Err(BridgeError::from(INPUT_TOO_LARGE)),
    };
    if params.get("binary") == Some(&Value::Bool(true)) {
        base64::engine::general_purpose::STANDARD
            .decode(data)
            .map_err(|_| BridgeError::from(INPUT_INVALID))
    } else {
        Ok(data.as_bytes().to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(value: Value) -> Map<String, Value> {
        value.as_object().cloned().unwrap()
    }

    #[test]
    fn sizes_are_clamped_and_default() {
        assert_eq!(size(&params(json!({}))), (80, 24));
        assert_eq!(size(&params(json!({"cols": 117, "rows": 31}))), (117, 31));
        assert_eq!(size(&params(json!({"cols": 1, "rows": 1}))), (10, 3));
        assert_eq!(size(&params(json!({"cols": 1e9, "rows": -4}))), (400, 3));
        assert_eq!(
            size(&params(json!({"cols": 120.9, "rows": "x"}))),
            (120, 24)
        );
    }

    #[test]
    fn pane_ids_follow_the_pattern() {
        for id in ["a", "pane_1-b", &"x".repeat(80)] {
            assert_eq!(pane_id(&params(json!({"id": id}))), Ok(id));
        }
        for id in [
            json!(""),
            json!("a b"),
            json!("a/b"),
            json!("é"),
            json!(1),
            json!(null),
        ] {
            assert!(pane_id(&params(json!({"id": id}))).is_err());
        }
        assert!(pane_id(&params(json!({}))).is_err());
        assert!(pane_id(&params(json!({"id": "x".repeat(81)}))).is_err());
    }

    #[test]
    fn input_is_text_or_base64() {
        assert_eq!(
            input(&params(json!({"data": "é\r"}))).unwrap(),
            "é\r".as_bytes()
        );
        assert_eq!(input(&params(json!({}))).unwrap(), b"");
        assert_eq!(
            input(&params(json!({"data": "AAEC/w==", "binary": true}))).unwrap(),
            [0, 1, 2, 255]
        );
        // `binary` must be exactly true, as in the Python bridge.
        assert_eq!(
            input(&params(json!({"data": "AAEC", "binary": "yes"}))).unwrap(),
            b"AAEC"
        );
    }
}
