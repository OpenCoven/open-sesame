//! The bounded process runner (issue #73), tested against the real fixture binary.
//!
//! Every test that expects a kill also has a time limit, and the tests that start a grandchild
//! check that it has stopped by watching a counter it writes, not by trusting a PID.

use open_sesame_core::process::{run, Cancel, Output, Run, RunError};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

fn fixture(args: &[&str]) -> Run {
    let mut run = Run::new(env!("CARGO_BIN_EXE_fixture_cli"));
    run.args = args.iter().map(|arg| arg.to_string()).collect();
    run.timeout = Duration::from_secs(20);
    run
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8(bytes.to_vec()).unwrap()
}

fn ok(run_request: Run) -> Output {
    run(run_request, None).unwrap()
}

/// The counter the heartbeat child last wrote, or 0 when it has not written yet.
fn beat(file: &Path) -> u64 {
    for _ in 0..20 {
        if let Some(count) = std::fs::read_to_string(file).ok().and_then(|text| text.trim().parse().ok()) {
            return count;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    0
}

/// Fails unless the heartbeat child ran and has now stopped.
fn assert_stopped(file: &Path) {
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let before = beat(file);
        std::thread::sleep(Duration::from_millis(300));
        let after = beat(file);
        if before > 0 && before == after {
            return;
        }
        assert!(Instant::now() < deadline, "the grandchild is still running (counter {before} -> {after})");
    }
}

#[test]
fn missing_program_is_not_found() {
    let by_name = run(Run::new("open-sesame-no-such-program-73"), None);
    assert_eq!(by_name.unwrap_err(), RunError::NotFound);
    let by_path = run(Run::new(std::env::temp_dir().join("no-such-dir-73").join("tool")), None);
    assert_eq!(by_path.unwrap_err(), RunError::NotFound);
    assert_eq!(RunError::NotFound.to_string(), "That program is not installed or could not be found.");
}

#[test]
fn captures_stdout_and_exit_status() {
    let output = ok(fixture(&["echo-args", "a", "b c"]));
    assert_eq!(output.status, Some(0));
    assert_eq!(text(&output.stdout).replace('\r', ""), "a\nb c\n");
    assert!(output.stderr.is_empty());
}

/// A non-zero exit is a result, not a runner failure, and both streams are kept apart.
#[test]
fn nonzero_exit_and_stderr_are_returned() {
    let output = ok(fixture(&["exit", "7"]));
    assert_eq!(output.status, Some(7));
    assert_eq!(text(&output.stdout).trim(), "to stdout");
    assert_eq!(text(&output.stderr).trim(), "to stderr");
}

#[test]
fn streams_lines_in_order() {
    let mut seen = Vec::new();
    let mut on_line = |line: &str| seen.push(line.to_string());
    let output = run(fixture(&["lines", "3"]), Some(&mut on_line)).unwrap();
    assert_eq!(seen, ["1", "2", "3"]);
    assert_eq!(text(&output.stdout).replace('\r', ""), "1\n2\n3\n");
}

/// Only complete lines are streamed; an unterminated tail stays in the output. A trailing
/// carriage return is not part of the line.
#[test]
fn an_unterminated_last_line_is_not_streamed() {
    let mut seen = Vec::new();
    let mut on_line = |line: &str| seen.push(line.to_string());
    let output = run(fixture(&["partial"]), Some(&mut on_line)).unwrap();
    assert_eq!(seen, ["one", "two"]);
    assert!(text(&output.stdout).ends_with("three"));
}

#[test]
fn timeout_kills_the_child() {
    let mut request = fixture(&["sleep", "30"]);
    request.timeout = Duration::from_millis(300);
    let started = Instant::now();
    assert_eq!(run(request, None).unwrap_err(), RunError::Timeout);
    assert!(started.elapsed() < Duration::from_secs(3), "{:?}", started.elapsed());
}

#[test]
fn cancel_kills_the_child() {
    let cancel = Cancel::new();
    let mut request = fixture(&["sleep", "30"]);
    request.cancel = Some(cancel.clone());
    let canceller = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(200));
        cancel.cancel();
    });
    let started = Instant::now();
    assert_eq!(run(request, None).unwrap_err(), RunError::Cancelled);
    assert!(started.elapsed() < Duration::from_secs(3), "{:?}", started.elapsed());
    canceller.join().unwrap();
}

#[test]
fn a_request_cancelled_before_it_starts_runs_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("beat");
    let cancel = Cancel::new();
    cancel.cancel();
    assert!(cancel.is_cancelled());
    let mut request = fixture(&["spawn-child-and-exit", file.to_str().unwrap()]);
    request.cancel = Some(cancel);
    assert_eq!(run(request, None).unwrap_err(), RunError::Cancelled);
    std::thread::sleep(Duration::from_millis(200));
    assert!(!file.exists(), "nothing was started");
}

#[test]
fn output_cap_is_enforced() {
    let mut request = fixture(&["flood", "1000000"]);
    request.max_output = 1024;
    let started = Instant::now();
    assert_eq!(run(request, None).unwrap_err(), RunError::TooLarge);
    assert!(started.elapsed() < Duration::from_secs(3));
}

#[test]
fn output_cap_counts_stderr_and_allows_exactly_the_cap() {
    let mut request = fixture(&["flood-stderr", "1000000"]);
    request.max_output = 1024;
    assert_eq!(run(request, None).unwrap_err(), RunError::TooLarge);

    let mut request = fixture(&["flood", "1024"]);
    request.max_output = 1024;
    assert_eq!(ok(request).stdout.len(), 1024);
}

#[test]
fn grandchild_is_killed_on_timeout() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("beat");
    let mut request = fixture(&["spawn-child-and-sleep", file.to_str().unwrap()]);
    request.timeout = Duration::from_millis(600);
    let mut pid = String::new();
    let mut on_line = |line: &str| pid = line.to_string();
    assert_eq!(run(request, Some(&mut on_line)).unwrap_err(), RunError::Timeout);
    assert!(pid.parse::<u32>().is_ok(), "the fixture printed the grandchild's PID: {pid:?}");
    assert_stopped(&file);
}

#[test]
fn grandchild_is_killed_on_cancel() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("beat");
    let cancel = Cancel::new();
    let mut request = fixture(&["spawn-child-and-sleep", file.to_str().unwrap()]);
    request.cancel = Some(cancel.clone());
    let canceller = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(600));
        cancel.cancel();
    });
    assert_eq!(run(request, None).unwrap_err(), RunError::Cancelled);
    canceller.join().unwrap();
    assert_stopped(&file);
}

/// The program exits at once and leaves a child holding its output pipes. The run ends with the
/// program's own exit status soon after, without waiting for the timeout, and the child is killed.
#[test]
fn a_child_left_behind_by_a_finished_program_is_killed() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("beat");
    let started = Instant::now();
    let output = ok(fixture(&["spawn-child-and-exit", file.to_str().unwrap()]));
    assert_eq!(output.status, Some(0));
    assert!(started.elapsed() < Duration::from_secs(5), "{:?}", started.elapsed());
    assert!(text(&output.stdout).trim().parse::<u32>().is_ok());
    assert_stopped(&file);
}

#[test]
fn runs_in_a_cwd_with_spaces_and_unicode() {
    let dir = tempfile::tempdir().unwrap();
    let cwd = dir.path().join("with space é 日本語");
    std::fs::create_dir(&cwd).unwrap();
    let mut request = fixture(&["cwd"]);
    request.cwd = Some(cwd.clone());
    let output = ok(request);
    let reported = PathBuf::from(text(&output.stdout).trim_end_matches(['\r', '\n']));
    assert_eq!(reported.canonicalize().unwrap(), cwd.canonicalize().unwrap());
}

/// Arguments reach the program as given. Nothing is passed through a shell.
#[test]
fn arguments_are_passed_exactly() {
    let args = ["two words", "é 日本語", "$HOME", "a;b", "\"quoted\"", "*", "--flag=value", ""];
    let mut all = vec!["echo-args"];
    all.extend(args);
    let output = ok(fixture(&all));
    let lines: Vec<String> = text(&output.stdout).replace('\r', "").split('\n').map(str::to_string).collect();
    assert_eq!(&lines[..args.len()], &args[..]);
}

#[test]
fn stdin_is_written_then_closed() {
    let mut request = fixture(&["cat"]);
    request.stdin = Some(b"from the caller".to_vec());
    assert_eq!(text(&ok(request).stdout), "from the caller");
    // Without input the program sees end of input at once instead of waiting.
    let started = Instant::now();
    assert!(ok(fixture(&["cat"])).stdout.is_empty());
    assert!(started.elapsed() < Duration::from_secs(5));
}

/// Input larger than a pipe's buffer, to a program that never reads it, does not block the run.
#[test]
fn unread_stdin_does_not_block_the_run() {
    let mut request = fixture(&["sleep", "30"]);
    request.stdin = Some(vec![b'x'; 4 * 1024 * 1024]);
    request.timeout = Duration::from_millis(300);
    let started = Instant::now();
    assert_eq!(run(request, None).unwrap_err(), RunError::Timeout);
    assert!(started.elapsed() < Duration::from_secs(3));
}

#[test]
fn environment_is_added_or_replaced() {
    let mut request = fixture(&["env", "OPEN_SESAME_FIXTURE_VALUE"]);
    request.env = vec![("OPEN_SESAME_FIXTURE_VALUE".into(), "added é".into())];
    assert_eq!(text(&ok(request).stdout).trim(), "added é");

    // With a cleared environment only the given variables exist.
    let name = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    assert_eq!(ok(fixture(&["env", name])).status, Some(0), "{name} is inherited by default");
    let mut request = fixture(&["env", name]);
    request.clear_env = true;
    if cfg!(windows) {
        // Windows programs need SystemRoot to start.
        request.env = vec![("SystemRoot".into(), std::env::var("SystemRoot").unwrap())];
    }
    assert_eq!(ok(request).status, Some(1));
}

#[test]
fn a_missing_working_directory_is_an_error() {
    let mut request = fixture(&["cwd"]);
    request.cwd = Some(std::env::temp_dir().join("open-sesame-no-such-dir-73"));
    assert!(matches!(run(request, None), Err(RunError::Io(_))));
}

/// A callback that panics still leaves no process behind.
#[test]
fn a_panicking_callback_still_kills_the_tree() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("beat");
    let request = fixture(&["spawn-child-and-sleep", file.to_str().unwrap()]);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
        let mut on_line = |_: &str| {
            std::thread::sleep(Duration::from_millis(300));
            panic!("the caller's callback failed");
        };
        let _ = run(request, Some(&mut on_line));
    }));
    assert!(result.is_err());
    assert_stopped(&file);
}

#[test]
fn errors_are_plain_sentences_without_details() {
    for error in [RunError::NotFound, RunError::Timeout, RunError::Cancelled, RunError::TooLarge, RunError::Io("os error 13: /private/path".into())] {
        let message = error.to_string();
        assert!(message.ends_with('.') && !message.contains("/private/path") && !message.contains("os error"), "{message}");
    }
}
