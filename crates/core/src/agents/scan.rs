//! The system side: listing processes through `sysinfo` and acting on one (`snapshot`,
//! `process_identities` and the `os.kill` call in `agent_monitor.py`).

use std::collections::HashMap;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use sysinfo::{
    Pid, Process, ProcessRefreshKind, ProcessStatus, ProcessesToUpdate, System, UpdateKind,
};

use super::controls::{Action, ControlResult, Controls, Identity, ProcessAccess, NOT_CHANGED};
use super::list::{agents, identity_of, Agent, ProcessRow, ProcessState};
use super::recognize::Provider;

/// Shown when the system will not say who the current user is, so nothing can be listed safely.
pub const UNAVAILABLE: &str = "Local process discovery is unavailable. Try refreshing.";

/// What the Agents list shows, with the field names of the Python monitor plus the actions this
/// system can perform.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub agents: Vec<Agent>,
    pub machine: String,
    pub scope: &'static str,
    pub updated_at: u64,
    pub providers: Vec<&'static str>,
    pub controls: &'static [Action],
}

/// Lists agents and carries out controls for the current user. It keeps the process table between
/// snapshots, so CPU use is measured over the time since the previous one.
pub struct Scanner {
    system: System,
    user: Option<String>,
    machine: String,
    controls: Controls,
}

impl Default for Scanner {
    fn default() -> Self {
        Self::new()
    }
}

impl Scanner {
    pub fn new() -> Self {
        Self {
            system: System::new(),
            user: current_user(),
            machine: gethostname::gethostname().to_string_lossy().into_owned(),
            controls: Controls::new(),
        }
    }

    /// A scanner for which the system would not say who the current user is.
    #[cfg(test)]
    pub(super) fn without_user() -> Self {
        Self {
            user: None,
            ..Self::new()
        }
    }

    /// The current user's agents. `panes` maps each of the app's terminal panes' process IDs to
    /// the pane's ID.
    pub fn snapshot(&mut self, panes: &HashMap<u32, String>) -> Result<Snapshot, &'static str> {
        let user = self.user.as_deref().ok_or(UNAVAILABLE)?;
        // Arguments and executables are read again every time, because a PID can be reused.
        let kind = ProcessRefreshKind::nothing()
            .with_cpu()
            .with_memory()
            .with_user(UpdateKind::Always)
            .with_cmd(UpdateKind::Always)
            .with_exe(UpdateKind::Always)
            .without_tasks();
        self.system
            .refresh_processes_specifics(ProcessesToUpdate::All, true, kind);
        let rows: Vec<ProcessRow> = self.system.processes().values().map(row).collect();
        let mut listed = agents(&rows, user, panes);
        // The agents' state and working folder come from a fresh table of those processes alone,
        // which keeps the scan cheap. A fresh table matters on macOS, where `sysinfo` reads whether
        // a process is stopped only when it first lists the process.
        let pids: Vec<Pid> = listed
            .iter()
            .map(|agent| Pid::from_u32(agent.pid))
            .collect();
        if !pids.is_empty() {
            let mut detail = System::new();
            let kind = ProcessRefreshKind::nothing()
                .with_cwd(UpdateKind::Always)
                .without_tasks();
            detail.refresh_processes_specifics(ProcessesToUpdate::Some(&pids), true, kind);
            for agent in &mut listed {
                let process = detail.process(Pid::from_u32(agent.pid));
                agent.state = process.map_or(ProcessState::Exited, current_state);
                let folder = process.and_then(Process::cwd);
                agent.cwd = folder
                    .map(|path| path.to_string_lossy().into_owned())
                    .unwrap_or_default();
            }
        }
        let identities: HashMap<u32, Identity> = rows
            .iter()
            .filter(|row| listed.iter().any(|agent| agent.pid == row.pid))
            .filter_map(|row| identity_of(row, user))
            .map(|identity| (identity.pid, identity))
            .collect();
        self.controls
            .authorize(&mut listed, &identities, &self.machine, Instant::now());
        let updated_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |since| since.as_millis() as u64);
        Ok(Snapshot {
            agents: listed,
            machine: self.machine.clone(),
            scope: "current-user",
            updated_at,
            providers: Provider::ALL
                .iter()
                .map(|provider| provider.name())
                .collect(),
            controls: self.controls.actions(),
        })
    }

    /// Carries out `{pid, token, action}` for an agent from a recent snapshot.
    pub fn control(&self, params: &Value) -> Result<ControlResult, &'static str> {
        let user = self.user.clone().ok_or(UNAVAILABLE)?;
        self.controls
            .control(params, &SystemAccess { user }, Instant::now())
    }
}

/// Reads processes and sends actions through the operating system, for the current user only.
pub struct SystemAccess {
    user: String,
}

impl SystemAccess {
    /// Access for the current user, or `None` when the system will not say who that is.
    pub fn current() -> Option<Self> {
        current_user().map(|user| Self { user })
    }

    /// Access that treats only processes of the user with this key as its own.
    pub fn for_user(user: impl Into<String>) -> Self {
        Self { user: user.into() }
    }
}

impl ProcessAccess for SystemAccess {
    fn identity(&self, pid: u32) -> Option<Identity> {
        let target = Pid::from_u32(pid);
        let kind = ProcessRefreshKind::nothing()
            .with_user(UpdateKind::Always)
            .with_cmd(UpdateKind::Always)
            .with_exe(UpdateKind::Always)
            .without_tasks();
        let mut system = System::new();
        system.refresh_processes_specifics(ProcessesToUpdate::Some(&[target]), true, kind);
        identity_of(&row(system.process(target)?), &self.user)
    }

    fn send(&self, identity: &Identity, action: Action) -> Result<(), &'static str> {
        platform::send(identity, action)
    }
}

/// The current user's key, in the form [`row`] gives every process's owner.
fn current_user() -> Option<String> {
    let me = sysinfo::get_current_pid().ok()?;
    let mut system = System::new();
    let kind = ProcessRefreshKind::nothing()
        .with_user(UpdateKind::Always)
        .without_tasks();
    system.refresh_processes_specifics(ProcessesToUpdate::Some(&[me]), false, kind);
    system
        .process(me)?
        .user_id()
        .map(|user| format!("{user:?}"))
}

fn row(process: &Process) -> ProcessRow {
    let mut argv: Vec<String> = process
        .cmd()
        .iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    if argv.is_empty() {
        // Some systems withhold the arguments; the process name still says what runs.
        argv.push(process.name().to_string_lossy().into_owned());
    }
    ProcessRow {
        pid: process.pid().as_u32(),
        parent: process.parent().map(Pid::as_u32),
        user: process.user_id().map(|user| format!("{user:?}")),
        state: state(process.status()),
        cpu_percent: process.cpu_usage(),
        memory_bytes: process.memory(),
        run_time_secs: process.run_time(),
        start_time: process.start_time(),
        argv,
        executable: process
            .exe()
            .map(|path| path.to_string_lossy().into_owned()),
        cwd: process
            .cwd()
            .map(|path| path.to_string_lossy().into_owned()),
    }
}

/// The state of a process from a fresh table. On macOS `sysinfo` reports every live process that
/// is not stopped as running, so there the threads are read instead.
fn current_state(process: &Process) -> ProcessState {
    let reported = state(process.status());
    #[cfg(target_os = "macos")]
    if reported == ProcessState::Running {
        return threads::state(process.pid().as_u32()).unwrap_or(reported);
    }
    reported
}

/// The Python monitor's mapping of `ps` states, for the states `sysinfo` reports. On macOS
/// `sysinfo` reports a thread in an uninterruptible wait as `Dead`.
pub(super) fn state(status: ProcessStatus) -> ProcessState {
    match status {
        ProcessStatus::Run => ProcessState::Running,
        ProcessStatus::Sleep | ProcessStatus::Idle => ProcessState::Sleeping,
        ProcessStatus::Stop | ProcessStatus::Tracing => ProcessState::Stopped,
        ProcessStatus::UninterruptibleDiskSleep | ProcessStatus::LockBlocked => {
            ProcessState::Blocked
        }
        ProcessStatus::Dead if cfg!(target_os = "macos") => ProcessState::Blocked,
        ProcessStatus::Zombie | ProcessStatus::Dead => ProcessState::Exited,
        _ => ProcessState::Unknown,
    }
}

/// What a macOS process's threads are doing, combined as `ps` combines them: running if any
/// thread runs, then blocked if any is in an uninterruptible wait, then sleeping.
#[cfg(target_os = "macos")]
mod threads {
    use std::mem::size_of;

    use super::ProcessState;

    /// From `sys/proc_info.h`; the `libc` crate does not export it.
    const PROC_PIDLISTTHREADS: libc::c_int = 6;
    /// More threads than this are not read; the first ones decide.
    const MOST: usize = 4096;

    /// `None` when the threads cannot be read, for example because the process has exited.
    pub(super) fn state(pid: u32) -> Option<ProcessState> {
        let pid = libc::c_int::try_from(pid).ok()?;
        let mut handles = vec![0u64; 64];
        let count = loop {
            let size = libc::c_int::try_from(handles.len() * size_of::<u64>()).ok()?;
            // SAFETY: the buffer holds `size` bytes, and this flavour writes at most that many bytes
            // of 64-bit thread handles.
            let written = unsafe {
                libc::proc_pidinfo(
                    pid,
                    PROC_PIDLISTTHREADS,
                    0,
                    handles.as_mut_ptr().cast(),
                    size,
                )
            };
            if written <= 0 {
                return None;
            }
            if written < size || handles.len() >= MOST {
                break usize::try_from(written).ok()? / size_of::<u64>();
            }
            handles.resize(handles.len() * 2, 0);
        };
        let (mut running, mut blocked, mut waiting) = (false, false, false);
        let size = libc::c_int::try_from(size_of::<libc::proc_threadinfo>()).ok()?;
        for &handle in &handles[..count] {
            // SAFETY: `proc_threadinfo` is plain integers and bytes, so all zeroes is a valid value,
            // and the call writes at most `size` bytes into it.
            let mut info: libc::proc_threadinfo = unsafe { std::mem::zeroed() };
            let pointer = (&mut info as *mut libc::proc_threadinfo).cast();
            if unsafe { libc::proc_pidinfo(pid, libc::PROC_PIDTHREADINFO, handle, pointer, size) }
                != size
            {
                continue;
            }
            match info.pth_run_state {
                libc::TH_STATE_RUNNING => running = true,
                libc::TH_STATE_UNINTERRUPTIBLE => blocked = true,
                libc::TH_STATE_WAITING => waiting = true,
                _ => {}
            }
        }
        match (running, blocked, waiting) {
            (true, _, _) => Some(ProcessState::Running),
            (_, true, _) => Some(ProcessState::Blocked),
            (_, _, true) => Some(ProcessState::Sleeping),
            _ => None,
        }
    }
}

#[cfg(unix)]
mod platform {
    use super::super::controls::{Action, Identity};
    use super::NOT_CHANGED;

    pub(super) fn send(identity: &Identity, action: Action) -> Result<(), &'static str> {
        let signal = match action {
            Action::Pause => libc::SIGSTOP,
            Action::Resume => libc::SIGCONT,
            Action::Stop => libc::SIGTERM,
        };
        let pid = libc::pid_t::try_from(identity.pid).map_err(|_| NOT_CHANGED)?;
        // SAFETY: `kill` only delivers a signal. The caller read this PID's identity immediately
        // before and found it unchanged.
        if unsafe { libc::kill(pid, signal) } == 0 {
            Ok(())
        } else {
            Err(NOT_CHANGED)
        }
    }
}

#[cfg(windows)]
mod platform {
    use windows_sys::Win32::Foundation::{CloseHandle, FILETIME, HANDLE, STILL_ACTIVE};
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, GetProcessTimes, OpenProcess, TerminateProcess,
        PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
    };

    use super::super::controls::{Action, Identity, CHANGED};
    use super::NOT_CHANGED;
    use crate::gate::NOT_ON_OS;

    /// Stop only. The start time and whether the process is still running are checked on the same
    /// handle that is terminated, so neither a PID reused after the listing nor a process that has
    /// since exited can be ended by mistake.
    pub(super) fn send(identity: &Identity, action: Action) -> Result<(), &'static str> {
        if action != Action::Stop {
            return Err(NOT_ON_OS);
        }
        let access = PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION;
        // SAFETY: OpenProcess has no preconditions; a null handle means it failed.
        let handle = unsafe { OpenProcess(access, 0, identity.pid) };
        if handle.is_null() {
            return Err(CHANGED);
        }
        let result = stop(handle, identity.start_time);
        // SAFETY: the handle came from OpenProcess above and is closed once, here.
        unsafe { CloseHandle(handle) };
        result
    }

    fn stop(handle: HANDLE, start_time: u64) -> Result<(), &'static str> {
        let mut created = FILETIME::default();
        let (mut exited, mut kernel, mut user) = (created, created, created);
        // SAFETY: `handle` is an open process handle with query access, and each pointer is to a
        // local FILETIME.
        if unsafe { GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user) }
            == 0
        {
            return Err(NOT_CHANGED);
        }
        if start_seconds(created) != start_time {
            return Err(CHANGED);
        }
        let mut code = 0u32;
        // SAFETY: as above, with a pointer to a local u32.
        if unsafe { GetExitCodeProcess(handle, &mut code) } == 0 {
            return Err(NOT_CHANGED);
        }
        if code != STILL_ACTIVE as u32 {
            return Err(CHANGED);
        }
        // SAFETY: `handle` is an open process handle with terminate access.
        if unsafe { TerminateProcess(handle, 1) } == 0 {
            return Err(NOT_CHANGED);
        }
        Ok(())
    }

    /// The start time in seconds since the Unix epoch, computed as `sysinfo` computes it.
    fn start_seconds(created: FILETIME) -> u64 {
        let ticks = (u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime);
        (ticks / 10_000_000).saturating_sub(11_644_473_600)
    }
}
