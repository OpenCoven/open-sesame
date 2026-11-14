//! The wire protocol between the UI and the host.
//!
//! The envelope is the one `dist/bridge.js` already speaks: a request is
//! `{requestId, method, params}`, a reply is `{requestId, result}` or `{requestId, error}`, and an
//! event is any object with an `event` key. Only the transport underneath changes.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fmt;
use std::sync::Arc;

/// One request from the UI.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub request_id: String,
    pub method: String,
    /// Named parameters. A request without `params` has none.
    #[serde(default)]
    pub params: Map<String, Value>,
}

/// The single reply to a [`Request`]: a result or an error message, never both.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reply {
    request_id: String,
    #[serde(flatten)]
    outcome: Outcome,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Outcome {
    Result(Value),
    Error(String),
}

impl Reply {
    pub fn ok(request_id: &str, result: Value) -> Reply {
        Reply {
            request_id: request_id.to_string(),
            outcome: Outcome::Result(result),
        }
    }

    pub fn err(request_id: &str, message: impl Into<String>) -> Reply {
        Reply {
            request_id: request_id.to_string(),
            outcome: Outcome::Error(message.into()),
        }
    }

    pub fn from_result(request_id: &str, result: BridgeResult) -> Reply {
        match result {
            Ok(value) => Reply::ok(request_id, value),
            Err(BridgeError(message)) => Reply::err(request_id, message),
        }
    }
}

/// A failure the UI shows to the user as it is written.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BridgeError(pub String);

impl fmt::Display for BridgeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for BridgeError {}

impl From<&str> for BridgeError {
    fn from(message: &str) -> Self {
        BridgeError(message.to_string())
    }
}

impl From<String> for BridgeError {
    fn from(message: String) -> Self {
        BridgeError(message)
    }
}

/// What a feature handler returns.
pub type BridgeResult = Result<Value, BridgeError>;

/// Sends an event to the UI. Every emitted value is an object with an `event` key.
pub type Emit = Arc<dyn Fn(Value) + Send + Sync>;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use std::sync::{Arc, Mutex};

    #[test]
    fn request_uses_the_bridge_field_names() {
        let request: Request = serde_json::from_str(
            r#"{"requestId":"request-1","method":"terminal.open","params":{"cols":80}}"#,
        )
        .unwrap();
        assert_eq!(request.request_id, "request-1");
        assert_eq!(request.method, "terminal.open");
        assert_eq!(request.params.get("cols"), Some(&json!(80)));
    }

    #[test]
    fn request_without_params_deserializes_to_empty_params() {
        let request: Request =
            serde_json::from_str(r#"{"requestId":"a","method":"system.info"}"#).unwrap();
        assert!(request.params.is_empty());
    }

    #[test]
    fn request_round_trips_with_the_same_envelope() {
        let wire = r#"{"requestId":"a","method":"system.info","params":{}}"#;
        let request: Request = serde_json::from_str(wire).unwrap();
        assert_eq!(serde_json::to_string(&request).unwrap(), wire);
    }

    #[test]
    fn malformed_requests_are_rejected() {
        for wire in [
            r#"{"method":"system.info"}"#,
            r#"{"requestId":"a"}"#,
            r#"{"requestId":7,"method":"system.info"}"#,
            r#"{"requestId":"a","method":["system.info"]}"#,
            r#"{"requestId":"a","method":"system.info","params":[1,2]}"#,
            r#"{"requestId":"a","method":"system.info","params":"x"}"#,
            r#"[]"#,
        ] {
            assert!(serde_json::from_str::<Request>(wire).is_err(), "{wire}");
        }
    }

    #[test]
    fn reply_shapes() {
        assert_eq!(
            serde_json::to_string(&Reply::ok("a", json!(true))).unwrap(),
            r#"{"requestId":"a","result":true}"#
        );
        assert_eq!(
            serde_json::to_string(&Reply::err("a", "x")).unwrap(),
            r#"{"requestId":"a","error":"x"}"#
        );
    }

    #[test]
    fn reply_carries_exactly_one_of_result_or_error() {
        for reply in [
            Reply::ok("a", json!({"platform": "linux"})),
            Reply::ok("a", Value::Null),
            Reply::err("a", String::from("x")),
        ] {
            let value = serde_json::to_value(&reply).unwrap();
            let object = value.as_object().unwrap();
            assert_eq!(object.len(), 2, "{value}");
            assert_eq!(object["requestId"], json!("a"));
            assert!(
                object.contains_key("result") != object.contains_key("error"),
                "{value}"
            );
        }
    }

    #[test]
    fn reply_from_a_handler_result() {
        let ok: BridgeResult = Ok(json!(1));
        let err: BridgeResult = Err("no".into());
        assert_eq!(Reply::from_result("a", ok), Reply::ok("a", json!(1)));
        assert_eq!(Reply::from_result("a", err), Reply::err("a", "no"));
    }

    #[test]
    fn bridge_error_displays_its_message_and_converts_from_strings() {
        let from_str: BridgeError = "one".into();
        let from_string: BridgeError = String::from("two").into();
        assert_eq!(from_str.to_string(), "one");
        assert_eq!(from_string.to_string(), "two");
        assert_eq!(from_str, BridgeError(String::from("one")));
        let boxed: Box<dyn std::error::Error> = Box::new(from_string);
        assert_eq!(boxed.to_string(), "two");
    }

    #[test]
    fn emit_is_shareable_across_threads() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&seen);
        let emit: Emit = Arc::new(move |value| sink.lock().unwrap().push(value));
        let worker = Arc::clone(&emit);
        std::thread::spawn(move || worker(json!({"event": "terminal.output", "id": "pane-1"})))
            .join()
            .unwrap();
        emit(json!({"event": "terminal.exit", "id": "pane-1"}));
        assert_eq!(
            *seen.lock().unwrap(),
            vec![
                json!({"event": "terminal.output", "id": "pane-1"}),
                json!({"event": "terminal.exit", "id": "pane-1"}),
            ]
        );
    }
}
