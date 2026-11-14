//! Host messages to the UI that are not replies: low-volume events such as a pane exiting.
//! High-volume terminal output does not go this way; it uses channels (issue #74).

use open_sesame_core::gate::MAIN_WINDOW;
use open_sesame_core::protocol::Emit;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, EventTarget, Runtime};

/// The event name the UI's bridge listens for. `ui/bridge.js` names the same string.
pub const MESSAGE_EVENT: &str = "open-sesame-message";

/// An [`Emit`] that delivers each message to the main window and to no other.
pub fn emitter<R: Runtime>(app: &AppHandle<R>) -> Emit {
    let app = app.clone();
    Arc::new(move |message| {
        debug_assert!(
            message.get("event").is_some_and(|event| event.is_string()),
            "a host message is an object with an `event` key"
        );
        // A message for a window that is gone has nowhere to go; that is not an error.
        let _ = app.emit_to(
            EventTarget::webview_window(MAIN_WINDOW),
            MESSAGE_EVENT,
            message,
        );
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use std::sync::Mutex;
    use tauri::test::{mock_builder, mock_context, noop_assets};
    use tauri::{Listener, WebviewUrl, WebviewWindowBuilder};

    #[test]
    fn messages_reach_the_main_window_only_and_in_order() {
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let open = |label: &str| {
            WebviewWindowBuilder::new(&app, label, WebviewUrl::App("index.html".into()))
                .build()
                .unwrap()
        };
        let (main, other) = (open(MAIN_WINDOW), open("other"));
        let seen = Arc::new(Mutex::new(Vec::new()));
        let record = |window: &tauri::WebviewWindow<_>, name: &'static str| {
            let seen = Arc::clone(&seen);
            window.listen(MESSAGE_EVENT, move |event| {
                let payload: Value = serde_json::from_str(event.payload()).unwrap();
                seen.lock().unwrap().push((name, payload));
            });
        };
        record(&main, "main");
        record(&other, "other");

        let emit = emitter(app.handle());
        emit(json!({"event": "terminal.exit", "id": "pane-1"}));
        emit(json!({"event": "terminal.error", "id": "pane-2"}));

        assert_eq!(
            *seen.lock().unwrap(),
            vec![
                ("main", json!({"event": "terminal.exit", "id": "pane-1"})),
                ("main", json!({"event": "terminal.error", "id": "pane-2"})),
            ]
        );
    }
}
