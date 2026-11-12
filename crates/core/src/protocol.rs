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
            assert!(object.contains_key("result") != object.contains_key("error"), "{value}");
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
