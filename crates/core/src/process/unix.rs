//! Unix: the child leads a new session and process group, and the group is what gets killed.
//!
//! A new session, not only a new group, because a session has no controlling terminal: a shell
//! started here cannot turn on job control and move its children into groups of their own, and
//! a tool cannot wait unseen for a password on `/dev/tty`.

use std::io;
use std::os::fd::AsRawFd;
use std::os::unix::process::CommandExt;
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};

/// The child's process group. Cloneable so the watchdog can kill it.
#[derive(Clone)]
pub(super) struct Tree {
    group: libc::pid_t,
    /// True once the child has been collected. After that the group ID may be reused by an
    /// unrelated process, so nothing is signalled again.
    retired: Arc<Mutex<bool>>,
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
        },
    ))
}

/// A pipe the child can write to through a path, apart from its standard output and error.
///
/// The login-shell capture reads the environment from it. Standard output is shared with
/// everything the user's startup files run, so a background job that is still printing when
/// the environment is printed there can add a variable or swallow one (issue #97). Nothing
/// writes to this pipe unless the command line names it.
///
/// The child gets the writing end under the number it has in this process, so nothing the
/// standard library set up for the child is replaced, and the end stays closed to every other
/// program this process starts.
pub(super) struct Report {
    reader: io::PipeReader,
    writer: io::PipeWriter,
}

impl Report {
    /// `None` when the system has no pipe to give, or gives one under a number the child's
    /// standard streams use.
    pub(super) fn new() -> Option<Report> {
        let (reader, writer) = io::pipe().ok()?;
        (writer.as_raw_fd() > 2).then_some(Report { reader, writer })
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

    /// After the child has started: gives up this process's writing end, so the pipe closes
    /// when the last process holding the child's copy has gone, and returns the reading end.
    pub(super) fn into_reader(self) -> io::PipeReader {
        self.reader
    }
}

impl Tree {
    fn signal(&self) {
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

    /// Kills whatever is left in the group, then collects the child. Returns its exit code.
    pub(super) fn retire(&self, child: &mut Child) -> Option<i32> {
        let mut retired = super::lock(&self.retired);
        if !*retired {
            self.signal();
        }
        let status = child.wait().ok();
        *retired = true;
        status.and_then(|status| status.code())
    }
}
