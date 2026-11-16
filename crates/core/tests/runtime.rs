//! Application-owned storage and discovery, using disposable data only.
use open_sesame_core::{
    storage::{Storage, StorageError, DATABASE_FILE},
    Core,
};
use serde_json::{json, Value};

fn call(core: &Core, method: &str, params: Value) -> open_sesame_core::protocol::BridgeResult {
    core.handle(method, params.as_object().unwrap())
}

#[test]
fn saved_data_survives_shutdown_while_the_old_core_remains_alive() {
    let dir = tempfile::tempdir().unwrap();
    let core = Core::with_storage(Storage::open_in(dir.path()));
    let saved = call(
        &core,
        "items.save",
        json!({"item":{"kind":"note","text":"Keep this after Quit"}}),
    )
    .unwrap();
    assert!(core.shutdown());
    assert!(
        !dir.path().join(format!("{DATABASE_FILE}-wal")).exists(),
        "shutdown must close SQLite, not just reject later calls"
    );
    let reopened = Core::with_storage(Storage::open_in(dir.path()));
    let listed = call(&reopened, "items.list", json!({})).unwrap();
    assert_eq!(listed["items"][0], saved["item"]);
    assert!(call(&core, "items.list", json!({})).is_err());
    reopened.shutdown();
}

#[test]
fn an_open_failure_keeps_system_info_available_and_never_reports_saved() {
    let core = Core::with_storage(Err(StorageError::Unreadable(
        "private operating system detail".into(),
    )));
    assert!(call(&core, "system.info", json!({})).is_ok());
    for (method, params) in [
        ("items.list", json!({})),
        (
            "items.save",
            json!({"item":{"kind":"note","text":"unsaved"}}),
        ),
    ] {
        let error = call(&core, method, params).unwrap_err().to_string();
        assert_eq!(
            error,
            "Open Sesame could not open its data file. The file has not been changed."
        );
        assert!(!error.contains("private"));
    }
}

#[test]
fn a_newer_database_is_refused_without_changing_it() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(DATABASE_FILE);
    drop(Storage::open_in(dir.path()).unwrap());
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute("UPDATE schema_version SET version = 999", [])
        .unwrap();
    drop(conn);
    let before = std::fs::read(&path).unwrap();
    let core = Core::with_storage(Storage::open_in(dir.path()));
    let error = call(&core, "items.list", json!({}))
        .unwrap_err()
        .to_string();
    assert!(error.contains("newer version"), "{error}");
    core.shutdown();
    assert_eq!(std::fs::read(&path).unwrap(), before);
}

#[test]
fn a_directory_that_cannot_hold_a_database_is_a_recoverable_error() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("regular-file");
    std::fs::write(&file, b"preserve").unwrap();
    let core = Core::with_storage(Storage::open_in(&file.join("child")));
    assert!(call(&core, "items.list", json!({})).is_err());
    assert!(call(&core, "system.info", json!({})).is_ok());
    assert_eq!(std::fs::read(file).unwrap(), b"preserve");
}

#[test]
fn shutdown_refuses_a_late_storage_initialization_and_initialization_happens_once() {
    let core = Core::new();
    assert!(call(&core, "items.list", json!({})).is_err());
    assert!(core.initialize_storage(Storage::open_in_memory()));
    call(
        &core,
        "items.save",
        json!({"item":{"kind":"note","text":"kept"}}),
    )
    .unwrap();
    assert!(!core.initialize_storage(Storage::open_in_memory()));
    assert_eq!(
        call(&core, "items.list", json!({})).unwrap()["items"][0]["text"],
        "kept"
    );
    core.shutdown();
    assert!(!core.initialize_storage(Storage::open_in_memory()));
    assert!(call(&core, "items.list", json!({})).is_err());
    let stopped = Core::new();
    stopped.shutdown();
    assert!(!stopped.initialize_storage(Storage::open_in_memory()));
}

#[cfg(target_os = "macos")]
#[test]
fn cancelling_a_hanging_login_shell_kills_its_child_before_returning() {
    use open_sesame_core::process::{Cancel, EnvSource, Fallback, ShellEnv};
    use std::{
        collections::BTreeMap,
        path::Path,
        time::{Duration, Instant},
    };
    assert!(
        Path::new("/bin/zsh").is_file(),
        "native macOS cancellation prerequisite"
    );
    let dir = tempfile::tempdir().unwrap();
    let pidfile = dir.path().join("child.pid");
    std::fs::write(
        dir.path().join(".zshenv"),
        format!(
            "sleep 30 &\nprint -r -- $! > '{}'\nwait\n",
            pidfile.display()
        ),
    )
    .unwrap();
    let vars = BTreeMap::from([
        ("HOME".into(), dir.path().display().to_string()),
        ("ZDOTDIR".into(), dir.path().display().to_string()),
        ("PATH".into(), "/usr/bin:/bin".into()),
    ]);
    let cancel = Cancel::new();
    let worker_cancel = cancel.clone();
    let started = Instant::now();
    let worker = std::thread::spawn(move || {
        ShellEnv::capture_cancellable(
            Some(Path::new("/bin/zsh")),
            vars,
            Duration::from_secs(3),
            worker_cancel,
        )
    });
    while !pidfile.exists() && started.elapsed() < Duration::from_secs(2) {
        std::thread::sleep(Duration::from_millis(10));
    }
    cancel.cancel();
    let env = worker.join().unwrap();
    let pid: i32 = std::fs::read_to_string(pidfile)
        .expect("shell never started")
        .trim()
        .parse()
        .unwrap();
    assert_eq!(
        unsafe { libc::kill(pid, 0) },
        -1,
        "capture child survived cancellation"
    );
    assert_eq!(env.source(), &EnvSource::Inherited(Fallback::Cancelled));
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "cancellation waited for the startup timeout"
    );
}

#[test]
fn tool_search_reads_the_saved_override_after_reopening_and_does_not_replace_a_bad_override() {
    use open_sesame_core::process::ShellEnv;
    use std::collections::BTreeMap;
    let dir = tempfile::tempdir().unwrap();
    let bin = dir.path().join("bin");
    std::fs::create_dir(&bin).unwrap();
    let name = if cfg!(windows) { "tool.exe" } else { "tool" };
    let on_path = bin.join(name);
    let chosen = dir.path().join(name);
    for file in [&on_path, &chosen] {
        std::fs::copy(env!("CARGO_BIN_EXE_fixture_cli"), file).unwrap();
    }
    let environment =
        ShellEnv::from_vars(BTreeMap::from([("PATH".into(), bin.display().to_string())]));
    let core = Core::with_storage(Storage::open_in(dir.path()));
    assert_eq!(core.find_tool("tool", &environment).unwrap(), Some(on_path));
    call(
        &core,
        "settings.cliPaths.set",
        json!({"name":"tool","path":chosen}),
    )
    .unwrap();
    core.shutdown();
    let reopened = Core::with_storage(Storage::open_in(dir.path()));
    assert_eq!(
        reopened.find_tool("tool", &environment).unwrap(),
        Some(chosen)
    );
    call(
        &reopened,
        "settings.cliPaths.set",
        json!({"name":"tool","path":dir.path().join("gone")}),
    )
    .unwrap();
    assert_eq!(reopened.find_tool("tool", &environment).unwrap(), None);
    reopened.shutdown();
    assert!(reopened.find_tool("tool", &environment).is_err());
}
