//! One login-shell capture, owned by the application and cancelled/joined on Quit.
use open_sesame_core::process::{Cancel, ShellEnv, StartupEnv, CAPTURE_TIMEOUT};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    thread::JoinHandle,
};

pub struct Startup {
    environment: Arc<StartupEnv>,
    inherited: ShellEnv,
    cancel: Cancel,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl Startup {
    pub fn start(inherited: ShellEnv) -> Self {
        let environment = Arc::new(StartupEnv::new());
        let cancel = Cancel::new();
        let shell = inherited.get("SHELL").map(PathBuf::from);
        let captured = Arc::clone(&environment);
        let vars = inherited.vars().clone();
        let worker_cancel = cancel.clone();
        let worker = std::thread::Builder::new()
            .name("startup-environment".into())
            .spawn(move || {
                captured.get_or_capture(|| {
                    ShellEnv::capture_cancellable(
                        shell.as_deref(),
                        vars,
                        CAPTURE_TIMEOUT,
                        worker_cancel,
                    )
                });
            })
            .ok();
        Self {
            environment,
            inherited,
            cancel,
            worker: Mutex::new(worker),
        }
    }

    pub fn environment(&self) -> ShellEnv {
        self.environment.peek().unwrap_or(&self.inherited).clone()
    }

    pub fn shutdown(&self) {
        self.cancel.cancel();
        if let Some(worker) = self.worker.lock().unwrap_or_else(|p| p.into_inner()).take() {
            let _ = worker.join();
        }
    }
}

impl Drop for Startup {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use open_sesame_core::process::{EnvSource, Fallback};
    use std::{collections::BTreeMap, os::unix::fs::PermissionsExt};

    #[test]
    fn startup_returns_while_capture_is_pending_and_quit_collects_it() {
        let dir = tempfile::tempdir().unwrap();
        let shell = dir.path().join("zsh");
        // A supported shell-name fixture that blocks before it can run the capture command.
        // No host profile or actual provider CLI is involved.
        std::fs::write(&shell, "#!/bin/sh\nsleep 30\n").unwrap();
        std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o700)).unwrap();
        let inherited = ShellEnv::from_vars(BTreeMap::from([
            ("SHELL".into(), shell.display().to_string()),
            ("PATH".into(), "/usr/bin:/bin".into()),
        ]));
        let startup = Startup::start(inherited.clone());
        assert!(
            startup.environment.peek().is_none(),
            "creating the app waited for shell capture"
        );
        assert_eq!(startup.environment(), inherited);
        startup.shutdown();
        assert_eq!(
            startup.environment().source(),
            &EnvSource::Inherited(Fallback::Cancelled)
        );
        startup.shutdown();
    }
}
