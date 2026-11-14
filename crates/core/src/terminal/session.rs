//! One pane: a program on a pseudo-terminal, its output stream and its process tree.
//!
//! Output is read by one thread and sent by another. The reader fills a bounded buffer; the
//! sender waits a few milliseconds for more, so a burst becomes a few large messages instead of
//! thousands of small ones, and stops sending while the terminal emulator's acknowledgements are
//! more than [`HIGH_WATER`] bytes behind, until they are within [`LOW_WATER`]. While the sender
//! is stopped the buffer fills, the reader stops reading, the pseudo-terminal fills, and the
//! program blocks on its own write: nothing is dropped and memory stays bounded.

use super::launch::Launch;
use super::tree::Tree;
use super::{Output, Sink, HIGH_WATER, LOW_WATER};
use crate::protocol::BridgeError;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
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

pub(super) const COULD_NOT_START: &str = "Open Sesame could not start the shell.";
pub(super) const ENDED: &str = "This shell has ended. Reopen the pane to reconnect.";
pub(super) const STREAM_ENDED: &str = "Terminal stream ended.";

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

struct Shared {
    stream: Mutex<Stream>,
    changed: Condvar,
    /// Taken by whichever of close and the natural end gets there first.
    child: Mutex<Option<Box<dyn Child + Send + Sync>>>,
    tree: Tree,
    writer: Mutex<Option<Box<dyn Write + Send>>>,
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
        let failed = |_| BridgeError::from(COULD_NOT_START);
        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };
        let pair = native_pty_system().openpty(size).map_err(failed)?;
        let mut command = CommandBuilder::new(&launch.program);
        command.args(&launch.args);
        command.cwd(&launch.cwd);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        let mut child = pair.slave.spawn_command(command).map_err(failed)?;
        // Only the child may hold the other end, or the stream never reports its end.
        drop(pair.slave);
        let adopted = Tree::adopt(child.as_ref()).and_then(|tree| {
            let reader = pair
                .master
                .try_clone_reader()
                .map_err(std::io::Error::other)?;
            let writer = pair.master.take_writer().map_err(std::io::Error::other)?;
            let pid = child
                .process_id()
                .ok_or_else(|| std::io::Error::other("the shell has no process ID"))?;
            Ok((tree, reader, writer, pid))
        });
        let (tree, reader, writer, pid) = match adopted {
            Ok(parts) => parts,
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(BridgeError::from(COULD_NOT_START));
            }
        };
        let shared = Arc::new(Shared {
            stream: Mutex::new(Stream::default()),
            changed: Condvar::new(),
            child: Mutex::new(Some(child)),
            tree,
            writer: Mutex::new(Some(writer)),
            master: Mutex::new(Some(pair.master)),
            sink,
        });
        let for_reader = Arc::clone(&shared);
        std::thread::spawn(move || for_reader.read(reader));
        let for_sender = Arc::clone(&shared);
        std::thread::spawn(move || for_sender.send());
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

    pub(super) fn write(&self, bytes: &[u8]) -> Result<(), BridgeError> {
        if self.closed() {
            return Err(BridgeError::from(ENDED));
        }
        let mut writer = lock(&self.shared.writer);
        let Some(writer) = writer.as_mut() else {
            return Err(BridgeError::from(ENDED));
        };
        writer
            .write_all(bytes)
            .and_then(|()| writer.flush())
            .map_err(|_| BridgeError::from(ENDED))
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
    /// done. Safe to call more than once and from any thread.
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
        // every caller returns only after the processes are gone.
        let mut child = lock(&self.child);
        if let Some(mut child) = child.take() {
            self.tree.end(child.as_mut());
        }
        // After the kill: dropping the writer writes an end-of-input byte, which would block on
        // a full pseudo-terminal whose reader is alive but not reading.
        lock(&self.writer).take();
        lock(&self.master).take();
    }

    /// Reads the pseudo-terminal until it ends. Keeps reading after the pane is closed so the
    /// program's last writes never block the kill, and discards what it reads then.
    fn read(&self, mut reader: Box<dyn Read + Send>) {
        let mut chunk = vec![0u8; READ_BYTES];
        loop {
            let read = reader.read(&mut chunk);
            let mut stream = lock(&self.stream);
            match read {
                Ok(0) => {
                    stream.eof = true;
                    break;
                }
                Ok(count) => {
                    while !stream.closed && stream.buffer.len() >= BUFFER_BYTES {
                        stream = self
                            .changed
                            .wait(stream)
                            .unwrap_or_else(|poisoned| poisoned.into_inner());
                    }
                    if !stream.closed {
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
                    stream.failed = !ended && !stream.closed;
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
