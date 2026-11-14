//! The one command the UI can call, and where each allowed request goes.

use crate::{summon, window, AppState};
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
    /// The shortcut and the other ways to make the window appear (issue #71).
    Summon,
    /// Everything else: the headless core.
    Core,
}

pub fn route(method: &str) -> Route {
    if method.starts_with("auth.") {
        Route::Auth
    } else if window::METHODS.contains(&method) {
        Route::Host
    } else if summon::METHODS.contains(&method) {
        Route::Summon
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
    gate::dispatch(request, &caller, |request| match route(&request.method) {
        Route::Auth => auth(&request.method),
        Route::Host => window::handle(window, &request.method, &request.params),
        Route::Summon => summon::handle(window.app_handle(), &request.method, &request.params),
        Route::Core => core.handle(&request.method, &request.params),
    })
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
        let app = mock_builder()
            .invoke_handler(tauri::generate_handler![bridge_request])
            .build(mock_context(noop_assets()))
            .unwrap();
        app.manage(AppState {
            core: Arc::new(Core::new()),
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
        // Listed in the gate ahead of its handler (#74): still a fixed reply, never a crash.
        assert_eq!(call(&main, "terminal.open", json!({})), error(UNSUPPORTED));
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
    fn summon_methods_go_to_summon() {
        for method in summon::METHODS {
            assert_eq!(route(method), Route::Summon, "{method}");
            assert!(PORTED.contains(method), "{method} must be ported");
        }
        // A method the gate allows must not fall through because the application forgot it.
        for method in PORTED.iter().filter(|method| method.starts_with("summon.")) {
            assert_eq!(route(method), Route::Summon, "{method}");
        }
    }

    /// The application with summon state for `session` and a settings file in a folder of its
    /// own. The shortcut plugin is not loaded, so the system refuses every registration.
    fn app_in(
        session: summon::Session,
        name: &str,
    ) -> (tauri::App<MockRuntime>, std::path::PathBuf) {
        let app = app();
        let folder =
            std::env::temp_dir().join(format!("open-sesame-router-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&folder);
        app.manage(summon::Summon::new(
            session,
            Some(folder.join("summon.json")),
        ));
        (app, folder)
    }

    #[test]
    fn the_page_reads_and_changes_the_summon_settings() {
        let (app, folder) = app_in(summon::Session::Wayland, "wayland");
        let main = open(&app, MAIN_WINDOW, bundled());
        let result = |reply: Result<Value, Value>| reply.unwrap()["result"].clone();
        let error = |reply: Result<Value, Value>| reply.unwrap()["error"].clone();

        let status = result(call(&main, "summon.status", json!({})));
        assert_eq!(status["session"], json!("wayland"));
        assert_eq!(status["shortcut"], json!(summon::DEFAULT_SHORTCUT));
        assert_eq!(status["registered"], json!(false));
        assert_eq!(status["hideOnBlur"], json!(false));
        assert_eq!(status["toggleCommand"], json!("open-sesame --toggle"));

        // A shortcut that cannot be one is refused and nothing changes.
        for bad in [
            json!({"shortcut": "Space"}),
            json!({"shortcut": "Alt+Nothing"}),
        ] {
            assert_eq!(
                error(call(&main, "summon.setShortcut", bad)),
                json!(summon::INVALID_SHORTCUT)
            );
        }
        for bad in [json!({}), json!({"shortcut": 7}), json!({"shortcut": null})] {
            assert_eq!(
                error(call(&main, "summon.setShortcut", bad)),
                json!(summon::INVALID_REQUEST)
            );
        }
        assert_eq!(
            result(call(&main, "summon.status", json!({})))["shortcut"],
            json!(summon::DEFAULT_SHORTCUT)
        );

        // A good one is kept for the next launch, and on Wayland the reply names the command.
        let changed = result(call(
            &main,
            "summon.setShortcut",
            json!({"shortcut": " Control+Alt+K "}),
        ));
        assert_eq!(changed["shortcut"], json!("Control+Alt+K"));
        assert_eq!(changed["registered"], json!(false));
        assert_eq!(changed["message"], json!(summon::WAYLAND));
        let kept = summon::Settings::load(&folder.join("summon.json"));
        assert_eq!(kept.shortcut, "Control+Alt+K");

        assert_eq!(
            error(call(
                &main,
                "summon.setHideOnBlur",
                json!({"enabled": "yes"})
            )),
            json!(summon::INVALID_REQUEST)
        );
        let blur = result(call(
            &main,
            "summon.setHideOnBlur",
            json!({"enabled": true}),
        ));
        assert_eq!(blur["hideOnBlur"], json!(true));
        assert!(summon::Settings::load(&folder.join("summon.json")).hide_on_blur);
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn a_refused_shortcut_reaches_the_page_and_the_old_one_is_kept() {
        let (app, folder) = app_in(summon::Session::X11, "refused");
        let main = open(&app, MAIN_WINDOW, bundled());
        let reply = call(
            &main,
            "summon.setShortcut",
            json!({"shortcut": "Alt+Space"}),
        )
        .unwrap();
        assert_eq!(reply["error"], json!(summon::refused("Alt+Space")));
        let status = call(&main, "summon.status", json!({})).unwrap()["result"].clone();
        assert_eq!(
            status["shortcut"],
            json!(summon::DEFAULT_SHORTCUT),
            "the setting did not change"
        );
        assert!(!folder.join("summon.json").exists(), "nothing was saved");

        // None is a choice: it registers nothing, is not an error, and is kept.
        let none =
            call(&main, "summon.setShortcut", json!({"shortcut": ""})).unwrap()["result"].clone();
        assert_eq!(none["shortcut"], json!(""));
        assert_eq!(none["registered"], json!(false));
        assert_eq!(none["message"], json!(""));
        assert_eq!(
            summon::Settings::load(&folder.join("summon.json")).shortcut,
            ""
        );
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn a_dialog_a_drag_and_a_pin_each_keep_the_window_on_blur() {
        let (app, folder) = app_in(summon::Session::X11, "blur");
        let main = open(&app, MAIN_WINDOW, bundled());
        let hides = || app.state::<summon::Summon>().should_hide_on_blur();
        assert!(!hides(), "off unless turned on");
        call(&main, "summon.setHideOnBlur", json!({"enabled": true})).unwrap();
        assert!(hides());

        // A drag, reported by the page.
        assert_eq!(
            call(&main, "summon.hold", json!({"held": true})).unwrap()["result"],
            json!({"held": true})
        );
        assert!(!hides());
        call(&main, "summon.hold", json!({"held": false})).unwrap();
        assert!(hides());
        assert_eq!(
            call(&main, "summon.hold", json!({})).unwrap()["error"],
            json!(summon::INVALID_REQUEST)
        );

        // A native dialog or a browser sign-in, held by the feature that opened it.
        let dialog = summon::hold(app.handle()).unwrap();
        assert!(!hides());
        drop(dialog);
        assert!(hides());

        // The pin.
        call(&main, "window.keepOpen", json!({"pinned": true})).unwrap();
        assert!(!hides());
        call(&main, "window.keepOpen", json!({"pinned": false})).unwrap();
        assert!(hides());
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn a_hide_on_blur_excuses_the_one_press_or_click_that_caused_it() {
        let (app, folder) = app_in(summon::Session::X11, "excuse");
        let main = open(&app, MAIN_WINDOW, bundled());
        // Off: losing focus hides nothing, so there is nothing to excuse.
        summon::blurred(app.handle());
        assert!(!summon::blur_just_hid(app.handle()));
        // On: the press or click that took the focus must not show the window again, and the
        // one after it toggles as usual. The shortcut and the tray click both ask this.
        call(&main, "summon.setHideOnBlur", json!({"enabled": true})).unwrap();
        summon::blurred(app.handle());
        assert!(summon::blur_just_hid(app.handle()));
        assert!(!summon::blur_just_hid(app.handle()), "asked once");
        // A window something holds does not hide, so the next press toggles.
        let dialog = summon::hold(app.handle()).unwrap();
        summon::blurred(app.handle());
        assert!(!summon::blur_just_hid(app.handle()));
        drop(dialog);
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn wayland_refuses_always_on_top_with_the_fixed_message() {
        let (app, _folder) = app_in(summon::Session::Wayland, "pin");
        let main = open(&app, MAIN_WINDOW, bundled());
        assert_eq!(
            call(&main, "window.keepOpen", json!({"pinned": true})),
            Ok(json!({"requestId": "r1", "error": open_sesame_core::gate::NOT_ON_OS}))
        );
        assert!(!app.state::<summon::Summon>().should_hide_on_blur());
    }

    #[test]
    fn summon_without_its_state_is_a_fixed_reply() {
        let app = app();
        let main = open(&app, MAIN_WINDOW, bundled());
        assert_eq!(
            call(&main, "summon.status", json!({})),
            Ok(json!({"requestId": "r1", "error": UNSUPPORTED}))
        );
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
