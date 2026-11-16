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
//! quiet for one step or [`LAST_WORDS`] more bytes have been read, whichever is first. The pane
//! then ends as it does on macOS: the sender delivers what was read and kills what is left in
//! the session. macOS keeps the plain blocking read, which needs none of this.

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
    /// How much is still read once the shell has exited. A bound, so that a job which never
    /// stops writing cannot keep the pane of an exited shell open.
    const LAST_WORDS: usize = 1024 * 1024;

    enum State {
        /// The shell runs, as far as the last look showed.
        Running,
        /// The shell has exited; this many more bytes are read at most.
        Leaving(usize),
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
                    State::Leaving(0) => {
                        self.state = State::Over;
                        return true;
                    }
                    State::Leaving(_) => {
                        if self.readable() {
                            return false;
                        }
                        self.state = State::Over;
                        return true;
                    }
                    State::Running => {
                        let readable = self.readable();
                        if !readable && closed() {
                            // Closing the pane ends the shell and collects it; from then on its
                            // process ID says nothing about this pane.
                            self.state = State::Over;
                            return false;
                        }
                        if !readable || self.looked.elapsed() >= STEP {
                            self.looked = Instant::now();
                            if tree.leader_exited() {
                                self.state = State::Leaving(LAST_WORDS);
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
            if let State::Leaving(left) = &mut self.state {
                *left = left.saturating_sub(count);
            }
        }

        /// Whether the terminal has output, or has ended, within one step.
        fn readable(&self) -> bool {
            let until = Instant::now() + STEP;
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
