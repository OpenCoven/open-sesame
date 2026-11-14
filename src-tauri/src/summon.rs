//! Summon: the ways to make the window appear from anywhere (issue #71).
//!
//! The baseline works on every system: the tray menu, launching the application again (the
//! second process hands its arguments to the running one and exits) and `open-sesame --toggle`.
//! On macOS, Windows and X11 a global shortcut is added. On Wayland an application cannot grab a
//! key, so the status names the command to bind to a desktop shortcut instead.
//!
//! The shortcut is a setting. Registering it can fail, because other launchers take the common
//! ones, and the failure is kept and reported instead of swallowed.
//!
//! The setting is not kept between launches yet. The code that reads and writes its file is
//! here and tested, but the folder Tauri derives for this application is still the installed
//! Swift app's (the bundle identifier, issue #87), and where the restart keeps its data is
//! issue #105's question. Until that is answered a release build keeps the setting in memory;
//! a development build keeps it in the folder named by `OPEN_SESAME_DEV_CONFIG_DIR`, if set.

use crate::window;
use open_sesame_core::gate::UNSUPPORTED;
use open_sesame_core::protocol::{BridgeError, BridgeResult};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// The summon methods this crate answers. Each is also listed in the gate's `PORTED`.
pub const METHODS: &[&str] = &[
    "summon.status",
    "summon.setShortcut",
    "summon.setHideOnBlur",
    "summon.hold",
];

/// The argument that shows the window if it is hidden and hides it if it is shown.
pub const TOGGLE_FLAG: &str = "--toggle";
/// What a person binds to a desktop shortcut where the application cannot grab a key.
pub const TOGGLE_COMMAND: &str = "open-sesame --toggle";
/// Not Alt+Space or Option+Space, which ChatGPT, Gemini, Raycast, Alfred and the shipped Swift
/// host all use, and not Control+Alt+Space or Control+Shift+Space, which other assistants and
/// password managers use on Windows.
pub const DEFAULT_SHORTCUT: &str = "Alt+Shift+Space";

pub const INVALID_SHORTCUT: &str =
    "That is not a shortcut Open Sesame can use. Hold at least one of Control, Alt, Shift or Command and press one more key, for example Alt+Shift+Space.";
pub const INVALID_REQUEST: &str = "Invalid summon request.";
pub const NOT_SAVED: &str = "Open Sesame could not save the shortcut setting.";
pub const WAYLAND: &str =
    "Global shortcuts are not available to applications in this Wayland session. Bind a desktop shortcut to the command: open-sesame --toggle";

#[cfg_attr(not(any(debug_assertions, test)), allow(dead_code))]
const SETTINGS_FILE: &str = "summon.json";

/// What a launch asks the running application to do with its window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Launch {
    /// A plain launch: bring the window forward.
    Show,
    /// `--toggle`: show it if hidden, hide it if shown.
    Toggle,
}

/// Reads a process's arguments, the program name included. Anything unknown is a plain launch;
/// a web address handed over by the system is another feature's business (sign-in, #72).
pub fn launch<S: AsRef<str>>(arguments: &[S]) -> Launch {
    if arguments
        .iter()
        .skip(1)
        .any(|argument| argument.as_ref() == TOGGLE_FLAG)
    {
        Launch::Toggle
    } else {
        Launch::Show
    }
}

/// The kind of desktop session, which decides what summon can do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Session {
    MacOs,
    Windows,
    X11,
    Wayland,
}

impl Session {
    pub fn name(self) -> &'static str {
        match self {
            Session::MacOs => "macos",
            Session::Windows => "windows",
            Session::X11 => "x11",
            Session::Wayland => "wayland",
        }
    }

    /// Whether an application can register a key with the system here.
    pub fn has_global_shortcuts(self) -> bool {
        self != Session::Wayland
    }
}

/// The session this process runs in.
pub fn session() -> Session {
    let variable = |name: &str| std::env::var(name).ok();
    session_from(
        std::env::consts::OS,
        variable("XDG_SESSION_TYPE").as_deref(),
        variable("WAYLAND_DISPLAY").as_deref(),
        variable("GDK_BACKEND").as_deref(),
    )
}

/// On Linux the session is Wayland when the desktop says so or offers a Wayland display, unless
/// the toolkit was told to use X11, in which case the window is an X11 window and X11 rules apply.
pub fn session_from(
    os: &str,
    session_type: Option<&str>,
    wayland_display: Option<&str>,
    gdk_backend: Option<&str>,
) -> Session {
    match os {
        "macos" => Session::MacOs,
        "windows" => Session::Windows,
        _ => {
            let forced_x11 = gdk_backend.is_some_and(|backend| backend.trim() == "x11");
            let wayland = session_type.is_some_and(|kind| kind.eq_ignore_ascii_case("wayland"))
                || wayland_display.is_some_and(|display| !display.is_empty());
            if wayland && !forced_x11 {
                Session::Wayland
            } else {
                Session::X11
            }
        }
    }
}

/// Parses a shortcut a person typed. It needs a modifier, so a bare key that every application
/// uses is never taken from them. An empty string is not a shortcut; it means "none".
pub fn parse_shortcut(text: &str) -> Result<Shortcut, BridgeError> {
    let invalid = || BridgeError::from(INVALID_SHORTCUT);
    let shortcut = Shortcut::from_str(text.trim()).map_err(|_| invalid())?;
    let needed = Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER | Modifiers::SHIFT;
    if !shortcut.mods.intersects(needed) {
        return Err(invalid());
    }
    Ok(shortcut)
}

/// The sentence shown when the system refuses a shortcut.
pub fn refused(shortcut: &str) -> String {
    format!("Open Sesame could not register {shortcut}. Another application may already use it. Choose a different shortcut.")
}

/// What is kept between launches.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Settings {
    /// The shortcut as the person wrote it, or empty for none.
    pub shortcut: String,
    /// Hide the window when it loses focus, as a launcher does. Off unless turned on.
    pub hide_on_blur: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            shortcut: DEFAULT_SHORTCUT.to_string(),
            hide_on_blur: false,
        }
    }
}

impl Settings {
    /// Reads the settings file. A missing or damaged file gives the defaults: a setting that
    /// cannot be read must not stop the application from starting.
    pub fn load(path: &Path) -> Settings {
        let defaults = Settings::default();
        let Ok(text) = std::fs::read_to_string(path) else {
            return defaults;
        };
        let Ok(Value::Object(saved)) = serde_json::from_str::<Value>(&text) else {
            return defaults;
        };
        let shortcut = match saved.get("shortcut") {
            Some(Value::String(shortcut))
                if shortcut.is_empty() || parse_shortcut(shortcut).is_ok() =>
            {
                shortcut.clone()
            }
            _ => defaults.shortcut,
        };
        let hide_on_blur = saved.get("hideOnBlur") == Some(&Value::Bool(true));
        Settings {
            shortcut,
            hide_on_blur,
        }
    }

    /// Writes the settings file through a temporary file, so a crash leaves the old one whole.
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(folder) = path.parent() {
            std::fs::create_dir_all(folder)?;
        }
        let text = json!({"shortcut": self.shortcut, "hideOnBlur": self.hide_on_blur}).to_string();
        let temporary = path.with_extension("json.tmp");
        std::fs::write(&temporary, text)?;
        std::fs::rename(&temporary, path)
    }
}

/// Whether losing focus should hide the window now. A native dialog, a browser sign-in and a
/// drag all take focus away on purpose; while any of them holds the window, and while the
/// person has pinned it, it stays.
pub fn hides_on_blur(enabled: bool, holds: usize, held_by_page: bool, pinned: bool) -> bool {
    enabled && holds == 0 && !held_by_page && !pinned
}

/// How long after the window hid on blur a press of the shortcut counts as the cause of it.
const BLUR_GRACE: Duration = Duration::from_millis(300);

/// Whether a press of the shortcut is the one that just hid the window. On X11 the press
/// itself takes the keyboard away from the focused window for a moment, so with hide-on-blur
/// on the window hides before the press is delivered; toggling then would show it again and
/// the shortcut could never hide the window. `since_blur_hide` is how long ago the window
/// last hid because it lost focus, if it has.
pub fn press_caused_the_blur(since_blur_hide: Option<Duration>) -> bool {
    since_blur_hide.is_some_and(|elapsed| elapsed < BLUR_GRACE)
}

/// Where a window of `size` goes so that it sits against a tray icon at `icon` (position and
/// size) without leaving the `area` of the screen it may use (position and size). The window is
/// centred on the icon, above it when the icon is in the lower half of the area and below it
/// otherwise. All values are physical pixels.
pub fn popover_position(
    icon: ((f64, f64), (f64, f64)),
    size: (f64, f64),
    area: ((f64, f64), (f64, f64)),
) -> (f64, f64) {
    const GAP: f64 = 8.0;
    let ((icon_x, icon_y), (icon_width, icon_height)) = icon;
    let ((area_x, area_y), (area_width, area_height)) = area;
    let (width, height) = size;
    let centred = icon_x + icon_width / 2.0 - width / 2.0;
    let x = centred.clamp(area_x, (area_x + area_width - width).max(area_x));
    let lower_half = icon_y + icon_height / 2.0 > area_y + area_height / 2.0;
    let wanted = if lower_half {
        icon_y - height - GAP
    } else {
        icon_y + icon_height + GAP
    };
    let y = wanted.clamp(area_y, (area_y + area_height - height).max(area_y));
    (x, y)
}

/// The outcome of the last attempt to register the shortcut.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct Registration {
    registered: bool,
    /// Why the shortcut is not registered, in a sentence for the person; empty when it is, or
    /// when there is none to register.
    message: String,
}

/// The summon state the application keeps.
pub struct Summon {
    session: Session,
    path: Option<PathBuf>,
    settings: Mutex<Settings>,
    registration: Mutex<Registration>,
    /// Features that have taken focus away on purpose: a native dialog, a browser sign-in.
    holds: Arc<AtomicUsize>,
    /// The page says a drag is in progress.
    held_by_page: AtomicBool,
    pinned: AtomicBool,
    /// When the window last hid because it lost focus.
    hid_on_blur: Mutex<Option<Instant>>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Keeps the window from hiding on blur until it is dropped. A feature takes one before it
/// opens a native dialog or sends the person to a browser, and may carry it across threads.
pub struct Hold(Arc<AtomicUsize>);

impl Drop for Hold {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

/// Suspends hide-on-blur for as long as the returned value lives. Nothing on this branch opens
/// a native dialog or a browser yet: the folder dialog (issue #74) and sign-in (issue #72) are
/// the callers, so outside the tests this is not called until one of them lands.
#[cfg_attr(not(test), allow(dead_code))]
pub fn hold<R: Runtime>(app: &AppHandle<R>) -> Option<Hold> {
    app.try_state::<Summon>().map(|summon| summon.hold())
}

impl Summon {
    /// `path` is the settings file, or `None` to keep nothing between launches.
    pub fn new(session: Session, path: Option<PathBuf>) -> Summon {
        let settings = path.as_deref().map(Settings::load).unwrap_or_default();
        Summon {
            session,
            path,
            settings: Mutex::new(settings),
            registration: Mutex::new(Registration::default()),
            holds: Arc::new(AtomicUsize::new(0)),
            held_by_page: AtomicBool::new(false),
            pinned: AtomicBool::new(false),
            hid_on_blur: Mutex::new(None),
        }
    }

    pub fn session(&self) -> Session {
        self.session
    }

    /// Suspends hide-on-blur for as long as the returned value lives.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn hold(&self) -> Hold {
        self.holds.fetch_add(1, Ordering::SeqCst);
        Hold(Arc::clone(&self.holds))
    }

    /// Records that the person pinned or unpinned the window (`window.keepOpen`).
    pub fn set_pinned(&self, pinned: bool) {
        self.pinned.store(pinned, Ordering::SeqCst);
    }

    /// Whether the window should hide now that it has lost focus.
    pub fn should_hide_on_blur(&self) -> bool {
        hides_on_blur(
            lock(&self.settings).hide_on_blur,
            self.holds.load(Ordering::SeqCst),
            self.held_by_page.load(Ordering::SeqCst),
            self.pinned.load(Ordering::SeqCst),
        )
    }

    fn status(&self) -> Value {
        let settings = lock(&self.settings).clone();
        let registration = lock(&self.registration).clone();
        json!({
            "session": self.session.name(),
            "shortcut": settings.shortcut,
            "defaultShortcut": DEFAULT_SHORTCUT,
            "registered": registration.registered,
            "message": registration.message,
            "toggleCommand": TOGGLE_COMMAND,
            "hideOnBlur": settings.hide_on_blur,
        })
    }

    fn save(&self, settings: &Settings) -> Result<(), BridgeError> {
        match &self.path {
            Some(path) => settings
                .save(path)
                .map_err(|_| BridgeError::from(NOT_SAVED)),
            None => Ok(()),
        }
    }

    /// Registers `text` with the system through `register` and records the outcome. An empty
    /// `text` registers nothing. On Wayland nothing is attempted.
    fn register_with(
        &self,
        text: &str,
        register: impl FnOnce(Shortcut) -> bool,
    ) -> Result<(), BridgeError> {
        let outcome = if text.is_empty() {
            Ok(Registration::default())
        } else if !self.session.has_global_shortcuts() {
            Ok(Registration {
                registered: false,
                message: WAYLAND.to_string(),
            })
        } else {
            let shortcut = parse_shortcut(text)?;
            if register(shortcut) {
                Ok(Registration {
                    registered: true,
                    message: String::new(),
                })
            } else {
                Err(refused(text))
            }
        };
        match outcome {
            Ok(registration) => {
                *lock(&self.registration) = registration;
                Ok(())
            }
            Err(message) => {
                *lock(&self.registration) = Registration {
                    registered: false,
                    message: message.clone(),
                };
                Err(BridgeError(message))
            }
        }
    }
}

/// The plugin that listens for the shortcut. Its handler toggles the window on a press; the
/// release that follows is ignored. The page is granted none of the plugin's own commands.
pub fn shortcut_plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                pressed(app);
            }
        })
        .build()
}

/// The settings file, or `None` to keep the setting in memory. See the note at the top.
fn settings_path() -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    if let Some(folder) = std::env::var_os("OPEN_SESAME_DEV_CONFIG_DIR") {
        return Some(PathBuf::from(folder).join(SETTINGS_FILE));
    }
    None
}

/// Reads the settings and registers the shortcut. A refusal is kept for `summon.status` and
/// printed; it never stops the application from starting.
pub fn start<R: Runtime>(app: &AppHandle<R>) {
    let path = settings_path();
    let summon = Summon::new(session(), path);
    let shortcut = lock(&summon.settings).shortcut.clone();
    if let Err(error) = summon.register_with(&shortcut, |shortcut| register(app, shortcut)) {
        eprintln!("open-sesame: {}", error.0);
    }
    // Development evidence of what the system answered; the page shows the same to a person.
    #[cfg(debug_assertions)]
    eprintln!("open-sesame: summon {}", summon.status());
    app.manage(summon);
}

/// Whether the shortcut plugin is running. It is absent only under test.
fn listening<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.try_state::<tauri_plugin_global_shortcut::GlobalShortcut<R>>()
        .is_some()
}

fn register<R: Runtime>(app: &AppHandle<R>, shortcut: Shortcut) -> bool {
    listening(app) && app.global_shortcut().register(shortcut).is_ok()
}

fn unregister<R: Runtime>(app: &AppHandle<R>, text: &str) {
    if let (true, Ok(shortcut)) = (listening(app), parse_shortcut(text)) {
        let _ = app.global_shortcut().unregister(shortcut);
    }
}

/// What the running application does when it is launched again: the second process has already
/// exited, and its arguments arrive here.
pub fn launched_again<R: Runtime>(app: &AppHandle<R>, arguments: &[String]) {
    match launch(arguments) {
        Launch::Toggle => window::toggle(app),
        Launch::Show => window::show(app),
    }
}

/// The shortcut was pressed: toggle the window, unless this press is what just hid it.
fn pressed<R: Runtime>(app: &AppHandle<R>) {
    let since_blur_hide = app
        .try_state::<Summon>()
        .and_then(|summon| lock(&summon.hid_on_blur).take())
        .map(|at| at.elapsed());
    if !press_caused_the_blur(since_blur_hide) {
        window::toggle(app);
    }
}

/// The window lost focus.
pub fn blurred<R: Runtime>(app: &AppHandle<R>) {
    let Some(summon) = app.try_state::<Summon>() else {
        return;
    };
    if summon.should_hide_on_blur() {
        *lock(&summon.hid_on_blur) = Some(Instant::now());
        window::hide(app);
        #[cfg(debug_assertions)]
        eprintln!("open-sesame: hidden because the window lost focus");
    }
}

/// Answers a summon method the gate has allowed.
pub fn handle<R: Runtime>(
    app: &AppHandle<R>,
    method: &str,
    params: &Map<String, Value>,
) -> BridgeResult {
    let summon = app
        .try_state::<Summon>()
        .ok_or_else(|| BridgeError::from(UNSUPPORTED))?;
    let invalid = || BridgeError::from(INVALID_REQUEST);
    match method {
        "summon.status" => Ok(summon.status()),
        "summon.setShortcut" => {
            let wanted = match params.get("shortcut") {
                Some(Value::String(text)) => text.trim().to_string(),
                _ => return Err(invalid()),
            };
            // Refuse a shortcut that cannot be one before the working one is given up.
            if !wanted.is_empty() {
                parse_shortcut(&wanted)?;
            }
            let previous = lock(&summon.settings).clone();
            if summon.session.has_global_shortcuts() {
                unregister(app, &previous.shortcut);
            }
            if let Err(error) = summon.register_with(&wanted, |shortcut| register(app, shortcut)) {
                // Put the old one back, so a refused change does not leave the person with none.
                let _ =
                    summon.register_with(&previous.shortcut, |shortcut| register(app, shortcut));
                return Err(error);
            }
            let settings = Settings {
                shortcut: wanted,
                ..previous
            };
            summon.save(&settings)?;
            *lock(&summon.settings) = settings;
            Ok(summon.status())
        }
        "summon.setHideOnBlur" => {
            let Some(Value::Bool(enabled)) = params.get("enabled") else {
                return Err(invalid());
            };
            let settings = Settings {
                hide_on_blur: *enabled,
                ..lock(&summon.settings).clone()
            };
            summon.save(&settings)?;
            *lock(&summon.settings) = settings;
            Ok(summon.status())
        }
        "summon.hold" => {
            let Some(Value::Bool(held)) = params.get("held") else {
                return Err(invalid());
            };
            summon.held_by_page.store(*held, Ordering::SeqCst);
            Ok(json!({"held": held}))
        }
        _ => Err(BridgeError::from(UNSUPPORTED)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_toggle_argument_toggles() {
        assert_eq!(launch(&["open-sesame"]), Launch::Show);
        assert_eq!(launch(&["open-sesame", "--toggle"]), Launch::Toggle);
        assert_eq!(
            launch(&["open-sesame", "--other", "--toggle"]),
            Launch::Toggle
        );
        // The program's own name is not an argument, whatever it is called.
        assert_eq!(launch(&["--toggle"]), Launch::Show);
        assert_eq!(launch(&["open-sesame", "--toggle=1"]), Launch::Show);
        assert_eq!(launch(&["open-sesame", "toggle"]), Launch::Show);
        assert_eq!(launch::<&str>(&[]), Launch::Show);
    }

    #[test]
    fn the_session_decides_whether_a_key_can_be_grabbed() {
        assert_eq!(session_from("macos", None, None, None), Session::MacOs);
        assert_eq!(session_from("windows", None, None, None), Session::Windows);
        assert_eq!(session_from("linux", Some("x11"), None, None), Session::X11);
        assert_eq!(session_from("linux", None, None, None), Session::X11);
        assert_eq!(
            session_from("linux", Some("wayland"), None, None),
            Session::Wayland
        );
        assert_eq!(
            session_from("linux", Some("Wayland"), None, None),
            Session::Wayland
        );
        assert_eq!(
            session_from("linux", None, Some("wayland-0"), None),
            Session::Wayland
        );
        assert_eq!(
            session_from("linux", Some("tty"), Some(""), None),
            Session::X11
        );
        // The toolkit was told to use X11, so the window is an X11 window.
        assert_eq!(
            session_from("linux", Some("wayland"), Some("wayland-0"), Some("x11")),
            Session::X11
        );
        // A Wayland variable on another system means nothing.
        assert_eq!(
            session_from("macos", Some("wayland"), Some("wayland-0"), None),
            Session::MacOs
        );
        assert!(Session::X11.has_global_shortcuts());
        assert!(Session::MacOs.has_global_shortcuts());
        assert!(Session::Windows.has_global_shortcuts());
        assert!(!Session::Wayland.has_global_shortcuts());
    }

    #[test]
    fn a_shortcut_needs_a_modifier_and_a_key() {
        for good in [
            DEFAULT_SHORTCUT,
            "Control+Alt+K",
            "super+shift+o",
            " Alt+F1 ",
            "CmdOrCtrl+Shift+Space",
        ] {
            assert!(parse_shortcut(good).is_ok(), "{good}");
        }
        for bad in [
            "",
            "Space",
            "K",
            "F5",
            "Alt",
            "Alt+Shift",
            "Alt+Nothing",
            "Alt++K",
            "Alt+K+L",
        ] {
            assert_eq!(
                parse_shortcut(bad).unwrap_err().0,
                INVALID_SHORTCUT,
                "{bad}"
            );
        }
    }

    #[test]
    fn the_default_is_not_a_shortcut_other_launchers_take() {
        let default = parse_shortcut(DEFAULT_SHORTCUT).unwrap();
        for taken in [
            "Alt+Space",
            "Control+Alt+Space",
            "Control+Shift+Space",
            "Super+Space",
            "Control+Space",
        ] {
            assert_ne!(default, parse_shortcut(taken).unwrap(), "{taken}");
        }
    }

    #[test]
    fn settings_survive_a_round_trip_and_a_damaged_file() {
        let folder =
            std::env::temp_dir().join(format!("open-sesame-summon-{}", std::process::id()));
        let path = folder.join("nested").join(SETTINGS_FILE);
        assert_eq!(Settings::load(&path), Settings::default());
        let saved = Settings {
            shortcut: "Control+Alt+K".to_string(),
            hide_on_blur: true,
        };
        saved.save(&path).unwrap();
        assert_eq!(Settings::load(&path), saved);
        assert!(!path.with_extension("json.tmp").exists());
        // None is a choice and is kept.
        let none = Settings {
            shortcut: String::new(),
            hide_on_blur: false,
        };
        none.save(&path).unwrap();
        assert_eq!(Settings::load(&path), none);
        // A file that is not the expected shape, or holds a shortcut that cannot be one, gives
        // the defaults for what it got wrong and keeps the rest.
        for damaged in [
            "",
            "not json",
            "[]",
            r#"{"shortcut": 7}"#,
            r#"{"shortcut": "Space"}"#,
        ] {
            std::fs::write(&path, damaged).unwrap();
            assert_eq!(Settings::load(&path), Settings::default(), "{damaged}");
        }
        std::fs::write(&path, r#"{"shortcut": "Space", "hideOnBlur": true}"#).unwrap();
        assert_eq!(
            Settings::load(&path),
            Settings {
                shortcut: DEFAULT_SHORTCUT.to_string(),
                hide_on_blur: true
            }
        );
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn a_refused_shortcut_is_reported_and_remembered() {
        let summon = Summon::new(Session::X11, None);
        assert!(summon.register_with(DEFAULT_SHORTCUT, |_| true).is_ok());
        assert_eq!(summon.status()["registered"], json!(true));
        assert_eq!(summon.status()["message"], json!(""));

        let error = summon.register_with("Alt+Space", |_| false).unwrap_err();
        assert_eq!(
            error.0,
            "Open Sesame could not register Alt+Space. Another application may already use it. Choose a different shortcut."
        );
        assert_eq!(summon.status()["registered"], json!(false));
        assert_eq!(summon.status()["message"], json!(error.0));

        // None registers nothing and is not a failure.
        let mut asked = false;
        assert!(summon
            .register_with("", |_| {
                asked = true;
                true
            })
            .is_ok());
        assert!(!asked);
        assert_eq!(summon.status()["registered"], json!(false));
        assert_eq!(summon.status()["message"], json!(""));
    }

    #[test]
    fn wayland_never_tries_to_grab_a_key_and_names_the_command() {
        let summon = Summon::new(Session::Wayland, None);
        let mut asked = false;
        assert!(summon
            .register_with(DEFAULT_SHORTCUT, |_| {
                asked = true;
                true
            })
            .is_ok());
        assert!(!asked, "nothing is registered on Wayland");
        let status = summon.status();
        assert_eq!(status["session"], json!("wayland"));
        assert_eq!(status["registered"], json!(false));
        assert_eq!(status["message"], json!(WAYLAND));
        assert!(WAYLAND.ends_with(TOGGLE_COMMAND));
        assert_eq!(status["toggleCommand"], json!("open-sesame --toggle"));
    }

    #[test]
    fn blur_hides_only_when_asked_and_nothing_holds_the_window() {
        assert!(hides_on_blur(true, 0, false, false));
        assert!(
            !hides_on_blur(false, 0, false, false),
            "off unless turned on"
        );
        assert!(
            !hides_on_blur(true, 1, false, false),
            "a dialog or sign-in is open"
        );
        assert!(
            !hides_on_blur(true, 0, true, false),
            "a drag is in progress"
        );
        assert!(!hides_on_blur(true, 0, false, true), "the window is pinned");

        let summon = Summon::new(Session::MacOs, None);
        assert!(!summon.should_hide_on_blur());
        lock(&summon.settings).hide_on_blur = true;
        assert!(summon.should_hide_on_blur());
        {
            let _dialog = summon.hold();
            let _sign_in = summon.hold();
            assert!(!summon.should_hide_on_blur());
        }
        assert!(summon.should_hide_on_blur(), "the holds were released");
        summon.set_pinned(true);
        assert!(!summon.should_hide_on_blur());
        summon.set_pinned(false);
        summon.held_by_page.store(true, Ordering::SeqCst);
        assert!(!summon.should_hide_on_blur());
    }

    #[test]
    fn a_press_that_blurred_the_window_does_not_show_it_again() {
        // Found in a launched app on X11: with hide-on-blur on, the press took the keyboard,
        // the window hid, and the toggle that followed showed it again.
        assert!(press_caused_the_blur(Some(Duration::from_millis(0))));
        assert!(press_caused_the_blur(Some(Duration::from_millis(120))));
        assert!(!press_caused_the_blur(Some(Duration::from_millis(300))));
        assert!(!press_caused_the_blur(Some(Duration::from_secs(5))));
        assert!(
            !press_caused_the_blur(None),
            "the window did not hide on blur"
        );
    }

    #[test]
    fn the_popover_sits_against_the_tray_icon_and_stays_on_screen() {
        let area = ((0.0, 0.0), (1920.0, 1040.0));
        let size = (1090.0, 613.0);
        // Taskbar at the bottom: above the icon, centred on it, pulled in from the right edge.
        assert_eq!(
            popover_position(((1800.0, 1050.0), (24.0, 24.0)), size, area),
            (830.0, 427.0)
        );
        assert_eq!(
            popover_position(((900.0, 1050.0), (24.0, 24.0)), size, area),
            (367.0, 427.0)
        );
        // Menu bar at the top: below the icon.
        assert_eq!(
            popover_position(((1000.0, 0.0), (24.0, 24.0)), size, area),
            (467.0, 32.0)
        );
        // A second screen to the left of the first.
        let left = ((-1920.0, 0.0), (1920.0, 1040.0));
        assert_eq!(
            popover_position(((-1900.0, 1050.0), (24.0, 24.0)), size, left),
            (-1920.0, 427.0)
        );
        // A window larger than the area starts at the area's corner.
        assert_eq!(
            popover_position(((10.0, 10.0), (24.0, 24.0)), (4000.0, 3000.0), area),
            (0.0, 0.0)
        );
    }
}
