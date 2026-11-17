//! The Agents list (issue #79): which coding-agent command-line tools the current user is running on
//! this machine, in which folder, for how long, and whether one of the app's own terminal panes
//! started them.
//!
//! Ported from `desktop/agent_monitor.py`. Processes are listed through the `sysinfo` crate instead
//! of parsing `ps`, so the same code runs on macOS, Windows and Linux. Arguments are read only to
//! recognise the program and never leave this module: an [`Agent`] carries no arguments, and
//! neither does a serialized [`Snapshot`]. Only the current user's processes are listed. On macOS
//! `sysinfo` reports every live process that is not stopped as running, so a listed agent's state
//! is read from its threads there, the way `ps` reads it.
//!
//! Controls are bound to the exact process that was listed. [`Controls::authorize`] gives each
//! listed agent a short-lived token tied to its [`Identity`] (PID, user, start time, executable and
//! recognised tool). [`Controls::control`] checks the token, reads the process again and acts only
//! when that identity is unchanged, so a reused PID, a process of another user or one that is no
//! longer an agent is refused before any signal is sent. Pause and resume are POSIX signals and are
//! refused on Windows with the gate's not-on-this-system sentence; Stop works everywhere.
//! [`actions`] is the table a list uses to offer only what the current system can do. Asking the
//! person before Stop is the view's job; the token is what binds that confirmation to one process.
//!
//! Not wired yet: the gate admits no agents method and no handler calls this module until the
//! three-system smoke pass (#78) is done. Screen-based activity, history and tmux panes from
//! `desktop/process_workspace.py` belong to the attention signals of #80.
//!
//! Known limit: on Unix the identity is read again immediately before `kill`, as the Python monitor
//! did, but a PID could in principle be reused between that read and the signal. On Windows Stop
//! compares the start time on the same process handle it terminates, so it cannot hit a reused PID.

mod controls;
mod list;
mod recognize;
mod scan;
#[cfg(test)]
mod tests;

pub use controls::{
    actions, actions_for, Action, ControlResult, Controls, Identity, ProcessAccess, CHANGED,
    CHOOSE_ACTION, EXPIRED, MAX_TOKENS, NOT_CHANGED, SELECT_CURRENT, TOKEN_LIFETIME,
};
pub use list::{agents, identity_of, Agent, ProcessRow, ProcessState, Terminal, NO_TERMINAL};
pub use recognize::{provider, Provider};
pub use scan::{Scanner, Snapshot, SystemAccess, UNAVAILABLE};
