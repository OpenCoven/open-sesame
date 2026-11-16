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

/// Windows stores the search path as `Path` and matches variable names without regard to case.
/// Elsewhere `Path` is a different variable and is not the search path.
#[test]
fn the_path_variable_is_matched_the_way_the_system_matches_it() {
    let dir = tempfile::tempdir().unwrap();
    let tool = install(dir.path(), "tool");
    let env = ShellEnv::from_vars(vars(&[
        ("Path", dir.path().to_str().unwrap()),
        ("PathExt", " ; ;"),
    ]));
    let mut finder = Search::from_env(&env);
    finder.known_dirs.clear();
    if cfg!(windows) {
        assert_eq!(env.get("PATH"), dir.path().to_str());
        assert_eq!(finder.path, [dir.path().to_path_buf()]);
        // A `PATHEXT` that names no extension is not used: the usual ones are.
        assert_eq!(finder.extensions, Search::default_extensions());
        assert_eq!(finder.find("tool", None), Some(tool));
    } else {
        assert_eq!(env.get("PATH"), None);
        assert!(finder.path.is_empty() && finder.extensions.is_empty());
        assert_eq!(finder.find("tool", None), None);
    }
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
            let file = dir.path().join(name);
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(file, content).unwrap();
        }
        let inherited = vars(&[
            ("HOME", dir.path().to_str().unwrap()),
            ("PATH", "/usr/bin:/bin"),
            ("FROM_LAUNCHER", "kept"),
        ]);
        (dir, inherited)
    }

    /// Names the shells that must be installed where the tests run, as paths separated like a
    /// search path. CI sets it, so a runner without one of them fails instead of passing these
    /// tests without running them (issue #97). Unset, a missing shell is only noted. A shell is
    /// matched by its file name, so a test uses the path named here in place of its own, and
    /// a named shell that a test cannot find anywhere fails that test.
    const REQUIRED: &str = "OPEN_SESAME_REQUIRE_SHELLS";

    fn required() -> Vec<PathBuf> {
        std::env::var_os(REQUIRED)
            .map(|paths| {
                std::env::split_paths(&paths)
                    .filter(|path| !path.as_os_str().is_empty())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// The shell to use: the required path with the same file name when there is one, else the
    /// first of `paths` that is installed, else `None` with a note.
    fn installed(paths: &[&str]) -> Option<PathBuf> {
        let same_name = |needed: &PathBuf| {
            paths
                .iter()
                .any(|path| Path::new(path).file_name() == needed.file_name())
        };
        if let Some(needed) = required().into_iter().find(same_name) {
            assert!(
                needed.is_file(),
                "{} is named in {REQUIRED} and is not installed",
                needed.display()
            );
            return Some(needed);
        }
        let found = paths.iter().map(PathBuf::from).find(|path| path.is_file());
        if found.is_none() {
            eprintln!("NOT RUN: none of {paths:?} is installed on this machine");
        }
        found
    }

    fn shell(path: &str) -> Option<PathBuf> {
        installed(&[path])
    }

    /// A required shell that no test happens to ask for is still checked, and so is a path
    /// that was mistyped in the workflow.
    #[test]
    fn every_shell_the_run_requires_is_installed() {
        let missing: Vec<PathBuf> = required()
            .into_iter()
            .filter(|path| !path.is_file())
            .collect();
        assert!(
            missing.is_empty(),
            "named in {REQUIRED} and not installed: {missing:?}"
        );
    }

    /// Where fish is installed by the systems these tests run on: Linux packages, and Homebrew
    /// on either kind of Mac.
    const FISH: [&str; 3] = [
        "/usr/bin/fish",
        "/opt/homebrew/bin/fish",
        "/usr/local/bin/fish",
    ];

    /// The four kinds of shell the capture is tested with: where each is installed, the
    /// startup file a login shell of that kind reads, and how it exports a variable.
    struct Kind {
        paths: &'static [&'static str],
        startup_file: &'static str,
        export: fn(&str, &str) -> String,
    }

    fn posix_export(name: &str, value: &str) -> String {
        format!("export {name}={value}\n")
    }

    fn fish_export(name: &str, value: &str) -> String {
        format!("set -gx {name} {value}\n")
    }

    const KINDS: [Kind; 4] = [
        Kind {
            paths: &["/bin/zsh"],
            startup_file: ".zprofile",
            export: posix_export,
        },
        Kind {
            paths: &["/bin/bash"],
            startup_file: ".bash_profile",
            export: posix_export,
        },
        Kind {
            paths: &["/bin/sh"],
            startup_file: ".profile",
            export: posix_export,
        },
        Kind {
            paths: &FISH,
            startup_file: ".config/fish/config.fish",
            export: fish_export,
        },
    ];

    fn login_path_case(shell_path: &str, startup_file: &str) {
        let Some(shell) = shell(shell_path) else {
            return;
        };
        let shell = shell.as_path();
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

    /// fish is in the supported list and reads a different startup file in a different
    /// language, so it gets a case of its own wherever it is installed.
    #[test]
    fn a_tool_only_on_the_fish_login_path_is_found() {
        let Some(fish) = installed(&FISH) else {
            return;
        };
        let tools = tempfile::tempdir().unwrap();
        let bin = tools.path().join("login only bin");
        let tool = install(&bin, "only-on-login-path");
        let (_home, inherited) = home(&[(
            ".config/fish/config.fish",
            format!(
                "set -gx PATH \"{}\" $PATH\nset -gx FROM_PROFILE set\n",
                bin.display()
            ),
        )]);
        let env = ShellEnv::capture(Some(&fish), inherited, LIMIT);
        assert_eq!(env.source(), &EnvSource::LoginShell, "{fish:?}");
        assert_eq!(env.get("FROM_PROFILE"), Some("set"));
        assert_eq!(env.get("FROM_LAUNCHER"), Some("kept"));
        let mut finder = Search::from_env(&env);
        finder.known_dirs.clear();
        assert_eq!(finder.find("only-on-login-path", None), Some(tool));
    }

    /// A variable the shell exports with a value that is not Unicode is left out of what was
    /// captured, as it is left out of the inherited environment, and is never passed on with
    /// replacement characters in it (issue #97).
    #[test]
    fn a_value_that_is_not_unicode_is_left_out() {
        let Some(shell) = shell("/bin/bash") else {
            return;
        };
        let (_home, inherited) = home(&[(
            ".bash_profile",
            "export ODD=\"$(printf '\\377\\376')\"\nexport MIXED=\"ok$(printf '\\377')\"\nexport AFTER=ok\n"
                .to_string(),
        )]);
        let env = ShellEnv::capture(Some(&shell), inherited, LIMIT);
        assert_eq!(env.source(), &EnvSource::LoginShell);
        assert_eq!(env.get("ODD"), None);
        assert_eq!(env.get("MIXED"), None);
        assert_eq!(env.get("AFTER"), Some("ok"));
        assert!(
            env.vars().values().all(|value| !value.contains('\u{fffd}')),
            "a value was passed on with replacement characters"
        );
    }

    /// Background jobs that a startup file leaves printing share the shell's output. What they
    /// print while the environment is read must neither become a variable nor swallow one
    /// (issue #97): the environment travels on a channel of its own. The jobs print until they
    /// are killed, so they are printing when the environment is read on a fast machine too,
    /// and every kind of shell is tried: each treats the descriptors it is handed differently.
    /// The counting between two lines paces a job: measured, two jobs print about three lines
    /// a millisecond on a busy Mac, and stay far below the output cap on a fast machine.
    #[test]
    fn background_output_from_a_startup_file_does_not_reach_the_result() {
        let job = "/bin/sh -c 'while :; do echo NOISE=x; i=0; while [ $i -lt 100 ]; do i=$((i+1)); done; done' &\n";
        for kind in &KINDS {
            let Some(shell) = installed(kind.paths) else {
                continue;
            };
            let noisy = [
                (kind.export)("REAL", "value"),
                job.repeat(2),
                (kind.export)("LAST", "kept"),
            ]
            .concat();
            for round in 0..6 {
                let (_home, inherited) = home(&[(kind.startup_file, noisy.clone())]);
                let env = ShellEnv::capture(Some(&shell), inherited, LIMIT);
                let case = format!("{}, round {round}", shell.display());
                assert_eq!(env.source(), &EnvSource::LoginShell, "{case}");
                assert_eq!(env.get("REAL"), Some("value"), "{case}");
                assert_eq!(env.get("LAST"), Some("kept"), "{case}");
                assert_eq!(env.get("FROM_LAUNCHER"), Some("kept"), "{case}");
                assert_eq!(
                    env.get("NOISE"),
                    None,
                    "{case}: background output became a variable"
                );
                let swallowed: Vec<&String> = env
                    .vars()
                    .values()
                    .filter(|value| value.contains("NOISE"))
                    .collect();
                assert!(
                    swallowed.is_empty(),
                    "{case}: background output ended up inside {} values",
                    swallowed.len()
                );
            }
        }
    }

    /// A helper that a startup file leaves running with its output sent elsewhere, as an agent
    /// or a daemon is, still holds everything else the shell had open. The capture does not
    /// wait for it (issue #97). The times compared are the quickest of several, so a busy
    /// machine does not decide the result; waiting for the helper costs a quarter of a second.
    #[test]
    fn a_quiet_helper_left_by_a_startup_file_does_not_hold_up_the_result() {
        for kind in &KINDS {
            let Some(shell) = installed(kind.paths) else {
                continue;
            };
            let alone = (kind.export)("REAL", "value");
            let with_helper = format!("{alone}sleep 30 >/dev/null 2>&1 &\n");
            let time = |startup: &str| {
                let (_home, inherited) = home(&[(kind.startup_file, startup.to_string())]);
                let started = Instant::now();
                let env = ShellEnv::capture(Some(&shell), inherited, LIMIT);
                let took = started.elapsed();
                assert_eq!(env.source(), &EnvSource::LoginShell, "{}", shell.display());
                assert_eq!(env.get("REAL"), Some("value"), "{}", shell.display());
                took
            };
            let (mut quickest_alone, mut quickest_with_helper) = (Duration::MAX, Duration::MAX);
            for _ in 0..5 {
                quickest_alone = quickest_alone.min(time(&alone));
                quickest_with_helper = quickest_with_helper.min(time(&with_helper));
            }
            assert!(
                quickest_with_helper < quickest_alone + Duration::from_millis(125),
                "{}: {quickest_with_helper:?} with a helper, {quickest_alone:?} without",
                shell.display()
            );
        }
    }

    /// One directory on the search path with a name that is not Unicode does not cost the
    /// user every other directory their startup files added (issue #97): the capture is still
    /// used, and the search path is the directories that can be passed on.
    #[test]
    fn a_search_path_entry_that_is_not_unicode_is_the_only_thing_left_out() {
        let Some(shell) = shell("/bin/bash") else {
            return;
        };
        let (_home, inherited) = home(&[(
            ".bash_profile",
            "export PATH=\"/opt/first:/opt/odd$(printf '\\377')dir:$PATH:/opt/last\"\nexport AFTER=ok\n"
                .to_string(),
        )]);
        let env = ShellEnv::capture(Some(&shell), inherited, LIMIT);
        assert_eq!(env.source(), &EnvSource::LoginShell);
        assert_eq!(env.get("AFTER"), Some("ok"));
        let path: Vec<&str> = env.get("PATH").unwrap().split(':').collect();
        assert_eq!(path.first(), Some(&"/opt/first"), "{path:?}");
        assert_eq!(path.last(), Some(&"/opt/last"), "{path:?}");
        assert!(path.contains(&"/usr/bin"), "{path:?}");
        assert!(
            path.iter()
                .all(|dir| !dir.contains("odd") && !dir.contains('\u{fffd}')),
            "{path:?}"
        );
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
        let env = ShellEnv::capture(Some(&shell), inherited, LIMIT);
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
        let env = ShellEnv::capture(Some(&shell), inherited, LIMIT);
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
        let env = ShellEnv::capture(Some(&shell), inherited.clone(), Duration::from_millis(700));
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
        let env = ShellEnv::capture(Some(&shell), inherited, LIMIT);
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
