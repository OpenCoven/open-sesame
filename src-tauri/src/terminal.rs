//! The parts of a terminal pane that need the window (issue #74): the channel a pane's output
//! travels on, and the clipboard.
//!
//! Output does not go through window events. Tauri's events are not ordered and not built for
//! volume; a channel is ordered and carries raw bytes. The page creates one channel per pane and
//! names it in `terminal.open`; the core's sender thread writes to it, paced by `terminal.ack`.
//! A message on the channel is either an `ArrayBuffer` of output bytes or an object,
//! `{"event": "terminal.exit"}` or `{"event": "terminal.error", "message"}`, and the exit object
//! is always the last.

use open_sesame_core::protocol::{BridgeError, BridgeResult};
use open_sesame_core::terminal::{Output, Sink, NO_CHANNEL};
use open_sesame_core::Core;
use serde_json::{json, Map, Value};
use std::sync::Arc;
use tauri::ipc::{Channel, InvokeResponseBody, JavaScriptChannelId};
use tauri::{Runtime, WebviewWindow};
use tauri_plugin_clipboard_manager::ClipboardExt;

/// Methods answered here and not by the core.
pub const METHODS: &[&str] = &[
    "terminal.open",
    "terminal.clipboard.read",
    "terminal.clipboard.write",
];

/// The most clipboard text a pane may read or write, in bytes, as in the Swift host.
pub const CLIPBOARD_LIMIT: usize = 1024 * 1024;
const CLIPBOARD_INVALID: &str = "Invalid terminal clipboard request.";
const CLIPBOARD_TOO_LARGE: &str = "Clipboard text is too large.";
const CLIPBOARD_UNAVAILABLE: &str = "The clipboard is unavailable.";

pub fn handle<R: Runtime>(
    window: &WebviewWindow<R>,
    core: &Core,
    method: &str,
    params: &Map<String, Value>,
) -> BridgeResult {
    match method {
        "terminal.open" => open(window, core, params),
        "terminal.clipboard.read" => {
            read_request(params)?;
            let text = window.clipboard().read_text().unwrap_or_default();
            readable(text).map(Value::String)
        }
        _ => {
            let text = write_request(params)?;
            window
                .clipboard()
                .write_text(text)
                .map(|()| Value::Bool(true))
                .map_err(|_| BridgeError::from(CLIPBOARD_UNAVAILABLE))
        }
    }
}

/// Starts a pane whose output goes to the channel named by the `channel` parameter.
fn open<R: Runtime>(
    window: &WebviewWindow<R>,
    core: &Core,
    params: &Map<String, Value>,
) -> BridgeResult {
    let id = params
        .get("channel")
        .and_then(Value::as_str)
        .and_then(|channel| channel.parse::<JavaScriptChannelId>().ok())
        .ok_or_else(|| BridgeError::from(NO_CHANNEL))?;
    let channel: Channel<InvokeResponseBody> = id.channel_on(window.as_ref().clone());
    core.terminals.open(params, sink(channel))
}

/// Turns the core's output messages into channel messages. A send fails only when the page is
/// gone, and then there is nobody to tell.
fn sink(channel: Channel<InvokeResponseBody>) -> Sink {
    Arc::new(move |output| {
        let _ = channel.send(message(output));
    })
}

fn message(output: Output) -> InvokeResponseBody {
    match output {
        Output::Data(bytes) => InvokeResponseBody::Raw(bytes),
        Output::Error(message) => InvokeResponseBody::Json(
            json!({"event": "terminal.error", "message": message}).to_string(),
        ),
        Output::Exit => InvokeResponseBody::Json(json!({"event": "terminal.exit"}).to_string()),
    }
}

/// `terminal.clipboard.read` takes no parameters.
fn read_request(params: &Map<String, Value>) -> Result<(), BridgeError> {
    if params.is_empty() {
        Ok(())
    } else {
        Err(BridgeError::from(CLIPBOARD_INVALID))
    }
}

fn readable(text: String) -> Result<String, BridgeError> {
    if text.len() <= CLIPBOARD_LIMIT {
        Ok(text)
    } else {
        Err(BridgeError::from(CLIPBOARD_TOO_LARGE))
    }
}

/// `terminal.clipboard.write` takes exactly `text`, a string within the limit.
fn write_request(params: &Map<String, Value>) -> Result<&str, BridgeError> {
    match (params.len(), params.get("text")) {
        (1, Some(Value::String(text))) if text.len() <= CLIPBOARD_LIMIT => Ok(text),
        (1, Some(Value::String(_))) => Err(BridgeError::from(CLIPBOARD_TOO_LARGE)),
        _ => Err(BridgeError::from(CLIPBOARD_INVALID)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(value: Value) -> Map<String, Value> {
        value.as_object().cloned().unwrap()
    }

    #[test]
    fn clipboard_requests_follow_the_swift_rules() {
        assert_eq!(read_request(&params(json!({}))), Ok(()));
        assert_eq!(
            read_request(&params(json!({"x": 1}))),
            Err(BridgeError::from(CLIPBOARD_INVALID))
        );
        assert_eq!(write_request(&params(json!({"text": "copy"}))), Ok("copy"));
        assert_eq!(write_request(&params(json!({"text": ""}))), Ok(""));
        for request in [
            json!({}),
            json!({"text": 5}),
            json!({"text": "a", "more": 1}),
        ] {
            assert_eq!(
                write_request(&params(request)),
                Err(BridgeError::from(CLIPBOARD_INVALID))
            );
        }
        let limit = "x".repeat(CLIPBOARD_LIMIT);
        assert!(write_request(&params(json!({"text": limit}))).is_ok());
        assert_eq!(
            write_request(&params(json!({"text": "x".repeat(CLIPBOARD_LIMIT + 1)}))),
            Err(BridgeError::from(CLIPBOARD_TOO_LARGE))
        );
        assert!(readable("x".repeat(CLIPBOARD_LIMIT)).is_ok());
        assert_eq!(
            readable("é".repeat(CLIPBOARD_LIMIT / 2 + 1)),
            Err(BridgeError::from(CLIPBOARD_TOO_LARGE))
        );
    }

    #[test]
    fn output_is_raw_bytes_and_the_rest_are_objects() {
        assert!(matches!(
            message(Output::Data(vec![0, 159, 255])),
            InvokeResponseBody::Raw(bytes) if bytes == [0, 159, 255]
        ));
        let InvokeResponseBody::Json(exit) = message(Output::Exit) else {
            panic!("exit is not an object");
        };
        assert_eq!(
            serde_json::from_str::<Value>(&exit).unwrap(),
            json!({"event": "terminal.exit"})
        );
        let InvokeResponseBody::Json(error) = message(Output::Error("Terminal stream ended."))
        else {
            panic!("error is not an object");
        };
        assert_eq!(
            serde_json::from_str::<Value>(&error).unwrap(),
            json!({"event": "terminal.error", "message": "Terminal stream ended."})
        );
    }
}
