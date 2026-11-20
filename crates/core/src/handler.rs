//! Where a request goes once the gate has allowed it.
//!
//! [`Core`] owns the headless features. The application crate answers the methods that need a
//! window or a native dialog itself and passes every other allowed request here. A method no
//! module claims yet gets the same fixed reply as an unknown one, so a method listed in the gate
//! ahead of its handler never reaches feature code by accident.

use crate::gate::UNSUPPORTED;
use crate::process::{Search, ShellEnv};
use crate::protocol::{BridgeError, BridgeResult};
use crate::storage::{self, Storage, StorageError};
use crate::system;
use crate::terminal::Terminals;
use serde_json::{Map, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

/// The headless core. One instance lives for the life of the application.
#[derive(Default)]
pub struct Core {
    shut_down: AtomicBool,
    storage: Mutex<Option<Result<Storage, StorageError>>>,
    /// Every open pane. The application opens a pane through this directly, because only it
    /// can supply the channel the pane's output goes to.
    pub terminals: Terminals,
}

impl Core {
    pub fn new() -> Core {
        Core::default()
    }

    /// The host chooses the directory and supplies the opening result. An opening failure
    /// is retained as a plain error; the rest of the application remains usable.
    pub fn with_storage(storage: Result<Storage, StorageError>) -> Self {
        Self {
            storage: Mutex::new(Some(storage)),
            ..Self::default()
        }
    }

    /// Publishes the background opening result once. A result arriving after Quit is dropped,
    /// closing its connection, so asynchronous startup cannot reopen a stopped core.
    pub fn initialize_storage(&self, storage: Result<Storage, StorageError>) -> bool {
        let mut slot = self.storage.lock().unwrap_or_else(|p| p.into_inner());
        if self.is_shut_down() || slot.is_some() {
            return false;
        }
        *slot = Some(storage);
        true
    }

    /// Finds an installed tool using the current stored override and the host's captured
    /// environment. A bad override stays missing; a storage failure must not bypass it.
    pub fn find_tool(
        &self,
        name: &str,
        environment: &ShellEnv,
    ) -> Result<Option<std::path::PathBuf>, BridgeError> {
        if self.is_shut_down() {
            return Err(BridgeError::from(SHUTTING_DOWN));
        }
        let slot = self.storage.lock().unwrap_or_else(|p| p.into_inner());
        let storage = slot
            .as_ref()
            .ok_or_else(|| BridgeError::from(DATA_UNAVAILABLE))?
            .as_ref()
            .map_err(|error| BridgeError(error.to_string()))?;
        let explicit = storage.cli_path(name)?;
        // Filesystem discovery can be slow. It needs only the owned override path, so it must
        // not keep the storage slot locked and delay storage requests or shutdown.
        drop(slot);
        Ok(Search::from_env(environment).find(name, explicit.as_deref()))
    }

    /// Runs one allowed request. Blocking: call it off the UI thread.
    pub fn handle(&self, method: &str, params: &Map<String, Value>) -> BridgeResult {
        if self.is_shut_down() {
            return Err(BridgeError::from(SHUTTING_DOWN));
        }
        match method {
            "system.info" => Ok(system::info()),
            _ if storage::commands::METHODS.contains(&method) => {
                let slot = self.storage.lock().unwrap_or_else(|p| p.into_inner());
                let storage = slot
                    .as_ref()
                    .ok_or_else(|| BridgeError::from(DATA_UNAVAILABLE))?
                    .as_ref()
                    .map_err(|error| BridgeError(error.to_string()))?;
                storage::commands::handle(storage, method, params)
            }
            _ if Terminals::METHODS.contains(&method) => self.terminals.handle(method, params),
            _ => Err(BridgeError::from(UNSUPPORTED)),
        }
    }

    /// Stops everything the core owns: every pane's process tree is killed before this returns,
    /// and no pane opens afterwards. Called once on Quit; calling it again does nothing. Returns whether this call was the one
    /// that shut the core down.
    pub fn shutdown(&self) -> bool {
        let first = !self.shut_down.swap(true, Ordering::SeqCst);
        if first {
            self.terminals.shut_down();
            self.storage
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .take();
        }
        first
    }

    pub fn is_shut_down(&self) -> bool {
        self.shut_down.load(Ordering::SeqCst)
    }
}

impl std::fmt::Debug for Core {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Core")
            .field("shut_down", &self.is_shut_down())
            .finish_non_exhaustive()
    }
}

pub const DATA_UNAVAILABLE: &str =
    "Open Sesame is still opening its data file. Try again before saving changes.";

pub const SHUTTING_DOWN: &str = "Open Sesame is quitting.";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gate::{gate, Caller, Gate, MAIN_WINDOW, PORTED};

    fn no_params() -> Map<String, Value> {
        Map::new()
    }

    #[test]
    fn system_info_is_served() {
        let info = Core::new().handle("system.info", &no_params()).unwrap();
        assert_eq!(info["available"], Value::Bool(true));
    }

    #[test]
    fn a_method_no_module_claims_is_unsupported() {
        let core = Core::new();
        for method in [
            "project.reveal",
            "terminal.clipboard.read",
            "nope.nothing",
            "",
            "system.info.extra",
        ] {
            assert_eq!(
                core.handle(method, &no_params()),
                Err(BridgeError::from(UNSUPPORTED)),
                "{method}"
            );
        }
    }

    #[test]
    fn every_ported_method_gets_a_reply_and_never_a_panic() {
        let core = Core::new();
        let caller = Caller {
            window: MAIN_WINDOW,
            authenticated: true,
        };
        for method in PORTED {
            assert_eq!(gate(method, &caller), Gate::Allow, "{method}");
            let _ = core.handle(method, &no_params());
        }
    }

    #[test]
    fn terminal_requests_reach_the_terminals() {
        let core = Core::new();
        let mut params = no_params();
        params.insert("id".into(), Value::from("nobody"));
        assert_eq!(
            core.handle("terminal.input", &params),
            Err(BridgeError::from("Open this shell before sending input."))
        );
        assert_eq!(
            core.handle("terminal.open", &params),
            Err(BridgeError::from(crate::terminal::NO_CHANNEL))
        );
        assert_eq!(core.handle("terminal.ack", &params), Ok(Value::Bool(true)));
    }

    #[test]
    fn shutdown_closes_every_pane() {
        let core = Core::new();
        let mut params = no_params();
        params.insert("id".into(), Value::from("main"));
        let opened = core
            .terminals
            .open(&params, std::sync::Arc::new(|_| {}))
            .unwrap();
        assert!(opened["pid"].as_u64().is_some());
        assert!(core.shutdown());
        assert_eq!(
            core.handle("terminal.input", &params),
            Err(BridgeError::from(SHUTTING_DOWN))
        );
        // The pane is gone from the core, not merely refused.
        assert_eq!(
            core.terminals.handle("terminal.input", &params),
            Err(BridgeError::from("Open this shell before sending input."))
        );
        // The application opens panes on the terminals directly, so they refuse by themselves:
        // a pane opened after the shutdown would have nothing left to close it.
        assert_eq!(
            core.terminals.open(&params, std::sync::Arc::new(|_| {})),
            Err(BridgeError::from(SHUTTING_DOWN))
        );
    }

    #[test]
    fn shutdown_happens_once_and_refuses_later_requests() {
        let core = Core::new();
        assert!(!core.is_shut_down());
        assert!(core.shutdown());
        assert!(!core.shutdown());
        assert!(core.is_shut_down());
        assert_eq!(
            core.handle("system.info", &no_params()),
            Err(BridgeError::from(SHUTTING_DOWN))
        );
    }
}
