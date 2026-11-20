//! What a `terminal.open` request starts: validation, limits and messages copied from
//! `Session.__init__` in `desktop/bridge.py`, and the program, arguments and folder that result.
//! Nothing here starts a process.

use super::Config;
use crate::process;
use crate::protocol::BridgeError;
use serde_json::{Map, Value};
#[cfg(unix)]
use std::path::Path;
use std::path::PathBuf;

/// The program a pane runs, with exact arguments. Never passed through a shell by this app.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct Launch {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    /// The name the UI labels the pane with: this machine, or the SSH host.
    pub machine: String,
}

const LAUNCHERS: [&str; 3] = ["shell", "coven", "bash"];
const PROMPT_LIMIT: usize = 2000;
const FOLDER_LIMIT: usize = 4096;

pub(super) fn plan(params: &Map<String, Value>, config: &Config) -> Result<Launch, BridgeError> {
    let mode = text_or(params.get("mode"), "local");
    let launcher = text_or(params.get("launcher"), "shell");
    if !launcher.is_some_and(|launcher| LAUNCHERS.contains(&launcher)) {
        return Err("Choose Shell, Coven agent, or Bash command.".into());
    }
    let launcher = launcher.unwrap_or("shell");
    let prompt = match text_or(params.get("prompt"), "") {
        Some(prompt) if !prompt.contains('\0') && prompt.chars().count() <= PROMPT_LIMIT => prompt,
        _ => return Err("Use a request under 2000 characters.".into()),
    };
    if launcher == "bash" && prompt.trim().is_empty() {
        return Err("Enter a Bash command before launching.".into());
    }
    let task = if prompt.is_empty() {
        None
    } else {
        Some(format!("Task: {prompt}"))
    };
    // As in the Python bridge, a missing or empty folder means the home folder.
    let requested = match params.get("cwd") {
        None | Some(Value::Null) => None,
        Some(Value::String(folder)) if folder.is_empty() => None,
        Some(Value::String(folder))
            if !folder.contains('\0') && folder.chars().count() <= FOLDER_LIMIT =>
        {
            Some(folder.as_str())
        }
        Some(_) => return Err("Choose a valid project folder.".into()),
    };
    match mode {
        Some("local") => local(launcher, prompt, task, requested, config),
        Some("ssh") => ssh(params, launcher, prompt, task, requested, config),
        _ => Err("Choose local machine or SSH.".into()),
    }
}

/// A string parameter, the default when it is absent, or `None` when it is not a string.
fn text_or<'a>(value: Option<&'a Value>, default: &'a str) -> Option<&'a str> {
    match value {
        None => Some(default),
        Some(Value::String(text)) => Some(text),
        Some(_) => None,
    }
}

fn home() -> PathBuf {
    std::env::home_dir().unwrap_or_else(|| PathBuf::from(if cfg!(windows) { "C:\\" } else { "/" }))
}

fn local(
    launcher: &str,
    prompt: &str,
    task: Option<String>,
    requested: Option<&str>,
    config: &Config,
) -> Result<Launch, BridgeError> {
    let folder = match requested {
        Some(folder) => expand_home(folder),
        None => home(),
    };
    let Ok(folder) = folder.canonicalize() else {
        return Err("Project folder not found on this machine. Choose an existing folder.".into());
    };
    if !folder.is_dir() {
        return Err("The project folder must be a directory.".into());
    }
    let (program, args) = local_command(launcher, prompt, task, config)?;
    Ok(Launch {
        program,
        args,
        cwd: plain_path(folder),
        machine: crate::system::machine(),
    })
}

/// `~` and `~/rest` mean the home folder, as `pathlib.Path.expanduser` reads them.
fn expand_home(folder: &str) -> PathBuf {
    if folder == "~" {
        home()
    } else if let Some(rest) = folder
        .strip_prefix("~/")
        .or_else(|| folder.strip_prefix("~\\"))
    {
        home().join(rest)
    } else {
        PathBuf::from(folder)
    }
}

/// On Windows `canonicalize` returns a `\\?\C:\` path, which a process cannot use as its working
/// directory; give the ordinary form back for a drive path.
fn plain_path(path: PathBuf) -> PathBuf {
    if cfg!(windows) {
        let text = path.to_string_lossy();
        if let Some(rest) = text.strip_prefix(r"\\?\") {
            if !rest.starts_with("UNC\\") {
                return PathBuf::from(rest.to_string());
            }
        }
    }
    path
}

#[cfg(unix)]
fn local_command(
    launcher: &str,
    prompt: &str,
    task: Option<String>,
    config: &Config,
) -> Result<(PathBuf, Vec<String>), BridgeError> {
    let shell = shell(config);
    let own = |arguments: &[&str]| {
        arguments
            .iter()
            .map(|argument| argument.to_string())
            .collect()
    };
    Ok(match (launcher, task) {
        ("bash", _) => {
            let bash = process::resolve("bash", config.bash.as_deref())
                .unwrap_or_else(|| PathBuf::from("/bin/bash"));
            (bash, own(&["-l", "-c", prompt]))
        }
        ("coven", Some(task)) => (
            shell,
            own(&[
                "-l",
                "-i",
                "-c",
                "exec coven \"$1\"",
                "open-sesame-agent",
                &task,
            ]),
        ),
        ("coven", None) => (shell, own(&["-l", "-i", "-c", "exec coven"])),
        _ => (shell, own(&["-l"])),
    })
}

/// `$SHELL`, then the platform default, then `/bin/sh`.
#[cfg(unix)]
fn shell(config: &Config) -> PathBuf {
    let named = config
        .shell
        .clone()
        .or_else(|| std::env::var_os("SHELL").map(PathBuf::from))
        .filter(|shell| !shell.as_os_str().is_empty());
    let default = PathBuf::from(if cfg!(target_os = "macos") {
        "/bin/zsh"
    } else {
        "/bin/bash"
    });
    [named, Some(default)]
        .into_iter()
        .flatten()
        .find(|shell| is_program(shell))
        .unwrap_or_else(|| PathBuf::from("/bin/sh"))
}

#[cfg(unix)]
fn is_program(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
}

/// On Windows the shell launcher runs the shell with no arguments, the Bash launcher needs a
/// `bash` on the search path, and the Coven launcher runs `coven` with the task as its single
/// argument.
#[cfg(windows)]
fn local_command(
    launcher: &str,
    prompt: &str,
    task: Option<String>,
    config: &Config,
) -> Result<(PathBuf, Vec<String>), BridgeError> {
    Ok(match launcher {
        "bash" => {
            let Some(bash) = process::resolve("bash", config.bash.as_deref()) else {
                return Err("Bash is not installed on this machine.".into());
            };
            (
                bash,
                vec!["-l".to_string(), "-c".to_string(), prompt.to_string()],
            )
        }
        "coven" => {
            let Some(coven) = process::resolve("coven", None) else {
                return Err(process::not_installed("coven"));
            };
            (coven, task.into_iter().collect())
        }
        _ => (shell(config), Vec::new()),
    })
}

/// PowerShell 7 when it is installed, otherwise Windows PowerShell, which every supported
/// Windows has.
#[cfg(windows)]
fn shell(config: &Config) -> PathBuf {
    config
        .shell
        .clone()
        .or_else(|| process::resolve("pwsh", None))
        .or_else(|| process::resolve("powershell", None))
        .unwrap_or_else(|| PathBuf::from("powershell.exe"))
}

fn ssh(
    params: &Map<String, Value>,
    launcher: &str,
    prompt: &str,
    task: Option<String>,
    requested: Option<&str>,
    config: &Config,
) -> Result<Launch, BridgeError> {
    let host = match params.get("host") {
        Some(Value::String(host)) if is_host(host) => host.as_str(),
        _ => return Err("Enter an SSH hostname, tailnet name, or IP address.".into()),
    };
    let user = match params.get("user") {
        None | Some(Value::Null) => "",
        Some(Value::String(user)) if user.is_empty() || is_user(user) => user.as_str(),
        Some(_) => return Err("Enter a valid SSH user.".into()),
    };
    let Some(program) = process::resolve("ssh", config.ssh.as_deref()) else {
        return Err("OpenSSH is not installed on this machine.".into());
    };
    let destination = if user.is_empty() {
        host.to_string()
    } else {
        format!("{user}@{host}")
    };
    let change_folder = requested
        .map(|folder| format!("cd -- {} && ", quote(folder)))
        .unwrap_or_default();
    let remote = match (launcher, task) {
        ("bash", _) => format!("{change_folder}exec bash -l -c {}", quote(prompt)),
        ("coven", Some(task)) => format!(
            "{change_folder}exec \"${{SHELL:-/bin/sh}}\" -l -i -c {} open-sesame-agent {}",
            quote("exec coven \"$1\""),
            quote(&task)
        ),
        ("coven", None) => format!(
            "{change_folder}exec \"${{SHELL:-/bin/sh}}\" -l -i -c {}",
            quote("exec coven")
        ),
        _ => format!("{change_folder}exec \"${{SHELL:-/bin/sh}}\" -l"),
    };
    Ok(Launch {
        program,
        // The destination cannot start with `-`: the host pattern requires a letter or digit
        // first and the user pattern a letter or underscore, so it is never read as an option.
        args: vec!["-tt".to_string(), destination, remote],
        cwd: home(),
        machine: host.to_string(),
    })
}

/// `[A-Za-z0-9][A-Za-z0-9.:[\]_-]{0,252}`
fn is_host(host: &str) -> bool {
    let mut characters = host.chars();
    characters
        .next()
        .is_some_and(|first| first.is_ascii_alphanumeric())
        && host.len() <= 253
        && characters
            .all(|character| character.is_ascii_alphanumeric() || ".:[]_-".contains(character))
}

/// `[A-Za-z_][A-Za-z0-9_.-]{0,63}`
fn is_user(user: &str) -> bool {
    let mut characters = user.chars();
    characters
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
        && user.len() <= 64
        && characters
            .all(|character| character.is_ascii_alphanumeric() || "_.-".contains(character))
}

/// One word for a POSIX shell, as Python's `shlex.quote` writes it.
fn quote(text: &str) -> String {
    let safe =
        |character: char| character.is_ascii_alphanumeric() || "@%+=:,./-_".contains(character);
    if !text.is_empty() && text.chars().all(safe) {
        text.to_string()
    } else {
        format!("'{}'", text.replace('\'', "'\"'\"'"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn params(value: Value) -> Map<String, Value> {
        value.as_object().cloned().unwrap()
    }

    #[test]
    fn quoting_matches_shlex() {
        assert_eq!(quote(""), "''");
        assert_eq!(quote("plain-word_1.2/x"), "plain-word_1.2/x");
        assert_eq!(quote("two words"), "'two words'");
        assert_eq!(quote("it's"), "'it'\"'\"'s'");
        assert_eq!(quote("$(rm -rf ~)"), "'$(rm -rf ~)'");
        assert_eq!(quote("ünï"), "'ünï'");
    }

    #[test]
    fn host_and_user_patterns_match_the_python_bridge() {
        assert!(is_host("example.test") && is_host("192.0.2.7") && is_host("a_b-c.d:22"));
        // A bracketed address starts with `[`, which the first-character rule refuses, as the
        // Python pattern does.
        assert!(!is_host("[2001:db8::1]"));
        assert!(is_host("2001:db8::1"));
        assert!(!is_host("-oProxyCommand=x") && !is_host("a b") && !is_host("") && !is_host("a/b"));
        assert!(is_host(&"a".repeat(253)) && !is_host(&"a".repeat(254)));
        assert!(is_user("val") && is_user("_svc") && is_user("a.b-c"));
        assert!(!is_user("-l") && !is_user("9a") && !is_user("a b") && !is_user(&"a".repeat(65)));
    }

    #[test]
    fn the_home_folder_is_the_default_and_tilde_expands() {
        let launch = plan(&params(json!({"mode": "local"})), &Config::default()).unwrap();
        assert_eq!(launch.cwd, plain_path(home().canonicalize().unwrap()));
        let launch = plan(&params(json!({"cwd": "~"})), &Config::default()).unwrap();
        assert_eq!(launch.cwd, plain_path(home().canonicalize().unwrap()));
        assert!(!launch.machine.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn local_launchers_build_the_python_argument_lists() {
        let config = Config {
            shell: Some(PathBuf::from("/bin/sh")),
            ..Config::default()
        };
        let launch = plan(&params(json!({})), &config).unwrap();
        assert_eq!(
            (launch.program.as_path(), launch.args),
            (Path::new("/bin/sh"), vec!["-l".to_string()])
        );
        let launch = plan(&params(json!({"launcher": "coven"})), &config).unwrap();
        assert_eq!(launch.args, ["-l", "-i", "-c", "exec coven"]);
        let launch = plan(
            &params(json!({"launcher": "coven", "prompt": "do it"})),
            &config,
        )
        .unwrap();
        assert_eq!(
            launch.args,
            [
                "-l",
                "-i",
                "-c",
                "exec coven \"$1\"",
                "open-sesame-agent",
                "Task: do it"
            ]
        );
        let launch = plan(
            &params(json!({"launcher": "bash", "prompt": "ls; pwd"})),
            &config,
        )
        .unwrap();
        assert_eq!(launch.args, ["-l", "-c", "ls; pwd"]);
        assert!(launch.program.ends_with("bash"));
    }

    #[cfg(unix)]
    #[test]
    fn a_shell_that_is_not_a_program_falls_back() {
        let config = Config {
            shell: Some(PathBuf::from("/no/such/shell")),
            ..Config::default()
        };
        let chosen = shell(&config);
        assert!(is_program(&chosen), "{chosen:?}");
        assert_ne!(chosen, Path::new("/no/such/shell"));
    }
}
