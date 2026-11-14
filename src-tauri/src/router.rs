//! The one command the UI can call, and where each allowed request goes.

use crate::{window, AppState};
use open_sesame_core::gate::{self, Caller, NOT_IN_VERSION};
use open_sesame_core::protocol::{BridgeError, BridgeResult, Reply, Request};
use open_sesame_core::Core;
use serde_json::json;
use std::sync::Arc;
use tauri::{Manager, State, WebviewWindow};

/// Who answers an allowed method.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Route {
    /// Sign-in. Wired to the sign-in logic in issue #72.
    Auth,
    /// Needs the window, so the application answers it.
    Host,
    /// Everything else: the headless core.
    Core,
}

pub fn route(method: &str) -> Route {
    if method.starts_with("auth.") {
        Route::Auth
    } else if window::METHODS.contains(&method) {
        Route::Host
    } else {
        Route::Core
    }
}

/// Whether a session is verified. Nothing signs in until issue #72, and no method in the first
/// release needs a session (issue #60), so every local feature runs with this `false`.
fn authenticated() -> bool {
    false
}

/// Sign-in before issue #72: the status is honest and the actions say they are not here yet.
fn auth(method: &str) -> BridgeResult {
    match method {
        "auth.status" => Ok(json!({"authenticated": false})),
        _ => Err(BridgeError::from(NOT_IN_VERSION)),
    }
}

/// Serves one UI request. The gate decides first; a request from any window other than `main`,
/// or from a page that is not the application's own, is dropped: nothing runs and the call is rejected with
/// no message.
#[tauri::command]
pub async fn bridge_request(
    window: WebviewWindow,
    state: State<'_, AppState>,
    message: Request,
) -> Result<Reply, ()> {
    let dev_url = window.app_handle().config().build.dev_url.as_ref();
    if !window
        .url()
        .is_ok_and(|url| window::is_app_page(dev_url, &url))
    {
        return Err(());
    }
    let core = Arc::clone(&state.core);
    // Handlers may block, and window calls made from the UI thread can deadlock, so the whole
    // exchange runs on the blocking pool.
    tauri::async_runtime::spawn_blocking(move || answer(&window, &core, &message))
        .await
        .map_err(|_| ())?
        .ok_or(())
}

fn answer(window: &WebviewWindow, core: &Core, request: &Request) -> Option<Reply> {
    let caller = Caller {
        window: window.label(),
        authenticated: authenticated(),
    };
    gate::dispatch(request, &caller, |request| match route(&request.method) {
        Route::Auth => auth(&request.method),
        Route::Host => window::handle(window, &request.method, &request.params),
        Route::Core => core.handle(&request.method, &request.params),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use open_sesame_core::gate::{Gate, MAIN_WINDOW, PORTED};

    #[test]
    fn sign_in_methods_go_to_auth() {
        for method in ["auth.status", "auth.signIn", "auth.cancel", "auth.signOut"] {
            assert_eq!(route(method), Route::Auth, "{method}");
        }
    }

    #[test]
    fn window_methods_stay_in_the_host() {
        for method in [
            "window.size",
            "window.focus",
            "window.fullscreen",
            "window.keepOpen",
        ] {
            assert_eq!(route(method), Route::Host, "{method}");
        }
    }

    #[test]
    fn everything_else_goes_to_the_core() {
        for method in ["system.info", "terminal.open", "project.reveal"] {
            assert_eq!(route(method), Route::Core, "{method}");
        }
    }

    #[test]
    fn every_ported_host_method_has_a_handler() {
        // A method the gate allows must not fall through to the unknown-method reply because the
        // application forgot it.
        for method in PORTED.iter().filter(|method| method.starts_with("window.")) {
            assert_eq!(route(method), Route::Host, "{method}");
        }
    }

    #[test]
    fn the_app_is_signed_out_until_sign_in_is_wired() {
        assert!(!authenticated());
        assert_eq!(auth("auth.status"), Ok(json!({"authenticated": false})));
        for method in ["auth.signIn", "auth.cancel", "auth.signOut"] {
            assert_eq!(auth(method), Err(BridgeError::from(NOT_IN_VERSION)));
        }
        let caller = Caller {
            window: MAIN_WINDOW,
            authenticated: authenticated(),
        };
        assert_eq!(gate::gate("system.info", &caller), Gate::SignedOutInfo);
    }
}
