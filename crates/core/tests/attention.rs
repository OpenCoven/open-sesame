//! Attention signals (issue #80): Claude Code's hook events, the state of each agent, the
//! loopback listener that receives them and the opt-in change to Claude Code's settings.

use open_sesame_core::attention::board::{Board, Change, State};
use open_sesame_core::attention::hook;
use open_sesame_core::attention::listener;
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::mpsc;
use std::time::Duration;

fn event(name: &str, session: &str, extra: Value) -> Value {
    let mut value = json!({
        "hook_event_name": name,
        "session_id": session,
        "cwd": "/work/app",
        "transcript_path": "/work/state/projects/x/session.jsonl",
    });
    if let (Some(value), Value::Object(extra)) = (value.as_object_mut(), extra) {
        value.extend(extra);
    }
    value
}

/// One waiting state, one notice: the permission request and the notification Claude Code
/// sends for the same prompt start waiting once.
#[test]
fn an_agent_that_asks_for_permission_is_waiting_once() {
    let mut board = Board::default();
    assert_eq!(
        board.apply(&event(
            "UserPromptSubmit",
            "s1",
            json!({"prompt": "fix it"})
        )),
        Change::Changed
    );
    assert_eq!(board.agents()[0].state, State::Working);
    assert_eq!(
        board.apply(&event(
            "PermissionRequest",
            "s1",
            json!({"tool_name": "Bash", "tool_input": {"command": "rm -rf build"}})
        )),
        Change::StartedWaiting
    );
    let agent = &board.agents()[0];
    assert_eq!(agent.state, State::Waiting);
    assert_eq!(agent.folder, "/work/app");
    assert_eq!(agent.reason, "Asks to use Bash");
    assert_eq!(
        board.apply(&event(
            "Notification",
            "s1",
            json!({"notification_type": "permission_prompt", "message": "Claude needs your permission to use Bash"})
        )),
        Change::Unchanged,
        "the notice for the same prompt neither starts waiting again nor changes its sentence"
    );
    assert_eq!(board.waiting(), 1);
    assert_eq!(
        board.apply(&event("PostToolUse", "s1", json!({"tool_name": "Bash"}))),
        Change::Changed
    );
    assert_eq!(board.agents()[0].state, State::Working);
    assert_eq!(board.waiting(), 0);
    board.apply(&event("Stop", "s1", json!({})));
    assert_eq!(board.agents()[0].state, State::Finished);
    assert_eq!(
        board.apply(&event("Stop", "s1", json!({}))),
        Change::Unchanged
    );
    board.apply(&event("SessionEnd", "s1", json!({"reason": "exit"})));
    assert!(board.agents().is_empty());
}

/// The board keeps what it needs and nothing else: never the transcript's path, the prompt or
/// a tool's input.
#[test]
fn the_board_keeps_no_transcript_prompt_or_tool_input() {
    let mut board = Board::default();
    board.apply(&event(
        "UserPromptSubmit",
        "s1",
        json!({"prompt": "secret plan"}),
    ));
    board.apply(&event(
        "PermissionRequest",
        "s1",
        json!({"tool_name": "Bash", "tool_input": {"command": "cat private-key.pem"}}),
    ));
    let status = board.status().to_string();
    assert!(!status.contains("transcript"), "{status}");
    assert!(!status.contains("secret plan"), "{status}");
    assert!(!status.contains("private-key"), "{status}");
    assert!(status.contains("\"waiting\""), "{status}");
}

#[test]
fn other_waiting_notices_and_idle_and_ignored_events() {
    let mut board = Board::default();
    for (kind, change) in [
        ("elicitation_dialog", Change::StartedWaiting),
        // Claude Code says it is idle only once it has finished responding, so a prompt the
        // person dismissed with Escape (no Stop follows an interrupt) is no longer waiting.
        ("idle_prompt", Change::Changed),
        ("agent_needs_input", Change::StartedWaiting),
        ("auth_success", Change::Unchanged),
    ] {
        assert_eq!(
            board.apply(&event(
                "Notification",
                "s2",
                json!({"notification_type": kind, "message": "Claude is waiting for your input"})
            )),
            change,
            "{kind}"
        );
    }
    // An idle prompt after a finished turn is still finished, not waiting.
    assert_eq!(board.agents()[0].state, State::Waiting);
    board.apply(&event("Stop", "s2", json!({})));
    board.apply(&event(
        "Notification",
        "s2",
        json!({"notification_type": "idle_prompt", "message": "Claude is waiting for your input"}),
    ));
    assert_eq!(board.agents()[0].state, State::Finished);
    // Events without a session, or a subagent's other events, change nothing.
    assert_eq!(
        board.apply(&json!({"hook_event_name": "Stop"})),
        Change::Unchanged
    );
    assert_eq!(
        board.apply(&event(
            "UserPromptSubmit",
            "s3",
            json!({"agent_id": "sub-1"})
        )),
        Change::Unchanged
    );
    assert_eq!(
        board.apply(&json!({"hook_event_name": "Stop", "session_id": "x".repeat(300)})),
        Change::Unchanged
    );
}

/// Tools run in parallel: a tool that finishes while another one waits for permission does
/// not end the wait, and the notice for that prompt does not start a second one. The approved
/// tool finishing does end it, and so does a subagent's, whose events count for its session.
#[test]
fn a_wait_ends_when_the_tool_it_was_for_has_run() {
    let mut board = Board::default();
    board.apply(&event("UserPromptSubmit", "s1", json!({})));
    assert_eq!(
        board.apply(&event(
            "PermissionRequest",
            "s1",
            json!({"tool_name": "Bash"})
        )),
        Change::StartedWaiting
    );
    assert_eq!(
        board.apply(&event("PostToolUse", "s1", json!({"tool_name": "Read"}))),
        Change::Unchanged,
        "another tool finishing does not end the wait"
    );
    assert_eq!(board.agents()[0].state, State::Waiting);
    assert_eq!(
        board.apply(&event(
            "Notification",
            "s1",
            json!({"notification_type": "permission_prompt", "message": "Claude needs your permission to use Bash"})
        )),
        Change::Unchanged
    );
    assert_eq!(
        board.apply(&event("PostToolUse", "s1", json!({"tool_name": "Bash"}))),
        Change::Changed
    );
    assert_eq!(board.agents()[0].state, State::Working);
    // A subagent asks and is answered: its session waits, then works.
    assert_eq!(
        board.apply(&event(
            "PermissionRequest",
            "s1",
            json!({"agent_id": "sub-1", "tool_name": "Edit"})
        )),
        Change::StartedWaiting
    );
    assert_eq!(
        board.apply(&event(
            "PostToolUseFailure",
            "s1",
            json!({"agent_id": "sub-1", "tool_name": "Edit"})
        )),
        Change::Changed
    );
    assert_eq!(board.agents()[0].state, State::Working);
}

/// The board does not grow without bound: past its limit, the agent changed longest ago goes.
#[test]
fn the_board_holds_a_bounded_number_of_agents() {
    let mut board = Board::default();
    for n in 0..(open_sesame_core::attention::board::MOST_AGENTS + 5) {
        board.apply(&event(
            "SessionStart",
            &format!("s{n}"),
            json!({"source": "startup"}),
        ));
    }
    let agents = board.agents();
    assert_eq!(
        agents.len(),
        open_sesame_core::attention::board::MOST_AGENTS
    );
    assert!(!agents.iter().any(|agent| agent.session == "s0"));
    assert!(!agents.iter().any(|agent| agent.session == "s4"));
    assert!(agents.iter().any(|agent| agent.session == "s5"));
}

fn send(port: u16, request: &str) -> String {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    stream.write_all(request.as_bytes()).unwrap();
    let mut reply = String::new();
    let _ = stream.read_to_string(&mut reply);
    reply
}

fn post(path: &str, body: &str, extra: &str) -> String {
    format!(
        "POST {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n{extra}Content-Length: {}\r\n\r\n{body}",
        body.len()
    )
}

/// The listener answers only on the loopback address and only with the token, takes nothing
/// a browser page could send, and never answers with a decision.
#[test]
fn the_listener_takes_hook_events_with_the_token_only() {
    let token = hook::new_token();
    assert_eq!(token.len(), 43);
    let (sent, received) = mpsc::channel();
    let running = listener::start(0, &token, move |event| {
        let _ = sent.send(event);
    })
    .unwrap();
    let port = running.port();
    assert!(running.address().ip().is_loopback());
    let body = event("Stop", "s1", json!({})).to_string();
    let reply = send(port, &post(&format!("/hook/{token}"), &body, ""));
    assert!(reply.starts_with("HTTP/1.1 204 "), "{reply}");
    assert!(!reply.contains("decision"), "{reply}");
    let got = received.recv_timeout(Duration::from_secs(5)).unwrap();
    assert_eq!(got["hook_event_name"], json!("Stop"));
    let wrong = format!("/hook/{}", hook::new_token());
    for (request, status) in [
        (post(&wrong, &body, ""), "404"),
        (post("/hook/", &body, ""), "404"),
        (post(&format!("/hook/{token}/x"), &body, ""), "404"),
        (
            format!("GET /hook/{token} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"),
            "405",
        ),
        (
            post(
                &format!("/hook/{token}"),
                &body,
                "Origin: https://example.test\r\n",
            ),
            "403",
        ),
        (post(&format!("/hook/{token}"), "not json", ""), "400"),
        (post(&format!("/hook/{token}"), "[1]", ""), "400"),
        (
            format!("POST /hook/{token} HTTP/1.1\r\nContent-Length: 99999999\r\n\r\n"),
            "413",
        ),
    ] {
        let reply = send(port, &request);
        assert!(
            reply.starts_with(&format!("HTTP/1.1 {status} ")),
            "{status}: {reply}"
        );
    }
    assert!(
        received.recv_timeout(Duration::from_millis(300)).is_err(),
        "a refused request is not an event"
    );
    // A connection that sends nothing does not hold the listener up.
    let idle = TcpStream::connect(("127.0.0.1", port)).unwrap();
    let reply = send(port, &post(&format!("/hook/{token}"), &body, ""));
    assert!(reply.starts_with("HTTP/1.1 204 "), "{reply}");
    drop(idle);
    running.stop();
    assert!(
        TcpStream::connect(("127.0.0.1", port)).is_err(),
        "the port is closed"
    );
}

const URL: &str = "http://127.0.0.1:47813/hook/abc";

fn parsed(bytes: &[u8]) -> Value {
    serde_json::from_slice(bytes).unwrap()
}

#[test]
fn the_plan_adds_one_http_hook_per_event_and_keeps_everything_else() {
    let current = b"{\n  \"model\": \"opus\",\n  \"hooks\": {\n    \"Stop\": [\n      {\n        \"hooks\": [\n          {\n            \"type\": \"command\",\n            \"command\": \"say done\"\n          }\n        ]\n      }\n    ]\n  },\n  \"env\": {\n    \"A\": \"1\"\n  }\n}\n";
    let after = hook::plan(Some(current), URL).unwrap();
    let text = String::from_utf8(after.clone()).unwrap();
    let value = parsed(&after);
    for name in hook::EVENTS {
        let groups = value["hooks"][name].as_array().unwrap();
        let ours: Vec<&Value> = groups
            .iter()
            .flat_map(|group| group["hooks"].as_array().unwrap())
            .filter(|handler| handler["url"] == json!(URL))
            .collect();
        assert_eq!(ours.len(), 1, "{name}");
        assert_eq!(ours[0]["type"], json!("http"));
        assert!(ours[0]["timeout"].as_u64().unwrap() <= 10);
    }
    // The person's own hook and settings are still there, in their order and text.
    assert_eq!(
        value["hooks"]["Stop"][0]["hooks"][0]["command"],
        json!("say done")
    );
    assert_eq!(value["model"], json!("opus"));
    let model = text.find("\"model\"").unwrap();
    let hooks = text.find("\"hooks\"").unwrap();
    let env = text.find("\"env\"").unwrap();
    assert!(model < hooks && hooks < env, "{text}");
    assert!(text.contains("\"env\": {\n    \"A\": \"1\"\n  }"), "{text}");
    // Planning again changes nothing: the hook is there once.
    assert_eq!(hook::plan(Some(&after), URL).unwrap(), after);
    // No file yet: the plan is the hooks alone.
    let fresh = parsed(&hook::plan(None, URL).unwrap());
    assert_eq!(fresh.as_object().unwrap().len(), 1);
}

#[test]
fn a_settings_file_the_plan_does_not_understand_is_left_alone() {
    for bad in [
        &b"not json"[..],
        b"[1, 2]",
        b"{\"hooks\": []}",
        b"{\"hooks\": {\"Stop\": {}}}",
    ] {
        let error = hook::plan(Some(bad), URL).unwrap_err();
        assert!(error.starts_with("Claude Code's settings file"), "{error}");
    }
    // An empty file is an empty object.
    assert!(hook::plan(Some(b""), URL).is_ok());
}

fn folder() -> tempfile::TempDir {
    tempfile::tempdir().unwrap()
}

/// Removing the hook puts back the file exactly as it was, byte for byte, including a file
/// that did not exist.
#[test]
fn removing_the_hook_restores_the_file_exactly() {
    let root = folder();
    let settings = root.path().join("claude").join("settings.json");
    let backup = root.path().join("backup");
    let original = b"{\"model\":\"opus\",   \"hooks\":{\"Stop\":[{\"hooks\":[{\"type\":\"command\",\"command\":\"say done\"}]}]}}";
    std::fs::create_dir_all(settings.parent().unwrap()).unwrap();
    std::fs::write(&settings, original).unwrap();
    let planned = hook::plan(Some(original), URL).unwrap();
    hook::install(&settings, &backup, URL).unwrap();
    assert_eq!(std::fs::read(&settings).unwrap(), planned);
    assert!(backup.exists());
    // Installing twice is the same install.
    hook::install(&settings, &backup, URL).unwrap();
    assert_eq!(std::fs::read(&settings).unwrap(), planned);
    hook::remove(&settings, &backup, URL).unwrap();
    assert_eq!(std::fs::read(&settings).unwrap(), original);
    assert!(!backup.exists());
    // No file before: none after.
    std::fs::remove_file(&settings).unwrap();
    hook::install(&settings, &backup, URL).unwrap();
    assert!(settings.exists());
    hook::remove(&settings, &backup, URL).unwrap();
    assert!(!settings.exists());
    assert!(!backup.exists());
}

/// A file the person changed after the install keeps their change: only Open Sesame's hooks
/// are taken out, and the rest is left as it is.
#[test]
fn removing_after_the_person_edited_the_file_keeps_their_edit() {
    let root = folder();
    let settings = root.path().join("settings.json");
    let backup = root.path().join("backup");
    std::fs::write(&settings, b"{\n  \"model\": \"opus\"\n}\n").unwrap();
    hook::install(&settings, &backup, URL).unwrap();
    let edited = String::from_utf8(std::fs::read(&settings).unwrap())
        .unwrap()
        .replace("\"model\": \"opus\"", "\"model\": \"sonnet\"");
    std::fs::write(&settings, &edited).unwrap();
    hook::remove(&settings, &backup, URL).unwrap();
    let value = parsed(&std::fs::read(&settings).unwrap());
    assert_eq!(value, json!({"model": "sonnet"}));
    assert!(!backup.exists());
    // An unreadable file is not overwritten by a removal.
    hook::install(&settings, &backup, URL).unwrap();
    std::fs::write(&settings, b"{ broken").unwrap();
    let error = hook::remove(&settings, &backup, URL).unwrap_err();
    assert!(error.starts_with("Claude Code's settings file"), "{error}");
    assert_eq!(std::fs::read(&settings).unwrap(), b"{ broken");
    assert!(
        backup.exists(),
        "the backup is kept while nothing was restored"
    );
}

/// A settings file that is a link, as a dotfiles folder makes it, stays a link: the file it
/// points to is the one changed.
#[cfg(unix)]
#[test]
fn a_linked_settings_file_stays_a_link() {
    let root = folder();
    let real = root.path().join("dotfiles-settings.json");
    let settings = root.path().join("settings.json");
    let backup = root.path().join("backup");
    std::fs::write(&real, b"{}").unwrap();
    std::os::unix::fs::symlink(&real, &settings).unwrap();
    hook::install(&settings, &backup, URL).unwrap();
    assert!(std::fs::symlink_metadata(&settings)
        .unwrap()
        .file_type()
        .is_symlink());
    assert!(parsed(&std::fs::read(&real).unwrap())["hooks"].is_object());
    hook::remove(&settings, &backup, URL).unwrap();
    assert!(std::fs::symlink_metadata(&settings)
        .unwrap()
        .file_type()
        .is_symlink());
    assert_eq!(std::fs::read(&real).unwrap(), b"{}");
}

#[test]
fn the_hook_url_names_the_loopback_address_port_and_token() {
    assert_eq!(hook::url(47813, "abc"), "http://127.0.0.1:47813/hook/abc");
    assert_ne!(hook::new_token(), hook::new_token());
    assert!(hook::new_token()
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_'));
}

/// Claude Code reads the last of two members with the same name. A file with a repeated key
/// is refused, so the hooks in effect are never dropped and ours never lands in the copy that
/// is not read.
#[test]
fn a_settings_file_with_a_repeated_key_is_left_alone() {
    for repeated in [
        &br#"{"hooks": {"Stop": []}, "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "say second"}]}]}}"#[..],
        br#"{"hooks": {"Stop": [], "Stop": [{"hooks": []}]}}"#,
    ] {
        let error = hook::plan(Some(repeated), URL).unwrap_err();
        assert!(error.contains("more than once"), "{error}");
    }
}

/// A removal that finds none of Open Sesame's hooks leaves the file's bytes alone.
#[test]
fn a_removal_with_nothing_to_take_out_writes_nothing() {
    let root = folder();
    let settings = root.path().join("settings.json");
    let backup = root.path().join("backup");
    let text = b"{\n    \"model\":   \"opus\",\n    \"hooks\": {\"Stop\": [{\"hooks\": [{\"type\": \"command\", \"command\": \"say\"}]}]}\n}\n";
    std::fs::write(&settings, text).unwrap();
    hook::remove(&settings, &backup, URL).unwrap();
    assert_eq!(std::fs::read(&settings).unwrap(), text);
}

/// A link whose file does not exist yet stays a link: the file is made where it points, and a
/// removal takes away only that file.
#[cfg(unix)]
#[test]
fn a_link_to_a_missing_file_stays_a_link() {
    let root = folder();
    std::fs::create_dir_all(root.path().join("dotfiles")).unwrap();
    let settings = root.path().join("settings.json");
    let backup = root.path().join("backup");
    std::os::unix::fs::symlink("dotfiles/claude.json", &settings).unwrap();
    hook::install(&settings, &backup, URL).unwrap();
    assert!(std::fs::symlink_metadata(&settings)
        .unwrap()
        .file_type()
        .is_symlink());
    assert!(root.path().join("dotfiles/claude.json").exists());
    hook::remove(&settings, &backup, URL).unwrap();
    assert!(std::fs::symlink_metadata(&settings)
        .unwrap()
        .file_type()
        .is_symlink());
    assert!(!root.path().join("dotfiles/claude.json").exists());
}

/// The backup can hold whatever the settings file holds, keys included, so only the person
/// can read it; and a file the person made read-only is not written.
#[cfg(unix)]
#[test]
fn the_backup_is_private_and_a_read_only_file_is_refused() {
    use std::os::unix::fs::PermissionsExt;
    let root = folder();
    let settings = root.path().join("settings.json");
    let backup = root.path().join("backup");
    std::fs::write(&settings, br#"{"env": {"KEY": "secret"}}"#).unwrap();
    hook::install(&settings, &backup, URL).unwrap();
    assert_eq!(
        std::fs::metadata(&backup).unwrap().permissions().mode() & 0o777,
        0o600
    );
    hook::remove(&settings, &backup, URL).unwrap();
    std::fs::set_permissions(&settings, std::fs::Permissions::from_mode(0o400)).unwrap();
    let error = hook::install(&settings, &backup, URL).unwrap_err();
    assert!(error.contains("read-only"), "{error}");
    assert_eq!(
        std::fs::read(&settings).unwrap(),
        br#"{"env": {"KEY": "secret"}}"#
    );
    assert!(!backup.exists());
}

/// What the listener hands on is the event without its prompt, its tool's input or output and
/// its transcript, even when the body is many megabytes; and it is handed on before the reply,
/// so the next event Claude Code sends cannot overtake it.
#[test]
fn the_listener_hands_on_only_what_the_board_reads_and_before_it_replies() {
    let token = hook::new_token();
    let (sent, received) = mpsc::channel();
    let running = listener::start(0, &token, move |event| {
        let _ = sent.send(event);
    })
    .unwrap();
    let body = json!({
        "hook_event_name": "PostToolUse", "session_id": "s1", "cwd": "/work/app", "tool_name": "Read",
        "prompt": "secret plan", "tool_input": {"file_path": "a"}, "tool_response": "x".repeat(3 * 1024 * 1024),
        "transcript_path": "/work/t.jsonl",
    })
    .to_string();
    let reply = send(running.port(), &post(&format!("/hook/{token}"), &body, ""));
    assert!(
        reply.starts_with("HTTP/1.1 204 "),
        "{}",
        &reply[..reply.len().min(80)]
    );
    let got = received
        .try_recv()
        .expect("the event was handed on before the reply");
    assert_eq!(got["tool_name"], json!("Read"));
    for kept_out in ["prompt", "tool_input", "tool_response", "transcript_path"] {
        assert!(got.get(kept_out).is_none(), "{kept_out}");
    }
    running.stop();
}

/// Connections that trickle bytes are cut off at a deadline, so they cannot hold every slot.
#[test]
fn connections_that_send_slowly_do_not_hold_the_listener() {
    let token = hook::new_token();
    let (sent, received) = mpsc::channel();
    let running = listener::start(0, &token, move |event| {
        let _ = sent.send(event);
    })
    .unwrap();
    let port = running.port();
    let trickling: Vec<std::thread::JoinHandle<()>> = (0..20)
        .map(|_| {
            std::thread::spawn(move || {
                let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)) else {
                    return;
                };
                for _ in 0..8 {
                    if stream.write_all(b"P").is_err() {
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(900));
                }
            })
        })
        .collect();
    std::thread::sleep(Duration::from_millis(3500));
    let body = event("Stop", "s1", json!({})).to_string();
    let reply = send(port, &post(&format!("/hook/{token}"), &body, ""));
    assert!(reply.starts_with("HTTP/1.1 204 "), "{reply}");
    assert!(received.recv_timeout(Duration::from_secs(2)).is_ok());
    for thread in trickling {
        let _ = thread.join();
    }
    running.stop();
}
