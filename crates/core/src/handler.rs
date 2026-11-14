//! Where a request goes once the gate has allowed it.
//!
//! [`Core`] owns the headless features. The application crate answers the methods that need a
//! window or a native dialog itself and passes every other allowed request here. A method no
//! module claims yet gets the same fixed reply as an unknown one, so a method listed in the gate
//! ahead of its handler never reaches feature code by accident.

use crate::gate::UNSUPPORTED;
use crate::protocol::{BridgeError, BridgeResult};
use crate::system;
use serde_json::{Map, Value};
use std::sync::atomic::{AtomicBool, Ordering};

/// The headless core. One instance lives for the life of the application.
#[derive(Debug, Default)]
pub struct Core {
    shut_down: AtomicBool,
}

impl Core {
    pub fn new() -> Core {
        Core::default()
    }

    /// Runs one allowed request. Blocking: call it off the UI thread.
    pub fn handle(&self, method: &str, _params: &Map<String, Value>) -> BridgeResult {
        if self.is_shut_down() {
            return Err(BridgeError::from(SHUTTING_DOWN));
        }
        match method {
            "system.info" => Ok(system::info()),
            _ => Err(BridgeError::from(UNSUPPORTED)),
        }
    }

    /// Stops everything the core owns. Called once on Quit; calling it again does nothing.
    /// Returns whether this call was the one that shut the core down.
    pub fn shutdown(&self) -> bool {
        !self.shut_down.swap(true, Ordering::SeqCst)
    }

    pub fn is_shut_down(&self) -> bool {
        self.shut_down.load(Ordering::SeqCst)
    }
}

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
        for method in ["terminal.open", "nope.nothing", "", "system.info.extra"] {
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
