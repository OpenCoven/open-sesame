//! One way to run an installed command-line tool that cannot hang or leave processes behind
//! (issue #73), and one way to find those tools when the app is started from a desktop icon.
//!
//! [`run`] starts a program directly, never through a shell, and always ends: when the program
//! exits, when the timeout passes, when the caller cancels, or when the output grows past its
//! cap. On every one of those paths, and if the caller's callback panics, the whole process tree
//! is killed before `run` returns. The child is the leader of a new session and process group on
//! Unix and is placed in a kill-on-close job object on Windows before it runs any code.
//!
//! Some programs the kill does not end, or not at once: one this user may not signal, which on
//! Unix is a program that has changed its user, and one held inside the system, as on a file
//! system that has stopped answering. `run` waits [`GONE`] for a killed child and then returns
//! [`RunError::Timeout`] with that program possibly still running, whatever had stopped the run
//! (issue #97): a caller cannot tell "killed" from "given up", and the sentence for a timeout
//! says the command was stopped. A child given up is handed to a thread that collects it when
//! it ends; until then that thread, the threads reading its output and their pipes stay, so a
//! caller that keeps starting such a program keeps adding to them. Nothing bounds that number.
//!
//! Known limit: on Unix a program that deliberately moves itself to another process group or
//! session leaves the group and is not killed. Ordinary command-line tools and their helpers do
//! not do this. If such a program also keeps the output pipes and keeps writing to them, the run
//! ends with the timeout or the output cap instead of a result, and no later than that.
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

pub use env::{EnvSource, Fallback, ShellEnv, StartupEnv, CAPTURE_TIMEOUT};
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
/// How long a child that has just been killed is waited for. Without a limit, a program this
/// user cannot kill held `run` for as long as it lived (issue #97; the owner chose a limit and
/// a timeout error on 16 November 2026). Five seconds is what a pane gives a killed shell too.
const GONE: Duration = Duration::from_secs(5);
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

/// What to run and its limits. `Debug` shows the sizes of the arguments, environment and input,
/// never their contents, which can hold secrets.
#[derive(Clone)]
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
    /// What the login-shell capture reads from its own pipe counts as well.
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

impl fmt::Debug for Run {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Run")
            .field("program", &self.program)
            .field("args", &self.args.len())
            .field("cwd", &self.cwd)
            .field("env", &self.env.len())
            .field("clear_env", &self.clear_env)
            .field("stdin_bytes", &self.stdin.as_ref().map(Vec::len))
            .field("timeout", &self.timeout)
            .field("max_output", &self.max_output)
            .field("cancel", &self.cancel)
            .finish()
    }
}

/// What a finished program produced. A non-zero status is a result, not an error. `Debug` shows
/// the status and the sizes of the two streams, never the output itself.
#[derive(Clone, PartialEq, Eq)]
pub struct Output {
    /// The exit code, or `None` when the program was ended by a signal.
    pub status: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

impl fmt::Debug for Output {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Output")
            .field("status", &self.status)
            .field("stdout_bytes", &self.stdout.len())
            .field("stderr_bytes", &self.stderr.len())
            .finish()
    }
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
    /// From the extra pipe of a run started with a [`Report`].
    #[cfg(unix)]
    Report(Vec<u8>),
    Closed,
}

/// A third output stream that only what the caller's command line names can write to; see
/// `Report` in `unix.rs`. Windows has no caller that needs one.
#[cfg(unix)]
use platform::Report;
#[cfg(not(unix))]
enum Report {}

/// The flag that ends the reading of a [`Report`]; see `drain` in `unix.rs`. Dropping it sets
/// it, so an early return from the run ends the reading too.
#[cfg(unix)]
#[derive(Default)]
struct Exited(Arc<AtomicBool>);

#[cfg(unix)]
impl Drop for Exited {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

/// Starts one of the run's helper threads. A system that cannot start a thread reports an
/// error here; `std::thread::spawn` would panic instead.
fn start(work: impl FnOnce() + Send + 'static) -> std::io::Result<()> {
    #[cfg(test)]
    if tests::thread_start_fails() {
        return Err(std::io::Error::other("no thread could be started"));
    }
    std::thread::Builder::new().spawn(work).map(|_| ())
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

/// What became of the child when the run let go of it.
#[derive(Clone, Copy)]
enum Left {
    /// It was collected, with this exit code if it had one.
    Collected(Option<i32>),
    /// It was killed and was still there after [`GONE`].
    Running,
}

/// Waits for a child that has just been killed and collects it. `None` when it is still there
/// after [`GONE`]. It looks at the child in steps so that the wait can end without it.
fn collect(child: &mut Child) -> Option<Option<i32>> {
    let started = Instant::now();
    let mut pause = Duration::from_micros(200);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Some(status.code()),
            // Nothing more can be learned about the child, as when `wait` failed here before.
            Err(_) => return Some(None),
            Ok(None) if started.elapsed() >= GONE => return None,
            Ok(None) => {}
        }
        std::thread::sleep(pause);
        pause = (pause * 2).min(POLL);
    }
}

/// Owns the child for the length of the run. Dropping it, on any path including a panic in the
/// caller's callback, kills the whole tree, collects the child and stops the watchdog. A child
/// that the kill does not end is given up after [`GONE`].
struct Owned {
    child: Option<Child>,
    tree: platform::Tree,
    shared: Arc<Shared>,
    left: Left,
}

impl Owned {
    fn retire(&mut self) -> Left {
        let Some(mut child) = self.child.take() else {
            return self.left;
        };
        self.left = match self.tree.retire(&mut child) {
            Some(status) => Left::Collected(status),
            None => {
                // Whenever the program does end, this collects it, so that it does not stay in
                // the process table until the application quits. Where no thread can be
                // started it does stay there.
                let _ = start(move || {
                    let _ = child.wait();
                });
                Left::Running
            }
        };
        *lock(&self.shared.finished) = true;
        self.shared.wake.notify_all();
        self.left
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
pub fn run(run: Run, on_line: Option<&mut dyn FnMut(&str)>) -> Result<Output, RunError> {
    execute(run, on_line, None).map(|(output, _)| output)
}

/// [`run`], with an optional extra output stream whose bytes are returned beside the output.
fn execute(
    run: Run,
    mut on_line: Option<&mut dyn FnMut(&str)>,
    report: Option<Report>,
) -> Result<(Output, Vec<u8>), RunError> {
    let failed = |error: std::io::Error| RunError::Io(error.to_string());
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
    #[cfg(unix)]
    if let Some(report) = &report {
        report.attach(&mut command);
    }

    let (mut child, tree) = platform::spawn(&mut command).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => RunError::NotFound,
        _ => RunError::Io(error.to_string()),
    })?;
    let (child_stdin, child_stdout, child_stderr) =
        (child.stdin.take(), child.stdout.take(), child.stderr.take());
    let shared = Arc::new(Shared {
        reason: Mutex::new(None),
        finished: Mutex::new(false),
        wake: Condvar::new(),
    });
    let mut owned = Owned {
        child: Some(child),
        tree,
        shared: shared.clone(),
        left: Left::Collected(None),
    };

    // From here on an early return drops `owned`, which kills the tree and collects the child.
    // That is what a thread that cannot be started comes to: an error, with nothing left behind.
    watch(
        shared.clone(),
        owned.tree.clone(),
        cancel,
        started,
        run.timeout,
    )
    .map_err(failed)?;
    let (sender, receiver) = sync_channel::<Message>(16);
    let mut open = 0; // output streams that have not closed yet
    if let Some(stdout) = child_stdout {
        pump(stdout, sender.clone(), Message::Stdout).map_err(failed)?;
        open += 1;
    }
    if let Some(stderr) = child_stderr {
        pump(stderr, sender.clone(), Message::Stderr).map_err(failed)?;
        open += 1;
    }
    // Set once the program is seen exited or the run is being stopped, and on every way out of
    // this function, so the thread that reads the report ends within one look (5 ms) of the
    // run. It is not joined. Setting it on the way out is for an early return or a panic in
    // the caller's callback; the capture reaches neither today and no test pins it.
    #[cfg(unix)]
    let exited = Exited::default();
    #[cfg(unix)]
    if let Some(report) = report {
        // The child has its own copy of the writing end by now; this side's is given up here.
        let reader = report.into_reader();
        let (sender, exited) = (sender.clone(), exited.0.clone());
        start(move || {
            platform::drain(reader, &exited, |bytes| {
                sender.send(Message::Report(bytes)).is_ok()
            });
            let _ = sender.send(Message::Closed);
        })
        .map_err(failed)?;
        open += 1;
    }
    #[cfg(not(unix))]
    let _ = report;
    drop(sender);
    if let (Some(mut stdin), Some(input)) = (child_stdin, run.stdin) {
        // A program that never reads its input must not block the run, so this has its own
        // thread. It ends when the input is written or the program is gone.
        start(move || {
            let _ = stdin.write_all(&input);
        })
        .map_err(failed)?;
    }

    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut reported = Vec::new();
    let mut delivered = 0; // bytes of stdout already passed to on_line
    let mut total = 0usize;
    let mut ended: Option<Instant> = None; // when the program was first seen exited or stopped
    let mut swept = false; // whether the tree has been killed
    let mut quiet: Option<Instant> = None; // since when no output has arrived
    let mut stopped: Option<Instant> = None; // when a reason to stop was first seen
    let mut wait = Duration::from_micros(200);

    let result = loop {
        let reason = shared.reason();
        if reason.is_some() || owned.tree.exited() {
            // What the program wrote to its report is in the pipe by now. The report is read
            // out and closed without waiting for whatever else still holds its other end.
            #[cfg(unix)]
            exited.0.store(true, Ordering::SeqCst);
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
            // A stopped run discards what arrives, so it does not wait for silence either:
            // something outside the tree could keep writing for as long as it likes.
            if reason.is_some() && stopped.get_or_insert_with(Instant::now).elapsed() > DRAIN {
                break reason;
            }
        }
        let tick = if ended.is_some() || open == 0 {
            wait = (wait * 2).min(POLL);
            wait
        } else {
            POLL
        };
        let (bytes, stream) = match receiver.recv_timeout(tick) {
            Ok(Message::Stdout(bytes)) => (bytes, 1),
            Ok(Message::Stderr(bytes)) => (bytes, 2),
            #[cfg(unix)]
            Ok(Message::Report(bytes)) => (bytes, 3),
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
                // Every stream is closed and the program is still running. Nothing more will
                // arrive on the channel, so wait here instead of spinning on it.
                open = 0;
                std::thread::sleep(tick);
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
        if stream != 1 {
            let other = if stream == 2 {
                &mut stderr
            } else {
                &mut reported
            };
            other.extend_from_slice(&bytes);
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

    match (owned.retire(), result) {
        // The kill did not end the program in time. The run stops waiting and says it took too
        // long, whatever stopped it first, and the program may still be running.
        (Left::Running, _) => Err(RunError::Timeout),
        (Left::Collected(_), Some(reason)) => Err(reason),
        (Left::Collected(status), None) => Ok((
            Output {
                status,
                stdout,
                stderr,
            },
            reported,
        )),
    }
}

/// Copies one of the child's output streams to the supervising thread. The channel is bounded,
/// so a slow consumer slows the child instead of growing memory.
fn pump(
    mut source: impl Read + Send + 'static,
    sender: SyncSender<Message>,
    wrap: fn(Vec<u8>) -> Message,
) -> std::io::Result<()> {
    start(move || {
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
    })
}

/// Kills the tree when the timeout passes or the caller cancels, even while the caller's
/// callback is running. Ends as soon as the run is retired.
fn watch(
    shared: Arc<Shared>,
    tree: platform::Tree,
    cancel: Cancel,
    started: Instant,
    timeout: Duration,
) -> std::io::Result<()> {
    start(move || {
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
    })
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    use super::*;
    use std::cell::Cell;

    thread_local! {
        /// How many more helper threads the run on this thread may start before one fails.
        static THREADS_LEFT: Cell<Option<usize>> = const { Cell::new(None) };
    }

    #[cfg(unix)]
    thread_local! {
        /// Whether the kill is left out for a program started on this thread.
        static KILL_DOES_NOTHING: Cell<bool> = const { Cell::new(false) };
    }

    /// Whether a program started on this thread is to outlive the kill. See `Tree::deaf`.
    #[cfg(unix)]
    pub(super) fn kill_does_nothing() -> bool {
        KILL_DOES_NOTHING.with(Cell::get)
    }

    /// A program that outlives the kill does not hold the run for as long as it lives: after
    /// `GONE` the run stops waiting and says it took too long, with the program still running
    /// (issue #97). It says so whatever had stopped the run, a cancel included, as decided. A
    /// test cannot start a program its user may not signal, so the kill is left out for these
    /// runs; the wait, the give-up and the later collection are the real code. The two runs
    /// are side by side, so the test takes one wait and not two.
    #[cfg(unix)]
    #[test]
    fn a_program_that_outlives_the_kill_is_given_up_after_a_limit() {
        // What one run did: its result, how long it took, and whether the program was still
        // there afterwards and was collected once it had been ended from here.
        fn outlive(cancel_after: Option<Duration>) -> (Result<(), RunError>, Duration, bool, bool) {
            // SAFETY (for both): `kill` takes plain integers; signal 0 only asks whether the
            // process exists, and it exists until it has been collected.
            let exists = |pid: libc::pid_t| unsafe { libc::kill(pid, 0) } == 0;
            let end = |pid: libc::pid_t| unsafe { libc::kill(pid, libc::SIGKILL) };
            let dir = tempfile::tempdir().unwrap();
            let pid_file = dir.path().join("pid");
            let mut request = Run::new("/bin/sh");
            // `exec`, so the number written is the program the run waits for. It ends by
            // itself after a minute if this test dies before it can end it.
            request.args = vec![
                "-c".into(),
                format!("echo $$ > '{}'; exec sleep 60", pid_file.display()),
            ];
            request.timeout = match cancel_after {
                Some(_) => Duration::from_secs(30),
                None => Duration::from_millis(500),
            };
            if let Some(after) = cancel_after {
                let cancel = Cancel::default();
                request.cancel = Some(cancel.clone());
                std::thread::spawn(move || {
                    std::thread::sleep(after);
                    cancel.cancel();
                });
            }
            KILL_DOES_NOTHING.with(|flag| flag.set(true));
            let started = Instant::now();
            let result = execute(request, None, None).map(|_| ());
            let took = started.elapsed();
            KILL_DOES_NOTHING.with(|flag| flag.set(false));

            let deadline = Instant::now() + Duration::from_secs(10);
            let pid = loop {
                let written = std::fs::read_to_string(&pid_file).unwrap_or_default();
                if let Ok(pid) = written.trim().parse::<libc::pid_t>() {
                    break pid;
                }
                assert!(Instant::now() < deadline, "the program never wrote its ID");
                std::thread::sleep(Duration::from_millis(20));
            };
            let outlived = exists(pid);
            end(pid);
            // The run handed the program to a thread that collects it once it ends.
            let collected = loop {
                if !exists(pid) {
                    break true;
                }
                if Instant::now() >= deadline {
                    break false;
                }
                std::thread::sleep(Duration::from_millis(20));
            };
            (result, took, outlived, collected)
        }
        let cancelled = std::thread::spawn(|| outlive(Some(Duration::from_millis(500))));
        let timed_out = outlive(None);
        let cancelled = cancelled.join().unwrap();
        for (what, (result, took, outlived, collected)) in
            [("timed out", timed_out), ("cancelled", cancelled)]
        {
            assert!(
                matches!(result, Err(RunError::Timeout)),
                "{what}: {result:?}"
            );
            assert!(
                outlived,
                "{what}: the program was gone, so the limit was not what ended the wait"
            );
            assert!(
                took >= GONE && took < GONE + Duration::from_secs(5),
                "{what}: the run returned after {took:?}"
            );
            assert!(
                collected,
                "{what}: the program was never collected after it ended"
            );
        }
    }

    /// Whether the next helper thread of a run started on this thread should fail to start.
    pub(super) fn thread_start_fails() -> bool {
        THREADS_LEFT.with(|left| match left.get() {
            Some(0) => true,
            Some(more) => {
                left.set(Some(more - 1));
                false
            }
            None => false,
        })
    }

    /// A system that cannot start a thread makes the run an error, not a panic, and the
    /// program that was already started is killed (issue #97). A run starts up to five
    /// threads: the watchdog, one for each output stream, one for the report when it has one,
    /// and one that writes the input.
    #[cfg(unix)]
    #[test]
    fn a_thread_that_cannot_be_started_is_an_error_and_leaves_nothing_running() {
        // With input the fifth thread writes it. Without input the report's thread is the
        // last one, which is the only case that shows its failure is not passed over: a
        // failure to start stays on, so with input the next thread would report it instead.
        let cases = (0..5).map(|allowed| (allowed, true)).chain([(3, false)]);
        for (allowed, with_input) in cases {
            let dir = tempfile::tempdir().unwrap();
            let pid_file = dir.path().join("pid");
            let mut request = Run::new("/bin/sh");
            request.args = vec![
                "-c".into(),
                format!("echo $$ > '{}'; sleep 30", pid_file.display()),
            ];
            request.stdin = with_input.then(|| b"unused".to_vec());
            request.timeout = Duration::from_secs(20);
            THREADS_LEFT.with(|left| left.set(Some(allowed)));
            let report = Report::new();
            assert!(report.is_some(), "no pipe for the report");
            let result = execute(request, None, report).map(|_| ());
            THREADS_LEFT.with(|left| left.set(None));
            assert!(
                matches!(result, Err(RunError::Io(_))),
                "with {allowed} threads started, input {with_input}: {result:?}"
            );
            // The program either never got as far as writing its process ID or is gone. A
            // shell killed between creating the file and writing to it leaves the file empty,
            // which a Linux run showed; that too is "never got as far".
            std::thread::sleep(Duration::from_millis(300));
            let written = std::fs::read_to_string(&pid_file).unwrap_or_default();
            if let Ok(pid) = written.trim().parse::<libc::pid_t>() {
                // SAFETY: signal 0 sends nothing; it only reports whether the process exists.
                let alive = unsafe { libc::kill(pid, 0) } == 0;
                assert!(!alive, "with {allowed} threads started: {pid} is running");
            }
        }
    }
}
