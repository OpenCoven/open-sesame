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

mod exit;
mod launch;
mod session;
mod tree;

use crate::protocol::{BridgeError, BridgeResult};
use base64::Engine;
use serde_json::{json, Map, Value};
use session::Session;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::JoinHandle;

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
    /// The pane has ended. What has become of its processes by then differs by system and is
    /// said in `tree.rs`, at its top and at `Tree::end`; on Windows a killed shell that did
    /// not end within five seconds may still be there.
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
    /// Threads still closing panes for [`Terminals::close_all_detached`].
    closing: Mutex<Vec<JoinHandle<()>>>,
    /// Set by [`Terminals::shut_down`]: no pane opens from then on.
    quitting: AtomicBool,
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
            closing: Mutex::default(),
            quitting: AtomicBool::new(false),
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
    /// closes the pane that had it first, also when two requests for one ID arrive together.
    pub fn open(&self, params: &Map<String, Value>, sink: Sink) -> BridgeResult {
        let id = pane_id(params)?;
        let previous = self.sessions().remove(id);
        if let Some(previous) = previous {
            previous.close();
        }
        let launch = launch::plan(params, &self.config)?;
        let (cols, rows) = size(params);
        let mut sessions = self.sessions();
        // Read with the panes locked: `shut_down` sets this before it takes them, so a pane is
        // either refused here or already among the panes it is about to close.
        if self.quitting.load(Ordering::SeqCst) {
            return Err(BridgeError::from(crate::handler::SHUTTING_DOWN));
        }
        if sessions
            .values()
            .filter(|session| !session.closed())
            .count()
            >= MAX_SESSIONS
        {
            return Err(BridgeError::from(TOO_MANY));
        }
        // The panes stay locked while the shell starts, which keeps the count above true and
        // makes every other request for any pane wait: some milliseconds for a start, about
        // 75 ms more when no pseudo-terminal can be opened and every further try fails too, and
        // for as long as discarding the shell takes when one was started and cannot be taken
        // over (on Windows that has the limit and the caveat said at `ENDING` in `tree.rs`).
        let session = Session::start(&launch, cols, rows, sink)?;
        let pid = session.pid;
        let displaced = sessions.insert(id.to_string(), Arc::new(session));
        drop(sessions);
        // Another open of the same ID got in after this one looked for a pane to replace. The
        // later of the two keeps the ID, and the earlier pane is closed like any replaced pane.
        if let Some(displaced) = displaced {
            displaced.close();
        }
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
                self.forget(id, &session);
            }
            _ => return Err(BridgeError::from(crate::gate::UNSUPPORTED)),
        }
        Ok(Value::Bool(true))
    }

    /// Takes a closed pane off the list, unless a `terminal.open` of the same ID has put another
    /// pane there since: that one is running, and the list is the only way to close it.
    fn forget(&self, id: &str, closed: &Arc<Session>) {
        let mut sessions = self.sessions();
        if sessions
            .get(id)
            .is_some_and(|listed| Arc::ptr_eq(listed, closed))
        {
            sessions.remove(id);
        }
    }

    /// Closes every pane, those that [`Terminals::close_all_detached`] is still closing
    /// included, and returns when every pane's `Session::close` has returned; what that says
    /// about a pane's processes differs by system and is said there. Panes close side by
    /// side, so quitting with many panes takes as long as the slowest one.
    pub fn close_all(&self) {
        close_side_by_side(&self.take_all());
        let closing: Vec<JoinHandle<()>> = self.closing().drain(..).collect();
        for thread in closing {
            let _ = thread.join();
        }
    }

    /// Closes every pane without waiting for their processes to go: the panes are off the list
    /// when this returns, and another thread ends them. For the application's window thread,
    /// when the page that opened the panes has been replaced and nothing can reach them
    /// (issue #112). Quit still waits for them, through [`Terminals::close_all`].
    ///
    /// The one thing this does wait for is the pane list, which a `terminal.open` holds while
    /// it starts its shell: 12 ms at the longest in a measurement on a Mac with another thread
    /// opening panes throughout, and under a tenth of a millisecond otherwise. An open that
    /// cannot get a pseudo-terminal holds the list about 75 ms longer, for its further tries,
    /// and one whose shell was started and cannot be taken over holds it for as long as
    /// discarding that shell takes (see the comment in `open`).
    pub fn close_all_detached(&self) {
        // Held from before the panes leave the list until the thread that closes them is
        // recorded, so `close_all` on another thread cannot look for threads to wait for in
        // between and return while these panes still run.
        let mut closing = self.closing();
        let sessions = self.take_all();
        if sessions.is_empty() {
            return;
        }
        let for_thread = sessions.clone();
        let thread = std::thread::Builder::new().spawn(move || close_side_by_side(&for_thread));
        match thread {
            Ok(thread) => {
                closing.retain(|thread| !thread.is_finished());
                closing.push(thread);
            }
            // No thread to hand them to: close them here, late rather than never, and one
            // after another, because closing them side by side needs threads too.
            Err(_) => sessions.iter().for_each(|session| session.close()),
        }
    }

    fn take_all(&self) -> Vec<Arc<Session>> {
        self.sessions()
            .drain()
            .map(|(_, session)| session)
            .collect()
    }

    fn closing(&self) -> MutexGuard<'_, Vec<JoinHandle<()>>> {
        self.closing
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Closes the panes side by side. A pane no thread can be started for is closed here, on the
/// calling thread: `Scope::spawn` panics in that case, which would leave that pane and every
/// pane after it running with nothing left that could close them.
fn close_side_by_side(sessions: &[Arc<Session>]) {
    std::thread::scope(|scope| {
        for session in sessions {
            let started = std::thread::Builder::new().spawn_scoped(scope, move || session.close());
            if started.is_err() {
                session.close();
            }
        }
    });
}

impl Terminals {
    /// Quit: closes every pane as [`Terminals::close_all`] does and refuses every later
    /// `terminal.open`. The application opens panes here directly, not through `Core::handle`,
    /// so without this a request that arrives while the app is quitting would start a shell
    /// after the last thing that could close it has run.
    pub fn shut_down(&self) {
        self.quitting.store(true, Ordering::SeqCst);
        self.close_all();
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

    /// `terminal.close` closes a pane and then takes it off the list. A `terminal.open` of the
    /// same ID that lands between the two must stay on the list, or nothing can close its shell
    /// (issue #112). The steps of the close are taken by hand here so the open lands exactly
    /// between them.
    #[cfg(unix)]
    #[test]
    fn closing_a_pane_does_not_forget_the_one_that_replaced_it() {
        let terminals = Terminals::with(Config {
            shell: Some(PathBuf::from("/bin/sh")),
            ..Config::default()
        });
        let request = params(json!({"id": "main", "mode": "local"}));
        let nowhere: Sink = Arc::new(|_| {});
        terminals.open(&request, Arc::clone(&nowhere)).unwrap();
        let first = terminals.sessions().get("main").cloned().unwrap();
        first.close();
        let second = terminals.open(&request, nowhere).unwrap();
        terminals.forget("main", &first);
        let listed = terminals.sessions().get("main").cloned();
        let listed = listed.expect("the pane opened during the close was taken off the list");
        assert_eq!(u64::from(listed.pid), second["pid"].as_u64().unwrap());
        assert!(!listed.closed());
        terminals.close_all();
        assert!(listed.closed());
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
