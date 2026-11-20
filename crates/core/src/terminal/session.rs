//! One pane: a program on a pseudo-terminal, its output stream and its process tree.
//!
//! Output is read by one thread and sent by another. The reader fills a bounded buffer; the
//! sender waits a few milliseconds for more, so a burst becomes a few large messages instead of
//! thousands of small ones, and stops sending while the terminal emulator's acknowledgements are
//! more than [`HIGH_WATER`] bytes behind, until they are within [`LOW_WATER`]. While the sender
//! is stopped the buffer fills, the reader stops reading, the pseudo-terminal fills, and the
//! program blocks on its own write: nothing is dropped and memory stays bounded.
//!
//! Input is typed by a third thread from a bounded queue, so a request to send input returns at
//! once even when the program is not reading. On macOS it is typed in small pieces with a pause
//! between them: see [`Pace`].

use super::exit::ShellExit;
use super::launch::Launch;
use super::tree::Tree;
use super::{Output, Sink, HIGH_WATER, LOW_WATER};
use crate::protocol::BridgeError;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

/// The most bytes one message carries.
const BATCH_BYTES: usize = 64 * 1024;
/// How long the sender waits for a batch to grow before it sends what there is.
const BATCH_WINDOW: Duration = Duration::from_millis(4);
/// How much output may wait in memory between the reader and the sender.
const BUFFER_BYTES: usize = 256 * 1024;
const READ_BYTES: usize = 16 * 1024;
/// How much input may wait for a program that is not reading before more is refused.
const INPUT_BACKLOG: usize = 1024 * 1024;
/// How input is typed: at most this many bytes at once, never past the end of a line when
/// `by_line` is set, and with this pause after each piece.
///
/// On macOS a shell that edits lines (`sh`, `bash`) switches the terminal between raw and line
/// mode at the end of every line, and input that is already waiting in the terminal driver when
/// it does so can come out damaged: a paste of a few kilobytes arrives with characters replaced
/// and lines repeated. So input there is typed a line at a time with a pause for the shell to
/// take each line. Measured on macOS 27.2 with a 42 KB paste into `sh`: all at once, damaged
/// almost every time; 1024 bytes every 15 ms, 2 of 20 damaged; 256 bytes every 2 ms, 1 of 29;
/// a line at a time with 0.2 ms, 5 of 30; a line at a time with 2 ms, 0 of 80. This is a
/// measurement, not a guarantee, and it costs speed: about 400 lines a second. Linux and
/// Windows hold the writer back instead of damaging input, so there a request is written whole.
struct Pace {
    piece: usize,
    by_line: bool,
    pause: Duration,
}
#[cfg(target_os = "macos")]
const PACE: Pace = Pace {
    piece: 256,
    by_line: true,
    pause: Duration::from_millis(2),
};
#[cfg(not(target_os = "macos"))]
const PACE: Pace = Pace {
    piece: 64 * 1024,
    by_line: false,
    pause: Duration::ZERO,
};

pub(super) const COULD_NOT_START: &str = "Open Sesame could not start the shell.";
pub(super) const ENDED: &str = "This shell has ended. Reopen the pane to reconnect.";
pub(super) const STREAM_ENDED: &str = "Terminal stream ended.";
pub(super) const NOT_READING: &str =
    "This shell is not reading its input. Wait for it, or close the pane.";

/// The reply for a pane that could not be started. The page gets one sentence whatever went
/// wrong. A development build also says on standard error which step failed and why, as the
/// system's error number or its own words for it, and nothing else: no path, argument or
/// environment value. Without that, a start that fails once on a busy machine cannot be
/// explained afterwards (issue #112).
fn could_not_start(step: &str, why: String) -> BridgeError {
    if cfg!(debug_assertions) {
        eprintln!("open-sesame: no shell: {step} failed ({why})");
    }
    BridgeError::from(COULD_NOT_START)
}

fn number(system_error: Option<i32>) -> String {
    match system_error {
        Some(code) => format!("system error {code}"),
        None => "no system error number".to_string(),
    }
}

/// The operating system's error number behind a `portable-pty` error, when it kept one. The
/// error's text is not used: it can name the program and the folder.
fn system_error<E: AsRef<dyn std::error::Error + Send + Sync + 'static>>(error: &E) -> String {
    let mut cause: Option<&(dyn std::error::Error + 'static)> = Some(error.as_ref());
    while let Some(current) = cause {
        if let Some(io) = current.downcast_ref::<std::io::Error>() {
            return number(io.raw_os_error());
        }
        cause = current.source();
    }
    number(None)
}

/// The pauses before each further try at opening a pseudo-terminal.
///
/// macOS now and then refuses to open one with error -6, which is not an error a program is
/// meant to see: the kernel uses that number for "start this open again" and passes it on when
/// its own tries run out. On macOS 27.2, on a busy machine, it reached this code in 2 of 8
/// runs of this package's tests and in 1 of 12 processes when two copies of the terminal
/// tests ran at once, each time for one pane out of some hundreds, and the page was told the
/// shell could not start (issue #112). A further try a few milliseconds later is what the
/// number asks for. The library keeps the error as text only, so every failure of this step is
/// tried again; one that lasts, such as no pseudo-terminal being left, is reported about 75 ms
/// later than before.
const OPEN_PAUSES: [Duration; 3] = [
    Duration::from_millis(5),
    Duration::from_millis(20),
    Duration::from_millis(50),
];

/// Runs `attempt`, and after a failure once more after each of `pauses`; the last error stands.
fn again<T, E>(pauses: &[Duration], mut attempt: impl FnMut() -> Result<T, E>) -> Result<T, E> {
    let mut result = attempt();
    for pause in pauses {
        if result.is_ok() {
            break;
        }
        std::thread::sleep(*pause);
        result = attempt();
    }
    result
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[derive(Default)]
struct Stream {
    /// Output read from the pseudo-terminal and not yet sent.
    buffer: Vec<u8>,
    /// The pseudo-terminal reported its end.
    eof: bool,
    /// The read failed for a reason other than the program ending.
    failed: bool,
    /// The pane was closed or its program ended: output is discarded from here on.
    closed: bool,
    sent: u64,
    acknowledged: u64,
}

/// Input accepted from the pane and not yet typed into the pseudo-terminal.
#[derive(Default)]
struct Typing {
    pending: VecDeque<u8>,
    /// The pane has ended or the pseudo-terminal refused a write: nothing more is typed.
    closed: bool,
}

struct Shared {
    stream: Mutex<Stream>,
    changed: Condvar,
    typing: Mutex<Typing>,
    typed: Condvar,
    /// Taken by whichever of close and the natural end gets there first.
    child: Mutex<Option<Box<dyn Child + Send + Sync>>>,
    tree: Tree,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    sink: Sink,
}

pub(super) struct Session {
    pub pid: u32,
    shared: Arc<Shared>,
}

impl Session {
    pub(super) fn start(
        launch: &Launch,
        cols: u16,
        rows: u16,
        sink: Sink,
    ) -> Result<Session, BridgeError> {
        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };
        let mut tries = 0;
        let pair = again(&OPEN_PAUSES, || {
            tries += 1;
            native_pty_system().openpty(size)
        })
        // The library keeps this error as text, and the text names no path: it is the
        // system's own description of why no pseudo-terminal could be had.
        .map_err(|error| could_not_start("opening a pseudo-terminal", error.to_string()))?;
        if cfg!(debug_assertions) && tries > 1 {
            eprintln!("open-sesame: opening a pseudo-terminal worked on try {tries}");
        }
        let mut command = CommandBuilder::new(&launch.program);
        command.args(&launch.args);
        command.cwd(&launch.cwd);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        // The shell inherits how this process treats Control+C; see `deliver_control_c`.
        #[cfg(windows)]
        super::tree::deliver_control_c();
        let mut child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| could_not_start("starting the program", system_error(&error)))?;
        // Only the child may hold the other end, or the stream never reports its end.
        drop(pair.slave);
        let adopted = Tree::adopt(child.as_ref()).and_then(|tree| {
            let reader = pair
                .master
                .try_clone_reader()
                .map_err(std::io::Error::other)?;
            let writer = pair.master.take_writer().map_err(std::io::Error::other)?;
            let exit = ShellExit::watch(pair.master.as_ref())?;
            let pid = child
                .process_id()
                .ok_or_else(|| std::io::Error::other("the shell has no process ID"))?;
            Ok((tree, reader, writer, exit, pid))
        });
        let (tree, reader, writer, exit, pid) = match adopted {
            Ok(parts) => parts,
            Err(error) => {
                super::tree::discard(child.as_mut());
                return Err(could_not_start(
                    "taking over the pseudo-terminal",
                    number(error.raw_os_error()),
                ));
            }
        };
        let shared = Arc::new(Shared {
            stream: Mutex::new(Stream::default()),
            changed: Condvar::new(),
            child: Mutex::new(Some(child)),
            typing: Mutex::new(Typing::default()),
            typed: Condvar::new(),
            tree,
            master: Mutex::new(Some(pair.master)),
            sink,
        });
        let for_reader = Arc::clone(&shared);
        std::thread::spawn(move || for_reader.read(reader, exit));
        let for_sender = Arc::clone(&shared);
        std::thread::spawn(move || for_sender.send());
        let for_typist = Arc::clone(&shared);
        std::thread::spawn(move || for_typist.type_in(writer));
        #[cfg(windows)]
        {
            let for_watcher = Arc::clone(&shared);
            std::thread::spawn(move || for_watcher.watch());
        }
        Ok(Session { pid, shared })
    }

    /// Whether the pane was closed or its program has ended.
    pub(super) fn closed(&self) -> bool {
        lock(&self.shared.stream).closed
    }

    /// Queues input for the program and returns at once. The input is typed in order by the
    /// pane's own thread.
    pub(super) fn write(&self, bytes: &[u8]) -> Result<(), BridgeError> {
        if self.closed() {
            return Err(BridgeError::from(ENDED));
        }
        let mut typing = lock(&self.shared.typing);
        if typing.closed {
            return Err(BridgeError::from(ENDED));
        }
        if typing.pending.len() + bytes.len() > INPUT_BACKLOG {
            return Err(BridgeError::from(NOT_READING));
        }
        typing.pending.extend(bytes);
        self.shared.typed.notify_all();
        Ok(())
    }

    pub(super) fn resize(&self, cols: u16, rows: u16) {
        if let Some(master) = lock(&self.shared.master).as_ref() {
            let _ = master.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            });
        }
    }

    /// Records how many bytes of this pane's output the emulator has processed in total.
    pub(super) fn acknowledge(&self, bytes: u64) {
        let mut stream = lock(&self.shared.stream);
        // The count only moves forward and never passes what was sent.
        stream.acknowledged = stream.acknowledged.max(bytes.min(stream.sent));
        self.shared.changed.notify_all();
    }

    /// Ends the pane: kills its whole process tree and collects the shell. Returns when that is
    /// done; on Windows a killed shell is given five seconds to end, and this goes on without
    /// it after that to close the pseudo-console, which on Windows builds before 26100 may
    /// itself wait (see `ENDING` in `tree.rs`). On Unix the top of `tree.rs` and `Tree::end`
    /// say what is ended and what is not. Safe to call more than once and from any thread.
    pub(super) fn close(&self) {
        self.shared.end();
    }
}

impl Shared {
    /// Stops the stream, kills the tree and releases the pseudo-terminal, once.
    fn end(&self) {
        {
            let mut stream = lock(&self.stream);
            stream.closed = true;
            stream.buffer = Vec::new();
            self.changed.notify_all();
        }
        // Holding this lock while the tree ends makes a second caller wait for the first, so
        // every caller returns only after the tree has been ended.
        let mut child = lock(&self.child);
        if let Some(mut child) = child.take() {
            self.tree.end(child.as_mut());
        }
        // After the kill: the typing thread drops the writer when it sees this, and dropping it
        // writes an end-of-input byte, which would block on a full pseudo-terminal whose reader
        // is alive but not reading. A write that was blocked on such a terminal has already
        // been released by the kill.
        {
            let mut typing = lock(&self.typing);
            typing.closed = true;
            typing.pending = VecDeque::new();
            self.typed.notify_all();
        }
        lock(&self.master).take();
    }

    /// Types queued input into the pseudo-terminal, a piece at a time, until the pane ends. The
    /// writer is dropped here, on this thread, and only after [`Shared::end`] or a failed write.
    fn type_in(&self, mut writer: Box<dyn Write + Send>) {
        loop {
            let mut typing = lock(&self.typing);
            while !typing.closed && typing.pending.is_empty() {
                typing = self
                    .typed
                    .wait(typing)
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
            }
            if typing.closed {
                return;
            }
            let mut count = typing.pending.len().min(PACE.piece);
            if PACE.by_line {
                let line_end = |byte: &u8| *byte == b'\r' || *byte == b'\n';
                if let Some(end) = typing.pending.iter().take(count).position(line_end) {
                    count = end + 1;
                }
            }
            let bytes: Vec<u8> = typing.pending.drain(..count).collect();
            drop(typing);
            if writer
                .write_all(&bytes)
                .and_then(|()| writer.flush())
                .is_err()
            {
                // The program has gone; the reader notices and ends the pane.
                let mut typing = lock(&self.typing);
                typing.closed = true;
                typing.pending = VecDeque::new();
                return;
            }
            if !PACE.pause.is_zero() {
                std::thread::sleep(PACE.pause);
            }
        }
    }

    /// Reads the pseudo-terminal until it ends. Keeps reading after the pane is closed so the
    /// program's last writes never block the kill, and discards what it reads then.
    ///
    /// The stream also ends when `exit` says the shell has exited and left something running
    /// that keeps the terminal open (see `exit.rs`). The sender then ends the pane, and this
    /// goes on reading, and discarding, until the kill has closed the terminal.
    fn read(&self, mut reader: Box<dyn Read + Send>, mut exit: ShellExit) {
        let mut chunk = vec![0u8; READ_BYTES];
        loop {
            if exit.ended(&self.tree, || lock(&self.stream).closed) {
                lock(&self.stream).eof = true;
                self.changed.notify_all();
                continue;
            }
            let read = reader.read(&mut chunk);
            let mut stream = lock(&self.stream);
            match read {
                Ok(0) => {
                    stream.eof = true;
                    break;
                }
                Ok(count) => {
                    exit.took(count);
                    let over = |stream: &Stream| stream.closed || stream.eof;
                    while !over(&stream) && stream.buffer.len() >= BUFFER_BYTES {
                        stream = self
                            .changed
                            .wait(stream)
                            .unwrap_or_else(|poisoned| poisoned.into_inner());
                    }
                    if !over(&stream) {
                        stream.buffer.extend_from_slice(&chunk[..count]);
                        self.changed.notify_all();
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                Err(error) => {
                    // A pseudo-terminal whose program has gone reports an input/output error on
                    // Linux and a closed pipe on Windows; anything else is a real failure.
                    let ended = error.kind() == std::io::ErrorKind::BrokenPipe
                        || error.raw_os_error() == Some(END_OF_TERMINAL);
                    stream.failed = !ended && !stream.closed && !stream.eof;
                    stream.eof = true;
                    break;
                }
            }
        }
        self.changed.notify_all();
    }

    /// Sends batches until the stream ends or the pane is closed, then ends the pane and says so.
    fn send(&self) {
        let mut paused = false;
        loop {
            let mut stream = lock(&self.stream);
            while !stream.closed && !stream.eof && stream.buffer.is_empty() {
                stream = self
                    .changed
                    .wait(stream)
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
            }
            if stream.closed || (stream.eof && stream.buffer.is_empty()) {
                break;
            }
            // Give a burst a moment to gather into one message.
            let window = Instant::now() + BATCH_WINDOW;
            while !stream.closed && !stream.eof && stream.buffer.len() < BATCH_BYTES {
                let now = Instant::now();
                if now >= window {
                    break;
                }
                stream = self
                    .changed
                    .wait_timeout(stream, window - now)
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .0;
            }
            // Wait for the emulator when it has fallen behind.
            loop {
                let behind = stream.sent - stream.acknowledged;
                paused = if paused {
                    behind > LOW_WATER
                } else {
                    behind >= HIGH_WATER
                };
                if !paused || stream.closed {
                    break;
                }
                stream = self
                    .changed
                    .wait(stream)
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
            }
            if stream.closed {
                break;
            }
            let count = stream.buffer.len().min(BATCH_BYTES);
            let batch: Vec<u8> = stream.buffer.drain(..count).collect();
            stream.sent += batch.len() as u64;
            self.changed.notify_all();
            drop(stream);
            (self.sink)(Output::Data(batch));
        }
        let failed = lock(&self.stream).failed;
        self.end();
        if failed {
            (self.sink)(Output::Error(STREAM_ENDED));
        }
        (self.sink)(Output::Exit);
    }

    /// Windows reports the end of the stream only once the pseudo-console is closed, so the
    /// shell's own exit is watched for and the pseudo-console closed then. Waiting on a process
    /// handle does not collect it, so this does not race the tree's own wait.
    #[cfg(windows)]
    fn watch(&self) {
        loop {
            std::thread::sleep(Duration::from_millis(50));
            if lock(&self.stream).closed {
                return;
            }
            let exited = match lock(&self.child).as_mut() {
                Some(child) => !matches!(child.try_wait(), Ok(None)),
                None => return,
            };
            if exited {
                // Closing the pseudo-console flushes what the shell wrote last and ends the read.
                lock(&self.master).take();
                return;
            }
        }
    }
}

#[cfg(unix)]
const END_OF_TERMINAL: i32 = libc::EIO;
/// `ERROR_BROKEN_PIPE`, in case it does not arrive as `ErrorKind::BrokenPipe`.
#[cfg(windows)]
const END_OF_TERMINAL: i32 = 109;

#[cfg(test)]
mod tests {
    use super::again;
    use std::time::{Duration, Instant};

    const PAUSES: [Duration; 2] = [Duration::from_millis(1), Duration::from_millis(30)];

    #[test]
    fn a_step_that_fails_at_first_is_tried_again_and_its_result_used() {
        let mut tries = 0;
        let result: Result<u32, &str> = again(&PAUSES, || {
            tries += 1;
            if tries < 3 {
                Err("not yet")
            } else {
                Ok(tries)
            }
        });
        assert_eq!(result, Ok(3));
        assert_eq!(tries, 3);
    }

    #[test]
    fn a_step_that_works_is_run_once_and_without_a_pause() {
        let mut tries = 0;
        let started = Instant::now();
        let result: Result<(), &str> = again(&[Duration::from_secs(30)], || {
            tries += 1;
            Ok(())
        });
        assert_eq!(result, Ok(()));
        assert_eq!(tries, 1);
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn a_step_that_keeps_failing_ends_with_its_last_error_after_every_pause() {
        let mut tries = 0;
        let started = Instant::now();
        let result: Result<(), String> = again(&PAUSES, || {
            tries += 1;
            Err(format!("failure {tries}"))
        });
        assert_eq!(result, Err("failure 3".to_string()));
        assert!(started.elapsed() >= PAUSES[0] + PAUSES[1]);
    }
}
