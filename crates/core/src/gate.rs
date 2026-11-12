#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{BridgeError, Reply, Request};
    use serde_json::{json, Value};
    use std::cell::Cell;

    const SIGNED_IN: Caller = Caller { window: MAIN_WINDOW, authenticated: true };
    const SIGNED_OUT: Caller = Caller { window: MAIN_WINDOW, authenticated: false };
    const BOTH: [Caller; 2] = [SIGNED_IN, SIGNED_OUT];
    const SIGN_IN_METHODS: [&str; 4] = ["auth.status", "auth.signIn", "auth.cancel", "auth.signOut"];

    /// One concrete method name for a not-ported entry: the entry itself when it names a method,
    /// or the entry plus a segment when it names a namespace.
    fn sample(prefix: &str) -> String {
        if prefix.ends_with('.') { format!("{prefix}probe") } else { prefix.to_string() }
    }

    fn request(method: &str) -> Request {
        serde_json::from_value(json!({"requestId": "r1", "method": method})).unwrap()
    }

    // Step 1: main window only.

    #[test]
    fn requests_from_any_other_window_are_dropped() {
        for window in ["", "settings", "Main", "main ", "main-2"] {
            for authenticated in [true, false] {
                let caller = Caller { window, authenticated };
                for method in ["auth.status", "system.info", "terminal.open", "vnc.open", "nope.nothing"] {
                    assert_eq!(gate(method, &caller), Gate::Drop, "{window:?} {method}");
                }
            }
        }
    }

    // Step 2: sign-in methods are always allowed.

    #[test]
    fn sign_in_methods_are_allowed_signed_in_and_signed_out() {
        for caller in &BOTH {
            for method in SIGN_IN_METHODS {
                assert_eq!(gate(method, caller), Gate::Allow, "{method} {caller:?}");
            }
        }
    }

    // Step 3: limited system.info when signed out.

    #[test]
    fn system_info_is_limited_only_while_signed_out() {
        assert_eq!(gate("system.info", &SIGNED_OUT), Gate::SignedOutInfo);
        assert_eq!(gate("system.info", &SIGNED_IN), Gate::Allow);
    }

    // Step 4: the session rule chosen in #60 (Option B: only account-backed methods need one).

    #[test]
    fn local_methods_run_signed_out() {
        for method in PORTED.iter().filter(|method| **method != "system.info") {
            assert_eq!(gate(method, &SIGNED_OUT), Gate::Allow, "{method}");
        }
    }

    #[test]
    fn the_first_release_has_no_account_backed_method() {
        assert!(ACCOUNT_BACKED.is_empty());
        for method in PORTED {
            assert_ne!(gate(method, &SIGNED_OUT), Gate::Deny(SIGN_IN_REQUIRED), "{method}");
        }
    }

    #[test]
    fn an_account_backed_method_needs_a_session() {
        let policy = Policy { ported: &["sync.push", "terminal.open"], account_backed: &["sync.push"], ..Policy::RELEASE };
        assert_eq!(policy.gate("sync.push", &SIGNED_OUT), Gate::Deny(SIGN_IN_REQUIRED));
        assert_eq!(policy.gate("sync.push", &SIGNED_IN), Gate::Allow);
        assert_eq!(policy.gate("terminal.open", &SIGNED_OUT), Gate::Allow);
    }

    #[test]
    fn the_session_rule_is_checked_before_the_not_ported_list() {
        let policy = Policy { account_backed: &["music.spotify.library"], ..Policy::RELEASE };
        assert_eq!(policy.gate("music.spotify.library", &SIGNED_OUT), Gate::Deny(SIGN_IN_REQUIRED));
        assert_eq!(policy.gate("music.spotify.library", &SIGNED_IN), Gate::Deny(NOT_IN_VERSION));
    }

    // Step 5: features that are not ported.

    #[test]
    fn every_ported_method_is_allowed_signed_in() {
        assert!(!PORTED.is_empty());
        for method in PORTED {
            assert_eq!(gate(method, &SIGNED_IN), Gate::Allow, "{method}");
        }
    }

    #[test]
    fn every_not_ported_prefix_is_refused_with_the_fixed_message() {
        assert!(!NOT_PORTED_PREFIXES.is_empty());
        for prefix in NOT_PORTED_PREFIXES {
            for caller in &BOTH {
                assert_eq!(gate(&sample(prefix), caller), Gate::Deny(NOT_IN_VERSION), "{prefix} {caller:?}");
            }
        }
    }

    #[test]
    fn methods_the_current_ui_calls_for_unported_features_are_refused() {
        for method in [
            "computer.start", "native.computer.prepare", "screen.notes.capture", "privacy.start", "speech.start",
            "diarization.start", "record.start", "voice.start", "vnc.open", "vnc.credential.read", "music.spotify.status",
            "webview.open", "media.player.open", "media.windows.close", "controller.start", "live.ask", "window.detach",
            "window.display.status", "capture.start", "image.generate", "transcript.save", "agents.snapshot",
            "agents.terminal", "coven.send", "github.snapshot", "feeds.fetch", "reading.pdf",
        ] {
            for caller in &BOTH {
                assert_eq!(gate(method, caller), Gate::Deny(NOT_IN_VERSION), "{method} {caller:?}");
            }
        }
    }

    #[test]
    fn a_method_entry_does_not_swallow_longer_names() {
        // `window.detach` names one method; it is not a namespace.
        assert_eq!(gate("window.detach", &SIGNED_IN), Gate::Deny(NOT_IN_VERSION));
        assert_eq!(gate("window.detached", &SIGNED_IN), Gate::Deny(UNSUPPORTED));
        assert_eq!(gate("window.detach.now", &SIGNED_IN), Gate::Deny(UNSUPPORTED));
    }

    // Step 6: features the current operating system cannot do.

    #[test]
    fn a_method_this_operating_system_cannot_do_is_refused() {
        let policy = Policy { not_on_this_os: &["terminal.open"], ..Policy::RELEASE };
        for caller in &BOTH {
            assert_eq!(policy.gate("terminal.open", caller), Gate::Deny(NOT_ON_OS), "{caller:?}");
        }
        assert_eq!(policy.gate("terminal.close", &SIGNED_IN), Gate::Allow);
    }

    #[test]
    fn the_not_ported_list_is_checked_before_the_operating_system_list() {
        let policy = Policy { not_on_this_os: &["vnc.open"], ..Policy::RELEASE };
        assert_eq!(policy.gate("vnc.open", &SIGNED_IN), Gate::Deny(NOT_IN_VERSION));
    }

    // Step 7: unknown methods.

    #[test]
    fn unknown_methods_are_refused() {
        for method in ["nope.nothing", "", "terminal", "terminal.", "terminal.openx", "Terminal.open", "auth.status ", "auth", "system.information"] {
            for caller in &BOTH {
                assert_eq!(gate(method, caller), Gate::Deny(UNSUPPORTED), "{method:?} {caller:?}");
            }
        }
    }

    // The lists themselves.

    #[test]
    fn the_release_lists_do_not_contradict_each_other() {
        for (index, method) in PORTED.iter().enumerate() {
            assert!(!PORTED[..index].contains(method), "duplicate ported method {method}");
            assert!(!NOT_PORTED_PREFIXES.iter().any(|prefix| not_ported(prefix, method)), "{method} is ported and not ported");
        }
        for (index, prefix) in NOT_PORTED_PREFIXES.iter().enumerate() {
            assert!(!NOT_PORTED_PREFIXES[..index].contains(prefix), "duplicate not-ported entry {prefix}");
        }
        for method in SIGN_IN_METHODS.iter().chain(["system.info"].iter()) {
            assert!(PORTED.contains(method), "{method} must be ported");
        }
        for method in ACCOUNT_BACKED.iter().chain(NOT_ON_THIS_OS.iter()) {
            assert!(PORTED.contains(method), "{method} must be a ported method");
        }
    }

    #[test]
    fn the_messages_are_the_fixed_strings() {
        assert_eq!(SIGN_IN_REQUIRED, "Sign in to Open Sesame before using this tool.");
        assert_eq!(NOT_IN_VERSION, "This feature is not available in this version of Open Sesame.");
        assert_eq!(NOT_ON_OS, "This feature is not available on this operating system.");
        assert_eq!(UNSUPPORTED, "Unsupported desktop action.");
    }

    #[test]
    fn platform_uses_the_names_the_ui_already_knows() {
        let expected = if cfg!(target_os = "macos") { "darwin" } else if cfg!(windows) { "win32" } else { "linux" };
        assert_eq!(platform(), expected);
    }

    // Dispatch: the gate decides before any feature code runs.

    #[test]
    fn a_not_ported_request_runs_nothing_and_returns_the_fixed_message() {
        for prefix in NOT_PORTED_PREFIXES {
            for caller in &BOTH {
                let ran = Cell::new(false);
                let reply = dispatch(&request(&sample(prefix)), caller, |_| { ran.set(true); Ok(Value::Null) });
                assert!(!ran.get(), "{prefix} ran feature code");
                assert_eq!(reply, Some(Reply::err("r1", NOT_IN_VERSION)), "{prefix}");
            }
        }
    }

    #[test]
    fn an_unknown_request_runs_nothing() {
        let ran = Cell::new(false);
        let reply = dispatch(&request("nope.nothing"), &SIGNED_IN, |_| { ran.set(true); Ok(Value::Null) });
        assert!(!ran.get());
        assert_eq!(reply, Some(Reply::err("r1", UNSUPPORTED)));
    }

    #[test]
    fn a_request_from_another_window_runs_nothing_and_gets_no_reply() {
        let ran = Cell::new(false);
        let caller = Caller { window: "settings", authenticated: true };
        assert_eq!(dispatch(&request("terminal.open"), &caller, |_| { ran.set(true); Ok(Value::Null) }), None);
        assert!(!ran.get());
    }

    #[test]
    fn signed_out_system_info_replies_without_running_the_handler() {
        let ran = Cell::new(false);
        let reply = dispatch(&request("system.info"), &SIGNED_OUT, |_| { ran.set(true); Ok(Value::Null) });
        assert!(!ran.get());
        assert_eq!(reply, Some(Reply::ok("r1", json!({"platform": platform(), "authenticated": false}))));
    }

    #[test]
    fn an_allowed_request_runs_its_handler_once_and_wraps_the_outcome() {
        let runs = Cell::new(0);
        let reply = dispatch(&request("terminal.open"), &SIGNED_OUT, |request| {
            runs.set(runs.get() + 1);
            Ok(json!({"method": request.method}))
        });
        assert_eq!(runs.get(), 1);
        assert_eq!(reply, Some(Reply::ok("r1", json!({"method": "terminal.open"}))));
        let failed = dispatch(&request("terminal.open"), &SIGNED_IN, |_| Err(BridgeError::from("No shell is available.")));
        assert_eq!(failed, Some(Reply::err("r1", "No shell is available.")));
    }
}
