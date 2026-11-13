//! Finding installed command-line tools and capturing the login-shell environment (issue #73).
//!
//! The shell tests run a real shell against startup files in a temporary home directory. They
//! never read the developer's own startup files and never change this process's environment.

use open_sesame_core::process::{not_installed, EnvSource, Fallback, Search, ShellEnv, StartupEnv};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Puts a runnable program called `name` in `dir` and returns its path.
fn install(dir: &Path, name: &str) -> PathBuf {
    std::fs::create_dir_all(dir).unwrap();
    let file = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    let path = dir.join(file);
    std::fs::copy(env!("CARGO_BIN_EXE_fixture_cli"), &path).unwrap();
    path
}

fn search(path: &[&Path], known: &[&Path]) -> Search {
    Search {
        path: path.iter().map(|dir| dir.to_path_buf()).collect(),
        extensions: Search::default_extensions(),
        known_dirs: known.iter().map(|dir| dir.to_path_buf()).collect(),
    }
}

fn vars(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
    pairs
        .iter()
        .map(|(name, value)| (name.to_string(), value.to_string()))
        .collect()
}

#[test]
fn finds_a_program_in_search_path_order() {
    let dir = tempfile::tempdir().unwrap();
    let (first, second) = (dir.path().join("first"), dir.path().join("second dir é"));
    install(&first, "tool");
    let wanted = install(&second, "tool");
    let other = install(&second, "other");
    assert_eq!(
        search(&[&second, &first], &[]).find("tool", None),
        Some(wanted)
    );
    assert_eq!(
        search(&[&first, &second], &[]).find("other", None),
        Some(other)
    );
}

#[test]
fn known_locations_are_searched_after_the_path() {
    let dir = tempfile::tempdir().unwrap();
    let (on_path, known) = (dir.path().join("on-path"), dir.path().join("known"));
    let preferred = install(&on_path, "tool");
    let fallback = install(&known, "tool");
    let only_known = install(&known, "rare");
    let both = search(&[&on_path], &[&known]);
    assert_eq!(both.find("tool", None), Some(preferred));
    assert_eq!(both.find("rare", None), Some(only_known));
    assert_eq!(search(&[], &[&known]).find("tool", None), Some(fallback));
}

/// An override the user set is used as it is. A bad override is reported as missing; the search
/// never quietly picks a different program.
#[test]
fn an_explicit_path_is_used_or_reported_missing() {
    let dir = tempfile::tempdir().unwrap();
    let on_path = dir.path().join("on-path");
    install(&on_path, "tool");
    let chosen = install(&dir.path().join("chosen"), "tool");
    let finder = search(&[&on_path], &[]);
    assert_eq!(finder.find("tool", Some(&chosen)), Some(chosen));
    assert_eq!(
        finder.find("tool", Some(&dir.path().join("gone").join("tool"))),
        None
    );
    assert_eq!(finder.find("tool", Some(Path::new("relative/tool"))), None);
    assert_eq!(
        finder.find("tool", Some(&on_path)),
        None,
        "a directory is not a program"
    );
}

#[test]
fn a_missing_program_is_none_and_has_a_plain_message() {
    let dir = tempfile::tempdir().unwrap();
    let finder = search(&[dir.path()], &[dir.path()]);
    assert_eq!(finder.find("coven", None), None);
    for name in ["", ".", "..", "../tool", "dir/tool", "dir\\tool", "tool\0"] {
        assert_eq!(finder.find(name, None), None, "{name:?}");
    }
    let message = not_installed("coven").0;
    assert_eq!(message, "coven is not installed, or Open Sesame could not find it. Install it, or set its path in Settings.");
}

#[cfg(unix)]
#[test]
fn files_that_cannot_be_run_are_skipped() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let (first, second) = (dir.path().join("first"), dir.path().join("second"));
    let plain = install(&first, "tool");
    std::fs::set_permissions(&plain, std::fs::Permissions::from_mode(0o644)).unwrap();
    std::fs::create_dir_all(first.join("folder")).unwrap();
    let runnable = install(&second, "tool");
    install(&second, "folder");
    let finder = search(&[&first, &second], &[]);
    assert_eq!(finder.find("tool", None), Some(runnable));
    assert_eq!(finder.find("folder", None), Some(second.join("folder")));
    assert_eq!(
        finder.find("tool", Some(&plain)),
        None,
        "an override that cannot be run is missing"
    );
}

#[cfg(windows)]
#[test]
fn windows_extensions_are_tried_in_order() {
    let dir = tempfile::tempdir().unwrap();
    let exe = install(dir.path(), "tool");
    std::fs::write(dir.path().join("tool.cmd"), "@echo off\r\n").unwrap();
    std::fs::write(dir.path().join("script.cmd"), "@echo off\r\n").unwrap();
    let mut finder = search(&[dir.path()], &[]);
    finder.extensions = vec![".EXE".into(), ".CMD".into()];
    assert_eq!(finder.find("tool", None), Some(exe.clone()));
    assert_eq!(finder.find("tool.exe", None), Some(exe));
    assert!(finder
        .find("script", None)
        .unwrap()
        .to_string_lossy()
        .to_lowercase()
        .ends_with("script.cmd"));
    finder.extensions = vec![".CMD".into(), ".EXE".into()];
    assert!(finder
        .find("tool", None)
        .unwrap()
        .to_string_lossy()
        .to_lowercase()
        .ends_with("tool.cmd"));
}

/// Only absolute directories are searched: never the working directory, never an empty entry.
#[test]
fn the_search_path_keeps_only_absolute_directories() {
    let dir = tempfile::tempdir().unwrap();
    let absolute = dir.path().to_str().unwrap();
    let separator = if cfg!(windows) { ";" } else { ":" };
    let path = ["", "relative/bin", absolute, ".", "", absolute].join(separator);
    let env = ShellEnv::from_vars(vars(&[("PATH", &path)]));
    let finder = Search::from_env(&env);
    assert_eq!(finder.path, [dir.path().to_path_buf()]);
    assert!(finder.known_dirs.iter().all(|dir| dir.is_absolute()));
}

#[test]
fn the_environment_is_not_printed_when_debugged() {
    let env = ShellEnv::from_vars(vars(&[
        ("PATH", "/usr/bin"),
        ("API_KEY", "value-that-must-not-print"),
    ]));
    let printed = format!("{env:?}");
    assert!(
        !printed.contains("value-that-must-not-print") && !printed.contains("/usr/bin"),
        "{printed}"
    );
    assert_eq!(env.get("API_KEY"), Some("value-that-must-not-print"));
    assert_eq!(env.source(), &EnvSource::Inherited(Fallback::NotCaptured));
    assert!(env
        .to_run_env()
        .contains(&("PATH".to_string(), "/usr/bin".to_string())));
}

#[test]
fn the_startup_environment_is_captured_once() {
    let startup = StartupEnv::new();
    let mut calls = 0;
    for _ in 0..3 {
        let env = startup.get_or_capture(|| {
            calls += 1;
            ShellEnv::from_vars(vars(&[("PATH", "/usr/bin")]))
        });
        assert_eq!(env.get("PATH"), Some("/usr/bin"));
    }
    assert_eq!(calls, 1);
}

#[test]
fn without_a_usable_shell_the_inherited_environment_is_kept() {
    let inherited = vars(&[("PATH", "/usr/bin"), ("KEPT", "yes")]);
    let none = ShellEnv::capture(None, inherited.clone(), Duration::from_secs(5));
    assert_eq!(none.vars(), &inherited);
    assert!(matches!(none.source(), EnvSource::Inherited(_)));
    let missing = ShellEnv::capture(
        Some(Path::new("/no/such/shell-73")),
        inherited.clone(),
        Duration::from_secs(5),
    );
    assert_eq!(missing.vars(), &inherited);
    assert!(matches!(missing.source(), EnvSource::Inherited(_)));
    let relative = ShellEnv::capture(
        Some(Path::new("zsh")),
        inherited.clone(),
        Duration::from_secs(5),
    );
    let expected = if cfg!(windows) {
        Fallback::NotNeeded
    } else {
        Fallback::NoShell
    };
    assert_eq!(relative.source(), &EnvSource::Inherited(expected));
}

#[cfg(unix)]
mod login_shell {
    use super::*;
    use std::time::Instant;

    const LIMIT: Duration = Duration::from_secs(15);

    /// A home directory with the given startup files, and the minimal environment a desktop
    /// launch gives an app.
    fn home(files: &[(&str, String)]) -> (tempfile::TempDir, BTreeMap<String, String>) {
        let dir = tempfile::tempdir().unwrap();
        for (name, content) in files {
            std::fs::write(dir.path().join(name), content).unwrap();
        }
        let inherited = vars(&[
            ("HOME", dir.path().to_str().unwrap()),
            ("PATH", "/usr/bin:/bin"),
            ("FROM_LAUNCHER", "kept"),
        ]);
        (dir, inherited)
    }

    /// The shell, or `None` with a note when this machine does not have it.
    fn shell(path: &'static str) -> Option<&'static Path> {
        let found = Path::new(path).is_file();
        if !found {
            eprintln!("NOT RUN: {path} is not installed on this machine");
        }
        found.then(|| Path::new(path))
    }

    fn login_path_case(shell_path: &'static str, startup_file: &str) {
        let Some(shell) = shell(shell_path) else {
            return;
        };
        let tools = tempfile::tempdir().unwrap();
        let bin = tools.path().join("login only bin");
        let tool = install(&bin, "only-on-login-path");
        let (_home, inherited) = home(&[(
            startup_file,
            format!(
                "export PATH=\"{}:$PATH\"\nexport FROM_PROFILE=set\n",
                bin.display()
            ),
        )]);

        // What the app sees when it is started from the desktop: the tool is not found.
        let before = ShellEnv::from_vars(inherited.clone());
        let mut finder = Search::from_env(&before);
        finder.known_dirs.clear();
        assert_eq!(finder.find("only-on-login-path", None), None);

        let env = ShellEnv::capture(Some(shell), inherited, LIMIT);
        assert_eq!(env.source(), &EnvSource::LoginShell, "{shell_path}");
        assert_eq!(env.get("FROM_PROFILE"), Some("set"));
        assert_eq!(env.get("FROM_LAUNCHER"), Some("kept"));
        assert!(
            env.get("PATH")
                .unwrap()
                .split(':')
                .any(|dir| Path::new(dir) == bin),
            "{:?}",
            env.get("PATH")
        );
        let mut finder = Search::from_env(&env);
        finder.known_dirs.clear();
        assert_eq!(finder.find("only-on-login-path", None), Some(tool));
    }

    #[test]
    fn a_tool_only_on_the_zsh_login_path_is_found() {
        login_path_case("/bin/zsh", ".zprofile");
    }

    #[test]
    fn a_tool_only_on_the_bash_login_path_is_found() {
        login_path_case("/bin/bash", ".bash_profile");
    }

    /// Startup files print banners, and may even print something that looks like a marker.
    #[test]
    fn startup_noise_does_not_corrupt_the_result() {
        let Some(shell) = shell("/bin/zsh") else {
            return;
        };
        let noise = "echo 'Welcome back!'\necho '__OPEN_SESAME_ENV_0000000000000000__'\necho 'FAKE=from-noise'\nexport REAL=value\necho 'warning' >&2\n";
        let (_home, inherited) = home(&[
            (".zprofile", noise.to_string()),
            (".zlogin", "echo 'last words'\n".to_string()),
        ]);
        let env = ShellEnv::capture(Some(shell), inherited, LIMIT);
        assert_eq!(env.source(), &EnvSource::LoginShell);
        assert_eq!(env.get("REAL"), Some("value"));
        assert_eq!(env.get("FAKE"), None);
    }

    #[test]
    fn a_value_with_a_newline_is_kept_whole() {
        let Some(shell) = shell("/bin/zsh") else {
            return;
        };
        let (_home, inherited) = home(&[(
            ".zprofile",
            "export MULTI=$'first\\nSECOND=fake'\nexport AFTER=ok\n".to_string(),
        )]);
        let env = ShellEnv::capture(Some(shell), inherited, LIMIT);
        assert_eq!(env.source(), &EnvSource::LoginShell);
        assert_eq!(env.get("MULTI"), Some("first\nSECOND=fake"));
        assert_eq!(env.get("SECOND"), None);
        assert_eq!(env.get("AFTER"), Some("ok"));
    }

    /// A startup file that never finishes costs the timeout and nothing more.
    #[test]
    fn a_startup_file_that_hangs_falls_back_to_the_inherited_environment() {
        let Some(shell) = shell("/bin/zsh") else {
            return;
        };
        let (_home, inherited) = home(&[(".zprofile", "export HALF=done\nsleep 30\n".to_string())]);
        let started = Instant::now();
        let env = ShellEnv::capture(Some(shell), inherited.clone(), Duration::from_millis(700));
        assert!(
            started.elapsed() < Duration::from_secs(4),
            "{:?}",
            started.elapsed()
        );
        assert_eq!(env.source(), &EnvSource::Inherited(Fallback::TimedOut));
        assert_eq!(env.vars(), &inherited);
    }

    /// A startup file that waits for the keyboard gets end of input instead.
    #[test]
    fn a_startup_file_that_reads_input_does_not_hang() {
        let Some(shell) = shell("/bin/zsh") else {
            return;
        };
        let (_home, inherited) = home(&[(
            ".zprofile",
            "read -r answer\nexport ASKED=yes\n".to_string(),
        )]);
        let started = Instant::now();
        let env = ShellEnv::capture(Some(shell), inherited, LIMIT);
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "{:?}",
            started.elapsed()
        );
        assert_eq!(env.source(), &EnvSource::LoginShell);
        assert_eq!(env.get("ASKED"), Some("yes"));
    }

    /// A program that is not a shell: it exits without printing the markers.
    #[test]
    fn a_shell_that_prints_no_markers_falls_back() {
        let (_home, inherited) = home(&[]);
        let not_a_shell = install(_home.path(), "zsh");
        let env = ShellEnv::capture(Some(&not_a_shell), inherited.clone(), LIMIT);
        assert_eq!(env.source(), &EnvSource::Inherited(Fallback::ShellFailed));
        assert_eq!(env.vars(), &inherited);
    }
}
