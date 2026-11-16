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
            known_dirs: known_dirs(env, home.as_deref()),
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
///
/// After Cargo and Bun come the places Node version managers and npm put programs (issue #97,
/// decided on 16 November 2026), in a fixed order: Volta, mise, asdf, fnm, nvm, then npm's own
/// global folder. Each was read from that tool's source in November 2026: Volta's `bin`, the
/// `shims` of mise and asdf, the `aliases/default` link fnm keeps to its default version, the
/// `bin` of the version nvm's default alias names (nvm has no shims), and for npm the `bin` of
/// the prefix its variable names, or `~/.npm-global`, which npm's documentation suggested
/// until 2025; the `~/.local/bin` it suggests now is searched already. Nothing is run to find
/// them, and npm's configuration file is not read, so a prefix set only there is not searched.
/// Not searched either: nvm's folders for Node before 0.12 and for io.js, a default alias of
/// nvm's stored with flags, mise's system-wide shims, and the variable for npm's prefix in any
/// spelling but all capitals or all small letters. A program found in one of these may still
/// need its interpreter, or the manager itself, on the `PATH` it is started with.
fn known_dirs(env: &ShellEnv, home: Option<&Path>) -> Vec<PathBuf> {
    let home = home.filter(|home| home.is_absolute());
    // The folder a variable names when it names an absolute one.
    let named = |key: &str| {
        env.get(key)
            .map(Path::new)
            .filter(|path| path.is_absolute())
            .map(Path::to_path_buf)
    };
    let under_home = |rest: &str| home.map(|home| home.join(rest));
    let install_bin = |key: &str, default: &str| {
        named(key)
            .or_else(|| under_home(default))
            .map(|root| root.join("bin"))
    };
    let mut dirs = Vec::new();
    if !cfg!(windows) {
        dirs.extend(under_home(".local/bin"));
    }
    dirs.extend(install_bin("CARGO_HOME", ".cargo"));
    dirs.extend(install_bin("BUN_INSTALL", ".bun"));
    if cfg!(windows) {
        let local = named("LOCALAPPDATA");
        let roaming = named("APPDATA");
        dirs.extend(
            named("VOLTA_HOME")
                .or_else(|| local.as_ref().map(|local| local.join("Volta")))
                .map(|root| root.join("bin")),
        );
        dirs.extend(named("MISE_SHIMS_DIR").or_else(|| {
            named("MISE_DATA_DIR")
                .or_else(|| named("XDG_DATA_HOME").map(|data| data.join("mise")))
                .or_else(|| local.as_ref().map(|local| local.join("mise")))
                .map(|root| root.join("shims"))
        }));
        // On Windows a Node installation has its programs in its own folder, not in `bin`.
        let fnm_default = |root: PathBuf| root.join("aliases").join("default");
        match named("FNM_DIR") {
            Some(root) => dirs.push(fnm_default(root)),
            None => {
                dirs.extend(
                    roaming
                        .as_ref()
                        .map(|roaming| fnm_default(roaming.join("fnm"))),
                );
                dirs.extend(under_home(".fnm").map(fnm_default));
            }
        }
        dirs.extend(
            named("NPM_CONFIG_PREFIX")
                .or_else(|| named("npm_config_prefix"))
                .or_else(|| roaming.as_ref().map(|roaming| roaming.join("npm"))),
        );
    } else {
        dirs.extend(install_bin("VOLTA_HOME", ".volta"));
        dirs.extend(named("MISE_SHIMS_DIR").or_else(|| {
            named("MISE_DATA_DIR")
                .or_else(|| named("XDG_DATA_HOME").map(|data| data.join("mise")))
                .or_else(|| under_home(".local/share/mise"))
                .map(|root| root.join("shims"))
        }));
        dirs.extend(
            named("ASDF_DATA_DIR")
                .or_else(|| under_home(".asdf"))
                .map(|root| root.join("shims")),
        );
        let fnm_default = |root: PathBuf| root.join("aliases/default/bin");
        match named("FNM_DIR") {
            Some(root) => dirs.push(fnm_default(root)),
            // fnm uses the first of these that exists, in this order; the last two are where
            // older versions and its install script on a Mac put it.
            None => {
                dirs.extend(named("XDG_DATA_HOME").map(|data| fnm_default(data.join("fnm"))));
                dirs.extend(under_home(".local/share/fnm").map(fnm_default));
                dirs.extend(under_home(".fnm").map(fnm_default));
                dirs.extend(under_home("Library/Application Support/fnm").map(fnm_default));
            }
        }
        // nvm installs under the configuration folder when that variable is set, and under
        // the home directory otherwise.
        let nvm_roots = match named("NVM_DIR") {
            Some(root) => vec![root],
            None => named("XDG_CONFIG_HOME")
                .map(|config| config.join("nvm"))
                .into_iter()
                .chain(under_home(".nvm"))
                .collect(),
        };
        dirs.extend(nvm_roots.iter().find_map(|root| nvm_default_bin(root)));
        dirs.extend(
            named("NPM_CONFIG_PREFIX")
                .or_else(|| named("npm_config_prefix"))
                .map(|prefix| prefix.join("bin")),
        );
        dirs.extend(under_home(".npm-global/bin"));
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
        dirs.extend(under_home(".coven/bin"));
    }
    let mut unique = Vec::new();
    for dir in dirs {
        if !unique.contains(&dir) {
            unique.push(dir);
        }
    }
    unique
}

/// The most that is read of one nvm alias file, and the most version folders looked at.
const NVM_ALIAS_BYTES: u64 = 256;
const NVM_VERSIONS: usize = 1024;

/// The `bin` folder of the Node version nvm would use in a new shell: the one its `default`
/// alias names. nvm has no folder of shims; it puts this folder on `PATH` itself. An alias may
/// name a version (`v22.11.0`), part of one (`22`, the highest installed that starts so),
/// `node` or `stable` (the highest installed), or another alias, `lts/*` among them. Without a
/// default alias, or with `system`, there is nothing to add. Nor is there for an alias stored
/// with the `--lts` or `--only=` flags that nvm 0.41 introduced: working those out needs nvm's
/// record of which versions are long-term ones, which is not read here.
fn nvm_default_bin(root: &Path) -> Option<PathBuf> {
    let versions = root.join("versions").join("node");
    let mut installed: Vec<(Vec<u64>, PathBuf)> = std::fs::read_dir(&versions)
        .ok()?
        .take(NVM_VERSIONS)
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name();
            let numbers = version_numbers(name.to_str()?.strip_prefix('v')?)?;
            (numbers.len() == 3).then(|| (numbers, entry.path()))
        })
        .collect();
    installed.sort();
    let mut alias = "default".to_string();
    // nvm follows aliases too; the count only stops two that name each other.
    for _ in 0..8 {
        let named = read_alias(&root.join("alias"), &alias)?;
        let wanted = match named.as_str() {
            "node" | "stable" => Some(Vec::new()),
            other => version_numbers(other.strip_prefix('v').unwrap_or(other)),
        };
        if let Some(wanted) = wanted {
            return installed
                .iter()
                .rev()
                .find(|(numbers, _)| numbers.starts_with(&wanted))
                .map(|(_, dir)| dir.join("bin"));
        }
        alias = named;
    }
    None
}

/// The numbers of a version or of the start of one: `22`, `22.11`, `22.11.0`.
fn version_numbers(text: &str) -> Option<Vec<u64>> {
    let numbers: Option<Vec<u64>> = text
        .split('.')
        .map(|part| {
            (!part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
                .then(|| part.parse().ok())
                .flatten()
        })
        .collect();
    numbers.filter(|numbers| !numbers.is_empty() && numbers.len() <= 3)
}

/// What an nvm alias names: the first line of its file that says anything. The name is nvm's own or comes out of
/// another alias file, so one that would leave the alias folder is not followed.
fn read_alias(aliases: &Path, name: &str) -> Option<String> {
    use std::io::Read;
    use std::path::Component;
    let relative = Path::new(name);
    let stays_inside = !name.is_empty()
        && relative
            .components()
            .all(|part| matches!(part, Component::Normal(_)));
    if !stays_inside {
        return None;
    }
    let mut text = String::new();
    std::fs::File::open(aliases.join(relative))
        .ok()?
        .take(NVM_ALIAS_BYTES)
        .read_to_string(&mut text)
        .ok()?;
    // As nvm reads it since 0.40.6: each line ends at a `#`, and the first line with anything
    // left on it counts.
    text.lines()
        .map(|line| line.split('#').next().unwrap_or_default().trim())
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

#[cfg(unix)]
fn is_program(path: &Path) -> bool {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    if !std::fs::metadata(path).is_ok_and(|metadata| metadata.is_file()) {
        return false;
    }
    let Ok(path) = CString::new(path.as_os_str().as_bytes()) else {
        return false;
    };
    // SAFETY: the path is NUL-terminated and lives through the call. Check the effective
    // user's access, including ACLs, rather than execute bits belonging to another user.
    unsafe { libc::faccessat(libc::AT_FDCWD, path.as_ptr(), libc::X_OK, libc::AT_EACCESS) == 0 }
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
