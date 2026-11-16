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

#[test]
fn standard_user_install_locations_work_without_shell_capture() {
    let home = tempfile::tempdir().unwrap();
    let cargo = install(&home.path().join(".cargo/bin"), "cargo-owned-tool-73");
    let bun = install(&home.path().join(".bun/bin"), "bun-owned-tool-73");
    let inherited = vars(&[(
        if cfg!(windows) { "USERPROFILE" } else { "HOME" },
        home.path().to_str().unwrap(),
    )]);
    let env = ShellEnv::capture(None, inherited, Duration::from_millis(20));
    assert!(matches!(env.source(), EnvSource::Inherited(_)));
    let finder = Search::from_env(&env);
    assert_eq!(
        [
            finder.find("cargo-owned-tool-73", None),
            finder.find("bun-owned-tool-73", None),
        ],
        [Some(cargo), Some(bun)]
    );
}

#[test]
fn configured_install_roots_work_without_a_home_directory() {
    let dir = tempfile::tempdir().unwrap();
    let cargo_home = dir.path().join("custom cargo");
    let bun_home = dir.path().join("custom bun");
    let cargo = install(&cargo_home.join("bin"), "cargo-owned-tool-73");
    let bun = install(&bun_home.join("bin"), "bun-owned-tool-73");
    let env = ShellEnv::from_vars(vars(&[
        ("CARGO_HOME", cargo_home.to_str().unwrap()),
        ("BUN_INSTALL", bun_home.to_str().unwrap()),
    ]));
    let finder = Search::from_env(&env);
    assert!(finder.known_dirs.iter().all(|path| path.is_absolute()));
    assert_eq!(
        [
            finder.find("cargo-owned-tool-73", None),
            finder.find("bun-owned-tool-73", None),
        ],
        [Some(cargo), Some(bun)]
    );
}

#[test]
fn relative_install_roots_fall_back_to_absolute_home_locations() {
    let home = tempfile::tempdir().unwrap();
    let cargo = install(&home.path().join(".cargo/bin"), "cargo-owned-tool-73");
    let bun = install(&home.path().join(".bun/bin"), "bun-owned-tool-73");
    let env = ShellEnv::from_vars(vars(&[
        (
            if cfg!(windows) { "USERPROFILE" } else { "HOME" },
            home.path().to_str().unwrap(),
        ),
        ("CARGO_HOME", "relative-cargo"),
        ("BUN_INSTALL", "relative-bun"),
    ]));
    let finder = Search::from_env(&env);
    assert!(finder.known_dirs.iter().all(|path| path.is_absolute()));
    assert_eq!(
        [
            finder.find("cargo-owned-tool-73", None),
            finder.find("bun-owned-tool-73", None),
        ],
        [Some(cargo), Some(bun)]
    );
}

/// The environment of an application launched with a home directory and nothing else.
fn launched_from(home: &Path, extra: &[(&str, &str)]) -> ShellEnv {
    let mut all = vec![(
        if cfg!(windows) { "USERPROFILE" } else { "HOME" },
        home.to_str().unwrap(),
    )];
    all.extend_from_slice(extra);
    ShellEnv::from_vars(vars(&all))
}

/// Where Node version managers and npm put programs is searched when the login shell's `PATH`
/// could not be had (issue #97): fnm's default version, the version nvm's default alias names,
/// npm's per-user global folder and the shims of Volta and mise, and after the system's
/// folders the shims of asdf.
#[cfg(unix)]
#[test]
fn version_manager_folders_under_the_home_directory_are_searched() {
    let home = tempfile::tempdir().unwrap();
    let at = |rest: &str| home.path().join(rest);
    std::fs::create_dir_all(at(".nvm/alias")).unwrap();
    std::fs::write(at(".nvm/alias/default"), "22\n").unwrap();
    let expected = [
        install(&at(".volta/bin"), "tool-volta"),
        install(&at(".local/share/mise/shims"), "tool-mise"),
        install(&at(".asdf/shims"), "tool-asdf"),
        install(&at(".local/share/fnm/aliases/default/bin"), "tool-fnm-xdg"),
        install(
            &at("Library/Application Support/fnm/aliases/default/bin"),
            "tool-fnm-mac",
        ),
        install(&at(".fnm/aliases/default/bin"), "tool-fnm-old"),
        install(&at(".nvm/versions/node/v22.11.0/bin"), "tool-nvm"),
        install(&at(".npm-global/bin"), "tool-npm"),
    ];
    install(&at(".nvm/versions/node/v22.11.0/bin"), "node");
    // The same name in several of them: a folder of real programs is searched before the
    // shims, and asdf's shims after everything, because a shim of asdf that cannot reach
    // `asdf` would hide a copy that can start.
    let real = install(&at(".nvm/versions/node/v22.11.0/bin"), "tool-twice");
    install(&at(".asdf/shims"), "tool-twice");
    install(&at(".volta/bin"), "tool-twice");
    // Volta's and mise's start by themselves, so they come before the system's folders, as
    // in a shell set up for them: a system copy does not hide the version the person chose.
    // `env` stands for such a tool, because the system has one of that name.
    assert!(Path::new("/usr/bin/env").is_file());
    let chosen = install(&at(".volta/bin"), "env");
    install(&at(".asdf/shims"), "env");
    let finder = Search::from_env(&launched_from(home.path(), &[]));
    assert!(finder.known_dirs.iter().all(|dir| dir.is_absolute()));
    for program in expected {
        let name = program.file_name().unwrap().to_str().unwrap();
        assert_eq!(finder.find(name, None), Some(program.clone()), "{name}");
    }
    assert_eq!(finder.find("tool-twice", None), Some(real));
    assert_eq!(finder.find("env", None), Some(chosen));
    let place = |rest: &str| {
        let dir = if rest.starts_with('/') {
            PathBuf::from(rest)
        } else {
            at(rest)
        };
        finder
            .known_dirs
            .iter()
            .position(|known| *known == dir)
            .unwrap_or_else(|| panic!("{rest} is not searched"))
    };
    let order = [
        ".local/share/fnm/aliases/default/bin",
        ".nvm/versions/node/v22.11.0/bin",
        ".npm-global/bin",
        ".volta/bin",
        ".local/share/mise/shims",
        "/opt/homebrew/bin",
        "/usr/bin",
        ".coven/bin",
        ".asdf/shims",
    ];
    for pair in order.windows(2) {
        assert!(
            place(pair[0]) < place(pair[1]),
            "{} before {}",
            pair[0],
            pair[1]
        );
    }
}

/// Each manager's own variable for its folder is honoured when it names an absolute one, and
/// the manager's folder under the home directory is then not searched, as the manager itself
/// would not use it. npm is the exception: `~/.npm-global` is a folder people make by hand, so
/// it is searched beside the prefix the variable names. A relative value is passed over for
/// the home folder, as for Cargo and Bun.
#[cfg(unix)]
#[test]
fn version_manager_folders_follow_their_variables() {
    let home = tempfile::tempdir().unwrap();
    let other = tempfile::tempdir().unwrap();
    let at = |rest: &str| other.path().join(rest);
    std::fs::create_dir_all(at("nvm/alias")).unwrap();
    std::fs::write(at("nvm/alias/default"), "v20.1.0\n").unwrap();
    let expected = [
        install(&at("volta/bin"), "tool-volta"),
        install(&at("mise/shims"), "tool-mise"),
        install(&at("asdf/shims"), "tool-asdf"),
        install(&at("fnm/aliases/default/bin"), "tool-fnm"),
        install(&at("nvm/versions/node/v20.1.0/bin"), "tool-nvm"),
        install(&at("npm/bin"), "tool-npm"),
    ];
    install(&at("nvm/versions/node/v20.1.0/bin"), "node");
    let text = |rest: &str| at(rest).to_str().unwrap().to_string();
    let named = [
        ("VOLTA_HOME", text("volta")),
        ("MISE_DATA_DIR", text("mise")),
        ("ASDF_DATA_DIR", text("asdf")),
        ("FNM_DIR", text("fnm")),
        ("NVM_DIR", text("nvm")),
        ("NPM_CONFIG_PREFIX", text("npm")),
    ];
    let pairs: Vec<(&str, &str)> = named
        .iter()
        .map(|(name, value)| (*name, value.as_str()))
        .collect();
    // The managers' folders under the home directory, which the variables replace.
    let under_home = |rest: &str| install(&home.path().join(rest), "only-under-home");
    let shadowed = under_home(".volta/bin");
    under_home(".local/share/mise/shims");
    under_home(".asdf/shims");
    under_home(".local/share/fnm/aliases/default/bin");
    under_home(".fnm/aliases/default/bin");
    under_home("Library/Application Support/fnm/aliases/default/bin");
    under_home(".nvm/versions/node/v20.1.0/bin");
    install(&home.path().join(".nvm/versions/node/v20.1.0/bin"), "node");
    std::fs::create_dir_all(home.path().join(".nvm/alias")).unwrap();
    std::fs::write(home.path().join(".nvm/alias/default"), "v20.1.0\n").unwrap();
    let finder = Search::from_env(&launched_from(home.path(), &pairs));
    for program in &expected {
        let name = program.file_name().unwrap().to_str().unwrap();
        assert_eq!(finder.find(name, None), Some(program.clone()), "{name}");
    }
    assert_eq!(finder.find("only-under-home", None), None);
    // Without the variables each of those is searched, and npm's hand-made folder is searched
    // with its variable set too.
    let plain = Search::from_env(&launched_from(home.path(), &[]));
    assert!(plain.find("only-under-home", None).is_some());
    let by_hand = install(&home.path().join(".npm-global/bin"), "tool-npm-by-hand");
    let finder = Search::from_env(&launched_from(home.path(), &pairs));
    assert_eq!(finder.find("tool-npm-by-hand", None), Some(by_hand));

    // npm also reads the variable in lower case, and mise and fnm follow XDG_DATA_HOME.
    let data = tempfile::tempdir().unwrap();
    let mise = install(&data.path().join("mise/shims"), "tool-mise-xdg");
    let fnm = install(&data.path().join("fnm/aliases/default/bin"), "tool-fnm-xdg");
    let finder = Search::from_env(&launched_from(
        home.path(),
        &[
            ("npm_config_prefix", &text("npm")),
            ("XDG_DATA_HOME", data.path().to_str().unwrap()),
        ],
    ));
    assert_eq!(finder.find("tool-npm", None), Some(expected[5].clone()));
    assert_eq!(finder.find("tool-mise-xdg", None), Some(mise));
    assert_eq!(finder.find("tool-fnm-xdg", None), Some(fnm));

    // mise's own variable for the shims folder comes before its data folder, and nvm is under
    // the configuration folder when that variable is set.
    let config = tempfile::tempdir().unwrap();
    let shims = install(&other.path().join("mise shims"), "tool-mise-shims");
    std::fs::create_dir_all(config.path().join("nvm/alias")).unwrap();
    std::fs::write(config.path().join("nvm/alias/default"), "node\n").unwrap();
    let nvm = install(
        &config.path().join("nvm/versions/node/v24.0.1/bin"),
        "tool-nvm-config",
    );
    install(nvm.parent().unwrap(), "node");
    let finder = Search::from_env(&launched_from(
        home.path(),
        &[
            ("MISE_SHIMS_DIR", shims.parent().unwrap().to_str().unwrap()),
            ("MISE_DATA_DIR", &text("mise")),
            ("XDG_CONFIG_HOME", config.path().to_str().unwrap()),
        ],
    ));
    assert_eq!(finder.find("tool-mise-shims", None), Some(shims));
    assert_eq!(finder.find("tool-mise", None), None);
    assert_eq!(finder.find("tool-nvm-config", None), Some(nvm));

    let relative = Search::from_env(&launched_from(
        home.path(),
        &[
            ("VOLTA_HOME", "relative-volta"),
            ("NVM_DIR", "relative-nvm"),
        ],
    ));
    assert!(relative.known_dirs.iter().all(|dir| dir.is_absolute()));
    assert!(relative
        .known_dirs
        .contains(&shadowed.parent().unwrap().to_path_buf()));
}

/// nvm has no folder of shims: the folder to search is the `bin` of the version its default
/// alias names, worked out from nvm's own files and never by running nvm.
#[cfg(unix)]
#[test]
fn the_nvm_folder_is_the_one_its_default_alias_names() {
    let home = tempfile::tempdir().unwrap();
    let nvm = home.path().join(".nvm");
    let mut programs = BTreeMap::new();
    // A version nvm would use has `node` in its `bin`.
    let version = |name: &str| {
        let bin = nvm.join("versions/node").join(name).join("bin");
        install(&bin, "node");
        install(&bin, "tool")
    };
    for name in ["v9.11.2", "v20.1.0", "v22.3.0", "v22.11.0", "v24.0.1"] {
        programs.insert(name, version(name));
    }
    // A folder that is not a version is never chosen.
    version("v99.broken");
    let alias = |name: &str, names: &str| {
        let file = nvm.join("alias").join(name);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, names).unwrap();
    };
    alias("lts/*", "lts/jod\n");
    alias("lts/jod", "v22.11.0\n");
    alias("mine", "20\n");
    alias("round", "about\n");
    alias("about", "round\n");
    // An alias file is followed first even when its name looks like a version: nvm does so.
    alias("9", "v20.1.0\n");
    // A file beside the alias folder, which would name a version if it were followed.
    std::fs::write(nvm.join("outside"), "v24.0.1\n").unwrap();
    // Twenty aliases in a row, the last naming a version.
    for hop in 1..=20 {
        let names = if hop == 20 {
            "22".to_string()
        } else {
            format!("hop{}", hop + 1)
        };
        alias(&format!("hop{hop}"), &names);
    }
    let long_comment = format!("#{}\n22.3.0\n", "x".repeat(253));
    // Longer than is read, and cut at that length it would say `22`, which is another version.
    let too_long = format!("#{}\n22.3.0\n", "x".repeat(4092));
    let cases = [
        ("v20.1.0", Some("v20.1.0")),
        ("20.1.0", Some("v20.1.0")),
        // Part of a version is the highest installed one that starts so, by number: 22.11
        // is above 22.3, and 9 is not above 22.
        ("22", Some("v22.11.0")),
        ("v22.3", Some("v22.3.0")),
        ("22.", Some("v22.11.0")),
        ("22.3.", Some("v22.3.0")),
        ("2", None),
        // nvm compares text: these are not 22.
        ("022", None),
        (" 22", None),
        // Only one dot at the end is passed over.
        ("22..", None),
        // The blanks nvm drops in a terminal's UTF-8 locale are dropped, at the end of a line
        // and in a line that says nothing: a no-break space and a vertical tab among them.
        ("22\u{a0}\n", Some("v22.11.0")),
        ("\u{a0}\n22\n", Some("v22.11.0")),
        ("22\u{b}\n", Some("v22.11.0")),
        ("22\t\u{c}\n", Some("v22.11.0")),
        ("9", Some("v20.1.0")),
        (long_comment.as_str(), Some("v22.3.0")),
        ("hop8", Some("v22.11.0")),
        ("node", Some("v24.0.1")),
        ("stable", Some("v24.0.1")),
        ("lts/*", Some("v22.11.0")),
        ("mine", Some("v20.1.0")),
        ("22.3.0  \nsecond line\n", Some("v22.3.0")),
        (
            "# a comment\n\n22.3.0 # and one after it\n",
            Some("v22.3.0"),
        ),
        // Nothing to add: the system's Node, a version that is not installed, an alias that
        // names nothing, two that name each other, a name that leaves the alias folder, an
        // alias stored with one of the flags nvm 0.41 introduced, a long-term name with a
        // capital letter (nvm refuses it, and on a disk that ignores case the file would be
        // found), a file longer than is read, and more aliases in a row than are followed.
        ("system", None),
        ("lts/Jod", None),
        ("../outside", None),
        (too_long.as_str(), None),
        ("hop1", None),
        ("--lts node", None),
        ("--only=lts 22", None),
        ("v18.0.0", None),
        ("99", None),
        ("missing", None),
        ("round", None),
        ("../versions/node/v24.0.1", None),
        ("/etc/hostname", None),
        ("", None),
    ];
    for (default, expected) in cases {
        alias("default", default);
        let finder = Search::from_env(&launched_from(home.path(), &[]));
        assert_eq!(
            finder.find("tool", None),
            expected.map(|version| programs[version].clone()),
            "default alias {default:?}"
        );
    }
    // An alias file named as nvm's own word for the newest version is followed first too.
    alias("stable", "v20.1.0\n");
    alias("default", "stable\n");
    let finder = Search::from_env(&launched_from(home.path(), &[]));
    assert_eq!(finder.find("tool", None), Some(programs["v20.1.0"].clone()));
    std::fs::remove_file(nvm.join("alias/stable")).unwrap();

    // A prerelease is a version: it is the newest when its numbers are the highest, as nvm
    // has it, and can be named in part or in full. Of several folders with the same three
    // numbers nvm takes the first by name, so an earlier prerelease before a later one.
    let candidate = version("v25.0.0-rc.1");
    version("v25.0.0-rc.2");
    for default in ["node", "25", "v25.0.0-rc.1"] {
        alias("default", default);
        let finder = Search::from_env(&launched_from(home.path(), &[]));
        assert_eq!(
            finder.find("tool", None),
            Some(candidate.clone()),
            "{default}"
        );
    }
    // And the release itself before any of its prereleases.
    let release = version("v25.0.0");
    for default in ["node", "stable", "25", "25.0", "25.0.0"] {
        alias("default", default);
        let finder = Search::from_env(&launched_from(home.path(), &[]));
        assert_eq!(
            finder.find("tool", None),
            Some(release.clone()),
            "{default}"
        );
    }
    alias("default", "v25.0.0-rc.2");
    let finder = Search::from_env(&launched_from(home.path(), &[]));
    let named_in_full = nvm.join("versions/node/v25.0.0-rc.2/bin/tool");
    assert_eq!(finder.find("tool", None), Some(named_in_full));

    // A version folder without `node`, as an install that was cut short leaves, is the
    // newest by its name and is no version to use: nvm puts nothing on `PATH` then, and no
    // older version in its place.
    let cut_short = nvm.join("versions/node/v26.0.0/bin");
    install(&cut_short, "tool");
    for default in ["node", "26", "v26.0.0"] {
        alias("default", default);
        let finder = Search::from_env(&launched_from(home.path(), &[]));
        assert!(!finder.known_dirs.contains(&cut_short), "{default}");
        assert_eq!(finder.find("tool", None), None, "{default}");
    }
    alias("default", "25");
    let finder = Search::from_env(&launched_from(home.path(), &[]));
    assert_eq!(finder.find("tool", None), Some(release));

    // A pipe left under the alias's name is not opened: opening it would wait for a writer
    // that never comes, and every search for a tool would wait with it.
    std::fs::remove_file(nvm.join("alias/default")).unwrap();
    let pipe = std::ffi::CString::new(nvm.join("alias/default").to_str().unwrap()).unwrap();
    // SAFETY: the path is NUL-terminated and lives through the call.
    assert_eq!(unsafe { libc::mkfifo(pipe.as_ptr(), 0o600) }, 0);
    let (sender, receiver) = std::sync::mpsc::channel();
    let env = launched_from(home.path(), &[]);
    std::thread::spawn(move || {
        let _ = sender.send(Search::from_env(&env).find("tool", None));
    });
    let found = receiver.recv_timeout(Duration::from_secs(10));
    // Let a search that did open the pipe go, so the failure is this assertion and not a
    // thread left waiting.
    let _ = std::os::unix::fs::OpenOptionsExt::custom_flags(
        std::fs::OpenOptions::new().write(true),
        libc::O_NONBLOCK,
    )
    .open(nvm.join("alias/default"));
    assert_eq!(found, Ok(None), "a pipe as the default alias");

    std::fs::remove_file(nvm.join("alias/default")).unwrap();
    let finder = Search::from_env(&launched_from(home.path(), &[]));
    assert_eq!(finder.find("tool", None), None, "no default alias");
}

/// On Windows the folders are under the two application-data folders, and npm puts programs
/// in its prefix itself, with no `bin` under it.
#[cfg(windows)]
#[test]
fn version_manager_folders_on_windows_are_searched() {
    let home = tempfile::tempdir().unwrap();
    let local = home.path().join("AppData").join("Local");
    let roaming = home.path().join("AppData").join("Roaming");
    let expected = [
        install(&local.join("Volta").join("bin"), "tool-volta"),
        install(&local.join("mise").join("shims"), "tool-mise"),
        install(
            &roaming.join("fnm").join("aliases").join("default"),
            "tool-fnm",
        ),
        install(
            &home.path().join(".fnm").join("aliases").join("default"),
            "tool-fnm-old",
        ),
        install(&roaming.join("npm"), "tool-npm"),
    ];
    let finder = Search::from_env(&launched_from(
        home.path(),
        &[
            ("LOCALAPPDATA", local.to_str().unwrap()),
            ("APPDATA", roaming.to_str().unwrap()),
        ],
    ));
    for program in expected {
        let name = program.file_stem().unwrap().to_str().unwrap();
        assert_eq!(finder.find(name, None), Some(program.clone()), "{name}");
    }
    // Real programs before the shims, as on Unix.
    let place = |dir: PathBuf| {
        finder
            .known_dirs
            .iter()
            .position(|known| *known == dir)
            .unwrap_or_else(|| panic!("{} is not searched", dir.display()))
    };
    let order = [
        place(roaming.join("fnm").join("aliases").join("default")),
        place(roaming.join("npm")),
        place(local.join("Volta").join("bin")),
        place(local.join("mise").join("shims")),
    ];
    assert!(order.windows(2).all(|pair| pair[0] < pair[1]), "{order:?}");
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

/// An execute bit for another class of user does not make a file runnable by its owner.
#[cfg(unix)]
#[test]
fn executable_search_uses_the_callers_actual_access() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let (first, second) = (dir.path().join("first"), dir.path().join("second"));
    let restricted = install(&first, "tool");
    let runnable = install(&second, "tool");
    std::fs::set_permissions(&restricted, std::fs::Permissions::from_mode(0o601)).unwrap();
    std::fs::set_permissions(&runnable, std::fs::Permissions::from_mode(0o700)).unwrap();
    let allowed = match std::process::Command::new(&restricted)
        .args(["lines", "1"])
        .output()
    {
        Ok(output) => {
            // A privileged caller can execute this file; test its real access too, without
            // silently skipping the test or assuming every runner has the same user ID.
            assert!(output.status.success());
            true
        }
        Err(error) => {
            assert_eq!(error.kind(), std::io::ErrorKind::PermissionDenied);
            false
        }
    };
    let finder = search(&[&first, &second], &[]);
    assert_eq!(
        finder.find("tool", None),
        Some(if allowed {
            restricted.clone()
        } else {
            runnable
        })
    );
    assert_eq!(
        finder.find("tool", Some(&restricted)),
        allowed.then_some(restricted),
        "an unusable explicit path must be reported missing"
    );
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
    /// matched by its file name, so a test that finds its shell through `shell` or `installed`
    /// uses the path named here in place of its own, and a named shell that such a test cannot
    /// find anywhere fails it. Two tests that came with #105 name their shell outright and
    /// fail without it whatever this says: `capture_honors_variables_unset_by_the_login_profile`
    /// (`/bin/sh`) and, on macOS, `cancelling_a_hanging_login_shell_kills_its_child_before_returning`
    /// in `runtime.rs` (`/bin/zsh`).
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

    const FISH_STARTUP: &str = ".config/fish/config.fish";

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
            startup_file: FISH_STARTUP,
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
    /// are killed, and every kind of shell is tried, because each catches a different fault.
    /// Measured on one Mac: with the pipe switched off altogether the zsh rounds fail (11 of
    /// 12) and the bash and sh rounds almost never do, and with the pipe handed over under a
    /// low descriptor, which bash 3.2 closes, the bash and sh rounds fail (16 and 12 of 18)
    /// and the zsh rounds never do. The counting between two lines paces a job: two jobs
    /// printed between three and seven lines a millisecond on that Mac, far below the output
    /// cap.
    #[test]
    fn background_output_from_a_startup_file_does_not_reach_the_result() {
        for kind in &KINDS {
            noisy_rounds(kind, "", 6);
        }
    }

    /// The same with `noclobber` set by the startup file, under the shells that have the
    /// option. The bash that macOS ships refuses a plain `>` to the pipe then, and the
    /// environment would go back to the shared output; the capture appends instead
    /// (issue #97). More rounds, because under that bash the background output reaches the
    /// result in about a third of the rounds when the redirection is the plain one.
    #[test]
    fn a_startup_file_that_sets_noclobber_does_not_send_the_environment_to_the_shared_output() {
        for kind in KINDS
            .iter()
            .filter(|kind| kind.startup_file != FISH_STARTUP)
        {
            noisy_rounds(kind, "set -o noclobber\n", 12);
        }
    }

    fn noisy_rounds(kind: &Kind, first_line: &str, rounds: usize) {
        let job = "/bin/sh -c 'while :; do echo NOISE=x; i=0; while [ $i -lt 100 ]; do i=$((i+1)); done; done' &\n";
        {
            let Some(shell) = installed(kind.paths) else {
                return;
            };
            let noisy = [
                first_line.to_string(),
                (kind.export)("REAL", "value"),
                job.repeat(2),
                (kind.export)("LAST", "kept"),
            ]
            .concat();
            for round in 0..rounds {
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
    /// or a daemon is, still holds everything else the shell had open, the pipe the
    /// environment is read from among it. The reading does not wait for it (issue #97). The
    /// times compared are the quickest of five, to keep a busy machine from deciding the
    /// result; waiting for the helper costs a quarter of a second. One failure in a Linux
    /// container under zsh is not explained, so five may not always be enough there.
    ///
    /// The redirection belongs to a subshell, so it is applied before the helper is started
    /// in the background. With `sleep 30 >/dev/null 2>&1 &` zsh (its `BG_NICE` option, on by
    /// default) lowers the new job's priority before the job has redirected its output, so
    /// on a busy machine the shell can exit while the job still holds the shell's own
    /// output. The runner then waits for that output, up to its quarter of a second, and
    /// such a round looks like the fault this test is for. That cost is real and is not this
    /// test's subject; `crates/AGENTS.md` records it. fish keeps the plain line: it has no
    /// subshell of this form, and the plain line under fish has not been measured under load.
    #[test]
    fn a_quiet_helper_left_by_a_startup_file_does_not_hold_up_the_result() {
        for kind in &KINDS {
            let Some(shell) = installed(kind.paths) else {
                continue;
            };
            let alone = (kind.export)("REAL", "value");
            let helper = if kind.startup_file == FISH_STARTUP {
                "sleep 30 >/dev/null 2>&1 &"
            } else {
                "(sleep 30 &) >/dev/null 2>&1"
            };
            let with_helper = format!("{alone}{helper}\n");
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

    /// A search path with no directory that can be passed on gives the whole capture up for
    /// the launch environment (issue #97). Since the result is the shell's own environment and
    /// no longer the launch one with changes laid over it, this is the only thing between such
    /// a startup file and a result with no search path at all. Under zsh the line goes into
    /// the file zsh reads last, because a system-wide `zshrc`, which is read after `.zprofile`,
    /// may put a directory of its own in front and so make the search path usable again.
    #[test]
    fn a_search_path_with_nothing_that_can_be_passed_on_gives_the_capture_up() {
        for kind in KINDS
            .iter()
            .filter(|kind| kind.startup_file != FISH_STARTUP)
        {
            let Some(shell) = installed(kind.paths) else {
                continue;
            };
            let last_read = match kind.startup_file {
                ".zprofile" => ".zlogin",
                other => other,
            };
            let (_home, inherited) = home(&[(
                last_read,
                "export PATH=\"/opt/odd$(printf '\\377')dir\"\nexport AFTER=ok\n".to_string(),
            )]);
            let env = ShellEnv::capture(Some(&shell), inherited, LIMIT);
            assert_eq!(
                env.source(),
                &EnvSource::Inherited(Fallback::ShellFailed),
                "{}",
                shell.display()
            );
            assert_eq!(
                env.get("PATH"),
                Some("/usr/bin:/bin"),
                "{}",
                shell.display()
            );
            assert_eq!(
                env.get("FROM_LAUNCHER"),
                Some("kept"),
                "{}",
                shell.display()
            );
            assert_eq!(env.get("AFTER"), None, "{}", shell.display());
        }
    }

    /// A variable the shell reports with a value that is not Unicode is left out, and the
    /// value the application was launched with under that name does not come back in its
    /// place: the result is the shell's environment (issue #97, with the rule of #105).
    #[test]
    fn a_value_that_is_not_unicode_does_not_bring_the_launch_value_back() {
        for kind in KINDS
            .iter()
            .filter(|kind| kind.startup_file != FISH_STARTUP)
        {
            let Some(shell) = installed(kind.paths) else {
                continue;
            };
            let (_home, mut inherited) = home(&[(
                kind.startup_file,
                "export ODD=\"$(printf '\\377')\"\nexport AFTER=ok\n".to_string(),
            )]);
            inherited.insert("ODD".into(), "launch-value".into());
            let env = ShellEnv::capture(Some(&shell), inherited, LIMIT);
            assert_eq!(env.source(), &EnvSource::LoginShell, "{}", shell.display());
            assert_eq!(env.get("AFTER"), Some("ok"), "{}", shell.display());
            assert_eq!(env.get("ODD"), None, "{}", shell.display());
        }
    }

    /// The shell's own bookkeeping variables are not passed on when the application was
    /// launched without them: what the shell set for itself while it ran says nothing about
    /// the programs started later (the rule of #105, which no test held).
    #[test]
    fn the_shells_own_variables_are_not_passed_on_when_the_launch_had_none() {
        for kind in KINDS
            .iter()
            .filter(|kind| kind.startup_file != FISH_STARTUP)
        {
            let Some(shell) = installed(kind.paths) else {
                continue;
            };
            let (_home, inherited) = home(&[(
                kind.startup_file,
                "cd /usr\ncd /\nexport AFTER=ok\n".to_string(),
            )]);
            let env = ShellEnv::capture(Some(&shell), inherited, LIMIT);
            assert_eq!(env.source(), &EnvSource::LoginShell, "{}", shell.display());
            assert_eq!(env.get("AFTER"), Some("ok"), "{}", shell.display());
            for name in ["PWD", "OLDPWD", "SHLVL", "_"] {
                assert_eq!(env.get(name), None, "{name} under {}", shell.display());
            }
        }
    }

    #[test]
    fn capture_honors_variables_unset_by_the_login_profile() {
        let shell = Path::new("/bin/sh");
        assert!(
            shell.is_file(),
            "the Unix login-shell prerequisite must exist"
        );
        let (_home, mut inherited) = home(&[(
            ".profile",
            "unset REMOVED_BY_PROFILE\nexport PROFILE_OBSERVED=${REMOVED_BY_PROFILE-absent}\n"
                .to_string(),
        )]);
        inherited.insert("REMOVED_BY_PROFILE".into(), "stale-value".into());
        inherited.insert("PWD".into(), "/launcher-working-directory".into());
        inherited.insert("SHLVL".into(), "41".into());
        let env = ShellEnv::capture(Some(shell), inherited, LIMIT);
        assert_eq!(env.source(), &EnvSource::LoginShell);
        assert_eq!(env.get("PROFILE_OBSERVED"), Some("absent"));
        assert_eq!(env.get("REMOVED_BY_PROFILE"), None);
        assert_eq!(env.get("FROM_LAUNCHER"), Some("kept"));
        assert_eq!(env.get("PWD"), Some("/launcher-working-directory"));
        assert_eq!(env.get("SHLVL"), Some("41"));
    }

    /// A variable the application was launched with under a name that is not a shell name,
    /// such as `config.key`, is still there after the capture (issue #136). bash, ksh and fish
    /// pass such a variable on; dash and the zsh macOS ships leave it out of the environment
    /// of everything they start, with or without startup files, so the capture puts the
    /// launch value back. A variable with an ordinary name that the startup file unsets
    /// stays gone beside it (the rule of #105). Each shell is skipped where it is not
    /// installed, unless `OPEN_SESAME_REQUIRE_SHELLS` names it.
    #[test]
    fn capture_preserves_environment_names_that_are_not_shell_identifiers() {
        const ODD_NAMES: [&str; 3] = ["config.key", "with-dash", "dotted.and-dashed"];
        for kind in &KINDS {
            let Some(shell) = installed(kind.paths) else {
                continue;
            };
            let unset = if kind.startup_file == FISH_STARTUP {
                "set -e REMOVED_BY_PROFILE\n"
            } else {
                "unset REMOVED_BY_PROFILE\n"
            };
            let startup = format!("{unset}{}", (kind.export)("AFTER", "ok"));
            let (_home, mut inherited) = home(&[(kind.startup_file, startup)]);
            for name in ODD_NAMES {
                inherited.insert(name.into(), format!("launch value of {name}"));
            }
            inherited.insert("REMOVED_BY_PROFILE".into(), "stale-value".into());
            let env = ShellEnv::capture(Some(&shell), inherited, LIMIT);
            assert_eq!(env.source(), &EnvSource::LoginShell, "{}", shell.display());
            assert_eq!(env.get("AFTER"), Some("ok"), "{}", shell.display());
            for name in ODD_NAMES {
                assert_eq!(
                    env.get(name),
                    Some(format!("launch value of {name}").as_str()),
                    "{name} under {}",
                    shell.display()
                );
            }
            assert_eq!(env.get("REMOVED_BY_PROFILE"), None, "{}", shell.display());
            assert_eq!(
                env.get("FROM_LAUNCHER"),
                Some("kept"),
                "{}",
                shell.display()
            );
        }
    }

    /// What a startup file removed is not put back, whatever its name: a function bash
    /// exported and its profile then forgot, and under ksh, where it is installed, a name in
    /// Greek letters that the profile unset. Both came back when every name that is not a
    /// shell name was put back.
    #[test]
    fn a_variable_a_startup_file_removed_under_an_unusual_name_stays_removed() {
        if let Some(bash) = installed(&["/bin/bash"]) {
            let startup = "unset -f gone\nexport AFTER=ok\n".to_string();
            let (_home, mut inherited) = home(&[(".bash_profile", startup)]);
            inherited.insert("BASH_FUNC_gone%%".into(), "() {  :\n}".into());
            inherited.insert("config.key".into(), "kept".into());
            let env = ShellEnv::capture(Some(&bash), inherited, LIMIT);
            assert_eq!(env.source(), &EnvSource::LoginShell);
            assert_eq!(env.get("AFTER"), Some("ok"));
            assert_eq!(env.get("BASH_FUNC_gone%%"), None);
            assert_eq!(env.get("config.key"), Some("kept"));
        }
        if let Some(ksh) = shell("/bin/ksh") {
            let startup = "unset όνομα\nexport AFTER=ok\n".to_string();
            let (_home, mut inherited) = home(&[(".profile", startup)]);
            inherited.insert("LC_ALL".into(), "en_US.UTF-8".into());
            inherited.insert("όνομα".into(), "launch".into());
            inherited.insert("config.key".into(), "kept".into());
            let env = ShellEnv::capture(Some(&ksh), inherited, LIMIT);
            assert_eq!(env.source(), &EnvSource::LoginShell);
            assert_eq!(env.get("AFTER"), Some("ok"));
            assert_eq!(env.get("όνομα"), None);
            assert_eq!(env.get("config.key"), Some("kept"));
        }
        // fish erases a name that starts with a digit, and passes one it did not erase on.
        if let Some(fish) = installed(&FISH) {
            let startup = "set -e 1gone\nset -gx AFTER ok\n".to_string();
            let (_home, mut inherited) = home(&[(FISH_STARTUP, startup)]);
            inherited.insert("1gone".into(), "launch".into());
            inherited.insert("1kept".into(), "launch".into());
            let env = ShellEnv::capture(Some(&fish), inherited, LIMIT);
            assert_eq!(env.source(), &EnvSource::LoginShell);
            assert_eq!(env.get("AFTER"), Some("ok"));
            assert_eq!(env.get("1gone"), None);
            assert_eq!(env.get("1kept"), Some("launch"));
        }
    }

    /// What ksh's startup file did to a name that is not a shell name is what the capture
    /// gives, whatever that was. The ksh macOS ships (93u+ of 2012) keeps a dotted name as a
    /// member of a compound variable and takes more characters for letters than this code
    /// would guess, so its startup file can remove `config.key`, `.hidden` and a Thai word,
    /// and they must stay removed; the ksh of Ubuntu 24.04 (93u+m) passes the same names on
    /// untouched whatever the file says, and they must stay. So the expectation is not
    /// written here: ksh is run with the same commands and no startup file, and the capture
    /// has to agree with it. A note says which way this ksh went.
    #[test]
    fn a_name_ksh_can_reach_is_left_as_its_startup_file_left_it() {
        let Some(ksh) = shell("/bin/ksh") else {
            return;
        };
        let thai = "\u{0e19}\u{0e49}\u{0e33}";
        let unset_thai = format!("unset {thai}\nexport AFTER=ok\n");
        for (startup, launch, name) in [
            (
                "config=()\nunset config.key\nexport AFTER=ok\n",
                vec![("config.key", "launch")],
                "config.key",
            ),
            (
                "unset config.key\nexport AFTER=ok\n",
                vec![("config", "x"), ("config.key", "launch")],
                "config.key",
            ),
            (
                "unset .hidden\nexport AFTER=ok\n",
                vec![(".hidden", "launch")],
                ".hidden",
            ),
            (
                unset_thai.as_str(),
                vec![("LC_ALL", "en_US.UTF-8"), (thai, "launch")],
                thai,
            ),
            (
                "config=(key=changed)\nexport AFTER=ok\n",
                vec![("config.key", "launch")],
                "config.key",
            ),
            (
                "export AFTER=ok\n",
                vec![("config.key", "launch")],
                "config.key",
            ),
        ] {
            let (_home, mut inherited) = home(&[(".profile", startup.to_string())]);
            for (name, value) in launch {
                inherited.insert(name.into(), value.into());
            }
            // The same commands in a ksh that reads no startup file, then the environment.
            let alone = std::process::Command::new(&ksh)
                .arg("-c")
                .arg(format!("{startup}/usr/bin/env -0"))
                .env_clear()
                .envs(&inherited)
                .stderr(std::process::Stdio::null())
                .output()
                .unwrap();
            let entry = format!("{name}=");
            let expected = alone
                .stdout
                .split(|byte| *byte == 0)
                .filter_map(|entry| std::str::from_utf8(entry).ok())
                .find_map(|text| text.strip_prefix(entry.as_str()));
            eprintln!("ksh leaves {name:?} as {expected:?} after {startup:?}");
            let env = ShellEnv::capture(Some(&ksh), inherited, LIMIT);
            assert_eq!(env.source(), &EnvSource::LoginShell, "{startup:?}");
            assert_eq!(env.get("AFTER"), Some("ok"), "{startup:?}");
            assert_eq!(env.get(name), expected, "{name} after {startup:?}");
        }
    }

    /// What a shell leaves out of the environment by itself, before any startup file runs,
    /// is put back whatever the name looks like (issue #136): a name that starts with a
    /// digit, one in letters outside ASCII, and a function bash exported, beside the dotted
    /// name. The zsh that macOS ships and dash leave such names out; a shell that passes them
    /// on shows the same result here.
    #[test]
    fn what_the_shell_itself_leaves_out_is_put_back_whatever_its_name() {
        const NAMES: [&str; 4] = ["config.key", "1digit", "όνομα", "BASH_FUNC_helper%%"];
        for kind in &KINDS {
            let Some(shell) = installed(kind.paths) else {
                continue;
            };
            let startup = (kind.export)("AFTER", "ok");
            let (_home, mut inherited) = home(&[(kind.startup_file, startup)]);
            for name in NAMES {
                let value = if name.starts_with("BASH_FUNC_") {
                    "() {  :\n}"
                } else {
                    "launch"
                };
                inherited.insert(name.into(), value.into());
            }
            let env = ShellEnv::capture(Some(&shell), inherited, LIMIT);
            assert_eq!(env.source(), &EnvSource::LoginShell, "{}", shell.display());
            assert_eq!(env.get("AFTER"), Some("ok"), "{}", shell.display());
            for name in NAMES {
                // bash may write its function out again in its own words.
                assert!(env.get(name).is_some(), "{name} under {}", shell.display());
            }
            assert_eq!(env.get("config.key"), Some("launch"));
        }
    }

    /// When the shell cannot be asked what it passes on by itself, nothing is put back: the
    /// missing variable may have been removed on purpose. The stand-in is `sh` under the name
    /// `fish`, which refuses the option that runs fish without its startup files, as a fish
    /// older than 3.3 does. Its startup file forgets a function that bash exported; dash, as
    /// `sh`, leaves that name out by itself. Either way it is missing and stays missing.
    #[test]
    fn when_the_shell_cannot_be_asked_nothing_is_put_back() {
        let Some(sh) = shell("/bin/sh") else {
            return;
        };
        let named = tempfile::tempdir().unwrap();
        let fish = named.path().join("fish");
        std::os::unix::fs::symlink(&sh, &fish).unwrap();
        let startup = "unset -f gone\nexport AFTER=ok\n".to_string();
        let (_home, mut inherited) = home(&[(".profile", startup)]);
        inherited.insert("BASH_FUNC_gone%%".into(), "() {  :\n}".into());
        let env = ShellEnv::capture(Some(&fish), inherited, LIMIT);
        assert_eq!(env.source(), &EnvSource::LoginShell);
        assert_eq!(env.get("AFTER"), Some("ok"));
        assert_eq!(env.get("BASH_FUNC_gone%%"), None);
    }

    /// How a stand-in leaves `config.key` out of what it starts, as dash and the zsh of macOS
    /// leave out every name that is not a shell name.
    const WITHOUT: &str = "/usr/bin/env -u config.key";

    /// A stand-in for a shell, for the rules of the second run that no installed shell can
    /// show: a script under the shell's name that notes each run in `log` beside it, with
    /// whether it was given `ENV` and `BASH_ENV` and, for the second run, its arguments. A run
    /// that starts with `-i` is the login run and does `login`; any other is the second run
    /// and does `bare`. The script is bash's, because bash passes every launch variable on to
    /// what it starts, so the script alone decides what is left out; under dash, which is
    /// `sh` on Ubuntu, `config.key` would be gone before the script's first line. `None`,
    /// with a note, where there is no bash. The script is copied into place by another
    /// program, so that no child of a test running beside this one can hold it open for
    /// writing when it is started.
    fn stand_in(name: &str, login: &str, bare: &str) -> Option<(tempfile::TempDir, PathBuf)> {
        use std::os::unix::fs::PermissionsExt;
        let bash = shell("/bin/bash")?;
        let bash = bash.display();
        let dir = tempfile::tempdir().unwrap();
        let text = dir.path().join("text");
        let shell = dir.path().join(name);
        let script = format!(
            "#!{bash}\nhere=${{0%/*}}\nnoted=\"ENV=${{ENV-unset}} BASH_ENV=${{BASH_ENV-unset}}\"\n\
             if [ \"$1\" = -i ]; then\n  echo \"login $noted\" >> \"$here/log\"\n  {login}\nfi\n\
             echo \"bare $noted $*\" >> \"$here/log\"\n{bare}\n"
        );
        std::fs::write(&text, script).unwrap();
        let copied = std::process::Command::new("/bin/cp")
            .args([&text, &shell])
            .status()
            .unwrap();
        assert!(copied.success());
        std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o755)).unwrap();
        Some((dir, shell))
    }

    /// The login run of a stand-in: the capture's own command, with `config.key` left out.
    fn login_run() -> String {
        format!("exec {WITHOUT} /bin/sh -c \"$4\"")
    }

    fn noted(shell: &Path) -> Vec<String> {
        std::fs::read_to_string(shell.with_file_name("log"))
            .unwrap_or_default()
            .lines()
            .map(str::to_string)
            .collect()
    }

    /// The launch a stand-in is captured from: one variable whose name is not a shell name,
    /// and the two that name a file a shell reads even when it is not a login shell.
    fn odd_launch() -> BTreeMap<String, String> {
        let (_home, mut inherited) = home(&[]);
        inherited.insert("config.key".into(), "launch".into());
        inherited.insert("ENV".into(), "/nonexistent/env".into());
        inherited.insert("BASH_ENV".into(), "/nonexistent/bash-env".into());
        inherited
    }

    fn gone(pid: i32) -> bool {
        let ended = Instant::now() + Duration::from_secs(5);
        loop {
            if unsafe { libc::kill(pid, 0) } == -1 {
                return std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH);
            }
            if Instant::now() > ended {
                return false;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    /// The second run, for every shell name the capture knows: it is made once, with the
    /// arguments that keep that shell from its startup files and without `ENV` and `BASH_ENV`,
    /// which the login run still has; what it leaves out is put back. A launch with no such
    /// variable makes no second run at all.
    #[test]
    fn the_second_run_is_made_as_each_shell_needs_and_only_for_a_missing_variable() {
        let cases = [
            ("zsh", "-f -c"),
            ("bash", "--noprofile --norc -c"),
            ("fish", "--no-config -c"),
            ("sh", "-c"),
            ("dash", "-c"),
            ("ksh", "-c"),
        ];
        for (name, arguments) in cases {
            let bare = format!("exec {WITHOUT} /usr/bin/env -0");
            let Some((_dir, shell)) = stand_in(name, &login_run(), &bare) else {
                return;
            };
            let env = ShellEnv::capture(Some(&shell), odd_launch(), LIMIT);
            assert_eq!(env.source(), &EnvSource::LoginShell, "{name}");
            assert_eq!(env.get("config.key"), Some("launch"), "{name}");
            assert_eq!(
                noted(&shell),
                [
                    "login ENV=/nonexistent/env BASH_ENV=/nonexistent/bash-env".to_string(),
                    format!("bare ENV=unset BASH_ENV=unset {arguments} /usr/bin/env -0"),
                ],
                "{name}"
            );
            let mut plain = odd_launch();
            plain.remove("config.key");
            let env = ShellEnv::capture(Some(&shell), plain, LIMIT);
            assert_eq!(env.source(), &EnvSource::LoginShell, "{name}");
            assert_eq!(noted(&shell).len(), 3, "{name}: {:?}", noted(&shell));
            assert!(noted(&shell)[2].starts_with("login "), "{name}");
        }
    }

    /// Nothing is put back unless the second run ended well, printed the variables exactly
    /// and left the variable out: not when it still has the variable (a startup file removed
    /// it), not when it ends with a failure, and not when it prints them without the NUL
    /// separators. And when the login run itself could print them only without those, which
    /// cannot show such a name at all, no second run is made.
    #[test]
    fn a_second_run_that_keeps_the_variable_fails_or_cannot_be_read_puts_nothing_back() {
        let cases = [
            ("it keeps the variable", "exec /usr/bin/env -0".to_string()),
            (
                "it ends with a failure",
                format!("{WITHOUT} /usr/bin/env -0; exit 3"),
            ),
            (
                "it prints without NUL separators",
                format!("exec {WITHOUT} /usr/bin/env"),
            ),
        ];
        for (what, bare) in cases {
            let Some((_dir, shell)) = stand_in("zsh", &login_run(), &bare) else {
                return;
            };
            let env = ShellEnv::capture(Some(&shell), odd_launch(), LIMIT);
            assert_eq!(env.source(), &EnvSource::LoginShell, "{what}");
            assert_eq!(env.get("FROM_LAUNCHER"), Some("kept"), "{what}");
            assert_eq!(env.get("config.key"), None, "{what}");
            assert_eq!(noted(&shell).len(), 2, "{what}: {:?}", noted(&shell));
        }
        let login = format!(
            "exec {WITHOUT} /bin/sh -c \"$(printf '%s' \"$4\" | sed 's#/usr/bin/env -0#/usr/bin/false#g')\""
        );
        let bare = format!("exec {WITHOUT} /usr/bin/env -0");
        let Some((_dir, shell)) = stand_in("zsh", &login, &bare) else {
            return;
        };
        let env = ShellEnv::capture(Some(&shell), odd_launch(), LIMIT);
        assert_eq!(env.source(), &EnvSource::LoginShell);
        assert_eq!(env.get("FROM_LAUNCHER"), Some("kept"));
        assert_eq!(env.get("config.key"), None);
        assert_eq!(noted(&shell).len(), 1, "{:?}", noted(&shell));
    }

    /// A second run that does not end is given up at its own limit of five seconds and
    /// killed; the capture keeps what the login run gave and puts nothing back.
    #[test]
    fn a_second_run_that_hangs_is_given_up_at_its_limit_and_killed() {
        let Some((dir, shell)) = stand_in(
            "zsh",
            &login_run(),
            "echo $$ > \"$here/pid\"\nexec sleep 600",
        ) else {
            return;
        };
        let started = Instant::now();
        let env = ShellEnv::capture(Some(&shell), odd_launch(), LIMIT);
        let took = started.elapsed();
        assert!(
            took >= Duration::from_secs(4) && took < Duration::from_secs(12),
            "{took:?}"
        );
        assert_eq!(env.source(), &EnvSource::LoginShell);
        assert_eq!(env.get("FROM_LAUNCHER"), Some("kept"));
        assert_eq!(env.get("config.key"), None);
        let pid: i32 = std::fs::read_to_string(dir.path().join("pid"))
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        assert!(gone(pid), "the second run is still there");
    }

    /// Quit during the second run ends it at once: the host's cancellation reaches that run
    /// too.
    #[test]
    fn quitting_during_the_second_run_ends_it_at_once() {
        let Some((dir, shell)) = stand_in(
            "zsh",
            &login_run(),
            "echo $$ > \"$here/pid\"\nexec sleep 600",
        ) else {
            return;
        };
        let cancel = open_sesame_core::process::Cancel::new();
        let pid_file = dir.path().join("pid");
        let quit = {
            let cancel = cancel.clone();
            std::thread::spawn(move || {
                let ended = Instant::now() + Duration::from_secs(10);
                let pid = loop {
                    let read = std::fs::read_to_string(&pid_file).unwrap_or_default();
                    if let Ok(pid) = read.trim().parse::<i32>() {
                        break pid;
                    }
                    assert!(Instant::now() < ended, "the second run never started");
                    std::thread::sleep(Duration::from_millis(10));
                };
                cancel.cancel();
                (pid, Instant::now())
            })
        };
        let env = ShellEnv::capture_cancellable(Some(&shell), odd_launch(), LIMIT, cancel);
        let returned = Instant::now();
        let (pid, cancelled) = quit.join().unwrap();
        let after = returned.saturating_duration_since(cancelled);
        assert!(after < Duration::from_secs(3), "{after:?}");
        assert_eq!(env.get("config.key"), None);
        assert!(gone(pid), "the second run is still there");
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
