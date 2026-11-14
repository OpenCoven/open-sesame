//! Terminal panes on real pseudo-terminals (issue #74).
//!
//! Every test starts real shells and checks the operating system's process list afterwards; a
//! test that leaves a process behind fails. The four tests of `desktop/tests/test_bridge.py` are
//! translated under their own names. Tests that need a POSIX shell are Unix only; the rest run on
//! Windows through PowerShell and ConPTY.

use open_sesame_core::terminal::{Config, Output, Sink, Terminals};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// What one pane's channel received, in order.
#[derive(Default)]
struct Pane {
    bytes: Mutex<Vec<u8>>,
    exited: AtomicBool,
    errors: Mutex<Vec<String>>,
}

impl Pane {
    fn new() -> Arc<Pane> {
        Arc::new(Pane::default())
    }

    fn sink(self: &Arc<Pane>) -> Sink {
        let pane = Arc::clone(self);
        Arc::new(move |output| match output {
            Output::Data(data) => pane.bytes.lock().unwrap().extend_from_slice(&data),
            Output::Exit => pane.exited.store(true, Ordering::SeqCst),
            Output::Error(message) => pane.errors.lock().unwrap().push(message.to_string()),
        })
    }

    #[cfg(unix)]
    fn len(&self) -> usize {
        self.bytes.lock().unwrap().len()
    }

    fn text(&self) -> String {
        String::from_utf8_lossy(&self.bytes.lock().unwrap()).into_owned()
    }

    fn exited(&self) -> bool {
        self.exited.load(Ordering::SeqCst)
    }
}

fn wait_for(limit: Duration, mut done: impl FnMut() -> bool) -> bool {
    let until = Instant::now() + limit;
    loop {
        if done() {
            return true;
        }
        if Instant::now() >= until {
            return false;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn wait_output(pane: &Pane, expected: &str) {
    assert!(
        wait_for(Duration::from_secs(10), || pane.text().contains(expected)),
        "expected terminal output {expected:?} was not received"
    );
}

fn params(value: Value) -> Map<String, Value> {
    value.as_object().cloned().unwrap()
}

/// The request a terminal sends to learn where the cursor is, and an answer to it.
#[cfg(windows)]
const CURSOR_QUERY: &str = "\u{1b}[6n";
#[cfg(windows)]
const CURSOR_ANSWER: &str = "\u{1b}[1;1R";

fn open(terminals: &Terminals, pane: &Arc<Pane>, value: Value) -> Result<Value, String> {
    let request = params(value);
    #[cfg(windows)]
    let asked = pane.text().matches(CURSOR_QUERY).count();
    let result = terminals
        .open(&request, pane.sink())
        .map_err(|error| error.0)?;
    // The Windows pseudo-console asks the terminal where its cursor is before it starts the
    // program, and waits for the answer. A terminal emulator answers by itself; in these tests
    // the test is the terminal.
    #[cfg(windows)]
    {
        let id = request.get("id").and_then(Value::as_str).unwrap_or("");
        let asked_again = || pane.text().matches(CURSOR_QUERY).count() > asked;
        if wait_for(Duration::from_secs(10), asked_again) {
            let _ = call(
                terminals,
                "terminal.input",
                json!({"id": id, "data": CURSOR_ANSWER}),
            );
        }
    }
    Ok(result)
}

fn call(terminals: &Terminals, method: &str, value: Value) -> Result<Value, String> {
    terminals
        .handle(method, &params(value))
        .map_err(|error| error.0)
}

fn input(terminals: &Terminals, id: &str, data: &str) {
    call(terminals, "terminal.input", json!({"id": id, "data": data})).unwrap();
}

fn pid(result: &Value) -> u32 {
    u32::try_from(result["pid"].as_u64().unwrap()).unwrap()
}

#[cfg(unix)]
fn alive(pid: u32) -> bool {
    // SAFETY: signal 0 sends nothing; it only reports whether the process exists.
    let result = unsafe { libc::kill(pid as libc::pid_t, 0) };
    result == 0 || std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
}

#[cfg(windows)]
fn alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, WAIT_TIMEOUT};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
    };
    // SAFETY: the handle is checked before use and closed once.
    unsafe {
        let handle = OpenProcess(PROCESS_SYNCHRONIZE, 0, pid);
        if handle.is_null() {
            return false;
        }
        let running = WaitForSingleObject(handle, 0) == WAIT_TIMEOUT;
        CloseHandle(handle);
        running
    }
}

fn gone(pids: &[u32]) -> bool {
    wait_for(Duration::from_secs(3), || {
        pids.iter().all(|pid| !alive(*pid))
    })
}

/// The first whole number after `marker` in the pane's output, once a line break follows it.
fn number_after(pane: &Pane, marker: &str) -> u32 {
    let mut found = None;
    assert!(
        wait_for(Duration::from_secs(10), || {
            let text = pane.text();
            for (at, _) in text.match_indices(marker) {
                let rest = &text[at + marker.len()..];
                let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
                let ended = rest[digits.len()..].starts_with(['\r', '\n']);
                if !digits.is_empty() && ended {
                    found = digits.parse().ok();
                    return true;
                }
            }
            false
        }),
        "no number after {marker:?} in the terminal output: {:?}",
        pane.text()
    );
    found.unwrap()
}

/// A plain POSIX shell, so the tests do not depend on the startup files of the user's own shell.
#[cfg(unix)]
fn plain() -> Terminals {
    Terminals::with(Config {
        shell: Some(PathBuf::from("/bin/sh")),
        ..Config::default()
    })
}

#[cfg(windows)]
fn plain() -> Terminals {
    Terminals::with(Config::default())
}

fn folder(root: &Path, name: &str) -> PathBuf {
    let path = root.canonicalize().unwrap().join(name);
    std::fs::create_dir(&path).unwrap();
    path
}

/// Prints `open-sesame-marker` without the typed line containing it.
#[cfg(unix)]
const MARKER_COMMAND: &str = "printf 'open-%s-marker\\n' sesame\r";
#[cfg(windows)]
const MARKER_COMMAND: &str = "Write-Output ('open-' + 'sesame' + '-marker')\r";

/// Starts a long-running child of the shell and prints `CHILD:<pid>`. `$!` stays unquoted and
/// last on the line: an interactive shell reads `!"` as history expansion.
#[cfg(unix)]
const CHILD_COMMAND: &str = "sleep 300 & printf 'CHILD:%s\\n' $!\r";
#[cfg(windows)]
const CHILD_COMMAND: &str = "$child = Start-Process ping -ArgumentList '-n','300','127.0.0.1' -PassThru -NoNewWindow; Write-Output ('CHILD:' + $child.Id)\r";

#[test]
fn rejects_invalid_pane_id() {
    let terminals = plain();
    let pane = Pane::new();
    for id in [json!("bad id!"), json!(""), json!("x".repeat(81)), json!(7)] {
        assert_eq!(
            open(&terminals, &pane, json!({"id": id, "mode": "local"})).unwrap_err(),
            "Invalid pane ID."
        );
        assert_eq!(
            call(&terminals, "terminal.input", json!({"id": id, "data": "x"})).unwrap_err(),
            "Invalid pane ID."
        );
    }
}

#[test]
fn rejects_missing_folder() {
    let temp = tempfile::tempdir().unwrap();
    let missing = temp.path().join("missing");
    let terminals = plain();
    let pane = Pane::new();
    assert_eq!(
        open(
            &terminals,
            &pane,
            json!({"id": "a", "mode": "local", "cwd": missing})
        )
        .unwrap_err(),
        "Project folder not found on this machine. Choose an existing folder."
    );
    let file = temp.path().join("file.txt");
    std::fs::write(&file, "x").unwrap();
    assert_eq!(
        open(
            &terminals,
            &pane,
            json!({"id": "a", "mode": "local", "cwd": file})
        )
        .unwrap_err(),
        "The project folder must be a directory."
    );
    assert_eq!(
        open(
            &terminals,
            &pane,
            json!({"id": "a", "mode": "local", "cwd": 5})
        )
        .unwrap_err(),
        "Choose a valid project folder."
    );
}

#[test]
fn rejects_invalid_launch_requests() {
    let terminals = plain();
    let pane = Pane::new();
    let cases = [
        (
            json!({"id": "a", "mode": "serial"}),
            "Choose local machine or SSH.",
        ),
        (
            json!({"id": "a", "launcher": "fish"}),
            "Choose Shell, Coven agent, or Bash command.",
        ),
        (
            json!({"id": "a", "prompt": "x".repeat(2001)}),
            "Use a request under 2000 characters.",
        ),
        (
            json!({"id": "a", "prompt": "a\u{0}b"}),
            "Use a request under 2000 characters.",
        ),
        (
            json!({"id": "a", "launcher": "bash", "prompt": "  "}),
            "Enter a Bash command before launching.",
        ),
    ];
    for (request, message) in cases {
        assert_eq!(open(&terminals, &pane, request).unwrap_err(), message);
    }
}

#[test]
fn rejects_invalid_ssh_host() {
    let terminals = plain();
    let pane = Pane::new();
    for host in [
        json!("a b"),
        json!("-oProxyCommand=anything"),
        json!(""),
        json!("host;rm"),
        json!(3),
    ] {
        assert_eq!(
            open(
                &terminals,
                &pane,
                json!({"id": "a", "mode": "ssh", "host": host})
            )
            .unwrap_err(),
            "Enter an SSH hostname, tailnet name, or IP address."
        );
    }
    for user in [json!("-l"), json!("a b"), json!("9lives"), json!(4)] {
        assert_eq!(
            open(
                &terminals,
                &pane,
                json!({"id": "a", "mode": "ssh", "host": "example.test", "user": user})
            )
            .unwrap_err(),
            "Enter a valid SSH user."
        );
    }
}

#[test]
fn rejects_seventeenth_session() {
    let terminals = plain();
    let panes: Vec<Arc<Pane>> = (0..17).map(|_| Pane::new()).collect();
    let mut pids = Vec::new();
    for (index, pane) in panes.iter().take(16).enumerate() {
        let result = open(
            &terminals,
            pane,
            json!({"id": format!("pane-{index}"), "mode": "local"}),
        )
        .unwrap();
        pids.push(pid(&result));
    }
    assert_eq!(
        open(
            &terminals,
            &panes[16],
            json!({"id": "pane-16", "mode": "local"})
        )
        .unwrap_err(),
        "Close a shell before opening more than 16 active sessions."
    );
    // Reopening an existing pane replaces it and is not a seventeenth session.
    let replaced = open(
        &terminals,
        &panes[16],
        json!({"id": "pane-0", "mode": "local"}),
    )
    .unwrap();
    assert!(gone(&pids[..1]), "the replaced shell is still running");
    pids.push(pid(&replaced));
    terminals.close_all();
    assert!(gone(&pids), "a shell outlived close_all");
}

#[test]
fn input_before_open_is_refused() {
    let terminals = plain();
    for method in ["terminal.input", "terminal.resize", "terminal.close"] {
        assert_eq!(
            call(&terminals, method, json!({"id": "nobody", "data": "x"})).unwrap_err(),
            "Open this shell before sending input."
        );
    }
    assert_eq!(
        call(&terminals, "terminal.open", json!({"id": "nobody"})).unwrap_err(),
        "This shell has no output channel."
    );
}

#[test]
fn echoes_a_marker_through_the_shell() {
    // The default shell of this machine, chosen the way the app chooses it.
    let terminals = Terminals::new();
    let pane = Pane::new();
    let result = open(&terminals, &pane, json!({"id": "main", "mode": "local"})).unwrap();
    assert_eq!(result["id"], "main");
    assert!(!result["machine"].as_str().unwrap().is_empty());
    input(&terminals, "main", MARKER_COMMAND);
    wait_output(&pane, "open-sesame-marker");
    terminals.close_all();
    assert!(gone(&[pid(&result)]));
}

#[test]
fn opens_in_a_folder_with_spaces_and_unicode() {
    let temp = tempfile::tempdir().unwrap();
    let project = folder(temp.path(), "open sesame ünï");
    let terminals = plain();
    let pane = Pane::new();
    let result = open(
        &terminals,
        &pane,
        json!({"id": "main", "mode": "local", "cwd": project}),
    )
    .unwrap();
    input(&terminals, "main", "pwd\r");
    wait_output(&pane, "open sesame ünï");
    terminals.close_all();
    assert!(gone(&[pid(&result)]));
}

#[test]
fn exit_emits_terminal_exit() {
    let terminals = plain();
    let pane = Pane::new();
    let result = open(&terminals, &pane, json!({"id": "main", "mode": "local"})).unwrap();
    input(&terminals, "main", "exit\r");
    assert!(
        wait_for(Duration::from_secs(10), || pane.exited()),
        "no exit message"
    );
    assert!(gone(&[pid(&result)]));
    assert!(pane.errors.lock().unwrap().is_empty());
    assert_eq!(
        call(
            &terminals,
            "terminal.input",
            json!({"id": "main", "data": "x"})
        )
        .unwrap_err(),
        "This shell has ended. Reopen the pane to reconnect."
    );
    // An ended pane does not count against the limit and can be reopened under the same ID.
    let again = open(&terminals, &pane, json!({"id": "main", "mode": "local"})).unwrap();
    terminals.close_all();
    assert!(gone(&[pid(&again)]));
}

#[test]
fn close_kills_the_whole_process_tree() {
    let terminals = plain();
    let pane = Pane::new();
    let result = open(&terminals, &pane, json!({"id": "main", "mode": "local"})).unwrap();
    input(&terminals, "main", CHILD_COMMAND);
    let child = number_after(&pane, "CHILD:");
    assert!(alive(child), "the child process never ran");
    call(&terminals, "terminal.close", json!({"id": "main"})).unwrap();
    assert!(
        gone(&[pid(&result), child]),
        "the shell or its child outlived the pane"
    );
}

/// A child that ignores the hang-up signal and sits in its own process group, as a job started
/// by an interactive shell does, is still killed: the whole session is, not one group.
#[cfg(unix)]
#[test]
fn close_kills_children_that_ignore_hangup() {
    let terminals = Terminals::with(Config {
        shell: Some(PathBuf::from("/bin/bash")),
        ..Config::default()
    });
    let pane = Pane::new();
    let result = open(&terminals, &pane, json!({"id": "main", "mode": "local"})).unwrap();
    input(
        &terminals,
        "main",
        "set -m; nohup sleep 300 >/dev/null 2>&1 & printf 'CHILD:%s\\n' $!\r",
    );
    let child = number_after(&pane, "CHILD:");
    assert!(alive(child));
    call(&terminals, "terminal.close", json!({"id": "main"})).unwrap();
    assert!(
        gone(&[pid(&result), child]),
        "a child that ignores hang-up outlived the pane"
    );
}

#[test]
fn close_all_leaves_no_children() {
    let terminals = plain();
    let mut pids = Vec::new();
    let panes: Vec<Arc<Pane>> = (0..3).map(|_| Pane::new()).collect();
    for (index, pane) in panes.iter().enumerate() {
        let id = format!("pane-{index}");
        let result = open(&terminals, pane, json!({"id": id, "mode": "local"})).unwrap();
        pids.push(pid(&result));
        input(&terminals, &id, CHILD_COMMAND);
        pids.push(number_after(pane, "CHILD:"));
    }
    assert!(pids.iter().all(|pid| alive(*pid)));
    terminals.close_all();
    assert!(gone(&pids), "a shell or a child outlived close_all");
    assert_eq!(
        call(
            &terminals,
            "terminal.input",
            json!({"id": "pane-0", "data": "x"})
        )
        .unwrap_err(),
        "Open this shell before sending input."
    );
}

#[test]
fn input_limits_and_binary_input() {
    let terminals = plain();
    let pane = Pane::new();
    let result = open(&terminals, &pane, json!({"id": "main", "mode": "local"})).unwrap();
    assert_eq!(
        call(
            &terminals,
            "terminal.input",
            json!({"id": "main", "data": "x".repeat(131_073)})
        )
        .unwrap_err(),
        "Terminal input is too large."
    );
    assert_eq!(
        call(
            &terminals,
            "terminal.input",
            json!({"id": "main", "data": 5})
        )
        .unwrap_err(),
        "Terminal input is too large."
    );
    assert_eq!(
        call(
            &terminals,
            "terminal.input",
            json!({"id": "main", "data": "not base64!", "binary": true})
        )
        .unwrap_err(),
        "Terminal input is not valid."
    );
    // "exit\r" as base64.
    call(
        &terminals,
        "terminal.input",
        json!({"id": "main", "data": "ZXhpdA0=", "binary": true}),
    )
    .unwrap();
    assert!(
        wait_for(Duration::from_secs(10), || pane.exited()),
        "binary input did not reach the shell"
    );
    assert!(gone(&[pid(&result)]));
}

/// Prints `SIZE:<columns>x<rows>` as the program sees its terminal. The typed line never
/// contains that text itself.
#[cfg(unix)]
const SIZE_COMMAND: &str = "stty size | awk '{ print \"SIZE:\" $2 \"x\" $1 }'\r";
#[cfg(windows)]
const SIZE_COMMAND: &str =
    "Write-Output ('SIZE:' + [Console]::WindowWidth + 'x' + [Console]::WindowHeight)\r";

/// Prints `RUNNING`, then waits thirty seconds.
#[cfg(unix)]
const WAIT_COMMAND: &str = "printf 'RUN%s\\n' NING; sleep 30\r";
#[cfg(windows)]
const WAIT_COMMAND: &str = "Write-Output ('RUN' + 'NING'); Start-Sleep -Seconds 30\r";

#[cfg(unix)]
const AFTER_COMMAND: &str = "printf 'AFTER-%s\\n' INTERRUPT\r";
#[cfg(windows)]
const AFTER_COMMAND: &str = "Write-Output ('AFTER-' + 'INTERRUPT')\r";

/// A resize reaches the program: POSIX window size on Unix, the pseudo-console on Windows.
#[test]
fn a_resize_reaches_the_program() {
    let terminals = plain();
    let pane = Pane::new();
    let result = open(
        &terminals,
        &pane,
        json!({"id": "main", "mode": "local", "cols": 80, "rows": 24}),
    )
    .unwrap();
    call(
        &terminals,
        "terminal.resize",
        json!({"id": "main", "cols": 117, "rows": 31}),
    )
    .unwrap();
    input(&terminals, "main", SIZE_COMMAND);
    wait_output(&pane, "SIZE:117x31");
    terminals.close_all();
    assert!(gone(&[pid(&result)]));
}

/// Control+C, typed as the byte the emulator sends for it, stops the running command, and the
/// shell takes the next one long before the thirty-second wait would have ended by itself.
#[test]
fn control_c_interrupts_the_running_command() {
    let terminals = plain();
    let pane = Pane::new();
    let result = open(&terminals, &pane, json!({"id": "main", "mode": "local"})).unwrap();
    input(&terminals, "main", WAIT_COMMAND);
    wait_output(&pane, "RUNNING");
    std::thread::sleep(Duration::from_millis(300));
    let started = Instant::now();
    input(&terminals, "main", "\u{3}");
    std::thread::sleep(Duration::from_millis(300));
    input(&terminals, "main", AFTER_COMMAND);
    wait_output(&pane, "AFTER-INTERRUPT");
    assert!(
        started.elapsed() < Duration::from_secs(15),
        "the shell took the next command only after the wait ended by itself"
    );
    terminals.close_all();
    assert!(gone(&[pid(&result)]));
}

/// A pane cannot be opened once the terminals have been shut down for Quit.
#[test]
fn nothing_opens_after_shut_down() {
    let terminals = plain();
    let pane = Pane::new();
    let result = open(&terminals, &pane, json!({"id": "main", "mode": "local"})).unwrap();
    terminals.shut_down();
    assert!(gone(&[pid(&result)]));
    assert_eq!(
        open(&terminals, &pane, json!({"id": "late", "mode": "local"})).unwrap_err(),
        "Open Sesame is quitting."
    );
}

#[cfg(unix)]
mod unix {
    use super::*;
    use open_sesame_core::terminal::HIGH_WATER;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn project_shells_are_real_and_isolated() {
        let temp = tempfile::tempdir().unwrap();
        let one = folder(temp.path(), "project one");
        let two = folder(temp.path(), "project two");
        let terminals = plain();
        let (first_pane, second_pane) = (Pane::new(), Pane::new());
        let first = open(
            &terminals,
            &first_pane,
            json!({"id": "first", "mode": "local", "cwd": one, "cols": 80, "rows": 24}),
        )
        .unwrap();
        let second = open(
            &terminals,
            &second_pane,
            json!({"id": "second", "mode": "local", "cwd": two, "cols": 80, "rows": 24}),
        )
        .unwrap();
        assert_ne!(pid(&first), pid(&second));
        input(&terminals, "first", "printf \"__ONE__%s\\n\" \"$PWD\"\r");
        input(&terminals, "second", "printf \"__TWO__%s\\n\" \"$PWD\"\r");
        wait_output(&first_pane, &format!("__ONE__{}", one.display()));
        wait_output(&second_pane, &format!("__TWO__{}", two.display()));
        assert!(!first_pane.text().contains("__TWO__"));
        input(
            &terminals,
            "first",
            "test -t 0 && printf \"__CONTROLLING_TTY__\\n\"\r",
        );
        wait_output(&first_pane, "__CONTROLLING_TTY__\r\n");
        input(
            &terminals,
            "first",
            "printf '__ENV__%s:%s\\n' \"$TERM\" \"$COLORTERM\"\r",
        );
        wait_output(&first_pane, "__ENV__xterm-256color:truecolor");
        terminals.close_all();
        assert!(gone(&[pid(&first), pid(&second)]));
    }

    #[test]
    fn resize_completion_and_interrupt() {
        let temp = tempfile::tempdir().unwrap();
        let one = folder(temp.path(), "project one");
        std::fs::write(one.join("alpha-project.txt"), "OPEN_SESAME_COMPLETION_OK\n").unwrap();
        // Completion needs a shell with line editing; bash is present on macOS and Linux.
        let terminals = Terminals::with(Config {
            shell: Some(PathBuf::from("/bin/bash")),
            ..Config::default()
        });
        let pane = Pane::new();
        let result = open(
            &terminals,
            &pane,
            json!({"id": "main", "mode": "local", "cwd": one, "cols": 80, "rows": 24}),
        )
        .unwrap();
        call(
            &terminals,
            "terminal.resize",
            json!({"id": "main", "cols": 117, "rows": 31}),
        )
        .unwrap();
        input(&terminals, "main", "stty size\r");
        wait_output(&pane, "31 117");
        // Sizes outside the limits are clamped, as the Python bridge clamps them.
        call(
            &terminals,
            "terminal.resize",
            json!({"id": "main", "cols": 5000, "rows": 1}),
        )
        .unwrap();
        input(&terminals, "main", "stty size\r");
        wait_output(&pane, "3 400");
        input(&terminals, "main", "cat alpha-pro\t\r");
        wait_output(&pane, "OPEN_SESAME_COMPLETION_OK");
        input(&terminals, "main", "sleep 20\r");
        std::thread::sleep(Duration::from_millis(200));
        input(&terminals, "main", "\u{3}");
        input(&terminals, "main", "printf \"__INTERRUPT_OK__\\n\"\r");
        wait_output(&pane, "__INTERRUPT_OK__\r\n");
        terminals.close_all();
        assert!(gone(&[pid(&result)]));
    }

    #[test]
    fn connection_validation_and_cleanup() {
        let temp = tempfile::tempdir().unwrap();
        let one = folder(temp.path(), "project one");
        let terminals = plain();
        let pane = Pane::new();
        assert!(open(
            &terminals,
            &pane,
            json!({"id": "bad", "mode": "ssh", "host": "-oProxyCommand=anything"})
        )
        .is_err());
        assert!(open(
            &terminals,
            &pane,
            json!({"id": "bad", "mode": "local", "cwd": one.join("missing")})
        )
        .is_err());
        let result = open(
            &terminals,
            &pane,
            json!({"id": "close", "mode": "local", "cwd": one, "cols": 80, "rows": 24}),
        )
        .unwrap();
        call(&terminals, "terminal.close", json!({"id": "close"})).unwrap();
        assert!(
            !alive(pid(&result)),
            "the shell is still there when close returns"
        );
        assert!(call(
            &terminals,
            "terminal.input",
            json!({"id": "close", "data": "echo no\r"})
        )
        .is_err());
    }

    /// A stand-in for `ssh` that prints the arguments it was given, one per line.
    fn fake_ssh(folder: &Path) -> PathBuf {
        let path = folder.join("fake-ssh");
        std::fs::write(
            &path,
            "#!/bin/sh\nfor argument in \"$@\"; do printf 'ARG<%s>\\n' \"$argument\"; done\nprintf 'TTY:%s\\n' \"$(test -t 0 && echo yes)\"\n",
        )
        .unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    #[test]
    fn ssh_runs_the_client_with_exact_arguments() {
        let temp = tempfile::tempdir().unwrap();
        let terminals = Terminals::with(Config {
            ssh: Some(fake_ssh(temp.path())),
            ..Config::default()
        });
        let pane = Pane::new();
        let result = open(
            &terminals,
            &pane,
            json!({"id": "remote", "mode": "ssh", "host": "box.tail.example", "user": "val", "cwd": "/srv/my project"}),
        )
        .unwrap();
        assert_eq!(result["machine"], "box.tail.example");
        wait_output(&pane, "TTY:yes");
        let text = pane.text();
        assert!(text.contains("ARG<-tt>\r\n"), "{text}");
        assert!(text.contains("ARG<val@box.tail.example>\r\n"), "{text}");
        assert!(
            text.contains("ARG<cd -- '/srv/my project' && exec \"${SHELL:-/bin/sh}\" -l>\r\n"),
            "{text}"
        );
        assert!(wait_for(Duration::from_secs(10), || pane.exited()));

        let pane = Pane::new();
        open(
            &terminals,
            &pane,
            json!({"id": "agent", "mode": "ssh", "host": "192.0.2.7", "launcher": "coven", "prompt": "fix it's bug"}),
        )
        .unwrap();
        wait_output(&pane, "TTY:yes");
        let text = pane.text();
        assert!(text.contains("ARG<192.0.2.7>\r\n"), "{text}");
        assert!(
            text.contains("ARG<exec \"${SHELL:-/bin/sh}\" -l -i -c 'exec coven \"$1\"' open-sesame-agent 'Task: fix it'\"'\"'s bug'>\r\n"),
            "{text}"
        );

        let pane = Pane::new();
        open(
            &terminals,
            &pane,
            json!({"id": "bash", "mode": "ssh", "host": "2001:db8::1", "launcher": "bash", "prompt": "ls -la", "cwd": "/tmp"}),
        )
        .unwrap();
        wait_output(&pane, "TTY:yes");
        assert!(
            pane.text()
                .contains("ARG<cd -- /tmp && exec bash -l -c 'ls -la'>\r\n"),
            "{}",
            pane.text()
        );
        terminals.close_all();
        assert!(gone(&[pid(&result)]));
    }

    #[test]
    fn a_missing_ssh_client_is_an_ordinary_error() {
        let temp = tempfile::tempdir().unwrap();
        let terminals = Terminals::with(Config {
            ssh: Some(temp.path().join("no-such-ssh")),
            ..Config::default()
        });
        assert_eq!(
            open(
                &terminals,
                &Pane::new(),
                json!({"id": "remote", "mode": "ssh", "host": "example.test"})
            )
            .unwrap_err(),
            "OpenSSH is not installed on this machine."
        );
    }

    #[test]
    fn the_bash_launcher_runs_one_command() {
        let terminals = plain();
        let pane = Pane::new();
        let result = open(
            &terminals,
            &pane,
            json!({"id": "bash", "mode": "local", "launcher": "bash", "prompt": "printf 'bash-%s-ran\\n' launcher"}),
        )
        .unwrap();
        wait_output(&pane, "bash-launcher-ran");
        assert!(wait_for(Duration::from_secs(10), || pane.exited()));
        assert!(gone(&[pid(&result)]));
    }

    /// A long paste reaches the program whole. On macOS a shell that edits lines switches the
    /// terminal's mode at every line end, and input already waiting then can come out damaged,
    /// so the pane types a line at a time there. Each shell here reads a here-document of 1,500
    /// numbered lines sent as one input.
    #[test]
    fn a_large_paste_reaches_the_shell_intact() {
        let root = tempfile::tempdir().unwrap();
        let body: String = (1..=1500)
            .map(|n| format!("line {n} of the pasted text\r"))
            .collect();
        let expected = body.replace('\r', "\n");
        assert!(expected.len() > 40_000);
        for (name, launch) in [
            ("sh", json!({"launcher": "bash", "prompt": "exec /bin/sh"})),
            (
                "bash",
                json!({"launcher": "bash", "prompt": "exec /bin/bash"}),
            ),
            ("default", json!({})),
        ] {
            let terminals = plain();
            let pane = Pane::new();
            let mut request = params(json!({"id": name, "mode": "local"}));
            request.extend(params(launch));
            open(&terminals, &pane, Value::Object(request)).unwrap();
            let file = root.path().join(name);
            let data = format!(
                " cat > '{}' <<'PASTE_END'\r{body}PASTE_END\r printf 'paste-%s\\n' done\r",
                file.display()
            );
            input(&terminals, name, &data);
            assert!(
                wait_for(Duration::from_secs(60), || pane
                    .text()
                    .contains("paste-done")),
                "{name}: the shell never finished reading the paste"
            );
            let written = std::fs::read_to_string(&file).unwrap();
            assert!(
                written == expected,
                "{name}: the paste was damaged ({} of {} bytes)",
                written.len(),
                expected.len()
            );
            call(&terminals, "terminal.close", json!({"id": name})).unwrap();
        }
    }

    /// Input for a program that is not reading is queued without holding the request, refused
    /// with a sentence once a megabyte is waiting, and does not keep the pane from closing.
    #[test]
    fn input_to_a_program_that_is_not_reading_never_blocks() {
        let terminals = plain();
        let pane = Pane::new();
        let result = open(&terminals, &pane, json!({"id": "busy", "mode": "local"})).unwrap();
        input(
            &terminals,
            "busy",
            "stty -echo; printf 'now-%s\\n' busy; sleep 300\r",
        );
        wait_output(&pane, "now-busy");
        let block = "x".repeat(100_000);
        let started = Instant::now();
        let mut refused = None;
        for _ in 0..40 {
            if let Err(error) = call(
                &terminals,
                "terminal.input",
                json!({"id": "busy", "data": block}),
            ) {
                refused = Some(error);
                break;
            }
        }
        assert_eq!(
            refused.as_deref(),
            Some("This shell is not reading its input. Wait for it, or close the pane.")
        );
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "input requests waited for the program"
        );
        let started = Instant::now();
        call(&terminals, "terminal.close", json!({"id": "busy"})).unwrap();
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "close waited for queued input"
        );
        assert!(gone(&[pid(&result)]));
        assert!(wait_for(Duration::from_secs(5), || pane.exited()));
    }

    /// Output stops when the emulator falls behind by the high-water mark and resumes once it
    /// acknowledges, and nothing is lost or reordered across the pause.
    #[test]
    fn output_pauses_until_acknowledged_and_loses_nothing() {
        let terminals = plain();
        let pane = Pane::new();
        let result = open(&terminals, &pane, json!({"id": "main", "mode": "local"})).unwrap();
        // 600,000 numbered lines, about 4 MB. `stty -echo -opost` keeps the typed command out
        // of the checked output and stops the terminal from rewriting line ends, so the bytes
        // that arrive are exactly the bytes the program wrote. (With line-end rewriting on, the
        // macOS kernel now and then writes a second carriage return when its queue is full.)
        // `set +m` turns job control off: with it on, the macOS `sh` now and then prints
        // `sh: child setpgid (N to N): Operation not permitted` when it starts `awk` on a busy
        // machine, and that line lands between the markers (seen in 1 run of 40 under load).
        input(
            &terminals,
            "main",
            "stty -echo -opost; set +m; printf '__START__\n'; awk 'BEGIN { for (i = 1; i <= 600000; i++) print i }'; printf '__END__\n'\r",
        );
        let limit = HIGH_WATER as usize + 256 * 1024;
        assert!(
            wait_for(Duration::from_secs(20), || pane.len()
                >= HIGH_WATER as usize),
            "output never reached the high-water mark"
        );
        // Nothing acknowledged: the stream has to stop near the mark and stay stopped.
        std::thread::sleep(Duration::from_millis(500));
        let paused_at = pane.len();
        assert!(
            paused_at <= limit,
            "{paused_at} bytes were sent without any acknowledgement"
        );
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(pane.len(), paused_at, "output kept flowing while paused");
        assert!(!pane.text().contains("__END__\n"));

        // Acknowledge as an emulator does, and the rest arrives.
        let finished = wait_for(Duration::from_secs(60), || {
            let received = pane.len();
            call(
                &terminals,
                "terminal.ack",
                json!({"id": "main", "bytes": received}),
            )
            .unwrap();
            pane.text().contains("__END__\n")
        });
        assert!(finished, "output did not resume after acknowledgement");
        let text = pane.text();
        let body = &text[text.find("__START__\n").unwrap() + 10..text.rfind("__END__\n").unwrap()];
        let expected: String = (1..=600_000).map(|line| format!("{line}\n")).collect();
        assert_eq!(body.len(), expected.len(), "output lost or duplicated");
        assert!(body == expected, "output reordered or changed");
        terminals.close_all();
        assert!(gone(&[pid(&result)]));
    }

    /// A character whose bytes the program writes apart arrives as two messages, split inside
    /// the character, with every byte unchanged: the core never turns output into text. Joining
    /// the halves is the emulator's job, checked in the launched app's self-test.
    #[test]
    fn a_character_split_between_two_messages_keeps_every_byte() {
        let terminals = plain();
        let pane = Arc::new(Split::default());
        let sink: Sink = {
            let pane = Arc::clone(&pane);
            Arc::new(move |output| {
                if let Output::Data(data) = output {
                    pane.messages.lock().unwrap().push(data);
                }
            })
        };
        let result = terminals
            .open(&params(json!({"id": "main", "mode": "local"})), sink)
            .unwrap();
        // é, € and 🦊, each written in two halves 300 ms apart.
        input(
            &terminals,
            "main",
            "stty -echo; printf 'S:\\303'; sleep 0.3; printf '\\251:\\342\\202'; sleep 0.3; printf '\\254:\\360\\237'; sleep 0.3; printf '\\246\\212:E\\n'\r",
        );
        let expected = "S:é:€:🦊:E".as_bytes();
        let found = |pane: &Split| {
            let all = pane.messages.lock().unwrap().concat();
            all.windows(expected.len())
                .position(|window| window == expected)
        };
        assert!(
            wait_for(Duration::from_secs(10), || found(&pane).is_some()),
            "the characters did not arrive byte for byte"
        );
        let at = found(&pane).unwrap();
        let mut end = 0;
        let inside: Vec<usize> = pane
            .messages
            .lock()
            .unwrap()
            .iter()
            .filter_map(|message| {
                end += message.len();
                (end > at && end < at + expected.len()).then(|| end - at)
            })
            .collect();
        // Offsets 3, 7 and 11 are inside é (2..4), € (5..8) and 🦊 (9..13).
        assert_eq!(
            inside,
            [3, 7, 11],
            "the messages were not split inside the characters"
        );
        terminals.close_all();
        assert!(gone(&[pid(&result)]));
    }

    /// The messages one pane's sink received, each as it arrived.
    #[derive(Default)]
    struct Split {
        messages: Mutex<Vec<Vec<u8>>>,
    }

    /// Closing a pane whose output is paused does not wait for an acknowledgement.
    #[test]
    fn closing_a_paused_pane_returns_promptly() {
        let terminals = plain();
        let pane = Pane::new();
        let result = open(&terminals, &pane, json!({"id": "main", "mode": "local"})).unwrap();
        input(&terminals, "main", "yes open-sesame\r");
        assert!(wait_for(Duration::from_secs(20), || {
            pane.len() >= HIGH_WATER as usize
        }));
        let started = Instant::now();
        call(&terminals, "terminal.close", json!({"id": "main"})).unwrap();
        assert!(started.elapsed() < Duration::from_secs(3));
        assert!(gone(&[pid(&result)]));
    }
}
