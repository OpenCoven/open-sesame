//! From the current user's processes to the agents shown (`parse_processes` and the terminal half
//! of `enrich_snapshot` in `agent_monitor.py`).

use std::collections::{HashMap, HashSet};

use serde::Serialize;

use super::controls::Identity;
use super::recognize::{is_native, program_name, provider, Provider, LAUNCHERS};

/// The process state the system reports. It says nothing about whether an agent is waiting for
/// the person; that is #80.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProcessState {
    Running,
    Sleeping,
    Stopped,
    Blocked,
    Exited,
    Unknown,
}

/// One process as the system lists it. The arguments stay in this struct, which is never
/// serialized.
#[derive(Clone, Debug, PartialEq)]
pub struct ProcessRow {
    pub pid: u32,
    pub parent: Option<u32>,
    /// An opaque key for the owning user; `None` when the system would not say.
    pub user: Option<String>,
    pub state: ProcessState,
    pub cpu_percent: f32,
    pub memory_bytes: u64,
    pub run_time_secs: u64,
    /// Seconds since the Unix epoch, as the system reports the start.
    pub start_time: u64,
    pub argv: Vec<String>,
    pub executable: Option<String>,
    pub cwd: Option<String>,
}

/// Where an agent's terminal is, as far as the app can prove it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Terminal {
    /// Started in one of the app's own panes, or below one.
    Owned {
        id: String,
    },
    Unavailable {
        reason: &'static str,
    },
}

pub const NO_TERMINAL: &str = "No verified terminal association";

/// One listed agent, with the field names of the Python monitor.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub pid: u32,
    pub provider: Provider,
    pub name: &'static str,
    pub state: ProcessState,
    pub cpu_percent: f64,
    #[serde(rename = "memoryMB")]
    pub memory_mb: f64,
    pub uptime_seconds: u64,
    pub parent_agent_pid: Option<u32>,
    pub child_agent_count: usize,
    pub relationship_source: &'static str,
    /// The working folder, or empty when the system would not say.
    pub cwd: String,
    pub terminal: Terminal,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub control_token: Option<String>,
}

/// The agents among `rows` that belong to `user`, sorted by name and PID. A launcher (`node`,
/// `bun`, `coven`) that wraps a native executable of the same tool is shown once, as the deeper
/// process; separate sessions of one tool are all kept. `panes` maps the process ID of each of the
/// app's terminal panes to the pane's ID.
pub fn agents(rows: &[ProcessRow], user: &str, panes: &HashMap<u32, String>) -> Vec<Agent> {
    let mut parents = HashMap::new();
    let mut found: HashMap<u32, Agent> = HashMap::new();
    let (mut launchers, mut native) = (HashSet::new(), HashSet::new());
    for row in rows {
        if row.user.as_deref() != Some(user) || row.pid == 0 || !row.cpu_percent.is_finite() {
            continue;
        }
        if let Some(parent) = row.parent {
            parents.insert(row.pid, parent);
        }
        let program = row.argv.first().map_or("", |first| program_name(first));
        if LAUNCHERS.contains(&program) {
            launchers.insert(row.pid);
        }
        if is_native(program) {
            native.insert(row.pid);
        }
        if let Some(provider) = provider(&row.argv) {
            found.insert(row.pid, agent(row, provider));
        }
    }

    // A launcher can wrap a native executable of the same tool: show the deeper process, once,
    // and keep independent sessions.
    let mut wrappers = HashSet::new();
    for (&pid, agent) in &found {
        if !native.contains(&pid) {
            continue;
        }
        for ancestor in ancestors(pid, &parents) {
            if launchers.contains(&ancestor)
                && found
                    .get(&ancestor)
                    .is_some_and(|outer| outer.provider == agent.provider)
            {
                wrappers.insert(ancestor);
            }
        }
    }
    found.retain(|pid, _| !wrappers.contains(pid));

    let retained: HashSet<u32> = found.keys().copied().collect();
    for (&pid, agent) in found.iter_mut() {
        agent.parent_agent_pid =
            ancestors(pid, &parents).find(|ancestor| retained.contains(ancestor));
        agent.terminal = std::iter::once(pid)
            .chain(ancestors(pid, &parents))
            .find_map(|process| panes.get(&process))
            .map_or(
                Terminal::Unavailable {
                    reason: NO_TERMINAL,
                },
                |id| Terminal::Owned { id: id.clone() },
            );
    }
    let children: Vec<u32> = found
        .values()
        .filter_map(|agent| agent.parent_agent_pid)
        .collect();
    let mut listed: Vec<Agent> = found
        .into_values()
        .map(|mut agent| {
            agent.child_agent_count = children
                .iter()
                .filter(|parent| **parent == agent.pid)
                .count();
            agent
        })
        .collect();
    listed.sort_by(|a, b| (a.name, a.pid).cmp(&(b.name, b.pid)));
    listed
}

fn agent(row: &ProcessRow, provider: Provider) -> Agent {
    Agent {
        pid: row.pid,
        provider,
        name: provider.name(),
        state: row.state,
        cpu_percent: one_decimal(f64::from(row.cpu_percent.max(0.0))),
        memory_mb: one_decimal(row.memory_bytes as f64 / 1_048_576.0),
        uptime_seconds: row.run_time_secs,
        parent_agent_pid: None,
        child_agent_count: 0,
        relationship_source: "process-ancestry",
        cwd: row.cwd.clone().unwrap_or_default(),
        terminal: Terminal::Unavailable {
            reason: NO_TERMINAL,
        },
        id: None,
        control_token: None,
    }
}

fn one_decimal(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

/// The parent, grandparent and so on of `pid` among the listed processes, ending at PID 0, at a
/// process that was not listed, or where the chain would loop.
fn ancestors(pid: u32, parents: &HashMap<u32, u32>) -> impl Iterator<Item = u32> + '_ {
    let mut seen = HashSet::from([pid]);
    let mut next = parents.get(&pid).copied();
    std::iter::from_fn(move || {
        let current = next.filter(|process| *process != 0 && seen.insert(*process))?;
        next = parents.get(&current).copied();
        Some(current)
    })
}

/// The identity a control is bound to, or `None` when the process is not an agent of `user` that
/// may be controlled.
pub fn identity_of(row: &ProcessRow, user: &str) -> Option<Identity> {
    if row.pid <= 1 || row.user.as_deref() != Some(user) {
        return None;
    }
    let provider = provider(&row.argv)?;
    let executable = row
        .executable
        .clone()
        .or_else(|| row.argv.first().cloned())?;
    Some(Identity {
        pid: row.pid,
        user: user.to_owned(),
        start_time: row.start_time,
        executable,
        provider,
    })
}
