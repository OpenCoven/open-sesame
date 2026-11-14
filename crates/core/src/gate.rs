//! The request gate: decides whether a request may run, before any feature code does.
//!
//! The order is fixed by issue #67:
//!
//! 1. Only the main window may make requests. Anything else is dropped without a reply.
//! 2. The sign-in methods are always allowed.
//! 3. `system.info` while signed out returns only the platform and `authenticated: false`.
//! 4. The session rule from issue #60: only account-backed methods need a signed-in session.
//!    Terminals, notes and other local features run signed out.
//! 5. A feature that is not ported returns [`NOT_IN_VERSION`].
//! 6. A ported method this operating system cannot do returns [`NOT_ON_OS`].
//! 7. Any other unknown method returns [`UNSUPPORTED`].
//!
//! A method is admitted by adding it to [`PORTED`] in the change that ports its handler, and by
//! removing its entry from [`NOT_PORTED_PREFIXES`] when that entry would still match it.

use crate::protocol::{BridgeResult, Reply, Request};
use serde_json::json;

pub const SIGN_IN_REQUIRED: &str = "Sign in to Open Sesame before using this tool.";
pub const NOT_IN_VERSION: &str = "This feature is not available in this version of Open Sesame.";
pub const NOT_ON_OS: &str = "This feature is not available on this operating system.";
pub const UNSUPPORTED: &str = "Unsupported desktop action.";

/// The label of the only window whose requests are served.
pub const MAIN_WINDOW: &str = "main";

const SIGN_IN_METHODS: &[&str] = &["auth.status", "auth.signIn", "auth.cancel", "auth.signOut"];
const SYSTEM_INFO: &str = "system.info";

/// Every method the walking skeleton serves (milestone "Desktop 1").
pub const PORTED: &[&str] = &[
    // Sign-in (#69, #72).
    "auth.status",
    "auth.signIn",
    "auth.cancel",
    "auth.signOut",
    // Shell and window (#70).
    "system.info",
    "window.size",
    "window.focus",
    "window.fullscreen",
    "window.keepOpen",
    // Terminals, SSH, clipboard and folder picker (#74).
    "terminal.open",
    "terminal.input",
    "terminal.resize",
    "terminal.close",
    "terminal.clipboard.read",
    "terminal.clipboard.write",
    "project.chooseFolder",
    "project.reveal",
    // Local storage (#75): the typed commands in storage::commands.
    "items.list",
    "items.get",
    "items.save",
    "items.delete",
    "projects.list",
    "projects.save",
    "projects.delete",
    "feedItems.list",
    "feedItems.get",
    "feedItems.save",
    "feedItems.delete",
    "settings.all",
    "settings.set",
    "settings.delete",
    "settings.cliPaths.list",
    "settings.cliPaths.set",
    "widgets.list",
    "widgets.set",
];

/// Features that are not in this version. An entry ending in `.` names a namespace and matches
/// every method under it; any other entry names exactly one method.
pub const NOT_PORTED_PREFIXES: &[&str] = &[
    // Planned for a later milestone. The issue that ports the feature moves its methods to
    // PORTED: agents (#79), feeds and reader (#82), GitHub monitor (#83), Coven Familiars (#84),
    // local transcription (#85).
    "agents.",
    "feeds.",
    "reading.",
    "github.",
    "coven.",
    "transcript.",
    // Out of scope for the restart (epic #58).
    "computer.",
    "native.",
    "screen.notes.",
    "privacy.",
    "speech.",
    "diarization.",
    "record.",
    "voice.",
    "vnc.",
    "music.",
    "webview.",
    "media.player.",
    "media.windows.",
    "controller.",
    "live.",
    "image.",
    "capture.",
    "window.detach",
    "window.display.",
];

/// Ported methods that need a signed-in session (issue #60, Option B). Nothing in the first
/// release is account-backed, so every ported method runs signed out.
pub const ACCOUNT_BACKED: &[&str] = &[];

/// Ported methods the operating system this build targets cannot do. Empty on every system today;
/// a per-system entry belongs behind a `cfg` attribute here.
pub const NOT_ON_THIS_OS: &[&str] = &[];

/// The platform name the UI already uses.
pub fn platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(windows) {
        "win32"
    } else {
        "linux"
    }
}

/// Who is asking: the window the request came from and whether a session is verified.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Caller<'a> {
    pub window: &'a str,
    pub authenticated: bool,
}

/// The gate's decision for one request.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Gate {
    /// Run the method's handler.
    Allow,
    /// Reply with the limited signed-out `system.info`, without running a handler.
    SignedOutInfo,
    /// Reply with this fixed message, without running a handler.
    Deny(&'static str),
    /// Not from the main window: run nothing and send no reply.
    Drop,
}

/// The lists the gate decides from. [`Policy::RELEASE`] is the shipped policy; tests build others
/// to exercise rules whose shipped lists are empty.
#[derive(Clone, Copy, Debug)]
pub struct Policy {
    pub ported: &'static [&'static str],
    pub not_ported_prefixes: &'static [&'static str],
    pub account_backed: &'static [&'static str],
    pub not_on_this_os: &'static [&'static str],
}

impl Policy {
    pub const RELEASE: Policy = Policy {
        ported: PORTED,
        not_ported_prefixes: NOT_PORTED_PREFIXES,
        account_backed: ACCOUNT_BACKED,
        not_on_this_os: NOT_ON_THIS_OS,
    };

    pub fn gate(&self, method: &str, caller: &Caller) -> Gate {
        if caller.window != MAIN_WINDOW {
            return Gate::Drop;
        }
        if SIGN_IN_METHODS.contains(&method) {
            return Gate::Allow;
        }
        if method == SYSTEM_INFO && !caller.authenticated {
            return Gate::SignedOutInfo;
        }
        if !caller.authenticated && self.account_backed.contains(&method) {
            return Gate::Deny(SIGN_IN_REQUIRED);
        }
        if self.is_not_ported(method) {
            return Gate::Deny(NOT_IN_VERSION);
        }
        if self.not_on_this_os.contains(&method) {
            return Gate::Deny(NOT_ON_OS);
        }
        if self.ported.contains(&method) {
            return Gate::Allow;
        }
        Gate::Deny(UNSUPPORTED)
    }

    fn is_not_ported(&self, method: &str) -> bool {
        self.not_ported_prefixes
            .iter()
            .any(|entry| not_ported(entry, method))
    }
}

/// Whether `method` falls under one [`NOT_PORTED_PREFIXES`] entry.
fn not_ported(entry: &str, method: &str) -> bool {
    if entry.ends_with('.') {
        method.starts_with(entry)
    } else {
        method == entry
    }
}

/// The shipped gate decision for `method`.
pub fn gate(method: &str, caller: &Caller) -> Gate {
    Policy::RELEASE.gate(method, caller)
}

/// Applies the gate to `request` and runs `handler` only when the gate allows it. Returns `None`
/// when the request is dropped, so the caller sends nothing back.
pub fn dispatch<H>(request: &Request, caller: &Caller, handler: H) -> Option<Reply>
where
    H: FnOnce(&Request) -> BridgeResult,
{
    let id = request.request_id.as_str();
    match gate(&request.method, caller) {
        Gate::Drop => None,
        Gate::Deny(message) => Some(Reply::err(id, message)),
        Gate::SignedOutInfo => Some(Reply::ok(
            id,
            json!({"platform": platform(), "authenticated": false}),
        )),
        Gate::Allow => Some(Reply::from_result(id, handler(request))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{BridgeError, Reply, Request};
    use serde_json::{json, Value};
    use std::cell::Cell;

    const SIGNED_IN: Caller = Caller {
        window: MAIN_WINDOW,
        authenticated: true,
    };
    const SIGNED_OUT: Caller = Caller {
        window: MAIN_WINDOW,
        authenticated: false,
    };
    const BOTH: [Caller; 2] = [SIGNED_IN, SIGNED_OUT];
    const SIGN_IN_METHODS: [&str; 4] =
        ["auth.status", "auth.signIn", "auth.cancel", "auth.signOut"];

    /// One concrete method name for a not-ported entry: the entry itself when it names a method,
    /// or the entry plus a segment when it names a namespace.
    fn sample(prefix: &str) -> String {
        if prefix.ends_with('.') {
            format!("{prefix}probe")
        } else {
            prefix.to_string()
        }
    }

    fn request(method: &str) -> Request {
        serde_json::from_value(json!({"requestId": "r1", "method": method})).unwrap()
    }

    // Step 1: main window only.

    #[test]
    fn requests_from_any_other_window_are_dropped() {
        for window in ["", "settings", "Main", "main ", "main-2"] {
            for authenticated in [true, false] {
                let caller = Caller {
                    window,
                    authenticated,
                };
                for method in [
                    "auth.status",
                    "system.info",
                    "terminal.open",
                    "vnc.open",
                    "nope.nothing",
                ] {
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

    #[test]
    fn sign_in_methods_are_allowed_whatever_the_other_lists_say() {
        // Sign-in must stay reachable even if a later edit lists these methods elsewhere.
        let policy = Policy {
            ported: &[],
            not_ported_prefixes: &["auth."],
            account_backed: &SIGN_IN_METHODS,
            not_on_this_os: &SIGN_IN_METHODS,
        };
        for caller in &BOTH {
            for method in SIGN_IN_METHODS {
                assert_eq!(
                    policy.gate(method, caller),
                    Gate::Allow,
                    "{method} {caller:?}"
                );
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
            assert_ne!(
                gate(method, &SIGNED_OUT),
                Gate::Deny(SIGN_IN_REQUIRED),
                "{method}"
            );
        }
    }

    #[test]
    fn an_account_backed_method_needs_a_session() {
        let policy = Policy {
            ported: &["sync.push", "terminal.open"],
            account_backed: &["sync.push"],
            ..Policy::RELEASE
        };
        assert_eq!(
            policy.gate("sync.push", &SIGNED_OUT),
            Gate::Deny(SIGN_IN_REQUIRED)
        );
        assert_eq!(policy.gate("sync.push", &SIGNED_IN), Gate::Allow);
        assert_eq!(policy.gate("terminal.open", &SIGNED_OUT), Gate::Allow);
    }

    #[test]
    fn the_session_rule_is_checked_before_the_not_ported_list() {
        let policy = Policy {
            account_backed: &["music.spotify.library"],
            ..Policy::RELEASE
        };
        assert_eq!(
            policy.gate("music.spotify.library", &SIGNED_OUT),
            Gate::Deny(SIGN_IN_REQUIRED)
        );
        assert_eq!(
            policy.gate("music.spotify.library", &SIGNED_IN),
            Gate::Deny(NOT_IN_VERSION)
        );
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
                assert_eq!(
                    gate(&sample(prefix), caller),
                    Gate::Deny(NOT_IN_VERSION),
                    "{prefix} {caller:?}"
                );
            }
        }
    }

    #[test]
    fn methods_the_current_ui_calls_for_unported_features_are_refused() {
        for method in [
            "computer.start",
            "native.computer.prepare",
            "screen.notes.capture",
            "privacy.start",
            "speech.start",
            "diarization.start",
            "record.start",
            "voice.start",
            "vnc.open",
            "vnc.credential.read",
            "music.spotify.status",
            "webview.open",
            "media.player.open",
            "media.windows.close",
            "controller.start",
            "live.ask",
            "window.detach",
            "window.display.status",
            "capture.start",
            "image.generate",
            "transcript.save",
            "agents.snapshot",
            "agents.terminal",
            "coven.send",
            "github.snapshot",
            "feeds.fetch",
            "reading.pdf",
        ] {
            for caller in &BOTH {
                assert_eq!(
                    gate(method, caller),
                    Gate::Deny(NOT_IN_VERSION),
                    "{method} {caller:?}"
                );
            }
        }
    }

    #[test]
    fn a_method_entry_does_not_swallow_longer_names() {
        // `window.detach` names one method; it is not a namespace.
        assert_eq!(
            gate("window.detach", &SIGNED_IN),
            Gate::Deny(NOT_IN_VERSION)
        );
        assert_eq!(gate("window.detached", &SIGNED_IN), Gate::Deny(UNSUPPORTED));
        assert_eq!(
            gate("window.detach.now", &SIGNED_IN),
            Gate::Deny(UNSUPPORTED)
        );
    }

    // Step 6: features the current operating system cannot do.

    #[test]
    fn a_method_this_operating_system_cannot_do_is_refused() {
        let policy = Policy {
            not_on_this_os: &["terminal.open"],
            ..Policy::RELEASE
        };
        for caller in &BOTH {
            assert_eq!(
                policy.gate("terminal.open", caller),
                Gate::Deny(NOT_ON_OS),
                "{caller:?}"
            );
        }
        assert_eq!(policy.gate("terminal.close", &SIGNED_IN), Gate::Allow);
    }

    #[test]
    fn the_not_ported_list_is_checked_before_the_operating_system_list() {
        let policy = Policy {
            not_on_this_os: &["vnc.open"],
            ..Policy::RELEASE
        };
        assert_eq!(
            policy.gate("vnc.open", &SIGNED_IN),
            Gate::Deny(NOT_IN_VERSION)
        );
    }

    // Step 7: unknown methods.

    #[test]
    fn unknown_methods_are_refused() {
        for method in [
            "nope.nothing",
            "",
            "terminal",
            "terminal.",
            "terminal.openx",
            "Terminal.open",
            "auth.status ",
            "auth",
            "system.information",
        ] {
            for caller in &BOTH {
                assert_eq!(
                    gate(method, caller),
                    Gate::Deny(UNSUPPORTED),
                    "{method:?} {caller:?}"
                );
            }
        }
    }

    // The lists themselves.

    #[test]
    fn the_release_lists_do_not_contradict_each_other() {
        for (index, method) in PORTED.iter().enumerate() {
            assert!(
                !PORTED[..index].contains(method),
                "duplicate ported method {method}"
            );
            assert!(
                !NOT_PORTED_PREFIXES
                    .iter()
                    .any(|prefix| not_ported(prefix, method)),
                "{method} is ported and not ported"
            );
        }
        for (index, prefix) in NOT_PORTED_PREFIXES.iter().enumerate() {
            assert!(
                !NOT_PORTED_PREFIXES[..index].contains(prefix),
                "duplicate not-ported entry {prefix}"
            );
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
        assert_eq!(
            SIGN_IN_REQUIRED,
            "Sign in to Open Sesame before using this tool."
        );
        assert_eq!(
            NOT_IN_VERSION,
            "This feature is not available in this version of Open Sesame."
        );
        assert_eq!(
            NOT_ON_OS,
            "This feature is not available on this operating system."
        );
        assert_eq!(UNSUPPORTED, "Unsupported desktop action.");
    }

    #[test]
    fn platform_uses_the_names_the_ui_already_knows() {
        let expected = if cfg!(target_os = "macos") {
            "darwin"
        } else if cfg!(windows) {
            "win32"
        } else {
            "linux"
        };
        assert_eq!(platform(), expected);
    }

    // Dispatch: the gate decides before any feature code runs.

    #[test]
    fn a_not_ported_request_runs_nothing_and_returns_the_fixed_message() {
        for prefix in NOT_PORTED_PREFIXES {
            for caller in &BOTH {
                let ran = Cell::new(false);
                let reply = dispatch(&request(&sample(prefix)), caller, |_| {
                    ran.set(true);
                    Ok(Value::Null)
                });
                assert!(!ran.get(), "{prefix} ran feature code");
                assert_eq!(reply, Some(Reply::err("r1", NOT_IN_VERSION)), "{prefix}");
            }
        }
    }

    #[test]
    fn an_unknown_request_runs_nothing() {
        let ran = Cell::new(false);
        let reply = dispatch(&request("nope.nothing"), &SIGNED_IN, |_| {
            ran.set(true);
            Ok(Value::Null)
        });
        assert!(!ran.get());
        assert_eq!(reply, Some(Reply::err("r1", UNSUPPORTED)));
    }

    #[test]
    fn a_request_from_another_window_runs_nothing_and_gets_no_reply() {
        let ran = Cell::new(false);
        let caller = Caller {
            window: "settings",
            authenticated: true,
        };
        assert_eq!(
            dispatch(&request("terminal.open"), &caller, |_| {
                ran.set(true);
                Ok(Value::Null)
            }),
            None
        );
        assert!(!ran.get());
    }

    #[test]
    fn signed_out_system_info_replies_without_running_the_handler() {
        let ran = Cell::new(false);
        let reply = dispatch(&request("system.info"), &SIGNED_OUT, |_| {
            ran.set(true);
            Ok(Value::Null)
        });
        assert!(!ran.get());
        assert_eq!(
            reply,
            Some(Reply::ok(
                "r1",
                json!({"platform": platform(), "authenticated": false})
            ))
        );
    }

    #[test]
    fn an_allowed_request_runs_its_handler_once_and_wraps_the_outcome() {
        let runs = Cell::new(0);
        let reply = dispatch(&request("terminal.open"), &SIGNED_OUT, |request| {
            runs.set(runs.get() + 1);
            Ok(json!({"method": request.method}))
        });
        assert_eq!(runs.get(), 1);
        assert_eq!(
            reply,
            Some(Reply::ok("r1", json!({"method": "terminal.open"})))
        );
        let failed = dispatch(&request("terminal.open"), &SIGNED_IN, |_| {
            Err(BridgeError::from("No shell is available."))
        });
        assert_eq!(failed, Some(Reply::err("r1", "No shell is available.")));
    }
}
