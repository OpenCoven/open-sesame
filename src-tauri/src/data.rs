//! Temporary restart data namespace until the product identity is decided (#59, #87).
use open_sesame_core::storage::StorageError;
use std::path::{Component, Path, PathBuf};

const NAMESPACE: &str = "org.opencoven.open-sesame.restart-development";
const SWIFT_IDENTIFIER: &str = "com.perch.widgetstudio";

pub struct Roots {
    pub data: PathBuf,
    pub home: PathBuf,
    pub legacy_xdg_data: Option<PathBuf>,
}

pub fn start_storage(
    core: std::sync::Arc<open_sesame_core::Core>,
    open: impl FnOnce() -> Result<open_sesame_core::storage::Storage, StorageError> + Send + 'static,
) {
    let worker = std::sync::Arc::clone(&core);
    // Filesystem calls cannot be cancelled reliably. Do not join this opening task on the UI
    // thread: a result after shutdown is refused and dropped by Core. It owns no child process;
    // if still blocked when the application exits, its thread ends with the application.
    if let Err(error) = std::thread::Builder::new()
        .name("startup-storage".into())
        .spawn(move || {
            worker.initialize_storage(open());
        })
    {
        core.initialize_storage(Err(StorageError::Unreadable(error.to_string())));
    }
}

pub fn directory(roots: &Roots, override_dir: Option<&Path>) -> Result<PathBuf, StorageError> {
    let root = &roots.data;
    let selected = override_dir
        .map(Path::to_path_buf)
        .unwrap_or_else(|| root.join(NAMESPACE));
    if !root.is_absolute()
        || !selected.is_absolute()
        || selected.components().any(|p| p == Component::ParentDir)
    {
        return Err(StorageError::Unreadable(
            "The development data directory must be absolute and contain no parent traversal."
                .into(),
        ));
    }
    let selected = physical(&selected)?;
    for installed in legacy_roots(roots)? {
        if within(
            &selected,
            &physical(&installed)?,
            cfg!(any(windows, target_os = "macos")),
        ) {
            return Err(StorageError::Unreadable(
                "The restart cannot use the installed application's data directory.".into(),
            ));
        }
    }
    Ok(selected)
}

fn legacy_roots(roots: &Roots) -> Result<Vec<PathBuf>, StorageError> {
    if !roots.home.is_absolute()
        || roots
            .legacy_xdg_data
            .as_ref()
            .is_some_and(|path| !path.is_absolute())
    {
        return Err(StorageError::Unreadable(
            "Could not establish the legacy data directories.".into(),
        ));
    }
    // Native/bridge defaults are not all derived from the bundle identifier. Keep the actual
    // roots used by SpeakerDiarization.swift, coven_runtime.py, process_workspace.py,
    // agent_activity.py and controller.py separate as well, including the older Perch receipts.
    let mut paths = [SWIFT_IDENTIFIER, "Open Sesame", "open-sesame", "Perch"]
        .map(|name| roots.data.join(name))
        .to_vec();
    paths.extend(
        [
            "Library/Application Support/Open Sesame",
            ".local/share/Open Sesame",
            ".local/share/Perch",
            ".local/share/open-sesame",
            ".local/state/open-sesame",
        ]
        .map(|path| roots.home.join(path)),
    );
    paths.extend(
        roots
            .legacy_xdg_data
            .as_ref()
            .map(|root| root.join("open-sesame")),
    );
    Ok(paths)
}

fn within(selected: &Path, installed: &Path, case_insensitive: bool) -> bool {
    if case_insensitive {
        let components = |path: &Path| {
            path.components()
                .map(|part| part.as_os_str().to_string_lossy().to_ascii_lowercase())
                .collect::<Vec<_>>()
        };
        components(selected).starts_with(&components(installed))
    } else {
        selected.starts_with(installed)
    }
}

/// Resolve existing symlinks even when the final directory has not been created yet.
fn physical(path: &Path) -> Result<PathBuf, StorageError> {
    match path.canonicalize() {
        Ok(path) => Ok(path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let parent = path
                .parent()
                .ok_or_else(|| StorageError::Unreadable("No data directory parent.".into()))?;
            let name = path
                .file_name()
                .ok_or_else(|| StorageError::Unreadable("Invalid data directory.".into()))?;
            Ok(physical(parent)?.join(name))
        }
        Err(error) => Err(StorageError::Unreadable(error.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roots(data: &Path) -> Roots {
        Roots {
            data: data.to_path_buf(),
            home: data.join("home"),
            legacy_xdg_data: None,
        }
    }

    #[test]
    fn actual_legacy_roots_and_descendants_are_never_restart_storage() {
        let dir = tempfile::tempdir().unwrap();
        let mut paths = roots(dir.path());
        paths.legacy_xdg_data = Some(dir.path().join("configured-xdg"));
        for legacy in [
            paths.data.join("Open Sesame"),
            paths.home.join("Library/Application Support/Open Sesame"),
            paths.home.join(".local/share/Open Sesame"),
            paths.home.join(".local/share/Perch"),
            paths.home.join(".local/share/open-sesame"),
            paths.home.join(".local/state/open-sesame"),
            paths.legacy_xdg_data.as_ref().unwrap().join("open-sesame"),
        ] {
            for path in [legacy.clone(), legacy.join("nested/data")] {
                assert!(
                    directory(&paths, Some(&path)).is_err(),
                    "accepted installed data: {}",
                    path.display()
                );
            }
        }
    }

    #[cfg(unix)]
    #[test]
    fn symlink_aliases_into_actual_legacy_data_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let paths = roots(dir.path());
        let legacy = paths.home.join("Library/Application Support/Open Sesame");
        std::fs::create_dir_all(&legacy).unwrap();
        let alias = dir.path().join("fixture-alias");
        std::os::unix::fs::symlink(&legacy, &alias).unwrap();
        assert!(directory(&paths, Some(&alias.join("nested"))).is_err());
    }

    #[cfg(any(windows, target_os = "macos"))]
    #[test]
    fn case_aliases_of_actual_legacy_data_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let paths = roots(dir.path());
        assert!(directory(&paths, Some(&paths.data.join("OPEN SESAME/nested"))).is_err());
    }

    #[test]
    fn case_insensitive_paths_cannot_alias_the_installed_namespace() {
        let installed = Path::new("/root/com.perch.widgetstudio");
        for (path, insensitive, expected) in [
            ("/root/COM.PERCH.WIDGETSTUDIO/data", true, true),
            ("/root/com.perch.widgetstudio", true, true),
            ("/root/com.perch.widgetstudio-other", true, false),
            ("/root/COM.PERCH.WIDGETSTUDIO", false, false),
        ] {
            assert_eq!(
                within(Path::new(path), installed, insensitive),
                expected,
                "{path}"
            );
        }
    }

    #[test]
    fn a_slow_database_open_does_not_block_application_setup() {
        use std::{
            sync::{mpsc, Arc},
            time::{Duration, Instant},
        };
        let core = Arc::new(open_sesame_core::Core::new());
        let (release, wait) = mpsc::channel();
        let started = Instant::now();
        start_storage(Arc::clone(&core), move || {
            let _ = wait.recv_timeout(Duration::from_secs(2));
            open_sesame_core::storage::Storage::open_in_memory()
        });
        assert!(
            started.elapsed() < Duration::from_secs(1),
            "setup waited for the data file"
        );
        assert!(core.handle("system.info", &Default::default()).is_ok());
        assert!(
            core.handle("items.list", &Default::default()).is_err(),
            "pending storage must not report a saved or empty result"
        );
        release.send(()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        while core.handle("items.list", &Default::default()).is_err() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(core.handle("items.list", &Default::default()).is_ok());
        core.shutdown();
    }

    #[test]
    fn default_storage_is_in_its_own_namespace() {
        let dir = tempfile::tempdir().unwrap();
        let chosen = directory(&roots(dir.path()), None).unwrap();
        assert_eq!(
            chosen,
            dir.path()
                .canonicalize()
                .unwrap()
                .join("org.opencoven.open-sesame.restart-development")
        );
        assert!(!chosen.starts_with(dir.path().join("com.perch.widgetstudio")));
    }

    #[test]
    fn an_absolute_disposable_override_is_used() {
        let dir = tempfile::tempdir().unwrap();
        let fixture = dir.path().join("fixture data é");
        assert_eq!(
            directory(&roots(dir.path()), Some(&fixture)).unwrap(),
            dir.path().canonicalize().unwrap().join("fixture data é")
        );
    }

    #[test]
    fn relative_and_installed_application_overrides_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        for path in [
            PathBuf::from("relative"),
            dir.path().join("com.perch.widgetstudio"),
            dir.path().join("com.perch.widgetstudio/inside"),
            dir.path().join("other/../com.perch.widgetstudio"),
        ] {
            assert!(
                directory(&roots(dir.path()), Some(&path)).is_err(),
                "{}",
                path.display()
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn an_override_symlink_cannot_point_into_the_installed_application() {
        let dir = tempfile::tempdir().unwrap();
        let installed = dir.path().join("com.perch.widgetstudio");
        std::fs::create_dir(&installed).unwrap();
        let link = dir.path().join("apparently-safe");
        std::os::unix::fs::symlink(&installed, &link).unwrap();
        assert!(directory(&roots(dir.path()), Some(&link.join("new-data"))).is_err());
    }
}
