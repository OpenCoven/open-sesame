//! Translations of `desktop/tests/test_agent_monitor.py`, `test_agent_controls.py` and the identity
//! test of `test_process_workspace.py`, with process rows built directly where they parsed `ps`.
//! Nothing here starts or signals a process; `crates/core/tests/agents.rs` does that with a child
//! it starts itself.

use std::cell::RefCell;
use std::collections::HashMap;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::*;
use crate::gate::NOT_ON_OS;

const ME: &str = "501";
const OTHER: &str = "502";

fn argv(command: &str) -> Vec<String> {
    command.split_whitespace().map(str::to_owned).collect()
}

/// A process of `user` started by PID 1, as one line of the Python test's `ps` output.
fn row(
    pid: u32,
    user: &str,
    state: ProcessState,
    cpu: f32,
    memory_kb: u64,
    uptime: u64,
    command: &str,
) -> ProcessRow {
    ProcessRow {
        pid,
        parent: Some(1),
        user: Some(user.to_owned()),
        state,
        cpu_percent: cpu,
        memory_bytes: memory_kb * 1024,
        run_time_secs: uptime,
        start_time: 1_794_000_000,
        argv: argv(command),
        executable: None,
        cwd: None,
    }
}

fn sleeping(pid: u32, parent: u32, user: &str, command: &str) -> ProcessRow {
    ProcessRow {
        parent: Some(parent),
        ..row(pid, user, ProcessState::Sleeping, 0.0, 100, 60, command)
    }
}

fn by_pid(rows: &[ProcessRow]) -> HashMap<u32, Agent> {
    agents(rows, ME, &HashMap::new())
        .into_iter()
        .map(|agent| (agent.pid, agent))
        .collect()
}

// test_agent_monitor.py: test_recognizes_real_launch_forms
#[test]
fn recognizes_real_launch_forms() {
    for (command, expected) in [
        ("/opt/homebrew/bin/claude --resume", Provider::Claude),
        (
            "/usr/bin/node /usr/local/lib/node_modules/@openai/codex/bin/codex.js",
            Provider::Codex,
        ),
        (
            "node /opt/npm/lib/node_modules/@anthropic-ai/claude-code/cli.js",
            Provider::Claude,
        ),
        (
            "node /usr/lib/@google/gemini-cli/dist/index.js",
            Provider::Gemini,
        ),
        ("python3.12 -m aider --model test", Provider::Aider),
        ("/usr/local/bin/coven", Provider::Coven),
        ("opencode", Provider::Opencode),
    ] {
        assert_eq!(provider(&argv(command)), Some(expected), "{command}");
    }
}

// New for Windows, where the Python monitor did not run: backslashes and `.exe`.
#[test]
fn recognizes_windows_launch_forms() {
    for (args, expected) in [
        (
            vec![
                r"C:\Program Files\nodejs\node.exe",
                r"C:\Program Files\npm\node_modules\@openai\codex\bin\codex.js",
            ],
            Provider::Codex,
        ),
        (
            vec![r"C:\Program Files\Claude\claude.exe", "--resume"],
            Provider::Claude,
        ),
        (
            vec![r"C:\Python312\python.exe", "-m", "aider"],
            Provider::Aider,
        ),
        (vec![r"C:\tools\coven-code.EXE"], Provider::Coven),
        (vec![r"C:\tools\aider.exe"], Provider::Aider),
    ] {
        assert_eq!(provider(&args), Some(expected), "{args:?}");
    }
}

// test_agent_monitor.py: test_unrelated_commands_and_prompts_are_not_agents
#[test]
fn unrelated_commands_and_prompts_are_not_agents() {
    for args in [
        vec!["bash".to_owned(), "-c".to_owned(), "codex".to_owned()],
        argv("rg claude"),
        argv("node server.js codex"),
        vec![
            "python".to_owned(),
            "-c".to_owned(),
            "import aider".to_owned(),
        ],
        argv("cat /tmp/codex"),
        argv("codex-helper"),
        argv("node /tmp/cli.js --provider claude"),
        vec![
            r"C:\Windows\System32\cmd.exe".to_owned(),
            "/c".to_owned(),
            "codex".to_owned(),
        ],
        Vec::new(),
    ] {
        assert_eq!(provider(&args), None, "{args:?}");
    }
}

#[test]
fn provider_names_are_the_python_monitors() {
    let names: Vec<_> = Provider::ALL.iter().map(|p| (p.key(), p.name())).collect();
    assert_eq!(
        names,
        [
            ("codex", "Codex"),
            ("claude", "Claude Code"),
            ("coven", "Coven"),
            ("gemini", "Gemini CLI"),
            ("aider", "Aider"),
            ("opencode", "OpenCode"),
        ]
    );
}

// test_agent_monitor.py: test_scope_states_and_no_private_arguments
#[test]
fn scope_states_and_no_private_arguments() {
    let rows = [
        row(
            21,
            ME,
            ProcessState::Running,
            12.5,
            204_800,
            83,
            "/usr/bin/codex --prompt secret-token",
        ),
        row(
            22,
            ME,
            ProcessState::Sleeping,
            0.0,
            1024,
            183_845,
            "claude --api-key secret-value",
        ),
        row(23, OTHER, ProcessState::Running, 1.0, 4096, 10, "coven"),
        row(24, ME, ProcessState::Stopped, 0.0, 512, 10, "aider"),
        row(25, ME, ProcessState::Blocked, 0.1, 512, 10, "gemini"),
        row(26, ME, ProcessState::Exited, 0.0, 0, 10, "opencode"),
        row(27, ME, ProcessState::Sleeping, f32::NAN, 0, 10, "codex"),
        // In place of the Python test's malformed ps line: no user, and PID 0.
        ProcessRow {
            user: None,
            ..row(28, ME, ProcessState::Running, 0.0, 1, 1, "codex")
        },
        row(0, ME, ProcessState::Running, 0.0, 1, 1, "codex"),
    ];
    let listed = agents(&rows, ME, &HashMap::new());
    assert_eq!(listed.len(), 5);
    let found: HashMap<u32, &Agent> = listed.iter().map(|agent| (agent.pid, agent)).collect();
    assert_eq!(found[&21].memory_mb, 200.0);
    assert_eq!(found[&21].uptime_seconds, 83);
    assert_eq!(found[&21].cpu_percent, 12.5);
    assert_eq!(found[&21].state, ProcessState::Running);
    assert_eq!(found[&22].state, ProcessState::Sleeping);
    assert_eq!(found[&24].state, ProcessState::Stopped);
    assert_eq!(found[&25].state, ProcessState::Blocked);
    assert_eq!(found[&26].state, ProcessState::Exited);
    let text = serde_json::to_string(&listed).unwrap();
    assert!(!text.contains("secret"), "{text}");
    assert!(
        !text.contains("command") && !text.contains("argv") && !text.contains("--"),
        "{text}"
    );
    // Sorted by name, then PID, as the Python monitor returned them.
    let order: Vec<_> = listed.iter().map(|agent| agent.pid).collect();
    assert_eq!(order, [24, 22, 21, 25, 26]);
}

// test_agent_monitor.py: test_wrappers_deduplicated_but_independent_sessions_retained
#[test]
fn wrappers_deduplicated_but_independent_sessions_retained() {
    let rows = [
        sleeping(10, 1, ME, "node /usr/lib/@openai/codex/bin/codex.js"),
        sleeping(11, 10, ME, "/opt/bin/codex"),
        sleeping(12, 1, ME, "codex"),
        sleeping(13, 11, ME, "claude"),
    ];
    let mut pids: Vec<_> = by_pid(&rows).into_keys().collect();
    pids.sort_unstable();
    assert_eq!(pids, [11, 12, 13]);
}

// test_agent_monitor.py: test_native_same_provider_subagents_survive_wrapper_deduplication
#[test]
fn native_same_provider_subagents_survive_wrapper_deduplication() {
    let rows = [
        sleeping(10, 1, ME, "codex"),
        sleeping(11, 10, ME, "bash"),
        sleeping(12, 11, ME, "codex"),
        sleeping(13, 12, ME, "claude"),
        sleeping(14, 1, OTHER, "codex"),
    ];
    let found = by_pid(&rows);
    let mut pids: Vec<_> = found.keys().copied().collect();
    pids.sort_unstable();
    assert_eq!(pids, [10, 12, 13]);
    assert_eq!(found[&10].parent_agent_pid, None);
    assert_eq!(found[&12].parent_agent_pid, Some(10));
    assert_eq!(found[&13].parent_agent_pid, Some(12));
    assert_eq!(found[&10].child_agent_count, 1);
    assert_eq!(found[&12].relationship_source, "process-ancestry");
    assert!(!serde_json::to_string(&found.values().collect::<Vec<_>>())
        .unwrap()
        .contains("bash"));
}

// test_agent_monitor.py: test_javascript_agent_children_are_not_treated_as_binary_wrappers
#[test]
fn javascript_agent_children_are_not_treated_as_binary_wrappers() {
    let script = "node /usr/lib/@google/gemini-cli/dist/index.js";
    let found = by_pid(&[sleeping(10, 1, ME, script), sleeping(11, 10, ME, script)]);
    assert_eq!(found.len(), 2);
    assert_eq!(found[&11].parent_agent_pid, Some(10));
}

// test_agent_monitor.py: test_elapsed_formats has no counterpart: sysinfo reports the running time
// in seconds, so there is no ps elapsed-time text to parse.

// enrich_snapshot in agent_monitor.py: an agent in, or below, one of the app's panes is owned by
// it; every other agent has no verified terminal. The working folder is carried through.
#[test]
fn panes_own_the_agents_started_below_them() {
    let rows = [
        sleeping(30, 1, ME, "/bin/zsh"),
        ProcessRow {
            cwd: Some("/work/project one".to_owned()),
            ..sleeping(31, 30, ME, "claude")
        },
        sleeping(32, 31, ME, "codex"),
        sleeping(33, 1, ME, "codex"),
    ];
    let panes = HashMap::from([(30, "pane-7".to_owned())]);
    let found: HashMap<u32, Agent> = agents(&rows, ME, &panes)
        .into_iter()
        .map(|agent| (agent.pid, agent))
        .collect();
    assert_eq!(
        found[&31].terminal,
        Terminal::Owned {
            id: "pane-7".to_owned()
        }
    );
    assert_eq!(
        found[&32].terminal,
        Terminal::Owned {
            id: "pane-7".to_owned()
        }
    );
    assert_eq!(
        found[&33].terminal,
        Terminal::Unavailable {
            reason: NO_TERMINAL
        }
    );
    assert_eq!(found[&31].cwd, "/work/project one");
    assert_eq!(found[&33].cwd, "");
    let owned = serde_json::to_value(&found[&31]).unwrap();
    assert_eq!(owned["terminal"], json!({"kind": "owned", "id": "pane-7"}));
    assert_eq!(
        serde_json::to_value(&found[&33]).unwrap()["terminal"],
        json!({"kind": "unavailable", "reason": NO_TERMINAL})
    );
}

// A pane's own process can be the agent, and an ancestry loop must end.
#[test]
fn a_pane_process_can_be_the_agent_and_loops_end() {
    let rows = [
        sleeping(40, 41, ME, "codex"),
        sleeping(41, 40, ME, "bash"),
        sleeping(42, 1, ME, "aider"),
    ];
    let panes = HashMap::from([(42, "pane-1".to_owned())]);
    let found: HashMap<u32, Agent> = agents(&rows, ME, &panes)
        .into_iter()
        .map(|agent| (agent.pid, agent))
        .collect();
    assert_eq!(
        found[&40].terminal,
        Terminal::Unavailable {
            reason: NO_TERMINAL
        }
    );
    assert_eq!(found[&40].parent_agent_pid, None);
    assert_eq!(
        found[&42].terminal,
        Terminal::Owned {
            id: "pane-1".to_owned()
        }
    );
}

// --- Controls (test_agent_controls.py) ---

struct StandIn {
    now: RefCell<HashMap<u32, Identity>>,
    sent: RefCell<Vec<(u32, Action)>>,
    refuse: bool,
}

impl StandIn {
    fn with(identity: &Identity) -> Self {
        Self {
            now: RefCell::new(HashMap::from([(identity.pid, identity.clone())])),
            sent: RefCell::default(),
            refuse: false,
        }
    }
}

impl ProcessAccess for StandIn {
    fn identity(&self, pid: u32) -> Option<Identity> {
        self.now.borrow().get(&pid).cloned()
    }

    fn send(&self, identity: &Identity, action: Action) -> Result<(), &'static str> {
        if self.refuse {
            return Err(NOT_CHANGED);
        }
        self.sent.borrow_mut().push((identity.pid, action));
        Ok(())
    }
}

fn identity() -> Identity {
    Identity {
        pid: 4242,
        user: ME.to_owned(),
        start_time: 1_794_000_000,
        executable: "/usr/bin/codex".to_owned(),
        provider: Provider::Codex,
    }
}

fn listed(identity: &Identity) -> Agent {
    let rows = [ProcessRow {
        executable: Some(identity.executable.clone()),
        start_time: identity.start_time,
        ..sleeping(
            identity.pid,
            1,
            ME,
            "/usr/bin/codex --prompt private-fixture",
        )
    }];
    agents(&rows, ME, &HashMap::new()).remove(0)
}

fn authorize(controls: &Controls, identity: &Identity, now: Instant) -> Value {
    let mut agents = [listed(identity)];
    controls.authorize(
        &mut agents,
        &HashMap::from([(identity.pid, identity.clone())]),
        "host",
        now,
    );
    json!({"pid": identity.pid, "token": agents[0].control_token.clone().expect("a token")})
}

fn with_action(params: &Value, action: &str) -> Value {
    let mut params = params.clone();
    params["action"] = json!(action);
    params
}

// test_explicit_actions_signal_only_the_selected_identity
#[test]
fn explicit_actions_signal_only_the_selected_identity() {
    let controls = Controls::for_os(true);
    let identity = identity();
    let access = StandIn::with(&identity);
    let now = Instant::now();
    for (name, action) in [
        ("pause", Action::Pause),
        ("resume", Action::Resume),
        ("stop", Action::Stop),
    ] {
        let params = with_action(&authorize(&controls, &identity, now), name);
        let done = controls.control(&params, &access, now).unwrap();
        assert_eq!(
            done,
            ControlResult {
                pid: 4242,
                action,
                signal_sent: true
            }
        );
        assert_eq!(access.sent.borrow().last(), Some(&(4242, action)));
        assert_eq!(
            controls.control(&params, &access, now),
            Err(EXPIRED),
            "a token is used once"
        );
    }
    assert_eq!(access.sent.borrow().len(), 3);
    assert_eq!(
        serde_json::to_value(ControlResult {
            pid: 4242,
            action: Action::Stop,
            signal_sent: true
        })
        .unwrap(),
        json!({"pid": 4242, "action": "stop", "signalSent": true})
    );
}

// New: Windows has no pause or resume; the token survives so Stop still works.
#[test]
fn windows_refuses_pause_and_resume_before_anything_is_sent() {
    let controls = Controls::for_os(false);
    let identity = identity();
    let access = StandIn::with(&identity);
    let now = Instant::now();
    let params = authorize(&controls, &identity, now);
    for name in ["pause", "resume"] {
        assert_eq!(
            controls.control(&with_action(&params, name), &access, now),
            Err(NOT_ON_OS)
        );
    }
    assert!(access.sent.borrow().is_empty());
    assert!(controls
        .control(&with_action(&params, "stop"), &access, now)
        .is_ok());
    assert_eq!(*access.sent.borrow(), [(4242, Action::Stop)]);
}

#[test]
fn the_action_table_never_offers_what_a_system_cannot_do() {
    assert_eq!(
        actions_for(true),
        [Action::Pause, Action::Resume, Action::Stop]
    );
    assert_eq!(actions_for(false), [Action::Stop]);
    assert_eq!(actions(), actions_for(cfg!(unix)));
    assert_eq!(Controls::for_os(false).actions(), [Action::Stop]);
}

// test_reused_pid_cannot_receive_a_stale_action
#[test]
fn reused_pid_cannot_receive_a_stale_action() {
    let controls = Controls::for_os(true);
    let identity = identity();
    let access = StandIn::with(&identity);
    let now = Instant::now();
    let params = with_action(&authorize(&controls, &identity, now), "stop");
    access.now.borrow_mut().insert(
        4242,
        Identity {
            start_time: identity.start_time + 3600,
            ..identity.clone()
        },
    );
    assert_eq!(controls.control(&params, &access, now), Err(CHANGED));
    // The token is spent, so the stale identity cannot be retried either.
    access.now.borrow_mut().insert(4242, identity.clone());
    assert_eq!(controls.control(&params, &access, now), Err(EXPIRED));
    assert!(access.sent.borrow().is_empty());
}

// New: a process that is gone, another user's or no longer an agent reads back as no identity.
#[test]
fn a_process_that_is_gone_or_another_users_is_refused() {
    let controls = Controls::for_os(true);
    let identity = identity();
    let access = StandIn::with(&identity);
    let now = Instant::now();
    let params = with_action(&authorize(&controls, &identity, now), "stop");
    access.now.borrow_mut().clear();
    assert_eq!(controls.control(&params, &access, now), Err(CHANGED));
    assert!(access.sent.borrow().is_empty());
}

// test_expired_missing_and_malformed_controls_fail_closed
#[test]
fn expired_missing_and_malformed_controls_fail_closed() {
    let controls = Controls::for_os(true);
    let identity = identity();
    let access = StandIn::with(&identity);
    let now = Instant::now();
    let params = with_action(&authorize(&controls, &identity, now), "stop");
    let later = now + TOKEN_LIFETIME + Duration::from_secs(1);
    assert_eq!(controls.control(&params, &access, later), Err(EXPIRED));
    let token = params["token"].clone();
    for (bad, sentence) in [
        (
            json!({"pid": -4242, "token": token, "action": "stop"}),
            SELECT_CURRENT,
        ),
        (
            json!({"pid": true, "token": token, "action": "stop"}),
            SELECT_CURRENT,
        ),
        (
            json!({"pid": "4242", "token": token, "action": "stop"}),
            SELECT_CURRENT,
        ),
        (
            json!({"pid": 4242.5, "token": token, "action": "stop"}),
            SELECT_CURRENT,
        ),
        (
            json!({"pid": 1, "token": token, "action": "stop"}),
            SELECT_CURRENT,
        ),
        (json!({"token": token, "action": "stop"}), SELECT_CURRENT),
        (json!({"pid": 4242, "action": "stop"}), SELECT_CURRENT),
        (
            json!({"pid": 4242, "token": "x".repeat(129), "action": "stop"}),
            SELECT_CURRENT,
        ),
        (
            json!({"pid": 4242, "token": "wrong", "action": "stop"}),
            EXPIRED,
        ),
        (
            json!({"pid": 4243, "token": token, "action": "stop"}),
            EXPIRED,
        ),
        (
            json!({"pid": 4242, "token": token, "action": "kill-all"}),
            CHOOSE_ACTION,
        ),
        (json!({"pid": 4242, "token": token}), CHOOSE_ACTION),
        (json!("stop"), SELECT_CURRENT),
    ] {
        assert_eq!(controls.control(&bad, &access, now), Err(sentence), "{bad}");
    }
    assert!(access.sent.borrow().is_empty());
}

// The Python monitor raised the same sentence when os.kill failed, and kept the token.
#[test]
fn a_failed_signal_is_reported_and_the_token_kept() {
    let controls = Controls::for_os(true);
    let identity = identity();
    let mut access = StandIn::with(&identity);
    access.refuse = true;
    let now = Instant::now();
    let params = with_action(&authorize(&controls, &identity, now), "stop");
    assert_eq!(controls.control(&params, &access, now), Err(NOT_CHANGED));
    access.refuse = false;
    assert!(controls.control(&params, &access, now).is_ok());
}

// test_identity_discovery_excludes_other_users_and_unknown_programs
#[test]
fn identity_discovery_excludes_other_users_and_unknown_programs() {
    let mine = ProcessRow {
        executable: Some("/usr/bin/codex".to_owned()),
        ..sleeping(4242, 1, ME, "codex --prompt private-fixture")
    };
    let found = identity_of(&mine, ME).expect("my agent");
    assert_eq!(
        found,
        Identity {
            pid: 4242,
            user: ME.to_owned(),
            start_time: 1_794_000_000,
            executable: "/usr/bin/codex".to_owned(),
            provider: Provider::Codex
        }
    );
    assert_eq!(identity_of(&sleeping(4243, 1, OTHER, "codex"), ME), None);
    assert_eq!(
        identity_of(
            &ProcessRow {
                user: None,
                ..sleeping(4243, 1, ME, "codex")
            },
            ME
        ),
        None
    );
    assert_eq!(
        identity_of(&sleeping(4244, 1, ME, "bash -c codex"), ME),
        None
    );
    assert_eq!(identity_of(&sleeping(1, 0, ME, "codex"), ME), None);
    // Without an executable path the program named in the arguments stands in.
    assert_eq!(
        identity_of(&sleeping(4245, 1, ME, "/opt/bin/codex"), ME)
            .unwrap()
            .executable,
        "/opt/bin/codex"
    );
}

// test_polling_preserves_confirmation_identity_without_exposing_arguments
#[test]
fn polling_preserves_confirmation_identity_without_exposing_arguments() {
    let controls = Controls::for_os(true);
    let identity = identity();
    let now = Instant::now();
    let first = authorize(&controls, &identity, now);
    assert_eq!(
        authorize(&controls, &identity, now + Duration::from_secs(30)),
        first
    );
    let mut agents = [listed(&identity)];
    controls.authorize(
        &mut agents,
        &HashMap::from([(4242, identity.clone())]),
        "host",
        now,
    );
    let text = serde_json::to_string(&agents).unwrap();
    assert!(!text.contains("private-fixture"), "{text}");
    assert_eq!(
        agents[0].id.as_deref(),
        Some(identity.agent_id("host").as_str())
    );
    assert_eq!(agents[0].control_token.as_ref().map(String::len), Some(43));
}

#[test]
fn an_identity_for_another_tool_gets_no_token() {
    let controls = Controls::for_os(true);
    let mut agents = [listed(&identity())];
    let other = Identity {
        provider: Provider::Claude,
        ..identity()
    };
    controls.authorize(
        &mut agents,
        &HashMap::from([(4242, other)]),
        "host",
        Instant::now(),
    );
    assert_eq!(
        (agents[0].control_token.as_ref(), agents[0].id.as_ref()),
        (None, None)
    );
}

#[test]
fn at_most_max_tokens_are_held() {
    let controls = Controls::for_os(true);
    let now = Instant::now();
    let identities: HashMap<u32, Identity> = (2..2 + MAX_TOKENS as u32 + 10)
        .map(|pid| (pid, Identity { pid, ..identity() }))
        .collect();
    let mut agents: Vec<Agent> = identities.values().map(listed).collect();
    controls.authorize(&mut agents, &identities, "host", now);
    assert_eq!(
        agents
            .iter()
            .filter(|agent| agent.control_token.is_some())
            .count(),
        MAX_TOKENS
    );
    // Expired tokens make room again.
    let mut later: Vec<Agent> = identities.values().map(listed).collect();
    controls.authorize(
        &mut later,
        &identities,
        "host",
        now + TOKEN_LIFETIME + Duration::from_secs(1),
    );
    assert_eq!(
        later
            .iter()
            .filter(|agent| agent.control_token.is_some())
            .count(),
        MAX_TOKENS
    );
}

// test_process_workspace.py: test_identity_survives_reparenting
#[test]
fn identity_survives_reparenting() {
    let first = ProcessRow {
        executable: Some("/usr/bin/codex".to_owned()),
        ..sleeping(42, 1, ME, "codex")
    };
    let reparented = ProcessRow {
        parent: Some(2),
        ..first.clone()
    };
    let restarted = ProcessRow {
        start_time: first.start_time + 1,
        ..first.clone()
    };
    let id = |row: &ProcessRow| identity_of(row, ME).unwrap().agent_id("host");
    assert_eq!(id(&first), id(&reparented));
    assert_ne!(id(&first), id(&restarted));
    assert_ne!(
        id(&first),
        identity_of(&first, ME).unwrap().agent_id("other-host")
    );
    assert_eq!(id(&first).len(), 24);
}

// sysinfo reports an uninterruptible wait on macOS as `Dead`, which is not an exit there.
#[test]
fn system_states_map_to_the_python_monitors() {
    use super::scan::state;
    use sysinfo::ProcessStatus;
    assert_eq!(state(ProcessStatus::Run), ProcessState::Running);
    assert_eq!(state(ProcessStatus::Sleep), ProcessState::Sleeping);
    assert_eq!(state(ProcessStatus::Idle), ProcessState::Sleeping);
    assert_eq!(state(ProcessStatus::Stop), ProcessState::Stopped);
    assert_eq!(
        state(ProcessStatus::UninterruptibleDiskSleep),
        ProcessState::Blocked
    );
    assert_eq!(state(ProcessStatus::Zombie), ProcessState::Exited);
    let dead = if cfg!(target_os = "macos") {
        ProcessState::Blocked
    } else {
        ProcessState::Exited
    };
    assert_eq!(state(ProcessStatus::Dead), dead);
    assert_eq!(state(ProcessStatus::Unknown(99)), ProcessState::Unknown);
}
