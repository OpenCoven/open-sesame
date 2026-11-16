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
    /// The host is quitting and cancelled its startup capture.
    Cancelled,
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
    /// returns the shell's effective environment, including variables removed by startup files.
    /// Shell-private values retain their inherited values. On any failure the result is
    /// `inherited` unchanged, with the reason in [`ShellEnv::source`].
    pub fn capture(
        shell: Option<&Path>,
        inherited: BTreeMap<String, String>,
        timeout: Duration,
    ) -> Self {
        Self::capture_cancellable(shell, inherited, timeout, super::Cancel::new())
    }

    /// As [`ShellEnv::capture`], with the host's Quit cancellation flag. Cancellation kills and
    /// collects the capture's entire process tree before returning the inherited fallback.
    pub fn capture_cancellable(
        shell: Option<&Path>,
        inherited: BTreeMap<String, String>,
        timeout: Duration,
        cancel: super::Cancel,
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
        request.cancel = Some(cancel);
        request.max_output = MAX_ENV_BYTES;

        let output = match run(request, None) {
            Ok(output) => output,
            Err(RunError::Cancelled) => return fallback(inherited, Fallback::Cancelled),
            Err(RunError::Timeout) => return fallback(inherited, Fallback::TimedOut),
            Err(_) => return fallback(inherited, Fallback::ShellFailed),
        };
        let Some(captured) = between(&output.stdout, marker.as_bytes()).map(parse) else {
            return fallback(inherited, Fallback::ShellFailed);
        };
        if !captured.contains_key("PATH") {
            return fallback(inherited, Fallback::ShellFailed);
        }
        let mut vars = captured;
        for name in SHELL_OWN {
            match inherited.get(*name) {
                Some(value) => {
                    vars.insert((*name).to_string(), value.clone());
                }
                None => {
                    vars.remove(*name);
                }
            }
        }
        Self {
            vars,
            source: EnvSource::LoginShell,
        }
    }

    /// The value of a variable. On Windows the name is matched without regard to case, as the
    /// system does: the search path is usually stored there as `Path`.
    pub fn get(&self, name: &str) -> Option<&str> {
        if let Some(value) = self.vars.get(name) {
            return Some(value);
        }
        if !cfg!(windows) {
            return None;
        }
        self.vars
            .iter()
            .find(|(other, _)| other.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
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
    let mut vars = BTreeMap::new();
    if body.contains(&b'\0') {
        for entry in body.split(|byte| *byte == 0) {
            // OS environment names may contain punctuation or Unicode. NUL framing makes
            // their boundaries exact; omit non-Unicode entries just as `inherited` does.
            let Ok(entry) = std::str::from_utf8(entry) else {
                continue;
            };
            if let Some((name, value)) = entry.split_once('=').filter(|(name, _)| !name.is_empty())
            {
                vars.insert(name.to_string(), value.to_string());
            }
        }
        return vars;
    }
    let text = String::from_utf8_lossy(body);
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

    /// Reads an already captured environment without starting a capture or waiting for one.
    pub fn peek(&self) -> Option<&ShellEnv> {
        self.0.get()
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

#[cfg(test)]
mod tests {
    use super::{between, parse};

    fn get<'a>(
        vars: &'a std::collections::BTreeMap<String, String>,
        name: &str,
    ) -> Option<&'a str> {
        vars.get(name).map(String::as_str)
    }

    #[test]
    fn only_what_is_between_the_first_and_last_marker_is_read() {
        assert_eq!(between(b"noise|M|A=1|M|tail", b"|M|"), Some(&b"A=1"[..]));
        assert_eq!(
            between(b"|M|A=|M|still inside|M|", b"|M|"),
            Some(&b"A=|M|still inside"[..])
        );
        assert_eq!(between(b"|M||M|", b"|M|"), Some(&b""[..]));
        assert_eq!(between(b"noise|M|A=1", b"|M|"), None);
        assert_eq!(between(b"no marker at all", b"|M|"), None);
        assert_eq!(between(b"", b"|M|"), None);
    }

    #[test]
    fn nul_separated_entries_are_exact() {
        let vars = parse(
            b"A=1\0EQ=a=b=c\0MULTI=first\nSECOND=fake\n\0EMPTY=\0not a name=x\0=invalid\0NOVALUE\0",
        );
        assert_eq!(get(&vars, "A"), Some("1"));
        assert_eq!(get(&vars, "EQ"), Some("a=b=c"));
        assert_eq!(get(&vars, "MULTI"), Some("first\nSECOND=fake\n"));
        assert_eq!(get(&vars, "EMPTY"), Some(""));
        assert_eq!(get(&vars, "not a name"), Some("x"));
        assert_eq!(vars.len(), 5);
    }

    #[test]
    fn nul_separated_names_follow_environment_not_shell_syntax() {
        let vars = parse("config.key=value\0with-dash=kept\0λ=unicode\0".as_bytes());
        assert_eq!(get(&vars, "config.key"), Some("value"));
        assert_eq!(get(&vars, "with-dash"), Some("kept"));
        assert_eq!(get(&vars, "λ"), Some("unicode"));
    }

    #[test]
    fn nul_separated_invalid_unicode_entries_are_omitted() {
        let vars = parse(b"GOOD=ok\0INVALID_VALUE=\xff\xfe\0invalid-\xff=bad\0");
        assert_eq!(get(&vars, "GOOD"), Some("ok"));
        assert_eq!(
            vars.len(),
            1,
            "match the inherited Unicode-only environment"
        );
    }

    /// The fallback for an `env` without `-0`, which no system these tests run on needs.
    #[test]
    fn newline_separated_entries_keep_continuation_lines() {
        let vars = parse(b"ignored before the first name\nA=1\nMULTI=first\n  second line\n\nlast\nEQ=a=b=c\nEMPTY=\n");
        assert_eq!(get(&vars, "A"), Some("1"));
        assert_eq!(get(&vars, "MULTI"), Some("first\n  second line\n\nlast"));
        assert_eq!(get(&vars, "EQ"), Some("a=b=c"));
        assert_eq!(get(&vars, "EMPTY"), Some(""));
        assert_eq!(vars.len(), 4);
        assert!(parse(b"").is_empty());
    }
}
