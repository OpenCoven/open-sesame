//! The user's login-shell environment.
//!
//! An app started from Finder or a Linux desktop launcher gets a minimal environment, without
//! the `PATH` additions the user's shell startup files make, so tools installed by Homebrew, npm
//! or a version manager are not found. [`ShellEnv::capture`] runs the login shell once, bounded
//! by the process runner, and reads the environment it ends up with. Any failure falls back to
//! the inherited environment and says why; nothing here panics, and values are never logged.

use super::{execute, Run, RunError};
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
    /// is `inherited` unchanged, with the reason in [`ShellEnv::source`]. A variable the shell
    /// reports with a name or value that is not valid Unicode is left out of what is overlaid,
    /// as [`ShellEnv::inherited`] leaves such variables out; if `inherited` has a value under
    /// that name, that value stays. Of a `PATH` that is not valid Unicode, the directories that
    /// are valid are kept.
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
        let to_output = "/usr/bin/env -0 2>/dev/null || /usr/bin/env";
        // The environment goes to a pipe of its own when there is one, because the startup
        // files' own programs share the standard output and may still be printing. Printing it
        // between the markers is what remains when that pipe cannot be had or written to.
        #[cfg(unix)]
        let report = super::Report::new();
        #[cfg(not(unix))]
        let report: Option<super::Report> = None;
        #[cfg(unix)]
        let print = match &report {
            Some(report) => {
                let pipe = report.path();
                // Appending, because a shell with `noclobber` set refuses to write over
                // anything that is not a regular file.
                format!("/usr/bin/env -0 >> {pipe} 2>/dev/null || /usr/bin/env >> {pipe} 2>/dev/null || {to_output}")
            }
            None => to_output.to_string(),
        };
        #[cfg(not(unix))]
        let print = to_output.to_string();
        let script = format!("printf '%s' '{marker}'; {print}; printf '%s' '{marker}'");
        let mut request = Run::new(shell);
        request.args = vec!["-i".into(), "-l".into(), "-c".into(), script];
        request.clear_env = true;
        request.env = inherited
            .iter()
            .map(|(name, value)| (name.clone(), value.clone()))
            .collect();
        request.timeout = timeout;
        request.max_output = MAX_ENV_BYTES;

        let (output, reported) = match execute(request, None, report) {
            Ok(finished) => finished,
            Err(RunError::Timeout) => return fallback(inherited, Fallback::TimedOut),
            Err(_) => return fallback(inherited, Fallback::ShellFailed),
        };
        // Both markers still have to be there: they say the shell reached the command and
        // finished it. The environment itself is what arrived on the pipe, when anything did.
        let Some(printed) = between(&output.stdout, marker.as_bytes()) else {
            return fallback(inherited, Fallback::ShellFailed);
        };
        let captured = parse(if reported.is_empty() {
            printed
        } else {
            &reported
        });
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
///
/// A variable whose name or value is not valid UTF-8 is left out whole. It is never kept with
/// replacement characters: a child program would be handed a value the user never set. `PATH`
/// is the one exception; see [`text`].
fn parse(body: &[u8]) -> BTreeMap<String, String> {
    let variable = |entry: &[u8]| -> Option<(String, Result<String, ()>)> {
        let equals = entry.iter().position(|byte| *byte == b'=')?;
        let name = std::str::from_utf8(&entry[..equals]).ok()?;
        is_name(name).then(|| (name.to_string(), text(name, &entry[equals + 1..])))
    };
    let mut vars = BTreeMap::new();
    if body.contains(&0) {
        for entry in body.split(|byte| *byte == 0) {
            if let Some((name, Ok(value))) = variable(entry) {
                vars.insert(name, value);
            }
        }
        return vars;
    }
    // Lines as `str::lines` gives them: no empty piece after a final line end, and a carriage
    // return is part of a line's end only when a line feed follows it.
    let mut lines: Vec<&[u8]> = body.split(|byte| *byte == b'\n').collect();
    let unfinished = lines.pop().filter(|line| !line.is_empty());
    let lines = lines
        .into_iter()
        .map(|line| line.strip_suffix(b"\r").unwrap_or(line))
        .chain(unfinished);
    // The variable the next continuation line belongs to; `None` before the first variable and
    // while a variable that was left out is being skipped.
    let mut current: Option<String> = None;
    for line in lines {
        match variable(line) {
            Some((name, Ok(value))) => {
                vars.insert(name.clone(), value);
                current = Some(name);
            }
            Some((name, Err(()))) => {
                vars.remove(&name);
                current = None;
            }
            None => match (std::str::from_utf8(line), current.take()) {
                (Ok(line), Some(name)) => {
                    if let Some(value) = vars.get_mut(&name) {
                        value.push('\n');
                        value.push_str(line);
                    }
                    current = Some(name);
                }
                (Err(_), Some(name)) => {
                    vars.remove(&name);
                }
                (_, None) => {}
            },
        }
    }
    vars
}

/// A value as text, or `Err` when it is not valid UTF-8.
///
/// `PATH` is kept in part: the directories that are valid UTF-8, in their order. Each entry
/// stands on its own, so none of what is kept is a value the user never set, and a directory
/// that cannot be held as text could not be searched from here anyway. Leaving `PATH` out
/// whole would throw away the capture, and with it every directory the startup files added,
/// for one directory with an odd name (issue #97).
fn text(name: &str, value: &[u8]) -> Result<String, ()> {
    if let Ok(value) = std::str::from_utf8(value) {
        return Ok(value.to_string());
    }
    if name != "PATH" {
        return Err(());
    }
    let kept: Vec<&str> = value
        .split(|byte| *byte == b':')
        .filter_map(|entry| std::str::from_utf8(entry).ok())
        .collect();
    if kept.is_empty() {
        return Err(());
    }
    Ok(kept.join(":"))
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
        let vars =
            parse(b"A=1\0EQ=a=b=c\0MULTI=first\nSECOND=fake\n\0EMPTY=\0not a name=x\0NOVALUE\0");
        assert_eq!(get(&vars, "A"), Some("1"));
        assert_eq!(get(&vars, "EQ"), Some("a=b=c"));
        assert_eq!(get(&vars, "MULTI"), Some("first\nSECOND=fake\n"));
        assert_eq!(get(&vars, "EMPTY"), Some(""));
        assert_eq!(vars.len(), 4);
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

    /// A value, a name or a continuation line that is not UTF-8 leaves its variable out, in
    /// both forms, and takes nothing else with it.
    #[test]
    fn entries_that_are_not_unicode_are_left_out() {
        let vars = parse(b"A=1\0ODD=\xff\xfe\0MIXED=ok\xff\0N\xffME=x\0B=2\0");
        assert_eq!(get(&vars, "A"), Some("1"));
        assert_eq!(get(&vars, "B"), Some("2"));
        assert_eq!(vars.len(), 2);

        let vars = parse(
            b"A=1\nODD=\xff\xfe\n still odd\nB=2\nMULTI=first\n second \xff line\nthird\nC=3\r\nN\xffME=x\nD=4\n",
        );
        assert_eq!(get(&vars, "A"), Some("1"));
        assert_eq!(get(&vars, "B"), Some("2"));
        // In this form a line that does not start a variable continues the one before it, so
        // the line with the damaged name belongs to C's value, and C is left out with it.
        assert_eq!(get(&vars, "C"), None);
        assert_eq!(get(&vars, "D"), Some("4"));
        assert_eq!(vars.len(), 3, "{:?}", vars.keys());
    }

    /// The search path is the one value that is kept in part: each directory in it stands on
    /// its own, and without it the whole capture is of no use.
    #[test]
    fn a_search_path_keeps_the_entries_that_are_unicode() {
        let vars = parse(b"A=1\0PATH=/first:/o\xffdd:/second::/third\0NOTPATH=/first:/o\xffdd\0");
        assert_eq!(get(&vars, "PATH"), Some("/first:/second::/third"));
        assert_eq!(get(&vars, "NOTPATH"), None);
        assert_eq!(get(&vars, "A"), Some("1"));

        let vars = parse(b"PATH=\xff\xfe\0A=1\0");
        assert_eq!(get(&vars, "PATH"), None);

        let vars = parse(b"A=1\nPATH=/first:/o\xffdd:/second\nB=2\n");
        assert_eq!(get(&vars, "PATH"), Some("/first:/second"));
        assert_eq!(get(&vars, "B"), Some("2"));
    }

    /// As `str::lines` reads them: a carriage return is part of a line's end only when a line
    /// feed follows it.
    #[test]
    fn a_carriage_return_is_dropped_only_before_a_line_feed() {
        let vars = parse(b"A=1\r\nB=2\r");
        assert_eq!(get(&vars, "A"), Some("1"));
        assert_eq!(get(&vars, "B"), Some("2\r"));
    }
}
