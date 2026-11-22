//! Finding an installed command-line tool.
//!
//! Order: the path the user set for the tool, if any, and nothing else; otherwise each absolute
//! directory on `PATH`, then the known install locations. The working directory is never
//! searched, and a name is never passed to a shell.

use super::{EnvSource, Output, RunError, ShellEnv};
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

    /// The environment to start `program` with, a path [`Search::find`] returned for `env` when
    /// it was given `explicit`; pass it as [`Run::env`](super::Run::env) with
    /// [`Run::clear_env`](super::Run::clear_env).
    ///
    /// When the login shell's `PATH` could not be had and the program was found in one of the
    /// known install locations, what it needs to start may not be on the short `PATH` a desktop
    /// launch gives: a script npm installed names `node` through `#!/usr/bin/env`, and the
    /// shims of asdf and the Windows shims of mise and Volta run their manager by name. The owner
    /// decided on 18 November 2026 (issue #145) that such a program starts with its own folder
    /// first on its `PATH`, then the `PATH` as it was, then the other known locations, and that a
    /// program that still cannot start is reported with [`could_not_start`]. Only `PATH`
    /// changes. A path the person set (`explicit`), a program found on the `PATH` (also when its
    /// folder is one of the known locations too, as `/usr/bin` or `~/.cargo/bin` can be), and any
    /// program when the login shell's environment was captured start with the environment as it
    /// is. On Windows there is no login shell to ask, so the environment is always the inherited
    /// one and the change applies to every program found only in a known location.
    pub fn start_env(
        &self,
        env: &ShellEnv,
        program: &Path,
        explicit: Option<&Path>,
    ) -> Vec<(String, String)> {
        let mut vars = env.to_run_env();
        if explicit.is_some() || *env.source() == EnvSource::LoginShell {
            return vars;
        }
        let Some(folder) = program.parent().filter(|folder| {
            self.known_dirs.iter().any(|dir| same_dir(dir, folder))
                && !self.path.iter().any(|dir| same_dir(dir, folder))
        }) else {
            return vars;
        };
        // Folders that cannot be written into a `PATH`, such as one with the separator in its
        // name, are left out rather than giving up the change.
        let joined = |dirs: Vec<&Path>| {
            let dirs: Vec<&Path> = dirs
                .into_iter()
                .filter(|dir| std::env::join_paths([dir]).is_ok())
                .collect();
            std::env::join_paths(dirs)
                .ok()
                .and_then(|joined| joined.into_string().ok())
                .unwrap_or_default()
        };
        let current = env.get("PATH").unwrap_or_default();
        let on_path: Vec<PathBuf> = std::env::split_paths(current).collect();
        let after: Vec<&Path> = self
            .known_dirs
            .iter()
            .map(PathBuf::as_path)
            .filter(|dir| {
                !same_dir(dir, folder) && !on_path.iter().any(|other| same_dir(other, dir))
            })
            .collect();
        // The `PATH` as it was is kept as written, empty entries and all.
        let value = [joined(vec![folder]), current.to_string(), joined(after)]
            .into_iter()
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join(if cfg!(windows) { ";" } else { ":" });
        // On Windows the variable is usually stored as `Path`; that entry is the one replaced.
        let key = vars.iter().position(|(name, _)| {
            name == "PATH" || (cfg!(windows) && name.eq_ignore_ascii_case("PATH"))
        });
        match key {
            Some(at) => vars[at].1 = value,
            None => vars.push(("PATH".to_string(), value)),
        }
        vars
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
/// The places Node version managers and npm put programs are searched too (issue #97, decided
/// on 16 November 2026). After Cargo and Bun come the ones that hold real programs: the
/// `aliases/default` link fnm keeps to its default version, the `bin` of the version nvm's
/// default alias names (nvm has no shims, and is not searched on Windows, where it does not
/// run), and for npm the `bin` of the prefix its variable names, or `~/.npm-global`, which
/// npm's documentation suggested until 2025; the `~/.local/bin` it suggests now is searched
/// already. Then the shims that start by themselves, Volta's `bin` and mise's `shims`, then
/// the system's own folders, and last the `shims` of asdf, which need `asdf` on the `PATH`
/// (asdf has no Windows form). Each folder was read from that tool's source in November 2026. A variable that names a manager's folder replaces the folder under the home
/// directory, as it does for the manager itself. Nothing is run to find these, and no tool's
/// configuration file is read, so a prefix set only in npm's and a `shims_dir` set only in
/// mise's are not searched. Not searched either: nvm's folders for Node before 0.12 and for
/// io.js, a default alias of nvm's stored with flags, mise's system-wide shims, and the
/// variable for npm's prefix in any spelling but all capitals or all small letters. A shim of
/// Volta or mise is found before a system copy even when its manager has no version of that
/// tool to run. A program
/// found in one of these may still need its interpreter, or the manager itself, on the `PATH`
/// it is started with: [`Search::start_env`] gives it one (issue #145).
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
        // The shims after the real programs. There is no system folder to order them
        // against here.
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
    } else {
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
        // The shims of Volta and mise come before the system's folders, where a shell set up
        // for them has them: each finds its manager by itself (Volta's is one program that
        // reads `VOLTA_HOME` or the home directory, mise's are links to `mise`), so a copy in
        // a system folder must not hide the version the person chose.
        dirs.extend(install_bin("VOLTA_HOME", ".volta"));
        dirs.extend(named("MISE_SHIMS_DIR").or_else(|| {
            named("MISE_DATA_DIR")
                .or_else(|| named("XDG_DATA_HOME").map(|data| data.join("mise")))
                .or_else(|| under_home(".local/share/mise"))
                .map(|root| root.join("shims"))
        }));
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
        // asdf's shims last: since asdf 0.16 a shim is a script that runs `asdf` by name, so
        // it needs `asdf` on the `PATH` it is started with, which is what is missing when
        // these folders matter. The search stops at the first program of the name, so that
        // shim in front would hide a copy further down that can start.
        dirs.extend(
            named("ASDF_DATA_DIR")
                .or_else(|| under_home(".asdf"))
                .map(|root| root.join("shims")),
        );
    }
    let mut unique = Vec::new();
    for dir in dirs {
        if !unique.contains(&dir) {
            unique.push(dir);
        }
    }
    unique
}

/// The most that is read of one nvm alias file, the most version folders looked at, and the
/// most aliases followed. nvm itself has none of these limits; past one of ours there is
/// nothing to add.
const NVM_ALIAS_BYTES: u64 = 4096;
const NVM_VERSIONS: usize = 1024;
const NVM_ALIASES: usize = 16;

/// The `bin` folder of the Node version nvm would use in a new shell: the one its `default`
/// alias names. nvm has no folder of shims; it puts this folder on `PATH` itself.
///
/// This follows nvm's own steps, as read in the source of nvm 0.40; the second review of this
/// code ran nvm 0.40.8 on a Mac against the same folders and the cases that differed are
/// either changed to match or listed below. While there is an alias file of the name in hand,
/// the name becomes what that file says, and two files that name each other give nothing.
/// What is left when no file has that name is `node` or `stable` (the highest version
/// installed), a full version (that folder, if it is there), or part of one (`22`, `22.11`:
/// the highest installed that starts so). Of folders with the same three numbers the first by
/// name is taken, so a release before its own prereleases. A file is looked for first even
/// when the name looks like a version, as nvm does. The folder found is used only when it has
/// `node` in its `bin`: nvm puts nothing on `PATH` for a version that was not installed whole,
/// and no older version in its place. Without a default alias, or with `system`, there is
/// nothing to add. Nor is there for an alias stored with the `--lts` or `--only=` flags that
/// nvm 0.41 introduced: working those out needs nvm's record of which versions are long-term
/// ones, which is not read here.
///
/// Known differences from nvm 0.40.8, each giving nothing here where nvm finds a version
/// unless said otherwise: a default of `lts/-1` (the long-term line before the newest);
/// `unstable` and `iojs`; a name nvm reads as a pattern (`v`, `.11`, `22.*`, `node-`); the
/// `.nvmrc` in the home directory, which nvm uses when there is no default alias; and an
/// alias file named like the version that a chain of aliases ends at, which nvm looks for a
/// second time and this does not, so this takes the version where nvm follows the file. nvm
/// refuses to work at all while npm's prefix variable is set; the folder is searched here
/// all the same. Rarer, and seen by running nvm 0.40.8: nvm does not count a version folder
/// that is a link to a folder elsewhere unless it is named in full, and this does, so the
/// link can be taken as the highest version where nvm takes a real folder; a plain file named
/// like a version is taken as the highest here, which then gives nothing, where nvm passes
/// over it; of two prereleases of one version whose names differ only in the case of a letter
/// the first by bytes is taken here and nvm, under a UTF-8 locale, takes the other; a chain of
/// more than `NVM_ALIASES` aliases is given up here; under the C locale nvm keeps a no-break
/// space at the end of an alias line as part of the name, which is dropped here, and a Linux
/// locale, where this was not tried, may do the same; and a next-line character (U+0085) at
/// the end of a line is kept by nvm and dropped here.
fn nvm_default_bin(root: &Path) -> Option<PathBuf> {
    let versions = root.join("versions").join("node");
    // Folder names that start as a version does, with the three numbers nvm sorts by.
    let mut installed: Vec<([u64; 3], String)> = std::fs::read_dir(&versions)
        .ok()?
        .take(NVM_VERSIONS)
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            Some((nvm_sort_key(&name)?, name))
        })
        .collect();
    installed.sort();
    let aliases = root.join("alias");
    let mut name = "default".to_string();
    let mut seen = vec![name.clone()];
    while let Some(next) = read_alias(&aliases, &name) {
        if seen.contains(&next) || seen.len() > NVM_ALIASES {
            return None;
        }
        seen.push(next.clone());
        name = next;
    }
    if seen.len() == 1 {
        // No default alias, or one that cannot be read.
        return None;
    }
    // Used only when `node` is there: see above.
    let bin_of = |folder: &str| {
        let bin = versions.join(folder).join("bin");
        is_program(&bin.join("node")).then_some(bin)
    };
    // The highest numbers among the folders that start so, and of those the first by name.
    let highest = |starts: &str| {
        let fits = |folder: &str| folder.starts_with(starts);
        let (top, _) = installed.iter().rev().find(|(_, folder)| fits(folder))?;
        installed
            .iter()
            .find(|(numbers, folder)| numbers == top && fits(folder))
            .and_then(|(_, folder)| bin_of(folder))
    };
    if name == "node" || name == "stable" {
        return highest("v");
    }
    // nvm puts a `v` in front of a name that starts with a digit, and compares text from
    // there: `022` and ` 22` are not `22`.
    let pattern = match name.bytes().next() {
        Some(first) if first.is_ascii_digit() => format!("v{name}"),
        Some(b'v') => name,
        _ => return None,
    };
    if installed.iter().any(|(_, folder)| *folder == pattern) {
        return bin_of(&pattern);
    }
    // One dot at the end is passed over, as nvm passes it over; `22..` is no version.
    let numbers = &pattern[1..];
    let numbers = numbers.strip_suffix('.').unwrap_or(numbers);
    let groups = numbers.split('.').count();
    let partial = !numbers.is_empty()
        && groups <= 2
        && numbers
            .split('.')
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()));
    partial.then(|| highest(&format!("v{numbers}."))).flatten()
}

/// The three numbers nvm sorts a version folder by: `v22.11.0` gives 22, 11 and 0, and so does
/// a prerelease such as `v22.11.0-rc.1`. A name that does not start so is not a version.
fn nvm_sort_key(folder: &str) -> Option<[u64; 3]> {
    let mut parts = folder.strip_prefix('v')?.splitn(3, '.');
    let mut number = |whole: bool| {
        let part = parts.next()?;
        let digits = part.bytes().take_while(u8::is_ascii_digit).count();
        (digits > 0 && (!whole || digits == part.len()))
            .then(|| part[..digits].parse().ok())
            .flatten()
    };
    Some([number(true)?, number(true)?, number(false)?])
}

/// What an nvm alias names: the first line of its file that says anything, read as nvm reads
/// it since 0.40.4: each line ends at a `#`, and the blanks at its end are dropped. nvm drops
/// what its shell calls a space, which in the UTF-8 locale a terminal has on macOS includes a
/// vertical tab and a no-break space, so both are dropped here; the characters Unicode calls
/// white space stand in for the system's list. The name is
/// nvm's own or comes out of another alias file, so one that would leave the alias folder is
/// not followed, and neither is a long-term name with a capital letter, which nvm refuses.
/// Only a regular file is opened, so a pipe left under that name cannot hold up the search.
fn read_alias(aliases: &Path, name: &str) -> Option<String> {
    use std::io::Read;
    use std::path::Component;
    let blank = char::is_whitespace;
    let relative = Path::new(name);
    let stays_inside = !name.is_empty()
        && relative
            .components()
            .all(|part| matches!(part, Component::Normal(_)));
    let refused = name.starts_with("lts/") && name.bytes().any(|byte| byte.is_ascii_uppercase());
    if !stays_inside || refused {
        return None;
    }
    let path = aliases.join(relative);
    if !std::fs::metadata(&path).is_ok_and(|metadata| metadata.is_file()) {
        return None;
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .ok()?
        .take(NVM_ALIAS_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    // A longer file is not cut short and read as if that were all of it.
    if bytes.len() as u64 > NVM_ALIAS_BYTES {
        return None;
    }
    String::from_utf8(bytes)
        .ok()?
        .lines()
        .map(|line| line.split('#').next().unwrap_or_default())
        .find(|line| !line.trim_matches(blank).is_empty())
        .map(|line| line.trim_end_matches(blank).to_string())
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

/// Whether two folders are the same as a `PATH` names them: exactly, or ignoring ASCII case on
/// Windows, whose file names are not case-sensitive.
fn same_dir(a: &Path, b: &Path) -> bool {
    a == b || (cfg!(windows) && a.as_os_str().eq_ignore_ascii_case(b.as_os_str()))
}

/// The message for a tool that is not installed. A missing tool is an ordinary error.
pub fn not_installed(name: &str) -> BridgeError {
    BridgeError(format!("{name} is not installed, or Open Sesame could not find it. Install it, or set its path in Settings."))
}

/// The message for a tool that was found but could not start because something it needs to run
/// was not found (issue #145): see [`start_failed`].
pub fn could_not_start(name: &str) -> BridgeError {
    BridgeError(format!("{name} was found but could not start, because a program it needs to run was not found. Set its path in Settings."))
}

/// Whether a run of a program found in a known location (one [`Search::start_env`] changed the
/// `PATH` for) failed to start because something it needs was missing: the system could not find
/// what the program's `#!` line names (`RunError::NotFound`), or a command it ran was not found,
/// which `env` and the shells report with status 127 and `cmd.exe` on Windows with 9009.
/// The statuses cannot be told apart from a program that ran and then exited with one of them
/// itself, or ran its work and then failed to find a later command, so those are counted too.
/// `RunError::NotFound` is also what a program removed between `find` and the run gives; a
/// caller that sees the program itself gone reports [`not_installed`] instead. Use it, and
/// [`could_not_start`], only for a program found in a known location: for a path the person set
/// or a program found on the `PATH`, the advice to set its path in Settings would not help.
pub fn start_failed(result: &Result<Output, RunError>) -> bool {
    let not_found = if cfg!(windows) { 9009 } else { 127 };
    match result {
        Err(RunError::NotFound) => true,
        Ok(output) => output.status == Some(not_found),
        Err(_) => false,
    }
}
