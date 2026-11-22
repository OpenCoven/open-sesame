//! Starting a tool found in a known install location when the login shell's `PATH` could not be
//! had (issue #145, decided on 18 November 2026): the tool starts with its own folder first and
//! the known locations at the end of its `PATH`, and when it still cannot start, the message
//! points to Settings.
//!
//! These start real scripts through their `#!` line with the short `PATH` a desktop launch
//! gives, which the discovery tests do not: they only find programs.

use open_sesame_core::process::{
    could_not_start, run, start_failed, Run, RunError, Search, ShellEnv,
};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// The `PATH` a program started from a desktop icon has on macOS and Linux.
#[cfg(unix)]
const SHORT_PATH: &str = "/usr/bin:/bin";

/// The environment of an application whose login-shell capture failed, with `path` as `PATH`.
fn launched_with(home: &Path, path: &str) -> ShellEnv {
    let mut vars = BTreeMap::new();
    vars.insert(
        if cfg!(windows) { "USERPROFILE" } else { "HOME" }.to_string(),
        home.to_str().unwrap().to_string(),
    );
    vars.insert("PATH".to_string(), path.to_string());
    if cfg!(windows) {
        // cmd.exe needs these to start at all.
        for name in ["SystemRoot", "ComSpec", "PATHEXT"] {
            if let Ok(value) = std::env::var(name) {
                vars.insert(name.to_string(), value);
            }
        }
    }
    ShellEnv::from_vars(vars)
}

fn search(path: &[PathBuf], known: &[&Path]) -> Search {
    Search {
        path: path.to_vec(),
        extensions: Search::default_extensions(),
        known_dirs: known.iter().map(|dir| dir.to_path_buf()).collect(),
    }
}

/// Starts `program` as a caller of [`Search::find`] should: exactly the environment
/// [`Search::start_env`] gives.
fn start(
    search: &Search,
    env: &ShellEnv,
    program: &Path,
) -> Result<open_sesame_core::process::Output, RunError> {
    let mut request = Run::new(program);
    request.clear_env = true;
    request.env = search.start_env(env, program, None);
    request.timeout = Duration::from_secs(20);
    run(request, None)
}

fn path_of(vars: &[(String, String)]) -> Option<String> {
    vars.iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("PATH"))
        .map(|(_, value)| value.clone())
}

#[cfg(unix)]
fn script(dir: &Path, name: &str, body: &str) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    std::fs::create_dir_all(dir).unwrap();
    let path = dir.join(name);
    std::fs::write(&path, body).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

/// The directories of the short `PATH`, as [`Search::from_env`] would read them.
#[cfg(unix)]
fn short_dirs() -> Vec<PathBuf> {
    std::env::split_paths(SHORT_PATH).collect()
}

/// A script installed by npm under nvm or fnm: `#!/usr/bin/env` names an interpreter that sits
/// beside it, which the short `PATH` does not have.
#[cfg(unix)]
#[test]
fn a_script_found_beside_its_interpreter_starts_with_the_short_path() {
    let home = tempfile::tempdir().unwrap();
    let known = home.path().join("versions/node/v22/bin");
    script(&known, "interp", "#!/bin/sh\necho interpreter-ran\n");
    script(&known, "tool", "#!/usr/bin/env interp\n");
    let env = launched_with(home.path(), SHORT_PATH);
    let search = search(&short_dirs(), &[&known]);
    let found = search
        .find("tool", None)
        .expect("found in the known location");
    let output = start(&search, &env, &found).unwrap();
    assert_eq!(
        output.status,
        Some(0),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        String::from_utf8_lossy(&output.stdout).trim(),
        "interpreter-ran"
    );
}

/// npm's own global folder, whose scripts need a `node` that is in another known location.
#[cfg(unix)]
#[test]
fn a_script_whose_interpreter_is_in_another_known_location_starts() {
    let home = tempfile::tempdir().unwrap();
    let (global, manager) = (
        home.path().join(".npm-global/bin"),
        home.path().join(".volta/bin"),
    );
    script(&manager, "interp", "#!/bin/sh\necho interpreter-ran\n");
    script(&global, "tool", "#!/usr/bin/env interp\n");
    let env = launched_with(home.path(), SHORT_PATH);
    let search = search(&short_dirs(), &[&global, &manager]);
    let found = search.find("tool", None).unwrap();
    let output = start(&search, &env, &found).unwrap();
    assert_eq!(
        output.status,
        Some(0),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        String::from_utf8_lossy(&output.stdout).trim(),
        "interpreter-ran"
    );
}

/// The order: the found folder, then the `PATH` as it was, then the other known locations.
#[test]
fn the_found_folder_comes_first_and_the_known_locations_last() {
    let home = tempfile::tempdir().unwrap();
    let (first, second, third) = (
        home.path().join("one"),
        home.path().join("two"),
        home.path().join("three"),
    );
    let on_path = home.path().join("on-path");
    let path = std::env::join_paths([&on_path])
        .unwrap()
        .into_string()
        .unwrap();
    let env = launched_with(home.path(), &path);
    let search = search(std::slice::from_ref(&on_path), &[&first, &second, &third]);
    let program = second.join("tool");
    let expected = std::env::join_paths([&second, &on_path, &first, &third])
        .unwrap()
        .into_string()
        .unwrap();
    let vars = search.start_env(&env, &program, None);
    assert_eq!(path_of(&vars), Some(expected));
    // Only `PATH` changes, and it is there once.
    let others: Vec<_> = vars
        .iter()
        .filter(|(name, _)| !name.eq_ignore_ascii_case("PATH"))
        .cloned()
        .collect();
    let before: Vec<_> = env
        .to_run_env()
        .into_iter()
        .filter(|(name, _)| !name.eq_ignore_ascii_case("PATH"))
        .collect();
    assert_eq!(others, before);
    assert_eq!(
        vars.iter()
            .filter(|(name, _)| name.eq_ignore_ascii_case("PATH"))
            .count(),
        1
    );
}

/// A program found on the `PATH`, or one the person set the path of in Settings, starts with the
/// environment as it is.
#[test]
fn a_program_not_found_in_a_known_location_keeps_the_environment() {
    let home = tempfile::tempdir().unwrap();
    let (on_path, known, chosen) = (
        home.path().join("on-path"),
        home.path().join("known"),
        home.path().join("chosen"),
    );
    let path = std::env::join_paths([&on_path])
        .unwrap()
        .into_string()
        .unwrap();
    let env = launched_with(home.path(), &path);
    let search = search(std::slice::from_ref(&on_path), &[&known]);
    assert_eq!(
        search.start_env(&env, &on_path.join("tool"), None),
        env.to_run_env()
    );
    let chosen = chosen.join("tool");
    assert_eq!(
        search.start_env(&env, &chosen, Some(&chosen)),
        env.to_run_env()
    );
    // A path the person set is left alone even when it is in a known location.
    let set_in_known = known.join("tool");
    assert_eq!(
        search.start_env(&env, &set_in_known, Some(&set_in_known)),
        env.to_run_env()
    );
}

/// Without `PATH` at all, the found folder and the known locations are the whole of it.
#[test]
fn without_a_path_the_found_folder_and_the_known_locations_are_used() {
    let home = tempfile::tempdir().unwrap();
    let (first, second) = (home.path().join("one"), home.path().join("two"));
    let mut vars = BTreeMap::new();
    vars.insert(
        "HOME".to_string(),
        home.path().to_str().unwrap().to_string(),
    );
    let env = ShellEnv::from_vars(vars);
    let search = search(&[], &[&first, &second]);
    let expected = std::env::join_paths([&second, &first])
        .unwrap()
        .into_string()
        .unwrap();
    assert_eq!(
        path_of(&search.start_env(&env, &second.join("tool"), None)),
        Some(expected)
    );
}

/// When what the script needs is nowhere, the run fails as a start failure and the message
/// says to set the tool's path in Settings.
#[cfg(unix)]
#[test]
fn a_tool_that_still_cannot_start_is_pointed_to_settings() {
    let home = tempfile::tempdir().unwrap();
    let known = home.path().join("known");
    script(
        &known,
        "tool",
        "#!/usr/bin/env no-such-interpreter-for-145\n",
    );
    script(&known, "direct", "#!/no/such/interpreter-for-145\n");
    let env = launched_with(home.path(), SHORT_PATH);
    let search = search(&short_dirs(), &[&known]);
    for name in ["tool", "direct"] {
        let found = search.find(name, None).unwrap();
        let result = start(&search, &env, &found);
        assert!(start_failed(&result), "{name}: {result:?}");
    }
    // A program that ran and failed is not a start failure.
    script(&known, "fails", "#!/bin/sh\nexit 3\n");
    let found = search.find("fails", None).unwrap();
    assert!(!start_failed(&start(&search, &env, &found)));
    let message = could_not_start("tool").0;
    assert!(message.starts_with("tool "), "{message}");
    assert!(message.contains("Settings"), "{message}");
}

/// A `.cmd` that npm writes runs `node` by name; the same with a command script beside it.
#[cfg(windows)]
#[test]
fn a_command_script_found_beside_what_it_runs_starts_on_windows() {
    let home = tempfile::tempdir().unwrap();
    let known = home.path().join("npm");
    std::fs::create_dir_all(&known).unwrap();
    std::fs::write(known.join("interp.cmd"), "@echo interpreter-ran\r\n").unwrap();
    std::fs::write(known.join("tool.cmd"), "@interp\r\n").unwrap();
    let system = PathBuf::from(std::env::var("SystemRoot").unwrap()).join("System32");
    let path = system.to_str().unwrap().to_string();
    let env = launched_with(home.path(), &path);
    let search = search(&[system], &[&known]);
    let found = search
        .find("tool", None)
        .expect("found in the known location");
    let output = start(&search, &env, &found).unwrap();
    assert_eq!(
        output.status,
        Some(0),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        String::from_utf8_lossy(&output.stdout).trim(),
        "interpreter-ran"
    );
}

/// With the login shell's environment captured, its `PATH` is the person's own, and a program
/// found in a known location starts with it as it is.
#[cfg(unix)]
#[test]
fn with_the_login_shell_environment_the_path_is_left_as_it_is() {
    let home = tempfile::tempdir().unwrap();
    let known = home.path().join("known");
    let mut inherited = BTreeMap::new();
    inherited.insert(
        "HOME".to_string(),
        home.path().to_str().unwrap().to_string(),
    );
    inherited.insert("PATH".to_string(), SHORT_PATH.to_string());
    let env = ShellEnv::capture(
        Some(Path::new("/bin/sh")),
        inherited,
        Duration::from_secs(20),
    );
    assert_eq!(
        env.source(),
        &open_sesame_core::process::EnvSource::LoginShell
    );
    let search = search(&short_dirs(), &[&known]);
    assert_eq!(
        search.start_env(&env, &known.join("tool"), None),
        env.to_run_env()
    );
}

/// A known location that is also on the `PATH`, as `/usr/bin` or `~/.cargo/bin` can be, is where
/// `find` found the program on the `PATH`, so the environment is left as it is.
#[test]
fn a_known_location_that_is_on_the_path_keeps_the_environment() {
    let home = tempfile::tempdir().unwrap();
    let (shared, other) = (home.path().join("shared"), home.path().join("other"));
    let path = std::env::join_paths([&shared])
        .unwrap()
        .into_string()
        .unwrap();
    let env = launched_with(home.path(), &path);
    let search = search(std::slice::from_ref(&shared), &[&shared, &other]);
    assert_eq!(
        search.start_env(&env, &shared.join("tool"), None),
        env.to_run_env()
    );
}

/// A known location already on the `PATH` is not added again at the end.
#[test]
fn a_known_location_already_on_the_path_is_not_added_twice() {
    let home = tempfile::tempdir().unwrap();
    let (found, listed, other) = (
        home.path().join("found"),
        home.path().join("listed"),
        home.path().join("other"),
    );
    let path = std::env::join_paths([&listed])
        .unwrap()
        .into_string()
        .unwrap();
    let env = launched_with(home.path(), &path);
    let search = search(std::slice::from_ref(&listed), &[&found, &listed, &other]);
    let expected = std::env::join_paths([&found, &listed, &other])
        .unwrap()
        .into_string()
        .unwrap();
    assert_eq!(
        path_of(&search.start_env(&env, &found.join("tool"), None)),
        Some(expected)
    );
}

/// A known location that cannot be written into a `PATH` (its name has the separator in it) is
/// left out, and the others are still added.
#[cfg(unix)]
#[test]
fn a_known_location_that_cannot_go_in_a_path_is_left_out() {
    let home = tempfile::tempdir().unwrap();
    let (found, odd) = (home.path().join("found"), home.path().join("odd:name"));
    let env = launched_with(home.path(), SHORT_PATH);
    let search = search(&short_dirs(), &[&found, &odd]);
    let expected = format!("{}:{SHORT_PATH}", found.display());
    assert_eq!(
        path_of(&search.start_env(&env, &found.join("tool"), None)),
        Some(expected)
    );
}

/// On Windows the variable is usually stored as `Path`; that entry is the one changed, and a
/// command script that names a program that is nowhere is a start failure (status 9009).
#[cfg(windows)]
#[test]
fn on_windows_the_path_entry_is_replaced_and_a_missing_command_is_a_start_failure() {
    let home = tempfile::tempdir().unwrap();
    let known = home.path().join("npm");
    std::fs::create_dir_all(&known).unwrap();
    std::fs::write(known.join("tool.cmd"), "@no-such-command-for-145\r\n").unwrap();
    let system = PathBuf::from(std::env::var("SystemRoot").unwrap()).join("System32");
    let mut vars = BTreeMap::new();
    vars.insert(
        "USERPROFILE".to_string(),
        home.path().to_str().unwrap().to_string(),
    );
    vars.insert("Path".to_string(), system.to_str().unwrap().to_string());
    for name in ["SystemRoot", "ComSpec", "PATHEXT"] {
        if let Ok(value) = std::env::var(name) {
            vars.insert(name.to_string(), value);
        }
    }
    let env = ShellEnv::from_vars(vars);
    let search = search(&[system], &[&known]);
    let found = search
        .find("tool", None)
        .expect("found in the known location");
    let started = search.start_env(&env, &found, None);
    let paths: Vec<_> = started
        .iter()
        .filter(|(name, _)| name.eq_ignore_ascii_case("PATH"))
        .collect();
    assert_eq!(paths.len(), 1, "{started:?}");
    assert_eq!(paths[0].0, "Path");
    assert!(
        paths[0].1.starts_with(known.to_str().unwrap()),
        "{started:?}"
    );
    let result = start(&search, &env, &found);
    assert!(start_failed(&result), "{result:?}");
    assert!(could_not_start("tool").0.contains("Settings"));
}
