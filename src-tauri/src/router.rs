//! The one command the UI can call, and where each allowed request goes.

use crate::{project, terminal, window, AppState};
use open_sesame_core::gate::{self, Caller, NOT_IN_VERSION};
use open_sesame_core::protocol::{BridgeError, BridgeResult, Reply, Request};
use open_sesame_core::Core;
use serde_json::json;
use std::sync::Arc;
use tauri::{Manager, Runtime, State, WebviewWindow};

/// Who answers an allowed method.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Route {
    /// Sign-in. Wired to the sign-in logic in issue #72.
    Auth,
    /// Needs the window, so the application answers it.
    Host,
    /// A pane's output channel and the clipboard (issue #74).
    Terminal,
    /// The folder dialog and the file manager (issue #74).
    Project,
    /// Everything else: the headless core.
    Core,
}

pub fn route(method: &str) -> Route {
    if method.starts_with("auth.") {
        Route::Auth
    } else if window::METHODS.contains(&method) {
        Route::Host
    } else if terminal::METHODS.contains(&method) {
        Route::Terminal
    } else if project::METHODS.contains(&method) {
        Route::Project
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
pub async fn bridge_request<R: Runtime>(
    window: WebviewWindow<R>,
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

fn answer<R: Runtime>(window: &WebviewWindow<R>, core: &Core, request: &Request) -> Option<Reply> {
    let caller = Caller {
        window: window.label(),
        authenticated: authenticated(),
    };
    let reply = gate::dispatch(request, &caller, |request| match route(&request.method) {
        Route::Auth => auth(&request.method),
        Route::Host => window::handle(window, &request.method, &request.params),
        Route::Terminal => terminal::handle(window, core, &request.method, &request.params),
        Route::Project => project::handle(window, &request.method, &request.params),
        Route::Core => core.handle(&request.method, &request.params),
    });
    #[cfg(debug_assertions)]
    if reply.is_some() {
        crate::runtime_probe::record(window.app_handle(), "bridge");
    }
    reply
}

#[cfg(test)]
mod tests {
    use super::*;
    use open_sesame_core::gate::{Gate, MAIN_WINDOW, PORTED, UNSUPPORTED};
    use serde_json::Value;
    use tauri::ipc::{CallbackFn, InvokeBody};
    use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime};
    use tauri::webview::InvokeRequest;
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    /// The application's command behind Tauri's own request handling, with windows that draw
    /// nothing. The real capability file is not loaded here, so only the command's own rules
    /// are under test.
    fn app() -> tauri::App<MockRuntime> {
        app_with_core(Core::with_storage(
            open_sesame_core::storage::Storage::open_in_memory(),
        ))
    }

    fn app_with_core(core: Core) -> tauri::App<MockRuntime> {
        let app = mock_builder()
            .invoke_handler(tauri::generate_handler![bridge_request])
            .build(mock_context(noop_assets()))
            .unwrap();
        app.manage(AppState {
            core: Arc::new(core),
            startup: crate::startup::Startup::start(
                open_sesame_core::process::ShellEnv::from_vars(Default::default()),
            ),
            emit: crate::events::emitter(app.handle()),
        });
        app
    }

    fn open(
        app: &tauri::App<MockRuntime>,
        label: &str,
        url: WebviewUrl,
    ) -> WebviewWindow<MockRuntime> {
        WebviewWindowBuilder::new(app, label, url).build().unwrap()
    }

    fn bundled() -> WebviewUrl {
        WebviewUrl::App("index.html".into())
    }

    /// Calls `bridge_request` from `window` the way the page does. `Ok` is the reply the page
    /// receives; `Err` is the value its call is rejected with.
    fn call(
        window: &WebviewWindow<MockRuntime>,
        method: &str,
        params: Value,
    ) -> Result<Value, Value> {
        call_from(window, window.url().unwrap(), method, params)
    }

    /// The same call, with the page address the request claims to come from given separately.
    fn call_from(
        window: &WebviewWindow<MockRuntime>,
        origin: tauri::Url,
        method: &str,
        params: Value,
    ) -> Result<Value, Value> {
        let message = json!({"requestId": "r1", "method": method, "params": params});
        get_ipc_response(
            window,
            InvokeRequest {
                cmd: "bridge_request".into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: origin,
                body: InvokeBody::Json(json!({ "message": message })),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        )
        .map(|body| body.deserialize::<Value>().unwrap())
    }

    #[test]
    fn storage_open_errors_reach_the_page_without_reporting_saved_or_rejecting_other_local_requests(
    ) {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("not-a-directory");
        std::fs::write(&file, b"keep").unwrap();
        let app = app_with_core(Core::with_storage(
            open_sesame_core::storage::Storage::open_in(&file.join("data")),
        ));
        let main = open(&app, MAIN_WINDOW, bundled());
        for (method, params) in [
            ("items.list", json!({})),
            (
                "items.save",
                json!({"item":{"kind":"note","text":"unsaved"}}),
            ),
        ] {
            let reply = call(&main, method, params).unwrap();
            assert_eq!(
                reply["error"],
                "Open Sesame could not open its data file. The file has not been changed."
            );
            assert!(reply.get("result").is_none());
        }
        assert!(call(&main, "system.info", json!({}))
            .unwrap()
            .get("result")
            .is_some());
        assert_eq!(std::fs::read(file).unwrap(), b"keep");
    }

    #[test]
    fn a_newer_schema_error_reaches_the_page_as_a_sentence() {
        // The real newer-file refusal and unchanged bytes are exercised in core/tests/runtime.rs.
        let app = app_with_core(Core::with_storage(Err(
            open_sesame_core::storage::StorageError::NewerSchema {
                found: 999,
                supported: 1,
            },
        )));
        let main = open(&app, MAIN_WINDOW, bundled());
        let reply = call(&main, "items.list", json!({})).unwrap();
        assert_eq!(
            reply["error"],
            "This data was saved by a newer version of Open Sesame. Update the app to open it."
        );
        assert!(reply.get("result").is_none());
    }

    #[test]
    fn every_ported_method_reaches_a_handler_or_its_named_pending_issue() {
        // #72 owns these three actions. Status already has an honest signed-out handler.
        const PENDING: &[(&str, u32)] = &[
            ("auth.signIn", 72),
            ("auth.cancel", 72),
            ("auth.signOut", 72),
        ];
        let app = app();
        let main = open(&app, MAIN_WINDOW, bundled());
        for (method, issue) in PENDING {
            assert!(
                PORTED.contains(method),
                "stale pending exception {method} #{issue}"
            );
        }
        for method in PORTED {
            // Invalid typed input avoids native dialogs, clipboard access and pane creation,
            // while still passing the gate and invoking the real route's handler.
            let reply = call(&main, method, json!({"unexpected":true}))
                .unwrap_or_else(|error| panic!("{method} did not return a reply: {error}"));
            assert_ne!(
                reply["error"], UNSUPPORTED,
                "admitted method lost its handler: {method}"
            );
            if PENDING.iter().any(|(pending, _)| pending == method) {
                assert_eq!(
                    reply["error"], NOT_IN_VERSION,
                    "remove the pending exception when {method} is implemented"
                );
            } else {
                assert_ne!(
                    reply["error"], NOT_IN_VERSION,
                    "unrecorded pending handler: {method}"
                );
            }
        }
    }

    #[test]
    fn folder_dialog_bad_input_is_refused_before_the_plugin_runs() {
        let app = app();
        let main = open(&app, MAIN_WINDOW, bundled());
        assert_eq!(
            call(&main, "project.chooseFolder", json!({"unexpected":true})),
            Ok(json!({"requestId":"r1","error":"Invalid folder request."}))
        );
    }

    #[test]
    fn storage_save_and_list_reach_the_core_through_the_command() {
        let app = app();
        let main = open(&app, MAIN_WINDOW, bundled());
        let saved = call(
            &main,
            "items.save",
            json!({"item": {"kind": "note", "text": "runtime wiring"}}),
        )
        .unwrap();
        assert!(saved.get("error").is_none(), "{saved}");
        let id = saved["result"]["item"]["id"].as_str().unwrap();
        let listed = call(&main, "items.list", json!({})).unwrap();
        assert_eq!(listed["result"]["items"][0]["id"], id);
        assert_eq!(listed["result"]["items"][0]["text"], "runtime wiring");
    }

    #[test]
    fn the_main_window_gets_one_reply_per_request() {
        let app = app();
        let main = open(&app, MAIN_WINDOW, bundled());
        assert_eq!(
            call(&main, "system.info", json!({})),
            Ok(json!({
                "requestId": "r1",
                "result": {"platform": gate::platform(), "authenticated": false},
            }))
        );
        assert_eq!(
            call(&main, "auth.status", json!({})),
            Ok(json!({"requestId": "r1", "result": {"authenticated": false}}))
        );
        assert_eq!(
            call(&main, "window.keepOpen", json!({"pinned": true})),
            Ok(json!({"requestId": "r1", "result": {"pinned": true}}))
        );
        assert_eq!(
            call(&main, "window.focus", json!({})),
            Ok(json!({"requestId": "r1", "result": true}))
        );
    }

    #[test]
    fn refusals_reach_the_page_as_the_fixed_sentences() {
        let app = app();
        let main = open(&app, MAIN_WINDOW, bundled());
        let error = |message: &str| Ok(json!({"requestId": "r1", "error": message}));
        assert_eq!(
            call(&main, "speech.start", json!({})),
            error(NOT_IN_VERSION)
        );
        assert_eq!(call(&main, "auth.signIn", json!({})), error(NOT_IN_VERSION));
        assert_eq!(call(&main, "nope.nothing", json!({})), error(UNSUPPORTED));
        // Requests the application answers refuse bad input before they touch a plugin.
        assert_eq!(
            call(&main, "terminal.open", json!({"id": "main"})),
            error(open_sesame_core::terminal::NO_CHANNEL)
        );
        assert_eq!(
            call(
                &main,
                "terminal.open",
                json!({"id": "bad id", "channel": "__CHANNEL__:7"})
            ),
            error("Invalid pane ID.")
        );
        assert_eq!(
            call(&main, "terminal.clipboard.read", json!({"x": 1})),
            error("Invalid terminal clipboard request.")
        );
        assert_eq!(
            call(&main, "terminal.clipboard.write", json!({"text": 5})),
            error("Invalid terminal clipboard request.")
        );
        assert_eq!(
            call(&main, "project.reveal", json!({"path": "relative"})),
            error("Folder unavailable.")
        );
        assert_eq!(
            call(&main, "window.size", json!({"width": "wide"})),
            error(window::INVALID_DIMENSIONS)
        );
    }

    #[test]
    fn a_request_from_any_other_window_is_dropped() {
        let app = app();
        let _main = open(&app, MAIN_WINDOW, bundled());
        for label in ["other", "main-2", "Main", "settings"] {
            let other = open(&app, label, bundled());
            for method in ["system.info", "auth.status", "window.focus", "speech.start"] {
                assert_eq!(
                    call(&other, method, json!({})),
                    Err(Value::Null),
                    "{label} {method}"
                );
            }
        }
    }

    #[test]
    fn a_request_from_a_page_that_is_not_the_applications_own_is_dropped() {
        let app = app();
        let elsewhere = WebviewUrl::External("https://example.com/".parse().unwrap());
        let main = open(&app, MAIN_WINDOW, elsewhere);
        // The address Tauri serves bundled files from on this system; any other address is a
        // remote page to Tauri, which refuses it before the command runs.
        let bundled_origin: tauri::Url = if cfg!(windows) {
            "http://tauri.localhost"
        } else {
            "tauri://localhost"
        }
        .parse()
        .unwrap();
        for method in ["system.info", "auth.status", "window.focus"] {
            // Tauri refuses a remote page before the command runs, with its own message.
            let refused = call(&main, method, json!({}));
            assert!(
                matches!(&refused, Err(Value::String(reason)) if reason.contains("not allowed")),
                "{method} {refused:?}"
            );
            // If a request ever claimed a bundled origin while the window shows another page,
            // the command itself drops it.
            assert_eq!(
                call_from(&main, bundled_origin.clone(), method, json!({})),
                Err(Value::Null),
                "{method}"
            );
        }
    }

    #[test]
    fn a_malformed_message_is_rejected_before_the_command_runs() {
        let app = app();
        let main = open(&app, MAIN_WINDOW, bundled());
        let request = |body: Value| InvokeRequest {
            cmd: "bridge_request".into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: main.url().unwrap(),
            body: InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_string(),
        };
        for body in [
            json!({}),
            json!({"message": {"method": "system.info"}}),
            json!({"message": {"requestId": 7, "method": "system.info"}}),
            json!({"message": {"requestId": "r1", "method": "system.info", "params": [1]}}),
        ] {
            assert!(
                get_ipc_response(&main, request(body.clone())).is_err(),
                "{body}"
            );
        }
    }

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
        for method in [
            "system.info",
            "terminal.input",
            "terminal.resize",
            "terminal.close",
            "terminal.ack",
        ] {
            assert_eq!(route(method), Route::Core, "{method}");
        }
    }

    #[test]
    fn methods_that_need_the_window_or_a_plugin_stay_in_the_application() {
        for method in [
            "terminal.open",
            "terminal.clipboard.read",
            "terminal.clipboard.write",
        ] {
            assert_eq!(route(method), Route::Terminal, "{method}");
        }
        for method in ["project.chooseFolder", "project.reveal"] {
            assert_eq!(route(method), Route::Project, "{method}");
        }
    }

    /// A pane opened through the command is a real shell, and closing it through the command
    /// leaves no process. The channel's messages go nowhere on this windowless runtime; the
    /// stream itself is tested in the core.
    #[test]
    fn a_pane_opens_and_closes_through_the_command() {
        let app = app();
        let main = open(&app, MAIN_WINDOW, bundled());
        let opened = call(
            &main,
            "terminal.open",
            json!({"id": "main", "mode": "local", "channel": "__CHANNEL__:7"}),
        )
        .unwrap();
        let pid = opened["result"]["pid"].as_u64().expect("no process ID") as u32;
        assert_eq!(opened["result"]["id"], "main");
        assert!(crate::test_support::alive(pid));
        let ok = Ok(json!({"requestId": "r1", "result": true}));
        assert_eq!(
            call(&main, "terminal.ack", json!({"id": "main", "bytes": 10})),
            ok
        );
        assert_eq!(
            call(
                &main,
                "terminal.resize",
                json!({"id": "main", "cols": 100, "rows": 30})
            ),
            ok
        );
        assert_eq!(call(&main, "terminal.close", json!({"id": "main"})), ok);
        assert!(
            !crate::test_support::alive(pid),
            "the shell is still running after terminal.close returned"
        );
        // Another window cannot reach the panes either.
        let other = open(&app, "other", bundled());
        assert_eq!(
            call(
                &other,
                "terminal.open",
                json!({"id": "x", "channel": "__CHANNEL__:8"})
            ),
            Err(Value::Null)
        );
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
