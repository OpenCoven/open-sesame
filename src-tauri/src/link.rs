//! Links the system hands to the application (issues #72 and #116): the sign-in callback and
//! the address that says the remote session ended.
//!
//! No link travels as an event. The deep-link plugin announces each link it receives as a
//! `deep-link://new-url` event, Tauri sends an event to every page listener as well as to Rust,
//! and the main window may listen for events because host messages reach it that way; Tauri
//! cannot narrow that permission to some event names. A script in the page could then read a
//! callback's code and `state`. So:
//!
//! - On Windows and Linux a link starts a second process with the link as its only argument.
//!   The single-instance plugin, built without its deep-link feature, hands the arguments to
//!   the running application, and [`handed_over`] takes the link out of them.
//! - On macOS the system hands the running application a `RunEvent::Opened`, which [`opened`]
//!   takes. The deep-link plugin is not registered there, because it announces that event too.
//! - The plugin is registered only in a development build on Windows and Linux, to register the
//!   scheme ([`register`]). There it announces a link only while it starts, before any page
//!   exists, and nothing listens for it.
//!
//! A launch that carries only a link, and that the single-instance plugin did not hand to a
//! running application, exits before it creates a window ([`only_a_link`]). The sign-in the
//! link belongs to waits in another process or in none: when no application is running, or on
//! a Linux session with no D-Bus session bus, where the plugin cannot find the running one.

use crate::auth::{Auth, Link};
use crate::window;
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime, Url};

/// The scheme named in `tauri.conf.json`.
pub const SCHEME: &str = "opensesame";

/// The link in a process's arguments, the program name included. It is the deep-link plugin's
/// rule: exactly one argument after the program name, an address on the scheme.
pub fn argument<S: AsRef<str>>(arguments: &[S]) -> Option<Url> {
    match arguments {
        [_, only] => Url::parse(only.as_ref())
            .ok()
            .filter(|url| url.scheme() == SCHEME),
        _ => None,
    }
}

/// Whether a launch carries only a link, and so has nothing to show.
pub fn only_a_link<S: AsRef<str>>(arguments: &[S]) -> bool {
    argument(arguments).is_some()
}

/// A second launch: the second process has exited and its arguments arrive here. Returns
/// whether they were a link, which is then all the launch asked for.
pub fn handed_over<R: Runtime>(app: &AppHandle<R>, arguments: &[String]) -> bool {
    match argument(arguments) {
        Some(url) => {
            deliver(app, url.as_str());
            true
        }
        None => false,
    }
}

/// The addresses the system opened with the application on macOS. A file is not a link.
#[cfg(target_os = "macos")]
pub fn opened<R: Runtime>(app: &AppHandle<R>, urls: Vec<Url>) {
    for url in urls.iter().filter(|url| url.scheme() == SCHEME) {
        deliver(app, url.as_str());
    }
}

/// In a development build on Windows and Linux nothing has installed the scheme, so it is
/// registered here, for the current user, and stays registered after the run ends. A failure
/// only means callbacks will not arrive.
#[cfg(all(debug_assertions, any(windows, target_os = "linux")))]
pub fn register<R: Runtime>(app: &AppHandle<R>) {
    use tauri_plugin_deep_link::DeepLinkExt;
    let _ = app.deep_link().register_all();
}

/// Gives a link to sign-in, and brings the window forward when the browser comes back, since on
/// macOS no second launch does that. The core checks a callback against the pending `state`.
fn deliver<R: Runtime>(app: &AppHandle<R>, url: &str) {
    let Some(auth) = app.try_state::<Arc<Auth>>() else {
        return;
    };
    let kind = auth.link(url);
    // Only what kind of address it was; the address itself carries the code.
    #[cfg(debug_assertions)]
    eprintln!("open-sesame: link {kind:?}");
    if kind != Link::Other {
        window::show(app);
    }
}

/// Ends a launch that carries only a link, before it has a window. Called from setup.
pub fn exit_without_window<R: Runtime>(app: &AppHandle<R>) {
    // Development evidence for the launched-application checks; the link is not printed.
    #[cfg(debug_assertions)]
    eprintln!("open-sesame: a launch with only a link exits");
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{Browser, Marker};
    use open_sesame_core::auth::{AuthError, CredentialStore, Jwks, Tokens, WorkosApi};
    use serde_json::{json, Value};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc::{channel, Receiver, Sender};
    use std::sync::Mutex;
    use std::time::Duration;
    use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};
    use tauri::{Listener, Manager};

    /// A WorkOS stand-in that records each code it is sent and answers none of them.
    struct Codes(Mutex<Sender<String>>);
    impl WorkosApi for Codes {
        fn exchange_code(&self, code: &str, _verifier: &str) -> Result<Tokens, AuthError> {
            let _ = self.0.lock().unwrap().send(code.to_string());
            Err(AuthError::Network)
        }
        fn refresh(&self, _refresh_token: &str) -> Result<Tokens, AuthError> {
            Err(AuthError::Network)
        }
        fn jwks(&self) -> Result<Jwks, AuthError> {
            Err(AuthError::Network)
        }
    }

    struct Empty;
    impl CredentialStore for Empty {
        fn load(&self) -> Result<Option<String>, AuthError> {
            Ok(None)
        }
        fn save(&self, _refresh_token: &str) -> Result<(), AuthError> {
            Ok(())
        }
        fn delete(&self) -> Result<(), AuthError> {
            Ok(())
        }
    }

    struct Waiting {
        app: tauri::App<MockRuntime>,
        codes: Receiver<String>,
        /// How many times anything announced a link as the deep-link plugin's event. A page
        /// listener is sent exactly what a listener registered here is sent.
        announced: Arc<AtomicUsize>,
        callback: String,
    }

    /// An application whose sign-in is waiting in the browser, and the callback that ends it.
    fn waiting() -> Waiting {
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let (send, codes) = channel();
        let opened = Arc::new(Mutex::new(Vec::new()));
        let record = Arc::clone(&opened);
        let browser: Browser = Arc::new(move |url| {
            record.lock().unwrap().push(url.to_string());
            true
        });
        let (auth, _wakes) = Auth::new(
            Arc::new(Codes(Mutex::new(send))),
            Arc::new(Empty),
            Arc::new(Marker::new(None)),
            browser,
            Arc::new(|| None),
        );
        assert_eq!(auth.handle("auth.signIn", || None), Ok(json!(true)));
        let state = opened.lock().unwrap()[0]
            .split(['?', '&'])
            .find_map(|pair| pair.strip_prefix("state="))
            .unwrap()
            .to_string();
        app.manage(auth);
        let announced = Arc::new(AtomicUsize::new(0));
        let count = Arc::clone(&announced);
        app.listen_any("deep-link://new-url", move |_| {
            count.fetch_add(1, Ordering::SeqCst);
        });
        Waiting {
            app,
            codes,
            announced,
            callback: format!("opensesame://auth/callback?code=the-code&state={state}"),
        }
    }

    #[test]
    fn a_link_from_a_second_launch_reaches_sign_in_and_is_never_announced() {
        let waiting = waiting();
        let arguments = vec!["/usr/bin/open-sesame".to_string(), waiting.callback.clone()];
        assert!(handed_over(waiting.app.handle(), &arguments));
        assert_eq!(
            waiting.codes.recv_timeout(Duration::from_secs(10)),
            Ok("the-code".to_string()),
            "the waiting sign-in sent the callback's code"
        );
        assert_eq!(waiting.announced.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn a_launch_that_is_not_only_a_link_is_left_to_summon() {
        let waiting = waiting();
        let callback = waiting.callback.as_str();
        for arguments in [
            vec!["open-sesame"],
            vec!["open-sesame", "--toggle"],
            vec!["open-sesame", callback, "--toggle"],
            vec!["open-sesame", "--toggle", callback],
        ] {
            let arguments: Vec<String> = arguments.into_iter().map(String::from).collect();
            assert!(
                !handed_over(waiting.app.handle(), &arguments),
                "{arguments:?}"
            );
        }
        assert!(
            waiting
                .codes
                .recv_timeout(Duration::from_millis(300))
                .is_err(),
            "no code was sent"
        );
        assert_eq!(waiting.announced.load(Ordering::SeqCst), 0);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_link_the_system_opens_on_macos_reaches_sign_in_and_is_never_announced() {
        let waiting = waiting();
        opened(
            waiting.app.handle(),
            vec![
                Url::parse("file:///tmp/notes.txt").unwrap(),
                Url::parse(&waiting.callback).unwrap(),
            ],
        );
        assert_eq!(
            waiting.codes.recv_timeout(Duration::from_secs(10)),
            Ok("the-code".to_string())
        );
        assert_eq!(waiting.announced.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn only_one_address_on_the_scheme_after_the_program_name_is_a_link() {
        for arguments in [
            ["open-sesame", "opensesame://auth/callback?code=x&state=y"],
            ["open-sesame", "opensesame://auth/signed-out"],
            ["open-sesame", "OPENSESAME://auth/callback?code=x"],
            ["open-sesame", "opensesame:anything"],
        ] {
            assert!(only_a_link(&arguments), "{arguments:?}");
        }
        let others: [&[&str]; 11] = [
            &[],
            &["opensesame://auth/callback?code=x"],
            &["open-sesame"],
            &["open-sesame", "--toggle"],
            &["open-sesame", ""],
            &["open-sesame", "opensesame"],
            &["open-sesame", "opensesame-spotify://auth/callback?code=x"],
            &[
                "open-sesame",
                "https://api.workos.com/user_management/authorize",
            ],
            &["open-sesame", "/tmp/opensesame://auth/callback"],
            &[
                "open-sesame",
                "opensesame://auth/callback?code=x",
                "--toggle",
            ],
            &[
                "open-sesame",
                "--toggle",
                "opensesame://auth/callback?code=x",
            ],
        ];
        for arguments in others {
            assert!(!only_a_link(arguments), "{arguments:?}");
        }
        // Passed on as the deep-link plugin passed it: parsed, so the scheme is in lower case.
        assert_eq!(
            argument(&["open-sesame", "OPENSESAME://auth/callback?code=x"]).map(String::from),
            Some("opensesame://auth/callback?code=x".to_string())
        );
    }

    #[test]
    fn the_scheme_is_the_one_the_configuration_registers() {
        let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(
            config["plugins"]["deep-link"]["desktop"]["schemes"],
            json!([SCHEME])
        );
    }
}
