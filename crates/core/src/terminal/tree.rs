//! Ending everything a pane started (issue #74), with the same guarantee as the process runner
//! of issue #73: closing a pane or quitting kills the whole tree, not one process.
//!
//! The mechanism differs from the runner's because a pane's shell is interactive. On Unix the
//! shell leads a session with the pseudo-terminal as its controlling terminal and puts each job
//! in a process group of its own, so signalling one group is not enough: every process whose
//! session is the shell's is signalled. On Windows the shell is placed in a job object that kills
//! everything in it when it is closed, as in the runner; `portable-pty` cannot start a process
//! suspended, so the shell is added to the job immediately after it starts.
//!
//! Known limit, as in the runner: a process that deliberately leaves the session (a daemon) or,
//! on Windows, is started outside the job is not killed.

use portable_pty::Child;
use std::io;

#[cfg(unix)]
pub(super) use unix::Tree;
#[cfg(windows)]
pub(super) use windows::{deliver_control_c, Tree};

#[cfg(unix)]
mod unix {
    use super::*;
    use std::time::{Duration, Instant};

    /// How long processes get to act on the hang-up before they are killed.
    const GRACE: Duration = Duration::from_millis(250);
    /// How long the kill loop runs. A killed process is gone in milliseconds; the loop exists
    /// for a process that forks while it is being enumerated.
    const KILL_LIMIT: Duration = Duration::from_secs(2);
    const STEP: Duration = Duration::from_millis(10);

    /// The session the pane's shell leads. Its ID is the shell's process ID.
    pub(in super::super) struct Tree {
        leader: libc::pid_t,
    }

    impl Tree {
        pub(in super::super) fn adopt(child: &dyn Child) -> io::Result<Tree> {
            let leader = child
                .process_id()
                .and_then(|id| libc::pid_t::try_from(id).ok())
                .ok_or_else(|| io::Error::other("the shell has no process ID"))?;
            Ok(Tree { leader })
        }

        /// Hangs up, then kills, every process in the session, and collects the shell.
        ///
        /// The shell is collected last and only here. Until then its process ID, which is the
        /// session ID, cannot be given to an unrelated process, so every process found in the
        /// session really belongs to this pane.
        pub(in super::super) fn end(&self, child: &mut dyn Child) {
            for process in self.members() {
                signal(process, libc::SIGHUP);
                signal(process, libc::SIGCONT);
            }
            let grace = Instant::now() + GRACE;
            while Instant::now() < grace && !self.finished() {
                std::thread::sleep(STEP);
            }
            let limit = Instant::now() + KILL_LIMIT;
            while !self.finished() && Instant::now() < limit {
                for process in self.members() {
                    signal(process, libc::SIGKILL);
                }
                std::thread::sleep(STEP);
            }
            if !self.leader_exited() {
                signal(self.leader, libc::SIGKILL);
            }
            let _ = child.wait();
        }

        /// Whether the shell has exited and nothing else is left in its session.
        fn finished(&self) -> bool {
            self.leader_exited() && self.members().is_empty()
        }

        /// Looks at the shell without collecting it, so its process ID stays reserved.
        fn leader_exited(&self) -> bool {
            // SAFETY: `info` is a valid, zeroed `siginfo_t` for `waitid` to fill, and the ID is
            // this pane's child, which has not been collected.
            unsafe {
                let mut info: libc::siginfo_t = std::mem::zeroed();
                let options = libc::WEXITED | libc::WNOHANG | libc::WNOWAIT;
                let result =
                    libc::waitid(libc::P_PID, self.leader as libc::id_t, &mut info, options);
                // An error means there is no such child to wait for: it is gone.
                result != 0 || info.si_signo != 0
            }
        }

        /// The live processes in the session, the shell included while it runs.
        fn members(&self) -> Vec<libc::pid_t> {
            let exited = self.leader_exited();
            all_processes()
                .into_iter()
                .filter(|process| !(exited && *process == self.leader))
                // SAFETY: `getsid` takes a plain integer and reports an error for a process
                // that is gone or may not be inspected.
                .filter(|process| unsafe { libc::getsid(*process) } == self.leader)
                .filter(|process| !is_zombie(*process))
                .collect()
        }
    }

    fn signal(process: libc::pid_t, signal: libc::c_int) {
        // SAFETY: `kill` takes plain integers. The process was just found in this pane's
        // session, whose ID is reserved until the shell is collected.
        unsafe {
            libc::kill(process, signal);
        }
    }

    /// A process that has exited and only waits to be collected by its parent. It holds
    /// nothing open and cannot be killed, so it does not count as left behind.
    #[cfg(target_os = "linux")]
    fn is_zombie(process: libc::pid_t) -> bool {
        // The state is the first field after the command name, which ends at the last `)`.
        std::fs::read_to_string(format!("/proc/{process}/stat"))
            .ok()
            .and_then(|stat| {
                let state = stat.rsplit_once(')')?.1.trim_start().chars().next()?;
                Some(state == 'Z' || state == 'X')
            })
            .unwrap_or(true)
    }

    #[cfg(not(target_os = "linux"))]
    fn is_zombie(_process: libc::pid_t) -> bool {
        false
    }

    #[cfg(target_os = "linux")]
    fn all_processes() -> Vec<libc::pid_t> {
        std::fs::read_dir("/proc")
            .map(|entries| {
                entries
                    .flatten()
                    .filter_map(|entry| entry.file_name().to_str()?.parse().ok())
                    .collect()
            })
            .unwrap_or_default()
    }

    #[cfg(target_os = "macos")]
    fn all_processes() -> Vec<libc::pid_t> {
        // SAFETY: the first call asks only for the count. The second passes a buffer of the
        // stated size in bytes, with room for processes that start in between.
        unsafe {
            let count = libc::proc_listallpids(std::ptr::null_mut(), 0);
            if count <= 0 {
                return Vec::new();
            }
            let mut processes = vec![0 as libc::pid_t; count as usize + 256];
            let bytes = (processes.len() * std::mem::size_of::<libc::pid_t>()) as libc::c_int;
            let filled = libc::proc_listallpids(processes.as_mut_ptr().cast(), bytes);
            processes.truncate(filled.max(0) as usize);
            processes.retain(|process| *process > 0);
            processes
        }
    }

    /// Other Unix systems are not release targets. Without a process list only the shell's own
    /// process group can be signalled.
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    fn all_processes() -> Vec<libc::pid_t> {
        Vec::new()
    }
}

#[cfg(windows)]
mod windows {
    use super::*;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::Console::SetConsoleCtrlHandler;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    /// Makes sure a shell started from here receives Control+C.
    ///
    /// A process inherits "ignore Control+C" from the one that starts it, and a shell that has
    /// it never sees the Control+C a pane types: the running command is not interrupted. This
    /// process may have inherited it itself. A hosted CI runner starts its steps that way, and
    /// there a pane's `Start-Sleep` ran on through Control+C until the attribute was cleared.
    /// So it is cleared here, once, before the first pane starts. With no handler given, the
    /// call changes nothing else.
    pub(in super::super) fn deliver_control_c() {
        static ONCE: std::sync::Once = std::sync::Once::new();
        ONCE.call_once(|| {
            // SAFETY: no handler is registered and no pointer is kept; `FALSE` with no handler
            // only restores normal Control+C processing for this process and its children.
            unsafe {
                SetConsoleCtrlHandler(None, 0);
            }
        });
    }

    /// A job object holding the shell and everything it starts. Closing it kills what is left.
    pub(in super::super) struct Tree {
        job: HANDLE,
    }

    // SAFETY: a job handle may be used from any thread; the kernel synchronises access.
    unsafe impl Send for Tree {}
    unsafe impl Sync for Tree {}

    impl Tree {
        pub(in super::super) fn adopt(child: &dyn Child) -> io::Result<Tree> {
            let process = child
                .as_raw_handle()
                .ok_or_else(|| io::Error::other("the shell has no process handle"))?;
            // SAFETY: both pointers may be null: default security, no name.
            let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if job.is_null() {
                return Err(io::Error::last_os_error());
            }
            let tree = Tree { job };
            // SAFETY: the structure is plain data, zero is valid for every field, and the size
            // passed is the size of the structure the pointer refers to. Both handles are valid.
            let placed = unsafe {
                let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                SetInformationJobObject(
                    tree.job,
                    JobObjectExtendedLimitInformation,
                    std::ptr::from_ref(&limits).cast(),
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                ) != 0
                    && AssignProcessToJobObject(tree.job, process as HANDLE) != 0
            };
            if placed {
                Ok(tree)
            } else {
                Err(io::Error::last_os_error())
            }
        }

        /// Kills every process in the job and collects the shell.
        pub(in super::super) fn end(&self, child: &mut dyn Child) {
            // SAFETY: the job handle is valid for as long as this value exists.
            unsafe {
                TerminateJobObject(self.job, 1);
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    impl Drop for Tree {
        fn drop(&mut self) {
            // SAFETY: the handle came from `CreateJobObjectW` and is closed exactly once, here.
            unsafe {
                CloseHandle(self.job);
            }
        }
    }
}
