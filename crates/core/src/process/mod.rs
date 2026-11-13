//! One way to run an installed command-line tool that cannot hang or leave processes behind
//! (issue #73), and one way to find those tools when the app is started from a desktop icon.
//!
//! [`run`] starts a program directly, never through a shell, and always ends: when the program
//! exits, when the timeout passes, when the caller cancels, or when the output grows past its
//! cap. On every one of those paths, and if the caller's callback panics, the whole process tree
//! is killed before `run` returns. The child is the leader of a new session and process group on
//! Unix and is placed in a kill-on-close job object on Windows before it runs any code.
//!
//! Known limit: on Unix a program that deliberately moves itself to another process group or
//! session leaves the group and is not killed. Ordinary command-line tools and their helpers do
//! not do this.
//!
//! [`ShellEnv`] captures the user's login-shell environment once at startup, because an app
//! started from Finder or a desktop launcher does not inherit it, and [`Search`] finds a tool on
//! that `PATH`, then in known install locations, unless the user set an explicit path.

mod env;
mod find;
#[cfg(unix)]
#[path = "unix.rs"]
mod platform;
#[cfg(windows)]
#[path = "windows.rs"]
mod platform;

pub use env::{EnvSource, Fallback, ShellEnv, StartupEnv};
pub use find::{not_installed, resolve, Search};

use crate::protocol::BridgeError;
use std::fmt;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, RecvTimeoutError, SyncSender};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

/// How often the watchdog looks at the cancel flag.
const POLL: Duration = Duration::from_millis(20);
/// How long output may keep arriving after the program has exited or been killed. A helper the
/// program left behind can hold the pipes open; it is killed when this runs out.
const DRAIN: Duration = Duration::from_millis(250);
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const DEFAULT_MAX_OUTPUT: usize = 1024 * 1024;

/// A flag the caller sets to stop a run from another thread.
#[derive(Clone, Debug, Default)]
pub struct Cancel(Arc<AtomicBool>);

impl Cancel {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// What to run and its limits.
#[derive(Clone, Debug)]
pub struct Run {
    /// A path, or a bare name for the operating system to look up. Prefer a path from [`Search`].
    pub program: PathBuf,
    /// Passed to the program exactly as given. Nothing goes through a shell.
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    /// Variables to add to, or replace in, the child's environment.
    pub env: Vec<(String, String)>,
    /// Start from an empty environment instead of this process's, so only `env` is passed.
    pub clear_env: bool,
    /// Written to the program's standard input, which is then closed. `None` gives the program
    /// end of input at once.
    pub stdin: Option<Vec<u8>>,
    pub timeout: Duration,
    /// The most bytes of standard output and standard error together before the run is stopped.
    pub max_output: usize,
    pub cancel: Option<Cancel>,
}

impl Run {
    /// A request with no arguments, a 30 second timeout and a 1 MiB output cap.
    pub fn new(program: impl Into<PathBuf>) -> Self {
        Self {
            program: program.into(),
            args: Vec::new(),
            cwd: None,
            env: Vec::new(),
            clear_env: false,
            stdin: None,
            timeout: DEFAULT_TIMEOUT,
            max_output: DEFAULT_MAX_OUTPUT,
            cancel: None,
        }
    }
}

/// What a finished program produced. A non-zero status is a result, not an error.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Output {
    /// The exit code, or `None` when the program was ended by a signal.
    pub status: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

/// Why a run did not finish. `Display` is a plain sentence for the UI; the detail in `Io` is for
/// logs and is never shown.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RunError {
    NotFound,
    Timeout,
    Cancelled,
    TooLarge,
    Io(String),
}

impl fmt::Display for RunError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::NotFound => "That program is not installed or could not be found.",
            Self::Timeout => "The command took too long and was stopped.",
            Self::Cancelled => "The command was cancelled.",
            Self::TooLarge => "The command produced too much output and was stopped.",
            Self::Io(_) => "The command could not be run.",
        })
    }
}

impl std::error::Error for RunError {}

impl From<RunError> for BridgeError {
    fn from(error: RunError) -> Self {
        BridgeError(error.to_string())
    }
}

enum Message {
    Stdout(Vec<u8>),
    Stderr(Vec<u8>),
    Closed,
}

/// What the watchdog and the supervising thread share.
struct Shared {
    reason: Mutex<Option<RunError>>,
    finished: Mutex<bool>,
    wake: Condvar,
}

impl Shared {
    /// Records why the run is being stopped. The first reason wins.
    fn stop(&self, reason: RunError) {
        let mut slot = lock(&self.reason);
        if slot.is_none() {
            *slot = Some(reason);
        }
    }

    fn reason(&self) -> Option<RunError> {
        lock(&self.reason).clone()
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Owns the child for the length of the run. Dropping it, on any path including a panic in the
/// caller's callback, kills the whole tree, collects the child and stops the watchdog.
struct Owned {
    child: Child,
    tree: platform::Tree,
    shared: Arc<Shared>,
    status: Option<Option<i32>>,
}

impl Owned {
    fn retire(&mut self) -> Option<i32> {
        if self.status.is_none() {
            self.status = Some(self.tree.retire(&mut self.child));
            *lock(&self.shared.finished) = true;
            self.shared.wake.notify_all();
        }
        self.status.flatten()
    }
}

impl Drop for Owned {
    fn drop(&mut self) {
        self.retire();
    }
}

/// Runs a program to completion within its limits. `on_line` receives each complete line of
/// standard output as it arrives, without its line ending; an unterminated last line is only in
/// the returned output. The callback runs on the calling thread and should return quickly: the
/// timeout still kills the program while a callback is running, but `run` cannot return until
/// the callback does.
pub fn run(run: Run, mut on_line: Option<&mut dyn FnMut(&str)>) -> Result<Output, RunError> {
    let cancel = run.cancel.clone().unwrap_or_default();
    if cancel.is_cancelled() {
        return Err(RunError::Cancelled);
    }
    if let Some(cwd) = &run.cwd {
        if !cwd.is_dir() {
            return Err(RunError::Io("the working directory does not exist".into()));
        }
    }
    let started = Instant::now();
    let mut command = Command::new(&run.program);
    command.args(&run.args);
    if run.clear_env {
        command.env_clear();
    }
    command.envs(run.env.iter().map(|(name, value)| (name, value)));
    if let Some(cwd) = &run.cwd {
        command.current_dir(cwd);
    }
    command.stdin(if run.stdin.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    });
    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    let (child, tree) = platform::spawn(&mut command).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => RunError::NotFound,
        _ => RunError::Io(error.to_string()),
    })?;
    let shared = Arc::new(Shared {
        reason: Mutex::new(None),
        finished: Mutex::new(false),
        wake: Condvar::new(),
    });
    let mut owned = Owned {
        child,
        tree,
        shared: shared.clone(),
        status: None,
    };

    watch(
        shared.clone(),
        owned.tree.clone(),
        cancel,
        started,
        run.timeout,
    );
    let (sender, receiver) = sync_channel::<Message>(16);
    if let Some(stdout) = owned.child.stdout.take() {
        pump(stdout, sender.clone(), Message::Stdout);
    }
    if let Some(stderr) = owned.child.stderr.take() {
        pump(stderr, sender.clone(), Message::Stderr);
    }
    drop(sender);
    if let (Some(mut stdin), Some(input)) = (owned.child.stdin.take(), run.stdin) {
        // A program that never reads its input must not block the run, so this has its own
        // thread. It ends when the input is written or the program is gone.
        std::thread::spawn(move || {
            let _ = stdin.write_all(&input);
        });
    }

    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut delivered = 0; // bytes of stdout already passed to on_line
    let mut total = 0usize;
    let mut open = 2; // output streams that have not closed yet
    let mut ended: Option<Instant> = None; // when the program was first seen exited or stopped
    let mut swept = false; // whether the tree has been killed
    let mut quiet: Option<Instant> = None; // since when no output has arrived
    let mut wait = Duration::from_micros(200);

    let result = loop {
        let reason = shared.reason();
        if reason.is_some() || owned.tree.exited() {
            let since = ended.get_or_insert_with(Instant::now).elapsed();
            if open == 0 {
                break reason;
            }
            if !swept && (reason.is_some() || since > DRAIN) {
                // The program is gone but something it started still holds the pipes.
                owned.tree.kill();
                swept = true;
                quiet = None;
            }
            // After the kill nothing in the tree can write, so the pipes close once they are
            // read out. Output still arriving is never cut off; only silence ends the wait, and
            // it means something outside the tree holds the pipes.
            if swept && quiet.is_some_and(|since| since.elapsed() > DRAIN) {
                break reason;
            }
        }
        let tick = if ended.is_some() || open == 0 {
            wait = (wait * 2).min(POLL);
            wait
        } else {
            POLL
        };
        let (bytes, to_stdout) = match receiver.recv_timeout(tick) {
            Ok(Message::Stdout(bytes)) => (bytes, true),
            Ok(Message::Stderr(bytes)) => (bytes, false),
            Ok(Message::Closed) => {
                open -= 1;
                quiet = None;
                continue;
            }
            Err(RecvTimeoutError::Timeout) => {
                quiet.get_or_insert_with(Instant::now);
                continue;
            }
            Err(RecvTimeoutError::Disconnected) => {
                open = 0;
                continue;
            }
        };
        quiet = None;
        if reason.is_some() {
            continue; // the run is being stopped; what arrives now is discarded
        }
        total = total.saturating_add(bytes.len());
        if total > run.max_output {
            shared.stop(RunError::TooLarge);
            owned.tree.kill();
            continue;
        }
        if !to_stdout {
            stderr.extend_from_slice(&bytes);
            continue;
        }
        stdout.extend_from_slice(&bytes);
        if let Some(on_line) = on_line.as_mut() {
            while let Some(end) = stdout[delivered..].iter().position(|byte| *byte == b'\n') {
                let line = &stdout[delivered..delivered + end];
                let line = line.strip_suffix(b"\r").unwrap_or(line);
                on_line(&String::from_utf8_lossy(line));
                delivered += end + 1;
            }
        }
    };

    let status = owned.retire();
    match result {
        Some(reason) => Err(reason),
        None => Ok(Output {
            status,
            stdout,
            stderr,
        }),
    }
}

/// Copies one of the child's output streams to the supervising thread. The channel is bounded,
/// so a slow consumer slows the child instead of growing memory.
fn pump(
    mut source: impl Read + Send + 'static,
    sender: SyncSender<Message>,
    wrap: fn(Vec<u8>) -> Message,
) {
    std::thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        loop {
            match source.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    if sender.send(wrap(buffer[..count].to_vec())).is_err() {
                        return;
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }
        let _ = sender.send(Message::Closed);
    });
}

/// Kills the tree when the timeout passes or the caller cancels, even while the caller's
/// callback is running. Ends as soon as the run is retired.
fn watch(
    shared: Arc<Shared>,
    tree: platform::Tree,
    cancel: Cancel,
    started: Instant,
    timeout: Duration,
) {
    std::thread::spawn(move || {
        let mut finished = lock(&shared.finished);
        while !*finished {
            let elapsed = started.elapsed();
            let stop = if cancel.is_cancelled() {
                Some(RunError::Cancelled)
            } else if elapsed >= timeout {
                Some(RunError::Timeout)
            } else {
                None
            };
            if let Some(reason) = stop {
                shared.stop(reason);
                tree.kill();
                return;
            }
            let pause = (timeout - elapsed).min(POLL);
            finished = shared
                .wake
                .wait_timeout(finished, pause)
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .0;
        }
    });
}
