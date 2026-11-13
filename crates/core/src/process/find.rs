//! Finding an installed command-line tool.
//!
//! Order: the path the user set for the tool, if any, and nothing else; otherwise each absolute
//! directory on `PATH`, then the known install locations. The working directory is never
//! searched, and a name is never passed to a shell.

use super::ShellEnv;
use crate::protocol::BridgeError;
use std::path::{Path, PathBuf};

/// Where to look for programs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Search {
    /// Directories from `PATH`, in order.
    pub path: Vec<PathBuf>,
    /// File extensions that mark a program, from `PATHEXT`. Empty except on Windows.
    pub extensions: Vec<String>,
    /// Usual install locations, searched after `path`.
    pub known_dirs: Vec<PathBuf>,
}

impl Search {
    /// The search for an environment: its `PATH`, its `PATHEXT` on Windows, and the known
    /// install locations under its home directory.
    pub fn from_env(env: &ShellEnv) -> Self {
        let mut path: Vec<PathBuf> = Vec::new();
        for dir in std::env::split_paths(env.get("PATH").unwrap_or_default()) {
            if dir.is_absolute() && !path.contains(&dir) {
                path.push(dir);
            }
        }
        let mut extensions: Vec<String> = match env.get("PATHEXT") {
            Some(list) if cfg!(windows) => list
                .split(';')
                .map(str::trim)
                .filter(|ext| ext.len() > 1 && ext.starts_with('.'))
                .map(str::to_string)
                .collect(),
            _ => Vec::new(),
        };
        if extensions.is_empty() {
            // Not set, or set to nothing usable: without extensions no name would match.
            extensions = Self::default_extensions();
        }
        let home = env
            .get(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
            .map(PathBuf::from);
        Self {
            path,
            extensions,
            known_dirs: known_dirs(home.as_deref()),
        }
    }

    /// The program extensions Windows uses when `PATHEXT` is not set; none elsewhere.
    pub fn default_extensions() -> Vec<String> {
        if cfg!(windows) {
            [".COM", ".EXE", ".BAT", ".CMD"]
                .map(str::to_string)
                .to_vec()
        } else {
            Vec::new()
        }
    }

    /// The program to run for `name`. With `explicit`, the user's own path for this tool, that
    /// path is returned if it is a program and `None` otherwise: a bad override is reported as
    /// missing instead of being replaced by a different program.
    pub fn find(&self, name: &str, explicit: Option<&Path>) -> Option<PathBuf> {
        if let Some(explicit) = explicit {
            return (explicit.is_absolute() && is_program(explicit))
                .then(|| explicit.to_path_buf());
        }
        let plain = !name.is_empty()
            && name != "."
            && name != ".."
            && !name.contains(['/', '\\', ':', '\0']);
        if !plain {
            return None;
        }
        self.path
            .iter()
            .chain(&self.known_dirs)
            .flat_map(|dir| self.candidates(dir, name))
            .find(|candidate| is_program(candidate))
    }

    fn candidates(&self, dir: &Path, name: &str) -> Vec<PathBuf> {
        if self.extensions.is_empty() {
            return vec![dir.join(name)];
        }
        let lower = name.to_ascii_lowercase();
        let mut candidates = Vec::new();
        if self
            .extensions
            .iter()
            .any(|ext| lower.ends_with(&ext.to_ascii_lowercase()))
        {
            candidates.push(dir.join(name));
        }
        candidates.extend(
            self.extensions
                .iter()
                .map(|ext| dir.join(format!("{name}{}", ext.to_ascii_lowercase()))),
        );
        candidates
    }
}

/// Usual install locations, most specific first. `home` adds the per-user ones.
fn known_dirs(home: Option<&Path>) -> Vec<PathBuf> {
    if cfg!(windows) {
        return Vec::new();
    }
    let home = home.filter(|home| home.is_absolute());
    let mut dirs: Vec<PathBuf> = home
        .map(|home| home.join(".local/bin"))
        .into_iter()
        .collect();
    dirs.extend(
        [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/snap/bin",
            "/usr/bin",
            "/bin",
        ]
        .map(PathBuf::from),
    );
    dirs.extend(home.map(|home| home.join(".coven/bin")));
    dirs
}

#[cfg(unix)]
fn is_program(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn is_program(path: &Path) -> bool {
    path.is_file()
}

/// Finds `name` using the environment this process was started with. Prefer
/// [`Search::from_env`] with the environment captured at startup; this is for code that runs
/// before, or without, that capture.
pub fn resolve(name: &str, explicit: Option<&Path>) -> Option<PathBuf> {
    Search::from_env(&ShellEnv::inherited()).find(name, explicit)
}

/// The message for a tool that is not installed. A missing tool is an ordinary error.
pub fn not_installed(name: &str) -> BridgeError {
    BridgeError(format!("{name} is not installed, or Open Sesame could not find it. Install it, or set its path in Settings."))
}
