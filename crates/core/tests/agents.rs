//! The Agents list against real processes (issue #79). Each test starts its own copy of the
//! fixture program under the name `codex`, finds it through the system's process table and acts on
//! it. Nothing else is signalled, and the child is killed when the test ends, pass or fail.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::thread::sleep;
use std::time::{Duration, Instant};

use open_sesame_core::agents::{
    actions, Agent, ProcessAccess, ProcessState, Provider, Scanner, Snapshot, SystemAccess,
    Terminal, CHANGED, NO_TERMINAL,
};
use serde_json::json;

const LIMIT: Duration = Duration::from_secs(10);
/// An argument the fixture ignores, which must never appear in what the list reports.
const PRIVATE: &str = "--private-fixture-argument";

struct FakeAgent {
    child: Child,
    program: PathBuf,
    folder: tempfile::TempDir,
}

impl FakeAgent {
    fn start() -> Self {
        let folder = tempfile::tempdir().unwrap();
        let program = folder
            .path()
            .join(if cfg!(windows) { "codex.exe" } else { "codex" });
        std::fs::copy(env!("CARGO_BIN_EXE_fixture_cli"), &program).unwrap();
        let child = Command::new(&program)
            .args(["sleep", "300", PRIVATE])
            .current_dir(folder.path())
            .spawn()
            .unwrap();
        Self {
            child,
            program,
            folder,
        }
    }

    fn pid(&self) -> u32 {
        self.child.id()
    }

    fn exited_within(&mut self, limit: Duration) -> bool {
        let until = Instant::now() + limit;
        while Instant::now() < until {
            if self.child.try_wait().unwrap().is_some() {
                return true;
            }
            sleep(Duration::from_millis(50));
        }
        false
    }
}

impl Drop for FakeAgent {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Lists until the fake agent appears in the given state, or fails after the limit.
fn listed(
    scanner: &mut Scanner,
    pid: u32,
    panes: &HashMap<u32, String>,
    state: Option<ProcessState>,
) -> (Snapshot, Agent) {
    let until = Instant::now() + LIMIT;
    loop {
        let snapshot = scanner.snapshot(panes).expect("a snapshot");
        let found = snapshot
            .agents
            .iter()
            .find(|agent| agent.pid == pid)
            .cloned();
        match found {
            Some(agent) if state.is_none_or(|state| agent.state == state) => {
                return (snapshot, agent)
            }
            _ if Instant::now() > until => {
                panic!("process {pid} was not listed as wanted: {found:?}")
            }
            _ => sleep(Duration::from_millis(100)),
        }
    }
}

fn control(
    scanner: &Scanner,
    agent: &Agent,
    action: &str,
) -> Result<serde_json::Value, &'static str> {
    let params = json!({"pid": agent.pid, "token": agent.control_token.clone().expect("a token"), "action": action});
    scanner
        .control(&params)
        .map(|done| serde_json::to_value(done).unwrap())
}

#[test]
fn a_started_agent_is_listed_with_its_folder_and_pane() {
    let fake = FakeAgent::start();
    let mut scanner = Scanner::new();
    // The fixture spends its time asleep, which every Unix system reports as such.
    let wanted = if cfg!(unix) {
        Some(ProcessState::Sleeping)
    } else {
        None
    };
    let (snapshot, agent) = listed(&mut scanner, fake.pid(), &HashMap::new(), wanted);
    assert_eq!((agent.provider, agent.name), (Provider::Codex, "Codex"));
    assert_eq!(
        agent.terminal,
        Terminal::Unavailable {
            reason: NO_TERMINAL
        }
    );
    assert_eq!(
        std::fs::canonicalize(&agent.cwd).unwrap(),
        std::fs::canonicalize(fake.folder.path()).unwrap(),
        "working folder"
    );
    assert!(agent.uptime_seconds < 600);
    assert_eq!(agent.id.as_ref().map(String::len), Some(24));
    assert!(agent.control_token.is_some());
    assert_eq!(snapshot.scope, "current-user");
    assert_eq!(snapshot.controls, actions());
    assert_eq!(
        snapshot.providers,
        [
            "Codex",
            "Claude Code",
            "Coven",
            "Gemini CLI",
            "Aider",
            "OpenCode"
        ]
    );
    assert!(!snapshot.machine.is_empty() && snapshot.updated_at > 1_700_000_000_000);
    let text = serde_json::to_string(&agent).unwrap();
    assert!(
        !text.contains(PRIVATE) && !text.contains("\"sleep\""),
        "no arguments: {text}"
    );

    let panes = HashMap::from([(fake.pid(), "pane-9".to_owned())]);
    let (_, owned) = listed(&mut scanner, fake.pid(), &panes, None);
    assert_eq!(
        owned.terminal,
        Terminal::Owned {
            id: "pane-9".to_owned()
        }
    );
    assert_eq!(
        owned.control_token, agent.control_token,
        "polling keeps the token"
    );
}

#[test]
fn the_system_reads_an_identity_only_for_its_own_user() {
    let fake = FakeAgent::start();
    let mut scanner = Scanner::new();
    listed(&mut scanner, fake.pid(), &HashMap::new(), None);
    let mine = SystemAccess::current()
        .expect("the current user")
        .identity(fake.pid())
        .expect("an identity");
    assert_eq!((mine.pid, mine.provider), (fake.pid(), Provider::Codex));
    assert_eq!(
        std::fs::canonicalize(&mine.executable).unwrap(),
        std::fs::canonicalize(&fake.program).unwrap()
    );
    assert_eq!(
        SystemAccess::for_user("someone else").identity(fake.pid()),
        None
    );
}

#[test]
fn stop_ends_the_listed_process() {
    let mut fake = FakeAgent::start();
    let mut scanner = Scanner::new();
    let (_, agent) = listed(&mut scanner, fake.pid(), &HashMap::new(), None);
    assert_eq!(
        control(&scanner, &agent, "stop"),
        Ok(json!({"pid": fake.pid(), "action": "stop", "signalSent": true}))
    );
    assert!(fake.exited_within(LIMIT), "the agent did not end");
}

#[test]
fn a_process_that_exited_is_not_signalled() {
    let mut fake = FakeAgent::start();
    let mut scanner = Scanner::new();
    let (_, agent) = listed(&mut scanner, fake.pid(), &HashMap::new(), None);
    fake.child.kill().unwrap();
    fake.child.wait().unwrap();
    assert_eq!(control(&scanner, &agent, "stop"), Err(CHANGED));
}

#[cfg(unix)]
#[test]
fn pause_and_resume_change_the_listed_state() {
    let mut fake = FakeAgent::start();
    let mut scanner = Scanner::new();
    let (_, agent) = listed(&mut scanner, fake.pid(), &HashMap::new(), None);
    assert!(control(&scanner, &agent, "pause").is_ok());
    let (_, paused) = listed(
        &mut scanner,
        fake.pid(),
        &HashMap::new(),
        Some(ProcessState::Stopped),
    );
    assert!(control(&scanner, &paused, "resume").is_ok());
    let (_, resumed) = listed(
        &mut scanner,
        fake.pid(),
        &HashMap::new(),
        Some(ProcessState::Sleeping),
    );
    assert!(control(&scanner, &resumed, "stop").is_ok());
    assert!(fake.exited_within(LIMIT), "the agent did not end");
}

#[cfg(windows)]
#[test]
fn pause_and_resume_are_refused_on_windows() {
    let mut fake = FakeAgent::start();
    let mut scanner = Scanner::new();
    let (_, agent) = listed(&mut scanner, fake.pid(), &HashMap::new(), None);
    for action in ["pause", "resume"] {
        assert_eq!(
            control(&scanner, &agent, action),
            Err(open_sesame_core::gate::NOT_ON_OS)
        );
    }
    assert!(fake.child.try_wait().unwrap().is_none(), "still running");
    assert!(control(&scanner, &agent, "stop").is_ok());
    assert!(fake.exited_within(LIMIT), "the agent did not end");
}
