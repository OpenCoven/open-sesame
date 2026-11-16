//! Unix: the child leads a new session and process group, and the group is what gets killed.
//!
//! A new session, not only a new group, because a session has no controlling terminal: a shell
//! started here cannot turn on job control and move its children into groups of their own, and
//! a tool cannot wait unseen for a password on `/dev/tty`.

use std::io::{self, Read};
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::os::unix::process::CommandExt;
use std::process::{Child, Command};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// The child's process group. Cloneable so the watchdog can kill it.
#[derive(Clone)]
pub(super) struct Tree {
    group: libc::pid_t,
    /// True once the child has been collected, or given up as one the kill did not end. After
    /// that the group ID may be reused by an unrelated process, so nothing is signalled again.
    retired: Arc<Mutex<bool>>,
    /// Test only: the kill is left out, which stands in for a program this user cannot kill.
    #[cfg(test)]
    deaf: bool,
}

pub(super) fn spawn(command: &mut Command) -> io::Result<(Child, Tree)> {
    // SAFETY: the closure runs in the child between fork and exec and calls only `setsid`, which
    // is async-signal-safe. It makes the child the leader of a new session and of a new process
    // group whose ID is the child's PID.
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() == -1 {
                Err(io::Error::last_os_error())
            } else {
                Ok(())
            }
        });
    }
    let child = command.spawn()?;
    let group = libc::pid_t::try_from(child.id())
        .map_err(|_| io::Error::other("the process ID does not fit"))?;
    Ok((
        child,
        Tree {
            group,
            retired: Arc::new(Mutex::new(false)),
            #[cfg(test)]
            deaf: super::tests::kill_does_nothing(),
        },
    ))
}

/// A pipe the child can write to through a path, apart from its standard output and error.
///
/// The login-shell capture reads the environment from it. Standard output is shared with
/// everything the user's startup files run, so a background job that is still printing when
/// the environment is printed there can add a variable or swallow one (issue #97). This pipe
/// is written to only by a command that names it.
///
/// The child gets the writing end under the number it has in this process, so nothing the
/// standard library set up for the child is replaced. In this process the end is closed to
/// every other program started here. In the child it is open to everything the child starts,
/// which is why [`drain`] does not wait for the pipe to close.
pub(super) struct Report {
    reader: io::PipeReader,
    writer: OwnedFd,
}

/// The lowest numbers to ask for, in order, for the child's end of the pipe.
///
/// The number has to be high. The bash that macOS ships (3.2) closes descriptors 3 to 19 when
/// it starts as an interactive login shell, so a pipe handed over under one of those numbers
/// was gone before the command ran; measured on macOS, 20 and above arrive in bash, sh, zsh,
/// ksh and dash, and on Linux in fish too. Three digits also keep it clear of the numbers
/// startup files use for their own redirections: one digit is all the POSIX shell language
/// promises, though bash takes more. 20 is the second choice for a process whose limit on
/// open files is 100 or less; with a limit of 20 or less there is no pipe, and the
/// environment is read from between the markers as before. No test lowers the limit.
const LOWEST: [libc::c_int; 2] = [100, 20];

impl Report {
    /// `None` when the system has no pipe to give, or no number high enough for its writing
    /// end.
    pub(super) fn new() -> Option<Report> {
        let (reader, low) = io::pipe().ok()?;
        let writer = LOWEST.iter().find_map(|lowest| {
            // SAFETY: `fcntl` takes plain integers and `low` is open. A result that is not -1
            // is a new descriptor that nothing else owns, closed on exec like the first.
            unsafe {
                let high = libc::fcntl(low.as_raw_fd(), libc::F_DUPFD_CLOEXEC, *lowest);
                (high >= 0).then(|| OwnedFd::from_raw_fd(high))
            }
        })?;
        Some(Report { reader, writer })
    }

    /// The path that names the pipe inside the child.
    pub(super) fn path(&self) -> String {
        format!("/dev/fd/{}", self.writer.as_raw_fd())
    }

    /// Lets the child of `command` keep the writing end across its `exec`.
    pub(super) fn attach(&self, command: &mut Command) {
        let writer = self.writer.as_raw_fd();
        // SAFETY: the closure runs in the child between fork and exec and calls only `fcntl`,
        // which is async-signal-safe. It clears close-on-exec on the child's own copy of the
        // descriptor; this process's copy keeps the flag.
        unsafe {
            command.pre_exec(move || {
                if libc::fcntl(writer, libc::F_SETFD, 0) == -1 {
                    Err(io::Error::last_os_error())
                } else {
                    Ok(())
                }
            });
        }
    }

    /// After the child has started: gives up this process's writing end and returns the
    /// reading end, for [`drain`].
    pub(super) fn into_reader(self) -> io::PipeReader {
        self.reader
    }
}

/// How long [`drain`] waits for the pipe before it looks at `exited` again.
const LOOK: Duration = Duration::from_millis(5);

/// Reads a [`Report`]'s pipe and hands each piece to `take`, until the pipe closes, `take`
/// returns `false`, or `exited` is set and the pipe has been read empty.
///
/// `exited` is the caller's word that the child has exited. What the child's own commands
/// wrote is in the pipe by then, so it is read out and the reading ends there. It does not
/// wait for the pipe to close: a helper that a startup file left running holds the writing end
/// for as long as it lives, with its output sent elsewhere, and waiting for it made every
/// capture a quarter of a second slower and left this thread behind when the helper had moved
/// to a session of its own (issue #97).
pub(super) fn drain(
    mut reader: io::PipeReader,
    exited: &AtomicBool,
    mut take: impl FnMut(Vec<u8>) -> bool,
) {
    let pipe = reader.as_raw_fd();
    // Reads must not block, or `exited` would not be looked at. The flag belongs to the
    // reading end, which only this process has. If it cannot be set the reads block as an
    // ordinary pipe's do, and the reading ends when the pipe closes.
    // SAFETY: `fcntl` takes plain integers, and the descriptor is owned by `reader`.
    unsafe {
        let flags = libc::fcntl(pipe, libc::F_GETFL);
        if flags != -1 {
            libc::fcntl(pipe, libc::F_SETFL, flags | libc::O_NONBLOCK);
        }
    }
    let mut buffer = [0u8; 8192];
    loop {
        // Looked at before the pipe is read out, so what was written before it was set is read.
        let last = exited.load(Ordering::SeqCst);
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => return,
                Ok(count) => {
                    if !take(buffer[..count].to_vec()) {
                        return;
                    }
                }
                Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => break,
                Err(_) => return,
            }
        }
        if last {
            return;
        }
        let mut poll = libc::pollfd {
            fd: pipe,
            events: libc::POLLIN,
            revents: 0,
        };
        // SAFETY: `poll` is one valid entry, and the descriptor is owned by `reader`. Whatever
        // the result, the next read says what there is.
        unsafe {
            libc::poll(&mut poll, 1, LOOK.as_millis() as libc::c_int);
        }
    }
}

impl Tree {
    fn signal(&self) {
        #[cfg(test)]
        if self.deaf {
            return;
        }
        // SAFETY: `kill` takes plain integers. The group still belongs to this child: the child
        // has not been collected, so its PID, and with it the group ID, cannot have been reused.
        unsafe {
            libc::kill(-self.group, libc::SIGKILL);
        }
    }

    /// Kills every process in the group, unless the child has already been collected.
    pub(super) fn kill(&self) {
        let retired = super::lock(&self.retired);
        if !*retired {
            self.signal();
        }
    }

    /// Whether the child has exited. It is looked at without being collected, so its PID stays
    /// reserved and the group can still be signalled safely.
    pub(super) fn exited(&self) -> bool {
        let retired = super::lock(&self.retired);
        if *retired {
            return true;
        }
        // SAFETY: `info` is a valid, zeroed `siginfo_t` for `waitid` to fill, and the ID is this
        // child's, which has not been collected.
        unsafe {
            let mut info: libc::siginfo_t = std::mem::zeroed();
            let options = libc::WEXITED | libc::WNOHANG | libc::WNOWAIT;
            libc::waitid(libc::P_PID, self.group as libc::id_t, &mut info, options) == 0
                && info.si_signo != 0
        }
    }

    /// Kills whatever is left in the group, then collects the child. Returns its exit code, or
    /// `None` when the child was still there after the limit and has not been collected.
    pub(super) fn retire(&self, child: &mut Child) -> Option<Option<i32>> {
        let mut retired = super::lock(&self.retired);
        if !*retired {
            self.signal();
        }
        let collected = super::collect(child);
        *retired = true;
        collected
    }
}
