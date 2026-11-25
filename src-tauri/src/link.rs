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
//! A launch that carries only one of sign-in's two links, and that the single-instance plugin
//! did not hand to a running application, exits before `setup` creates a window or opens
//! anything ([`only_a_link`]). The plugins' own setups have run by then: single-instance has
//! claimed the instance, and in a development build on Windows and Linux the deep-link plugin
//! has announced the link, with no page to hear it. The sign-in the link belongs to waits in
//! another process or in none: when no application is running, or on a Linux session with no
//! D-Bus session bus, where the plugin cannot find the running one.
//!
//! Any other address on the scheme is not sign-in's to take. The hosted login page's "Open
//! Open Sesame" is one (`opensesame://auth/login`): a launch with it is an ordinary launch,
//! and a second launch with it is left to summon, which shows the window. On macOS the system
//! hands it to the running application, which ignores it, as it did before this module.
//!
//! The address is taken as the parser returns it, not as it arrived. The parser puts the
//! scheme in lower case, drops spaces and control characters around the address and tabs and
//! line ends inside it, works out `.` and `..` in the path, and drops an empty user name and
//! an empty port. So `opensesame://auth/x/../callback` and `opensesame://@auth/callback` are
//! the callback too. The deep-link plugin did the same before this module, and the core's rule
//! that only the waiting `state` ends a sign-in does not depend on the spelling.

use crate::auth::{classify, Auth, Link};
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

/// The link in a process's arguments when it is one sign-in takes: the callback or the address
/// that says the remote session ended.
fn for_sign_in<S: AsRef<str>>(arguments: &[S]) -> Option<Url> {
    argument(arguments).filter(|url| classify(url.as_str()) != Link::Other)
}

/// Whether a launch carries only one of sign-in's two links, and so has nothing to show.
pub fn only_a_link<S: AsRef<str>>(arguments: &[S]) -> bool {
    for_sign_in(arguments).is_some()
}

/// A second launch: the second process has exited and its arguments arrive here. Returns
/// whether they were a link for sign-in, which is then all the launch asked for. Anything
/// else, another address on the scheme included, is left to the caller.
pub fn handed_over<R: Runtime>(app: &AppHandle<R>, arguments: &[String]) -> bool {
    match for_sign_in(arguments) {
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

/// Whether this run registered the scheme, so that only a run that did removes it.
#[cfg(all(debug_assertions, any(windows, target_os = "linux")))]
static REGISTERED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// In a development build on Windows and Linux nothing has installed the scheme, so it is
/// registered here, for the current user, and removed at a clean exit by [`unregister`]. A
/// failure only means callbacks will not arrive.
#[cfg(all(debug_assertions, any(windows, target_os = "linux")))]
pub fn register<R: Runtime>(app: &AppHandle<R>) {
    use tauri_plugin_deep_link::DeepLinkExt;
    // Set before, since a registration that fails partway may still have written something.
    REGISTERED.store(true, std::sync::atomic::Ordering::SeqCst);
    let _ = app.deep_link().register_all();
}

/// Removes, at a clean exit of a development build, the registration [`register`] made in this
/// run (issue #132, decided on 16 November 2026), so an installed build's callbacks do not go
/// to this binary after it has gone. A launch that only carried a link and ended before it
/// registered removes nothing, so a build that is still running keeps its registration. A
/// build that was killed leaves it, and `src-tauri/AGENTS.md` says how to remove it by hand.
#[cfg(all(debug_assertions, any(windows, target_os = "linux")))]
pub fn unregister<R: Runtime>(app: &AppHandle<R>) {
    if REGISTERED.swap(false, std::sync::atomic::Ordering::SeqCst) {
        remove_registration(app);
    }
}

#[cfg(all(debug_assertions, any(windows, target_os = "linux")))]
fn remove_registration<R: Runtime>(app: &AppHandle<R>) {
    // On Windows the plugin's own `unregister` also tries the all-users key an installer
    // writes, and stops with an error when it cannot remove it, so it is not used there.
    #[cfg(windows)]
    {
        let _ = app;
        let _ = remove_this_programs_key(SCHEME);
    }
    // On Linux it takes only this program's handler out of `mimeapps.list` and out of its own
    // handler file, and refreshes the desktop database when it changed something.
    #[cfg(target_os = "linux")]
    {
        use tauri_plugin_deep_link::DeepLinkExt;
        let _ = app.deep_link().unregister(SCHEME);
    }
}

/// [`remove_own_key`] for this executable, named as the deep-link plugin's `register` names it.
#[cfg(all(debug_assertions, windows))]
fn remove_this_programs_key(scheme: &str) -> windows_registry::Result<bool> {
    let Ok(exe) = tauri::utils::platform::current_exe() else {
        return Ok(false);
    };
    remove_own_key(scheme, dunce::simplified(&exe))
}

/// Deletes the current user's key for `scheme` when its command names `exe` as the deep-link
/// plugin writes it (`"<exe>" "%1"`), and never the all-users key. A key another program
/// wrote, such as one an installed build or another checkout's development build wrote after
/// this one, is left. Tauri's NSIS installer in its default per-user mode writes this same key,
/// which a development run's registration overwrites, so it goes too (issue #220). Returns
/// whether it deleted the key.
#[cfg(all(debug_assertions, windows))]
fn remove_own_key(scheme: &str, exe: &std::path::Path) -> windows_registry::Result<bool> {
    use windows_registry::CURRENT_USER;
    let base = format!("Software\\Classes\\{scheme}");
    let Ok(command) = CURRENT_USER.open(format!("{base}\\shell\\open\\command")) else {
        return Ok(false);
    };
    let ours = format!("\"{}\" \"%1\"", exe.display());
    // Windows file names are not case-sensitive.
    if !command
        .get_string("")
        .is_ok_and(|named| named.eq_ignore_ascii_case(&ours))
    {
        return Ok(false);
    }
    drop(command);
    CURRENT_USER.remove_tree(&base)?;
    Ok(true)
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
    if brings_the_window(kind) {
        window::show(app);
    }
}

/// Whether a link the application was handed brings its window forward: sign-in's two do, and
/// any other address on the scheme does not. On macOS that is the whole of what such an
/// address does to a running application.
fn brings_the_window(kind: Link) -> bool {
    kind != Link::Other
}

/// Ends a launch that carries only one of sign-in's links, before it has a window. Called
/// from setup.
pub fn exit_without_window<R: Runtime>(app: &AppHandle<R>) {
    // Development evidence for the launched-application checks; the link is not printed.
    #[cfg(debug_assertions)]
    eprintln!("open-sesame: a launch with only a sign-in link exits");
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
        /// How many times anything announced a link under the deep-link plugin's event name.
        /// A page listener is sent exactly what a listener registered here is sent. This
        /// application has no deep-link plugin, so the count shows only that taking a link
        /// announces nothing by itself; that the plugin is not registered where it would
        /// announce is held by check-tauri-sign-in.mjs, which reads lib.rs.
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
    fn a_link_from_a_second_launch_reaches_sign_in_and_announces_nothing_itself() {
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

    /// The hosted login page's "Open Open Sesame" is a link on the scheme that is not
    /// sign-in's (issue #116, review of #129). A second launch with it is left to summon,
    /// which shows the window. So is an address one character away from the callback.
    #[test]
    fn a_link_on_the_scheme_that_is_not_sign_ins_is_left_to_summon() {
        let waiting = waiting();
        for link in [
            "opensesame://auth/login",
            "opensesame://auth/login?code=the-code&state=x",
            "opensesame://auth/callback/?code=the-code&state=x",
            "opensesame://auth/signed-out/",
            "opensesame:anything",
        ] {
            let arguments = vec!["open-sesame".to_string(), link.to_string()];
            assert!(!handed_over(waiting.app.handle(), &arguments), "{link}");
        }
        // A launch that was not taken gave sign-in nothing, so no thread was started and
        // there is nothing to wait for.
        assert!(waiting.codes.try_recv().is_err(), "no code was sent");
    }

    /// Only sign-in's two links bring the window forward when the application is handed one;
    /// on macOS that is how the login page's address comes to be ignored.
    #[test]
    fn only_sign_ins_links_bring_the_window_forward() {
        assert!(brings_the_window(Link::Callback));
        assert!(brings_the_window(Link::SignedOut));
        assert!(!brings_the_window(Link::Other));
        assert_eq!(classify("opensesame://auth/login"), Link::Other);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_link_the_system_opens_on_macos_reaches_sign_in_and_announces_nothing_itself() {
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
    fn only_one_of_sign_ins_links_after_the_program_name_ends_a_launch() {
        for arguments in [
            ["open-sesame", "opensesame://auth/callback?code=x&state=y"],
            ["open-sesame", "opensesame://auth/callback"],
            ["open-sesame", "opensesame://auth/signed-out"],
            ["open-sesame", "OPENSESAME://auth/callback?code=x"],
            // Spellings the address parser turns into the callback before anything here sees
            // them. They are taken, as the deep-link plugin took them; the core's rule about
            // the waiting `state` is what a callback has to pass.
            ["open-sesame", "opensesame://auth/x/../callback?code=x"],
            ["open-sesame", "opensesame://@auth/callback?code=x"],
            ["open-sesame", "opensesame://auth:/callback?code=x"],
            ["open-sesame", " opensesame://auth/call\tback?code=x"],
        ] {
            assert!(only_a_link(&arguments), "{arguments:?}");
        }
        let others: [&[&str]; 19] = [
            &[],
            // On the scheme, and not sign-in's: the login page's "Open Open Sesame" among
            // them. Such a launch is an ordinary one.
            &["open-sesame", "opensesame://auth/login"],
            &["open-sesame", "opensesame://auth/login?next=x"],
            &["open-sesame", "opensesame://auth/callbacks"],
            &["open-sesame", "opensesame://auth/callback/"],
            &["open-sesame", "opensesame://auth/callback/?code=x&state=y"],
            &["open-sesame", "opensesame://auth/signed-out/"],
            &["open-sesame", "opensesame://AUTH/callback?code=x"],
            &["open-sesame", "opensesame:anything"],
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

    /// The scheme a test registers, so it never touches the real one.
    #[cfg(windows)]
    fn test_scheme(what: &str) -> String {
        format!("opensesame-test-{}-{what}", std::process::id())
    }

    /// Removes the test keys it names when it goes, so a failed assertion leaves none behind.
    #[cfg(windows)]
    struct TestKeys(Vec<String>);
    #[cfg(windows)]
    impl Drop for TestKeys {
        fn drop(&mut self) {
            for scheme in &self.0 {
                let _ = windows_registry::CURRENT_USER
                    .remove_tree(format!("Software\\Classes\\{scheme}"));
            }
        }
    }

    /// On Windows only the current user's key is removed, and only when its command names this
    /// executable: a key the deep-link plugin's own `register` wrote for this test program goes,
    /// a key that names another program, such as an installed build's, is left, and a missing key
    /// is no error.
    #[cfg(windows)]
    #[test]
    fn a_clean_exit_removes_only_this_programs_key_on_windows() {
        use tauri_plugin_deep_link::DeepLinkExt;
        use windows_registry::CURRENT_USER;
        let (ours, theirs) = (test_scheme("ours"), test_scheme("theirs"));
        let _keys = TestKeys(vec![ours.clone(), theirs.clone()]);
        let app = mock_builder()
            .plugin(tauri_plugin_deep_link::init())
            .build(mock_context(noop_assets()))
            .unwrap();
        app.deep_link().register(&ours).unwrap();
        let base = format!("Software\\Classes\\{ours}");
        assert!(CURRENT_USER.open(&base).is_ok(), "the plugin wrote the key");
        assert!(remove_this_programs_key(&ours).unwrap());
        assert!(
            CURRENT_USER.open(&base).is_err(),
            "this program's key is gone"
        );
        let base = format!("Software\\Classes\\{theirs}");
        CURRENT_USER
            .create(format!("{base}\\shell\\open\\command"))
            .unwrap()
            .set_string("", r#""C:\Program Files\Open Sesame\open-sesame.exe" "%1""#)
            .unwrap();
        assert!(!remove_this_programs_key(&theirs).unwrap());
        assert!(
            CURRENT_USER.open(&base).is_ok(),
            "another program's key is left"
        );
        assert!(!remove_this_programs_key(&test_scheme("none")).unwrap());
    }

    /// On Linux the deep-link plugin's own `unregister` takes the handler its `register` wrote
    /// out of `mimeapps.list` and out of the handler file, and leaves every other line. It runs
    /// in a child test process with a cleared environment, so the folders it uses are set for it
    /// alone and `xdg-mime` takes its generic path.
    #[cfg(target_os = "linux")]
    #[test]
    fn a_clean_exit_removes_this_programs_handler_on_linux() {
        let home = tempfile::tempdir().unwrap();
        let (data, config) = (home.path().join("data"), home.path().join("config"));
        let exe = std::env::current_exe().unwrap();
        let handler = format!(
            "{}-handler.desktop",
            exe.file_name().unwrap().to_string_lossy()
        );
        std::fs::create_dir_all(data.join("applications")).unwrap();
        std::fs::create_dir_all(&config).unwrap();
        let desktop = data.join("applications").join(&handler);
        std::fs::write(
            &desktop,
            format!("[Desktop Entry]\nType=Application\nName=Open Sesame\nExec=\"{}\" %u\nMimeType=text/plain;\n", exe.display()),
        )
        .unwrap();
        let mimeapps = config.join("mimeapps.list");
        std::fs::write(
            &mimeapps,
            "[Default Applications]\nx-scheme-handler/https=firefox.desktop\n",
        )
        .unwrap();
        let status = std::process::Command::new(&exe)
            .args([
                "--exact",
                "link::tests::unregister_in_this_process",
                "--ignored",
                "--test-threads=1",
            ])
            .env_clear()
            .env("PATH", std::env::var_os("PATH").unwrap())
            .env("HOME", home.path())
            .env("XDG_DATA_HOME", &data)
            .env("XDG_CONFIG_HOME", &config)
            .status()
            .unwrap();
        assert!(status.success());
        let left = std::fs::read_to_string(&mimeapps).unwrap();
        assert!(!left.contains("x-scheme-handler/opensesame"), "{left}");
        assert!(
            left.contains("x-scheme-handler/https=firefox.desktop"),
            "{left}"
        );
        let file = std::fs::read_to_string(&desktop).unwrap();
        assert!(!file.contains("x-scheme-handler/opensesame"), "{file}");
        assert!(file.contains("text/plain"), "{file}");
    }

    /// Run only by the test above, in its own process.
    #[cfg(target_os = "linux")]
    #[test]
    #[ignore = "run by a_clean_exit_removes_this_programs_handler_on_linux in its own process"]
    fn unregister_in_this_process() {
        use tauri_plugin_deep_link::DeepLinkExt;
        let app = mock_builder()
            .plugin(tauri_plugin_deep_link::init())
            .build(mock_context(noop_assets()))
            .unwrap();
        let mimeapps = std::env::var("XDG_CONFIG_HOME").unwrap() + "/mimeapps.list";
        let registered = || {
            std::fs::read_to_string(&mimeapps)
                .unwrap()
                .contains("x-scheme-handler/opensesame=")
        };
        // What a development build's start does, through the plugin itself.
        app.deep_link().register(SCHEME).unwrap();
        assert!(registered(), "the plugin registered the handler");
        // A run that did not register removes nothing.
        unregister(app.handle());
        assert!(registered(), "a run that did not register removed it");
        REGISTERED.store(true, std::sync::atomic::Ordering::SeqCst);
        unregister(app.handle());
    }
}
