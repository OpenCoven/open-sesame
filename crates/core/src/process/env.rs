//! The user's login-shell environment.
//!
//! An app started from Finder or a Linux desktop launcher gets a minimal environment, without
//! the `PATH` additions the user's shell startup files make, so tools installed by Homebrew, npm
//! or a version manager are not found. [`ShellEnv::capture`] runs the login shell once, bounded
//! by the process runner, and reads the environment it ends up with. Any failure falls back to
//! the inherited environment and says why; nothing here panics, and values are never logged.

use super::{run, Run, RunError};
use std::collections::BTreeMap;
use std::fmt;
use std::hash::{BuildHasher, Hasher};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

/// How long the login shell gets at startup before the app carries on without it.
pub const CAPTURE_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_ENV_BYTES: usize = 1024 * 1024;
/// Shells that accept `-i -l -c <command>` and the `;`, `||` and `printf` used below.
const SUPPORTED_SHELLS: &[&str] = &["bash", "zsh", "fish", "sh", "dash", "ksh"];
/// Variables that describe the capturing shell itself, not the user's setup.
const SHELL_OWN: &[&str] = &["_", "SHLVL", "PWD", "OLDPWD"];

/// Where a [`ShellEnv`] came from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EnvSource {
    /// Read from the user's login shell.
    LoginShell,
    /// The environment this process was started with, and why the shell's was not used.
    Inherited(Fallback),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fallback {
    /// No capture was attempted.
    NotCaptured,
    /// This operating system gives desktop apps the user's environment already (Windows).
    NotNeeded,
    /// There is no shell to ask, or it is one this code does not know how to ask.
    NoShell,
    /// The shell ran but did not report an environment.
    ShellFailed,
    /// The shell's startup files did not finish in time.
    TimedOut,
}

/// A set of environment variables and where it came from. `Debug` shows no names or values.
#[derive(Clone, PartialEq, Eq)]
pub struct ShellEnv {
    vars: BTreeMap<String, String>,
    source: EnvSource,
}

impl fmt::Debug for ShellEnv {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ShellEnv")
            .field("variables", &self.vars.len())
            .field("source", &self.source)
            .finish()
    }
}

impl ShellEnv {
    /// The given variables, marked as not captured.
    pub fn from_vars(vars: BTreeMap<String, String>) -> Self {
        Self {
            vars,
            source: EnvSource::Inherited(Fallback::NotCaptured),
        }
    }

    /// The environment this process was started with. Variables that are not valid Unicode are
    /// left out.
    pub fn inherited() -> Self {
        let vars = std::env::vars_os().filter_map(|(name, value)| {
            Some((name.into_string().ok()?, value.into_string().ok()?))
        });
        Self::from_vars(vars.collect())
    }

    /// Captures the login-shell environment for this process, using `SHELL`. Call it once at
    /// startup, through [`StartupEnv`].
    pub fn at_startup() -> Self {
        let inherited = Self::inherited().vars;
        let shell = inherited.get("SHELL").map(PathBuf::from);
        Self::capture(shell.as_deref(), inherited, CAPTURE_TIMEOUT)
    }

    /// Runs `shell` as an interactive login shell with exactly the `inherited` variables and
    /// returns them overlaid with what the shell's startup files set. On any failure the result
    /// is `inherited` unchanged, with the reason in [`ShellEnv::source`].
    pub fn capture(
        shell: Option<&Path>,
        inherited: BTreeMap<String, String>,
        timeout: Duration,
    ) -> Self {
        let fallback = |inherited, reason| Self {
            vars: inherited,
            source: EnvSource::Inherited(reason),
        };
        if cfg!(windows) {
            return fallback(inherited, Fallback::NotNeeded);
        }
        let supported = |shell: &&Path| {
            let name = shell
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default();
            shell.is_absolute() && shell.is_file() && SUPPORTED_SHELLS.contains(&name)
        };
        let Some(shell) = shell.filter(supported) else {
            return fallback(inherited, Fallback::NoShell);
        };

        // The marker is letters, digits and underscores only, so no shell treats it specially,
        // and it is different on every run, so startup files cannot print it by accident.
        let marker = format!(
            "__OPEN_SESAME_ENV_{:016x}__",
            std::collections::hash_map::RandomState::new()
                .build_hasher()
                .finish()
        );
        // NUL-separated when `env` supports it, so values that contain newlines stay whole.
        let script = format!("printf '%s' '{marker}'; /usr/bin/env -0 2>/dev/null || /usr/bin/env; printf '%s' '{marker}'");
        let mut request = Run::new(shell);
        request.args = vec!["-i".into(), "-l".into(), "-c".into(), script];
        request.clear_env = true;
        request.env = inherited
            .iter()
            .map(|(name, value)| (name.clone(), value.clone()))
            .collect();
        request.timeout = timeout;
        request.max_output = MAX_ENV_BYTES;

        let output = match run(request, None) {
            Ok(output) => output,
            Err(RunError::Timeout) => return fallback(inherited, Fallback::TimedOut),
            Err(_) => return fallback(inherited, Fallback::ShellFailed),
        };
        let Some(captured) = between(&output.stdout, marker.as_bytes()).map(parse) else {
            return fallback(inherited, Fallback::ShellFailed);
        };
        if !captured.contains_key("PATH") {
            return fallback(inherited, Fallback::ShellFailed);
        }
        let mut vars = inherited;
        vars.extend(
            captured
                .into_iter()
                .filter(|(name, _)| !SHELL_OWN.contains(&name.as_str())),
        );
        Self {
            vars,
            source: EnvSource::LoginShell,
        }
    }

    pub fn get(&self, name: &str) -> Option<&str> {
        self.vars.get(name).map(String::as_str)
    }

    pub fn vars(&self) -> &BTreeMap<String, String> {
        &self.vars
    }

    pub fn source(&self) -> &EnvSource {
        &self.source
    }

    /// The variables in the form [`Run::env`] takes. Use with [`Run::clear_env`] so a child gets
    /// exactly this environment.
    pub fn to_run_env(&self) -> Vec<(String, String)> {
        self.vars
            .iter()
            .map(|(name, value)| (name.clone(), value.clone()))
            .collect()
    }
}

/// The bytes between the first and the last occurrence of `marker`, when there are two.
fn between<'a>(output: &'a [u8], marker: &[u8]) -> Option<&'a [u8]> {
    let find = |from: usize| {
        output[from..]
            .windows(marker.len())
            .position(|window| window == marker)
            .map(|at| from + at)
    };
    let first = find(0)?;
    let start = first + marker.len();
    let mut end = find(start)?;
    while let Some(later) = find(end + marker.len()) {
        end = later;
    }
    Some(&output[start..end])
}

/// Reads `NAME=value` entries. NUL-separated output is exact. Newline-separated output is the
/// fallback for an `env` without `-0`: a line that does not start a new variable continues the
/// previous value.
fn parse(body: &[u8]) -> BTreeMap<String, String> {
    let text = String::from_utf8_lossy(body);
    let mut vars = BTreeMap::new();
    if text.contains('\0') {
        for entry in text.split('\0') {
            if let Some((name, value)) = entry.split_once('=').filter(|(name, _)| is_name(name)) {
                vars.insert(name.to_string(), value.to_string());
            }
        }
        return vars;
    }
    let mut current: Option<String> = None;
    for line in text.lines() {
        match line.split_once('=').filter(|(name, _)| is_name(name)) {
            Some((name, value)) => {
                vars.insert(name.to_string(), value.to_string());
                current = Some(name.to_string());
            }
            None => {
                if let Some(value) = current.as_ref().and_then(|name| vars.get_mut(name)) {
                    value.push('\n');
                    value.push_str(line);
                }
            }
        }
    }
    vars
}

fn is_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Holds the environment captured at startup so it is captured once and shared. The app owns one
/// of these for its lifetime.
#[derive(Default)]
pub struct StartupEnv(OnceLock<ShellEnv>);

impl StartupEnv {
    pub const fn new() -> Self {
        Self(OnceLock::new())
    }

    /// The login-shell environment, captured on the first call.
    pub fn get(&self) -> &ShellEnv {
        self.get_or_capture(ShellEnv::at_startup)
    }

    /// As [`StartupEnv::get`], with the capture supplied by the caller.
    pub fn get_or_capture(&self, capture: impl FnOnce() -> ShellEnv) -> &ShellEnv {
        self.0.get_or_init(capture)
    }
}
