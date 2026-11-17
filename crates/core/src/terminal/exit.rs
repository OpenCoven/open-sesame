//! Noticing that a pane's shell has exited while something else keeps its terminal open
//! (issue #112).
//!
//! A pane ends when the read of its pseudo-terminal ends. On macOS that happens as soon as the
//! shell exits, whatever it leaves running. On Linux it does not happen while any process still
//! has the terminal open: after `sleep 300 &` and `exit` the read waited for the job, the shell
//! stayed uncollected and the pane stayed open with nothing in it. Windows has the same gap and
//! closes it with `watch` in `session.rs`.
//!
//! So on Unix systems other than macOS the reader does not sit in the read. It waits for output
//! for [`STEP`] at a time and, between waits, asks whether the shell has exited. Once it has,
//! what is already in the terminal is still read, and the pane ends when the terminal has been
//! quiet for one step, when the reader has waited [`LAST_WAIT`] in all for output, or when
//! [`LAST_WORDS`] more bytes have been read, whichever is first. A job that writes a little
//! every few milliseconds is never quiet for a step and would take hours to write the byte
//! bound, so the wait has a bound of its own. The pane then ends as it does on macOS: the
//! sender delivers what was read and kills what is left in the session. macOS keeps the plain
//! blocking read, which needs none of this.
//!
//! None of this runs while the reader is held back because the page has not acknowledged what
//! it was sent: a pane whose output nobody takes stays open at the high-water mark on every
//! system, whether or not its shell has exited.

use super::tree::Tree;
use portable_pty::MasterPty;
use std::io;

#[cfg(not(all(unix, not(target_os = "macos"))))]
pub(super) use blocking::ShellExit;
#[cfg(all(unix, not(target_os = "macos")))]
pub(super) use polled::ShellExit;

#[cfg(all(unix, not(target_os = "macos")))]
mod polled {
    use super::*;
    use std::os::fd::{AsRawFd, BorrowedFd, OwnedFd};
    use std::time::{Duration, Instant};

    /// How long one wait for output lasts, and so how often an idle pane's shell is looked at.
    const STEP: Duration = Duration::from_millis(50);
    /// How much is still read once the shell has exited. A bound, so that a job which writes
    /// as fast as it is read cannot keep the pane of an exited shell open.
    const LAST_WORDS: usize = 1024 * 1024;
    /// How long the reader waits for output in all once the shell has exited. A bound, so that
    /// a job which writes a little at a time, more often than once a step, cannot either. Time
    /// the reader spends held back by the page does not count.
    const LAST_WAIT: Duration = Duration::from_millis(250);

    enum State {
        /// The shell runs, as far as the last look showed.
        Running,
        /// The shell has exited; this many more bytes are read at most, and output is waited
        /// for this much longer at most.
        Leaving { bytes: usize, wait: Duration },
        /// Nothing more to notice: the pane has been told, or it was closed.
        Over,
    }

    pub(in super::super) struct ShellExit {
        /// The reader's own handle on the terminal, so it stays valid while the reader runs.
        terminal: OwnedFd,
        looked: Instant,
        state: State,
    }

    impl ShellExit {
        pub(in super::super) fn watch(master: &dyn MasterPty) -> io::Result<ShellExit> {
            let terminal = master
                .as_raw_fd()
                .ok_or_else(|| io::Error::other("the terminal has no file descriptor"))?;
            // SAFETY: the descriptor belongs to `master`, which is borrowed for this call, and
            // the borrow ends with the copy made on this line.
            let terminal = unsafe { BorrowedFd::borrow_raw(terminal) }.try_clone_to_owned()?;
            Ok(ShellExit {
                terminal,
                looked: Instant::now(),
                state: State::Running,
            })
        }

        /// Waits until the terminal has something to read and returns `false`, or returns
        /// `true`, once, when the shell has exited and what it wrote has been read. After that,
        /// and once `closed` says the pane was closed, it returns `false` at once and the
        /// caller's read blocks until the terminal itself ends.
        pub(in super::super) fn ended(&mut self, tree: &Tree, closed: impl Fn() -> bool) -> bool {
            loop {
                match self.state {
                    State::Over => return false,
                    State::Leaving { bytes, wait } => {
                        let waiting = Instant::now();
                        if bytes > 0 && !wait.is_zero() && self.readable(STEP.min(wait)) {
                            let wait = wait.saturating_sub(waiting.elapsed());
                            self.state = State::Leaving { bytes, wait };
                            return false;
                        }
                        self.state = State::Over;
                        return true;
                    }
                    State::Running => {
                        let readable = self.readable(STEP);
                        if !readable && closed() {
                            // Closing the pane ends the shell and collects it; from then on its
                            // process ID says nothing about this pane.
                            self.state = State::Over;
                            return false;
                        }
                        if !readable || self.looked.elapsed() >= STEP {
                            self.looked = Instant::now();
                            if tree.leader_exited() {
                                self.state = State::Leaving {
                                    bytes: LAST_WORDS,
                                    wait: LAST_WAIT,
                                };
                                continue;
                            }
                        }
                        if readable {
                            return false;
                        }
                    }
                }
            }
        }

        /// Counts bytes read against what is still read after the shell's exit.
        pub(in super::super) fn took(&mut self, count: usize) {
            if let State::Leaving { bytes, .. } = &mut self.state {
                *bytes = bytes.saturating_sub(count);
            }
        }

        /// Whether the terminal has output, or has ended, within `wait`.
        fn readable(&self, wait: Duration) -> bool {
            let until = Instant::now() + wait;
            loop {
                let wait = until.saturating_duration_since(Instant::now());
                let mut poll = libc::pollfd {
                    fd: self.terminal.as_raw_fd(),
                    events: libc::POLLIN,
                    revents: 0,
                };
                // SAFETY: `poll` is one valid entry, and the descriptor is owned by `self`.
                let result = unsafe { libc::poll(&mut poll, 1, wait.as_millis() as libc::c_int) };
                if result >= 0 {
                    // An ended terminal counts as readable: the read then reports the end.
                    return result > 0;
                }
                if io::Error::last_os_error().kind() != io::ErrorKind::Interrupted {
                    // Nothing to wait for; the read reports what is wrong.
                    return true;
                }
            }
        }
    }
}

#[cfg(not(all(unix, not(target_os = "macos"))))]
mod blocking {
    use super::*;

    /// Nothing to notice: on macOS the read ends when the shell exits, and on Windows `watch`
    /// in `session.rs` closes the pseudo-console.
    pub(in super::super) struct ShellExit;

    impl ShellExit {
        pub(in super::super) fn watch(_master: &dyn MasterPty) -> io::Result<ShellExit> {
            Ok(ShellExit)
        }

        pub(in super::super) fn ended(&mut self, _tree: &Tree, _closed: impl Fn() -> bool) -> bool {
            false
        }

        pub(in super::super) fn took(&mut self, _count: usize) {}
    }
}
