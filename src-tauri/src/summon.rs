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
//! The setting is not kept between launches in a release build yet. The code that reads and
//! writes its file is here and tested, and issue #105 gives the core's storage a restart data
//! folder (`data.rs`), but this setting is not wired to it yet. So a release build keeps it in
//! memory; a development build keeps it in the folder named by `OPEN_SESAME_DEV_CONFIG_DIR`.

use crate::window;
use open_sesame_core::gate::{MAIN_WINDOW, UNSUPPORTED};
use open_sesame_core::protocol::{BridgeError, BridgeResult};
use serde_json::{json, Map, Value};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// The summon methods this crate answers. Each is also listed in the gate's `PORTED`.
pub const METHODS: &[&str] = &[
    "summon.status",
    "summon.setShortcut",
    "summon.setHideOnBlur",
    "summon.hold",
];

/// The argument that is one press ([`press`]): it shows the window if it is hidden, brings it
/// to the front if it is open but behind, and hides it if it is in front.
pub const TOGGLE_FLAG: &str = "--toggle";
/// What a person binds to a desktop shortcut where the application cannot grab a key.
pub const TOGGLE_COMMAND: &str = "open-sesame --toggle";
/// Not Alt+Space or Option+Space, which ChatGPT, Gemini, Raycast, Alfred and the shipped Swift
/// host all use, and not Alt+Shift+Space, which Gemini's Mac app takes for its full window. Every
/// other pair of modifiers with Space is some launcher's, password manager's or system's own
/// (`the_default_is_not_a_shortcut_other_launchers_take` lists them), and macOS does not report
/// a conflict, so the default holds three.
pub const DEFAULT_SHORTCUT: &str = "Control+Alt+Shift+Space";

pub const INVALID_SHORTCUT: &str =
    "That is not a shortcut Open Sesame can use. Hold at least one of Control, Alt, Shift or Command and press one more key, for example Control+Alt+Shift+Space.";
/// Shift held alone, with a key that is neither a function key nor a media key. It does not
/// suggest Alt: on a Mac, Alt and Shift with a letter is refused in turn.
pub const SHIFT_ALONE: &str =
    "Shift alone is not enough with that key, because people hold Shift with it while they write. Add Control or Command, or use a function key or a media key.";
/// Alt held alone, or with Shift, with a letter, on a Mac.
pub const OPTION_WITH_A_LETTER: &str =
    "On a Mac, Alt (the Option key) with a letter types a character, so Open Sesame does not take it. Add Control or Command, or use a key that is not a letter.";
/// Control and Alt, with Shift or without, with a letter, on Windows.
pub const ALT_GR_WITH_A_LETTER: &str =
    "Control+Alt with a letter is how many Windows keyboards type a character (the AltGr key), so Open Sesame does not take it. Use a key that is not a letter, for example Control+Alt+Shift+Space.";
pub const INVALID_REQUEST: &str = "Invalid summon request.";
/// How many named reasons the page may hold the window for at once. The drag is not counted.
pub const MAX_PAGE_HOLDS: usize = 8;
/// The reason of a hold the page gives no reason for. A drag was the only reason when the
/// method was written, and the page still sends it without a name.
const DRAG: &str = "drag";
const MAX_REASON_LENGTH: usize = 32;
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
    /// `--toggle`: one press, as [`press`] decides.
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
/// uses is never taken from them, and it must not be something a person presses while writing,
/// because registering it takes that from every application (issue #115): Shift alone is enough
/// only for a function key or a media key, and a letter is refused with Option on a Mac and
/// with Control+Alt on Windows, where those type a character. An empty string is not a
/// shortcut; it means "none".
pub fn parse_shortcut(text: &str) -> Result<Shortcut, BridgeError> {
    let keyboard = if cfg!(target_os = "macos") {
        Keyboard::Mac
    } else if cfg!(windows) {
        Keyboard::Windows
    } else {
        Keyboard::Other
    };
    parse_shortcut_on(text, keyboard)
}

/// Whose keyboard rules apply. They differ in which modifiers type a character with a letter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Keyboard {
    /// Option (Alt), with Shift or without, types a character with a letter.
    Mac,
    /// The right-hand Alt of many keyboards (AltGr) is reported as Control and Alt together,
    /// and types a character with a letter.
    Windows,
    /// Linux: AltGr is a modifier of its own that a shortcut here cannot name, and Alt with
    /// a letter types nothing.
    Other,
}

/// [`parse_shortcut`] for a named system's keyboard. Only letters are refused with Option or
/// AltGr, as decided on 16 November 2026; a digit or a punctuation key with them types a
/// character too and is still accepted.
fn parse_shortcut_on(text: &str, keyboard: Keyboard) -> Result<Shortcut, BridgeError> {
    let invalid = || BridgeError::from(INVALID_SHORTCUT);
    let shortcut = Shortcut::from_str(text.trim()).map_err(|_| invalid())?;
    let needed = Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER | Modifiers::SHIFT;
    if !shortcut.mods.intersects(needed) {
        return Err(invalid());
    }
    let beside_shift = shortcut.mods & (Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER);
    if beside_shift.is_empty() && !shift_alone_is_enough(shortcut.key) {
        return Err(BridgeError::from(SHIFT_ALONE));
    }
    if is_letter(shortcut.key) {
        if keyboard == Keyboard::Mac && beside_shift == Modifiers::ALT {
            return Err(BridgeError::from(OPTION_WITH_A_LETTER));
        }
        if keyboard == Keyboard::Windows && beside_shift == Modifiers::CONTROL | Modifiers::ALT {
            return Err(BridgeError::from(ALT_GR_WITH_A_LETTER));
        }
    }
    Ok(shortcut)
}

/// The keys Shift alone may be a shortcut with: the function keys and the media and volume
/// keys. Nobody holds Shift with these while writing. Every other key is refused with Shift
/// alone: the keys that type, and also the arrows, Home, End, Page Up, Page Down, Backspace,
/// Delete, Insert, Escape, Pause, Print Screen and the lock keys, which people do press with
/// Shift held, to select text or by habit.
fn shift_alone_is_enough(key: Code) -> bool {
    use Code::*;
    matches!(
        key,
        F1 | F2
            | F3
            | F4
            | F5
            | F6
            | F7
            | F8
            | F9
            | F10
            | F11
            | F12
            | F13
            | F14
            | F15
            | F16
            | F17
            | F18
            | F19
            | F20
            | F21
            | F22
            | F23
            | F24
            | AudioVolumeDown
            | AudioVolumeMute
            | AudioVolumeUp
            | MediaPause
            | MediaPlay
            | MediaPlayPause
            | MediaStop
            | MediaTrackNext
            | MediaTrackPrevious
    )
}

fn is_letter(key: Code) -> bool {
    use Code::*;
    matches!(
        key,
        KeyA | KeyB
            | KeyC
            | KeyD
            | KeyE
            | KeyF
            | KeyG
            | KeyH
            | KeyI
            | KeyJ
            | KeyK
            | KeyL
            | KeyM
            | KeyN
            | KeyO
            | KeyP
            | KeyQ
            | KeyR
            | KeyS
            | KeyT
            | KeyU
            | KeyV
            | KeyW
            | KeyX
            | KeyY
            | KeyZ
    )
}

/// A hold's reason is a short name: lower-case letters, digits and hyphens.
fn is_reason(reason: &str) -> bool {
    !reason.is_empty()
        && reason.len() <= MAX_REASON_LENGTH
        && reason
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

/// The sentence shown when the system refuses a shortcut.
pub fn refused(shortcut: &str) -> String {
    format!("Open Sesame could not register {shortcut}. Another application may already use it. Choose a different shortcut.")
}

/// The sentence shown when a saved shortcut the rules now refuse was replaced by the default.
/// `saved` is what the file held, or empty when that is not fit to show.
pub fn replaced(saved: &str) -> String {
    let which = if saved.is_empty() {
        "Your saved shortcut".to_string()
    } else {
        format!("Your saved shortcut, {saved},")
    };
    format!("{which} is one Open Sesame no longer takes, so the default, {DEFAULT_SHORTCUT}, is used. Set another here if you prefer.")
}

/// What the settings file held is repeated to the person only when it is one short line of
/// plain characters; it is text from a file, not something this run was given.
fn showable(saved: &str) -> &str {
    let plain = saved.len() <= 64
        && saved
            .chars()
            .all(|character| character.is_ascii_graphic() || character == ' ');
    if plain {
        saved
    } else {
        ""
    }
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
    /// The settings alone, as the tests read them back.
    #[cfg(test)]
    pub fn load(path: &Path) -> Settings {
        Self::load_reporting(path).0
    }

    /// Reads the settings file. A missing or damaged file gives the defaults: a setting that
    /// cannot be read must not stop the application from starting. Beside the settings comes
    /// the shortcut the file held when that was one the person had saved and the rules no
    /// longer take, which the default replaced.
    fn load_reporting(path: &Path) -> (Settings, Option<String>) {
        let defaults = Settings::default();
        let Ok(text) = std::fs::read_to_string(path) else {
            return (defaults, None);
        };
        let Ok(Value::Object(saved)) = serde_json::from_str::<Value>(&text) else {
            return (defaults, None);
        };
        let (shortcut, replaced) = match saved.get("shortcut") {
            Some(Value::String(shortcut))
                if shortcut.is_empty() || parse_shortcut(shortcut).is_ok() =>
            {
                (shortcut.clone(), None)
            }
            // A key combination the rules now refuse was the person's own, and they are told.
            // Text that never was a key combination is a damaged file and says nothing.
            // A key with no modifier was never taken, so it is not one that is "no longer".
            Some(Value::String(refused))
                if Shortcut::from_str(refused.trim())
                    .is_ok_and(|shortcut| !shortcut.mods.is_empty()) =>
            {
                (defaults.shortcut, Some(refused.trim().to_string()))
            }
            _ => (defaults.shortcut, None),
        };
        let hide_on_blur = saved.get("hideOnBlur") == Some(&Value::Bool(true));
        (
            Settings {
                shortcut,
                hide_on_blur,
            },
            replaced,
        )
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

/// What one press does: the shortcut, `open-sesame --toggle`, the tray's menu item and a click
/// on the tray icon on Windows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Press {
    /// The window is hidden or minimized: show it.
    Show,
    /// The window is open and something else is in front of it: bring it to the front.
    Forward,
    /// The window is open and in front: hide it.
    Hide,
}

/// The rule for one press (issue #115, decided on 16 November 2026): a window that is open but
/// behind comes to the front, and one that is in front hides. Before, every press hid a window
/// that was open, whether or not the person could see it.
///
/// "In front" is: the window has the keyboard now, or lost it no longer ago than `BLUR_GRACE`.
/// The second half is for a press that takes the keyboard itself before it is reported, which
/// the shortcut does on X11 and a click on the taskbar does on Windows; without it such a
/// press would only ever bring the window forward. It is the same allowance, for the same
/// reason, as `press_caused_the_blur`. What it costs: a person who turns to another
/// application and presses within that third of a second hides the window. What each system
/// reports as "has the keyboard" has not been seen on a real desktop; that is for #78.
pub fn press(shown: bool, focused: bool, since_lost_focus: Option<Duration>) -> Press {
    let in_front = focused || since_lost_focus.is_some_and(|since| since < BLUR_GRACE);
    match (shown, in_front) {
        (false, _) => Press::Show,
        (true, true) => Press::Hide,
        (true, false) => Press::Forward,
    }
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
    /// The reasons the page holds the window for: a drag in progress, and whatever else the
    /// page comes to name. Each is released by name, so the end of one does not release
    /// another (issue #115).
    held_by_page: Mutex<BTreeSet<String>>,
    pinned: AtomicBool,
    /// When the window last hid because it lost focus.
    hid_on_blur: Mutex<Option<Instant>>,
    /// What the person is told about a saved shortcut the default replaced; empty for nothing.
    notice: Mutex<String>,
    /// When the window last lost the keyboard, whether or not it hid for that.
    lost_focus: Mutex<Option<Instant>>,
    /// Whether the window was in front when the tray icon was last pressed, and when that was.
    /// Opening the tray's menu can take the keyboard, and the menu may then stay open for any
    /// length of time, so the menu item cannot ask the window when it is chosen.
    front_at_tray: Mutex<Option<(Instant, bool)>>,
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

/// Suspends hide-on-blur for as long as the returned value lives. A feature takes it before
/// it opens a native dialog or a browser: the folder dialog (issue #74) and sign-in
/// (issue #72) both do.
pub fn hold<R: Runtime>(app: &AppHandle<R>) -> Option<Hold> {
    app.try_state::<Summon>().map(|summon| summon.hold())
}

impl Summon {
    /// `path` is the settings file, or `None` to keep nothing between launches.
    pub fn new(session: Session, path: Option<PathBuf>) -> Summon {
        let (settings, refused) = path
            .as_deref()
            .map(Settings::load_reporting)
            .unwrap_or_default();
        let notice = refused
            .map(|saved| replaced(showable(&saved)))
            .unwrap_or_default();
        Summon {
            session,
            path,
            settings: Mutex::new(settings),
            registration: Mutex::new(Registration::default()),
            holds: Arc::new(AtomicUsize::new(0)),
            held_by_page: Mutex::default(),
            pinned: AtomicBool::new(false),
            hid_on_blur: Mutex::new(None),
            notice: Mutex::new(notice),
            lost_focus: Mutex::new(None),
            front_at_tray: Mutex::new(None),
        }
    }

    /// The person set a shortcut, or none, themselves: what replaced the old one is no longer
    /// news.
    fn shortcut_was_set(&self) {
        lock(&self.notice).clear();
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

    /// Takes or releases the page's hold for one reason. Taking one that is held, or releasing
    /// one that is not, changes nothing: the reasons are a set, not a count. The page may hold
    /// for [`MAX_PAGE_HOLDS`] named reasons at once; one more is refused, so a page cannot make
    /// this list grow without end. The drag is beside that limit and is never refused: the
    /// page's drag script does not look at the answer.
    fn hold_for_page(&self, reason: &str, held: bool) -> Result<(), BridgeError> {
        let mut reasons = lock(&self.held_by_page);
        if !held {
            reasons.remove(reason);
        } else if !reasons.contains(reason) {
            let named = reasons.iter().filter(|held| *held != DRAG).count();
            if reason != DRAG && named >= MAX_PAGE_HOLDS {
                return Err(BridgeError::from(INVALID_REQUEST));
            }
            reasons.insert(reason.to_string());
        }
        Ok(())
    }

    /// Releases every hold the page has taken so far. The features' own holds and the pin
    /// stay. A request is not tied to the page that sent it, so a `summon.hold` the old page
    /// sent that is handled after this is kept until something releases that reason (for the
    /// drag, the end of the next drag that starts in the page) or the next page load.
    fn release_page_holds(&self) {
        lock(&self.held_by_page).clear();
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
            !lock(&self.held_by_page).is_empty(),
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
            "notice": *lock(&self.notice),
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
        Launch::Toggle => {
            window::toggle(app);
        }
        Launch::Show => window::show(app),
    }
}

/// Whether the window hid on blur so recently that the press or click being handled now is
/// what took the focus from it. Asking forgets the hide, so one hide excuses one press.
pub(crate) fn blur_just_hid<R: Runtime>(app: &AppHandle<R>) -> bool {
    let since_blur_hide = app
        .try_state::<Summon>()
        .and_then(|summon| lock(&summon.hid_on_blur).take())
        .map(|at| at.elapsed());
    press_caused_the_blur(since_blur_hide)
}

/// The shortcut was pressed: one press on the window, unless this press is what just hid it.
/// Returns what the press did, or nothing when it did nothing more.
fn pressed<R: Runtime>(app: &AppHandle<R>) -> Option<Press> {
    if blur_just_hid(app) {
        return None;
    }
    window::toggle(app)
}

/// The tray icon was clicked, which is acted on only on Windows (macOS reports the click too,
/// and there it opens the menu): the popover, unless this click is what just hid the window. Pressing the button on the taskbar takes the focus from the
/// window before the click is reported, so with hide-on-blur on the window has already hidden
/// and showing it again would mean the icon could never hide it. This is the rule the shortcut
/// follows on X11; on Windows it is reasoned from how the taskbar takes focus and has not been
/// seen in a window.
pub fn tray_clicked<R: Runtime>(app: &AppHandle<R>, icon: tauri::Rect) -> Option<Press> {
    if blur_just_hid(app) {
        return None;
    }
    window::toggle_at(app, icon)
}

/// Whether a press on the tray icon is one that opens its menu, and so one to note for the
/// menu item ([`tray_pressed`]). On Windows the left button is the popover and only the right
/// one opens the menu; elsewhere either does. A press of the middle button, where it is
/// reported, opens no menu and is noted all the same: that note is used only if a menu is
/// then opened within `TRAY_MENU_OPEN` by some way that reports no press.
pub fn opens_the_tray_menu(windows: bool, right_button: bool) -> bool {
    !windows || right_button
}

/// How long what the tray icon's press saw stays good for the menu item. A menu left open
/// longer than this is answered as if no press had been reported. What it costs: nothing says
/// when a menu was dismissed without a choice, so a press whose menu was dismissed still
/// decides for a menu opened within this minute by some way that reports no press, such as
/// the keyboard; the item then goes by what the window was doing at the earlier press.
const TRAY_MENU_OPEN: Duration = Duration::from_secs(60);

/// Where no press on the tray icon was reported, or the one reported is older than
/// `TRAY_MENU_OPEN`: how long ago the window may have lost the keyboard and still count as in
/// front when the menu item is chosen. Linux never reports the press, so there this always
/// decides; on macOS and Windows it decides for a menu opened without a press. The menu takes
/// the keyboard when it opens, on the desktops this was reasoned for, so a window that was in
/// front has just lost it, by as long as the person took to choose. Ten seconds is a guess at
/// that. What it costs: a person who left the window less than ten seconds ago and chooses
/// the item to bring it back hides it, and chooses again; one who keeps the menu open longer
/// brings a window forward that was in front, and chooses again to hide it. No panel's menu
/// has been seen doing this; that is for #78.
const TRAY_MENU_GRACE: Duration = Duration::from_secs(10);

fn since_lost_focus<R: Runtime>(app: &AppHandle<R>) -> Option<Duration> {
    app.try_state::<Summon>()
        .and_then(|summon| *lock(&summon.lost_focus))
        .map(|at| at.elapsed())
}

/// What a press does to `window` now. See [`press`].
pub(crate) fn press_on<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>) -> Press {
    press(
        window::is_shown(window),
        window.is_focused().unwrap_or(false),
        since_lost_focus(app),
    )
}

/// The tray icon was pressed, which Windows and macOS report and Linux does not: remembers
/// whether the window was in front, for the menu item that may be chosen next.
pub fn tray_pressed<R: Runtime>(app: &AppHandle<R>) {
    let (Some(summon), Some(window)) = (
        app.try_state::<Summon>(),
        app.get_webview_window(MAIN_WINDOW),
    ) else {
        return;
    };
    let front = press_on(app, &window) == Press::Hide;
    *lock(&summon.front_at_tray) = Some((Instant::now(), front));
}

/// What choosing the tray's menu item does to `window`. See [`tray_item`].
pub(crate) fn tray_item_on<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>) -> Press {
    let seen = app
        .try_state::<Summon>()
        .and_then(|summon| lock(&summon.front_at_tray).take())
        .map(|(at, front)| (at.elapsed(), front));
    tray_item(
        window::is_shown(window),
        window.is_focused().unwrap_or(false),
        since_lost_focus(app),
        seen,
    )
}

/// The rule for the tray's menu item. The open menu may have the keyboard by the time its
/// item is chosen, and may have had it for any length of time, so the window cannot simply be
/// asked then. `seen` is how long ago the icon was pressed and whether the window was in
/// front at that moment; where it is there and recent it decides. Without it the window
/// counts as in front if it has the keyboard, or lost it within `TRAY_MENU_GRACE`.
pub fn tray_item(
    shown: bool,
    focused: bool,
    since_lost_focus: Option<Duration>,
    seen: Option<(Duration, bool)>,
) -> Press {
    if !shown {
        return Press::Show;
    }
    let front = match seen {
        Some((since, front)) if since < TRAY_MENU_OPEN => front,
        _ => focused || since_lost_focus.is_some_and(|since| since < TRAY_MENU_GRACE),
    };
    if front {
        Press::Hide
    } else {
        Press::Forward
    }
}

/// The window lost focus.
pub fn blurred<R: Runtime>(app: &AppHandle<R>) {
    let Some(summon) = app.try_state::<Summon>() else {
        return;
    };
    *lock(&summon.lost_focus) = Some(Instant::now());
    // Development evidence of when the system says the keyboard went elsewhere.
    #[cfg(debug_assertions)]
    eprintln!("open-sesame: window lost the keyboard");
    if summon.should_hide_on_blur() {
        *lock(&summon.hid_on_blur) = Some(Instant::now());
        window::hide(app);
        #[cfg(debug_assertions)]
        eprintln!("open-sesame: hidden because the window lost focus");
    }
}

/// The window started to load a page. The page that took the holds is gone and the new one
/// cannot release a reason it never took, so they are released here; without this a hold left
/// behind kept hide-on-blur from working until the application was started again.
pub fn page_replaced<R: Runtime>(app: &AppHandle<R>) {
    if let Some(summon) = app.try_state::<Summon>() {
        summon.release_page_holds();
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
            summon.shortcut_was_set();
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
            let reason = match params.get("reason") {
                None => DRAG,
                Some(Value::String(reason)) if is_reason(reason) => reason,
                Some(_) => return Err(invalid()),
            };
            summon.hold_for_page(reason, *held)?;
            Ok(json!({"held": held}))
        }
        _ => Err(BridgeError::from(UNSUPPORTED)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    /// The application with its main window on Tauri's windowless runtime, where a window
    /// always says it is shown and never says it has the keyboard. So here "in front" is only
    /// ever what this module remembers: when the window lost the keyboard, and what the press
    /// on the tray icon saw.
    fn windowless(hide_on_blur: bool) -> (tauri::App<MockRuntime>, WebviewWindow<MockRuntime>) {
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let summon = Summon::new(Session::X11, None);
        lock(&summon.settings).hide_on_blur = hide_on_blur;
        app.manage(summon);
        let window = WebviewWindowBuilder::new(&app, MAIN_WINDOW, WebviewUrl::default())
            .build()
            .unwrap();
        (app, window)
    }

    fn lost_the_keyboard(app: &tauri::App<MockRuntime>, ago: Option<Duration>) {
        let at = ago.map(|ago| Instant::now().checked_sub(ago).unwrap());
        *lock(&app.state::<Summon>().lost_focus) = at;
    }

    /// What `blurred` noted is made to read as this instant for as long as the test runs, so
    /// that a slow machine cannot let `BLUR_GRACE` pass between two statements. The note that
    /// the window lost the keyboard has to be there already, and be recent.
    fn the_blur_was_this_instant(app: &tauri::App<MockRuntime>) {
        let summon = app.state::<Summon>();
        let later = Instant::now() + Duration::from_secs(3600);
        let mut lost = lock(&summon.lost_focus);
        assert!(
            lost.is_some_and(|at| at.elapsed() < Duration::from_secs(60)),
            "losing the keyboard is noted with the time"
        );
        *lost = Some(later);
        drop(lost);
        let mut hid = lock(&summon.hid_on_blur);
        if hid.is_some() {
            *hid = Some(later);
        }
    }

    /// The window losing the keyboard is what a press goes by a moment later: without the
    /// note, a press that takes the keyboard itself could only ever bring the window forward.
    #[test]
    fn a_press_goes_by_when_the_window_lost_the_keyboard() {
        let (app, window) = windowless(false);
        assert_eq!(press_on(app.handle(), &window), Press::Forward);
        blurred(app.handle());
        the_blur_was_this_instant(&app);
        assert_eq!(press_on(app.handle(), &window), Press::Hide);
        assert_eq!(pressed(app.handle()), Some(Press::Hide));
        assert_eq!(window::toggle(app.handle()), Some(Press::Hide));
        lost_the_keyboard(&app, Some(Duration::from_secs(2)));
        assert_eq!(press_on(app.handle(), &window), Press::Forward);
        assert_eq!(pressed(app.handle()), Some(Press::Forward));
    }

    /// With hide-on-blur on, the press that took the keyboard and so hid the window does
    /// nothing more, for the shortcut and for the click on the tray icon; the next one acts.
    #[test]
    fn the_press_that_just_hid_the_window_does_nothing_more() {
        let icon = tauri::Rect::default();
        let (app, _window) = windowless(true);
        blurred(app.handle());
        assert!(lock(&app.state::<Summon>().hid_on_blur).is_some());
        the_blur_was_this_instant(&app);
        assert_eq!(pressed(app.handle()), None);
        assert!(
            pressed(app.handle()).is_some(),
            "one hide excuses one press"
        );
        blurred(app.handle());
        the_blur_was_this_instant(&app);
        assert_eq!(tray_clicked(app.handle(), icon), None);
        assert!(tray_clicked(app.handle(), icon).is_some());
        // With the setting off nothing hid, so the press acts at once.
        let (app, _window) = windowless(false);
        blurred(app.handle());
        assert!(lock(&app.state::<Summon>().hid_on_blur).is_none());
        the_blur_was_this_instant(&app);
        assert_eq!(pressed(app.handle()), Some(Press::Hide));
    }

    /// The same, through the application's own state: the menu item uses what the press on
    /// the icon noted, once, and not the shortcut's rule.
    #[test]
    fn the_tray_item_uses_what_the_press_noted_and_not_the_shortcuts_rule() {
        let (app, window) = windowless(false);
        let handle = app.handle();
        // No press was reported, as on Linux: a window that lost the keyboard two seconds ago
        // counts as in front for the item, and as behind for the shortcut.
        lost_the_keyboard(&app, Some(Duration::from_secs(2)));
        assert_eq!(press_on(handle, &window), Press::Forward);
        assert_eq!(tray_item_on(handle, &window), Press::Hide);
        assert_eq!(window::toggle_from_tray_menu(handle), Some(Press::Hide));
        // The icon was pressed while the window was behind; the menu then took the keyboard
        // from whatever had it. The item brings the window forward.
        lost_the_keyboard(&app, None);
        tray_pressed(handle);
        lost_the_keyboard(&app, Some(Duration::ZERO));
        assert_eq!(window::toggle_from_tray_menu(handle), Some(Press::Forward));
        // What the press saw is used once.
        assert_eq!(window::toggle_from_tray_menu(handle), Some(Press::Hide));
        // The icon was pressed while the window was in front, and the menu stayed open longer
        // than the allowance for a missing press: the item still hides.
        lost_the_keyboard(&app, Some(Duration::ZERO));
        the_blur_was_this_instant(&app);
        tray_pressed(handle);
        lost_the_keyboard(&app, Some(TRAY_MENU_GRACE + Duration::from_secs(5)));
        assert_eq!(tray_item_on(handle, &window), Press::Hide);
        assert_eq!(tray_item_on(handle, &window), Press::Forward);
    }

    /// The sentence for Shift alone names what to add, and not Alt: on a Mac, Alt and Shift
    /// with a letter is refused in turn.
    #[test]
    fn the_shift_sentence_suggests_control_or_command_and_not_alt() {
        assert!(SHIFT_ALONE.contains("Add Control or Command"));
        assert!(!SHIFT_ALONE.contains("Alt") && !SHIFT_ALONE.contains("Option"));
    }

    #[test]
    fn only_a_press_that_opens_the_tray_menu_is_noted() {
        assert!(opens_the_tray_menu(false, false));
        assert!(opens_the_tray_menu(false, true));
        assert!(opens_the_tray_menu(true, true));
        assert!(!opens_the_tray_menu(true, false), "the popover's button");
    }

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
            "Control+Shift+K",
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

    /// Shift with a key that types is what a person presses while writing, so taking it as a
    /// shortcut takes that character from every application (issue #115). Shift is still a
    /// modifier beside another one, and enough by itself for a function key.
    #[test]
    fn shift_alone_is_not_enough_for_a_key_that_types() {
        for bad in [
            "Shift+A",
            "shift+space",
            "Shift+1",
            "Shift+/",
            "Shift+Quote",
            "Shift+Enter",
            "Shift+Tab",
            "Shift+Num5",
            "Shift+NumpadAdd",
            "Shift+NumpadEnter",
        ] {
            assert_eq!(
                parse_shortcut(bad).map_err(|error| error.0),
                Err(SHIFT_ALONE.to_string()),
                "{bad}"
            );
        }
        for good in [
            "Shift+F5",
            "Shift+F13",
            "Control+Shift+A",
            "Alt+Shift+Space",
            "Super+Shift+1",
            "Control+A",
            "Alt+Space",
        ] {
            assert!(parse_shortcut(good).is_ok(), "{good}");
        }
    }

    /// Every key that types, by its own name. A name the parser does not know would be refused
    /// for another reason, so each is first shown to be a key: with Control it is accepted.
    #[test]
    fn shift_alone_is_refused_for_every_key_that_types() {
        let mut keys: Vec<String> = Vec::new();
        keys.extend(('A'..='Z').map(|letter| format!("Key{letter}")));
        keys.extend((0..=9).map(|digit| format!("Digit{digit}")));
        keys.extend((0..=9).map(|digit| format!("Numpad{digit}")));
        keys.extend(
            [
                "Backquote",
                "Backslash",
                "BracketLeft",
                "BracketRight",
                "Comma",
                "Equal",
                "Minus",
                "Period",
                "Quote",
                "Semicolon",
                "Slash",
                "Space",
                "Enter",
                "Tab",
                "NumpadAdd",
                "NumpadDecimal",
                "NumpadDivide",
                "NumpadEnter",
                "NumpadEqual",
                "NumpadMultiply",
                "NumpadSubtract",
            ]
            .map(String::from),
        );
        assert_eq!(keys.len(), 67);
        for key in keys {
            assert!(
                parse_shortcut(&format!("Control+Shift+{key}")).is_ok(),
                "{key} is not a key name"
            );
            assert_eq!(
                parse_shortcut(&format!("Shift+{key}")).map_err(|error| error.0),
                Err(SHIFT_ALONE.to_string()),
                "{key}"
            );
        }
    }

    #[test]
    fn a_reason_is_a_short_name() {
        assert!(is_reason("menu"));
        assert!(is_reason("select-list-2"));
        assert!(is_reason(&"x".repeat(MAX_REASON_LENGTH)));
        assert!(!is_reason(&"x".repeat(MAX_REASON_LENGTH + 1)));
        for bad in ["", "Menu", "with space", "menu_two", "men\u{fc}"] {
            assert!(!is_reason(bad), "{bad:?}");
        }
    }

    /// The drag is the one hold the page takes today, and its script does not look at the
    /// answer, so it must never be the hold that is refused (found in the review of #124).
    #[test]
    fn a_drag_is_held_however_many_named_reasons_are() {
        let summon = Summon::new(Session::MacOs, None);
        lock(&summon.settings).hide_on_blur = true;
        for index in 0..MAX_PAGE_HOLDS {
            summon
                .hold_for_page(&format!("reason-{index}"), true)
                .unwrap();
        }
        assert!(summon.hold_for_page("one-more", true).is_err());
        summon.hold_for_page(DRAG, true).unwrap();
        for index in 0..MAX_PAGE_HOLDS {
            summon
                .hold_for_page(&format!("reason-{index}"), false)
                .unwrap();
        }
        assert!(
            !summon.should_hide_on_blur(),
            "the drag was refused at the limit, so the window would hide in the middle of it"
        );
        // A drag in progress does not use up one of the named places either.
        for index in 0..MAX_PAGE_HOLDS {
            summon
                .hold_for_page(&format!("reason-{index}"), true)
                .unwrap();
        }
        assert!(summon.hold_for_page("one-more", true).is_err());
    }

    /// Shift alone is enough only for a function key or a media key (issue #115, decided on
    /// 16 November 2026). A person holds Shift with the arrows, Backspace and the like while
    /// writing, so those are refused as the keys that type are, and with a sentence that says
    /// why.
    #[test]
    fn shift_alone_is_enough_only_for_function_and_media_keys() {
        for bad in [
            "Shift+Up",
            "Shift+ArrowLeft",
            "Shift+Backspace",
            "Shift+Delete",
            "Shift+Insert",
            "Shift+Home",
            "Shift+End",
            "Shift+PageUp",
            "Shift+PageDown",
            "Shift+Escape",
            "Shift+CapsLock",
            "Shift+NumLock",
            "Shift+ScrollLock",
            "Shift+Pause",
            "Shift+PrintScreen",
            "Shift+A",
            "Shift+Space",
        ] {
            assert_eq!(
                parse_shortcut(bad).map_err(|error| error.0),
                Err(SHIFT_ALONE.to_string()),
                "{bad}"
            );
        }
        let mut good: Vec<String> = (1..=24).map(|number| format!("Shift+F{number}")).collect();
        good.extend(
            [
                "MediaPlay",
                "MediaPause",
                "MediaPlayPause",
                "MediaStop",
                "MediaTrackNext",
                "MediaTrackPrevious",
                "VolumeUp",
                "VolumeDown",
                "VolumeMute",
            ]
            .map(|key| format!("Shift+{key}")),
        );
        good.extend(
            [
                "Control+Shift+Up",
                "Alt+Shift+Backspace",
                "Super+Shift+Home",
            ]
            .map(String::from),
        );
        for good in good {
            assert!(parse_shortcut(&good).is_ok(), "{good}");
        }
    }

    /// A letter with Option types a character on a Mac, and a letter with Control+Alt does on
    /// Windows, where that is how the right-hand Alt of many keyboards (AltGr) is reported.
    /// Taking such a shortcut takes that character from every application, so each is refused
    /// with its own sentence, and only on the system where it types.
    #[test]
    fn a_letter_with_option_or_alt_gr_is_refused_where_it_types() {
        let always = [
            "Alt+Space",
            "Alt+1",
            "Alt+F4",
            "Alt+Super+A",
            "Control+A",
            "Control+Shift+A",
            "Super+Shift+A",
            "Control+Alt+Space",
            "Control+Alt+1",
            "Control+Alt+Super+A",
            DEFAULT_SHORTCUT,
        ];
        let option = [
            "Alt+A",
            "alt+z",
            "Alt+Shift+E",
            "Option+N",
            "Shift+Option+KeyQ",
        ];
        let alt_gr = ["Control+Alt+A", "Control+Alt+Shift+Q", "Ctrl+Alt+KeyE"];
        for keyboard in [Keyboard::Mac, Keyboard::Windows, Keyboard::Other] {
            for good in always {
                assert!(
                    parse_shortcut_on(good, keyboard).is_ok(),
                    "{good}, {keyboard:?}"
                );
            }
            for shortcut in option {
                let expected =
                    (keyboard == Keyboard::Mac).then(|| OPTION_WITH_A_LETTER.to_string());
                assert_eq!(
                    parse_shortcut_on(shortcut, keyboard)
                        .map_err(|error| error.0)
                        .err(),
                    expected,
                    "{shortcut}, {keyboard:?}"
                );
            }
            for shortcut in alt_gr {
                let expected =
                    (keyboard == Keyboard::Windows).then(|| ALT_GR_WITH_A_LETTER.to_string());
                assert_eq!(
                    parse_shortcut_on(shortcut, keyboard)
                        .map_err(|error| error.0)
                        .err(),
                    expected,
                    "{shortcut}, {keyboard:?}"
                );
            }
        }
        // The running system's own rule is the one `parse_shortcut` applies.
        assert_eq!(parse_shortcut("Alt+A").is_err(), cfg!(target_os = "macos"));
        assert_eq!(parse_shortcut("Control+Alt+A").is_err(), cfg!(windows));
    }

    /// A saved shortcut that the rules now refuse is replaced by the default, and the person
    /// is told which one it was until they set a shortcut themselves. A file that is missing,
    /// damaged or holds no shortcut says nothing: nothing of the person's was replaced.
    #[test]
    fn a_replaced_saved_shortcut_is_reported_until_one_is_set() {
        let folder =
            std::env::temp_dir().join(format!("open-sesame-summon-notice-{}", std::process::id()));
        let path = folder.join(SETTINGS_FILE);
        std::fs::create_dir_all(&folder).unwrap();
        let load = |text: &str| {
            std::fs::write(&path, text).unwrap();
            Summon::new(Session::X11, Some(path.clone()))
        };
        let summon = load(r#"{"shortcut":"Shift+Up","hideOnBlur":true}"#);
        let status = summon.status();
        assert_eq!(status["shortcut"], DEFAULT_SHORTCUT);
        assert_eq!(status["hideOnBlur"], true);
        assert_eq!(status["notice"], replaced("Shift+Up"));
        assert!(replaced("Shift+Up").contains("Shift+Up"));
        assert!(replaced("Shift+Up").contains(DEFAULT_SHORTCUT));
        summon.shortcut_was_set();
        assert_eq!(summon.status()["notice"], "");

        for quiet in [
            r#"{"shortcut":"Control+Shift+K"}"#,
            r#"{"shortcut":""}"#,
            r#"{"shortcut":7}"#,
            r#"{"hideOnBlur":true}"#,
            "not json",
            // Text that never was a key combination is a damaged file, not a shortcut of the
            // person's that was replaced.
            r#"{"shortcut":"   "}"#,
            r#"{"shortcut":"hello there"}"#,
            r#"{"shortcut":"Shift+"}"#,
            // A key with no modifier was never taken, so nothing says it no longer is.
            r#"{"shortcut":"Space"}"#,
            r#"{"shortcut":"K"}"#,
        ] {
            let summon = load(quiet);
            assert_eq!(summon.status()["notice"], "", "{quiet}");
            if quiet.contains("hello") {
                assert_eq!(summon.status()["shortcut"], DEFAULT_SHORTCUT);
            }
        }
        // The spaces around a saved shortcut are not repeated.
        let spaced = load(r#"{"shortcut":"  Shift+Up "}"#);
        assert_eq!(spaced.status()["notice"], replaced("Shift+Up"));
        // What the file held is shown only when it is short: a key combination can be written
        // at any length by repeating a modifier.
        let long = format!(r#"{{"shortcut":"{}Up"}}"#, "Shift+".repeat(20));
        let notice = load(&long).status()["notice"].as_str().unwrap().to_string();
        assert_eq!(notice, replaced(""));
        assert!(!notice.contains("Shift+Shift"));
        // Long text and text on two lines that are no key combination say nothing.
        let long = format!(r#"{{"shortcut":"Shift+{}"}}"#, "A".repeat(200));
        assert_eq!(load(&long).status()["notice"], "");
        let odd = load("{\"shortcut\":\"Shift+A\\nsecond line\"}").status()["notice"].clone();
        assert_eq!(odd, "");
        std::fs::remove_file(&path).unwrap();
        assert_eq!(
            Summon::new(Session::X11, Some(path.clone())).status()["notice"],
            ""
        );
        let _ = std::fs::remove_dir_all(&folder);
    }

    /// A saved shortcut that is no longer one gives the default, like any other the file
    /// cannot keep.
    #[test]
    fn a_saved_shift_only_shortcut_gives_the_default() {
        let folder =
            std::env::temp_dir().join(format!("open-sesame-summon-shift-{}", std::process::id()));
        let path = folder.join(SETTINGS_FILE);
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(&path, r#"{"shortcut":"Shift+A","hideOnBlur":true}"#).unwrap();
        let loaded = Settings::load(&path);
        let _ = std::fs::remove_dir_all(&folder);
        assert_eq!(loaded.shortcut, DEFAULT_SHORTCUT);
        assert!(loaded.hide_on_blur);
    }

    #[test]
    fn the_default_is_not_a_shortcut_other_launchers_take() {
        let default = parse_shortcut(DEFAULT_SHORTCUT).unwrap();
        for taken in [
            "Alt+Space",
            // Gemini's Mac app opens its full window with Option+Shift+Space.
            "Alt+Shift+Space",
            "Control+Alt+Space",
            "Control+Shift+Space",
            "Control+Super+Space",
            "Super+Alt+Space",
            "Super+Shift+Space",
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
            shortcut: "Control+Shift+K".to_string(),
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
        summon.hold_for_page(DRAG, true).unwrap();
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

    /// One press: a hidden window shows, one that is open but behind comes forward, one in
    /// front hides (issue #115). A press that took the keyboard a moment before it was reported
    /// still finds the window "in front".
    #[test]
    fn a_press_brings_a_window_that_is_behind_to_the_front() {
        let ms = Duration::from_millis;
        for (shown, focused, since, expected) in [
            (false, false, None, Press::Show),
            (false, false, Some(ms(10)), Press::Show),
            (false, true, None, Press::Show),
            (true, true, None, Press::Hide),
            (true, true, Some(ms(5_000)), Press::Hide),
            (true, false, None, Press::Forward),
            (true, false, Some(ms(5_000)), Press::Forward),
            (true, false, Some(ms(300)), Press::Forward),
            (true, false, Some(ms(299)), Press::Hide),
            (true, false, Some(ms(0)), Press::Hide),
        ] {
            assert_eq!(
                press(shown, focused, since),
                expected,
                "shown {shown}, focused {focused}, lost focus {since:?} ago"
            );
        }
    }

    /// The tray's menu item goes by what the press on the icon saw, because the open menu may
    /// have the keyboard by the time the item is chosen. Without such a press, as on Linux, or
    /// with one from long ago, a window that lost the keyboard a few seconds ago was in front.
    #[test]
    fn the_tray_item_goes_by_what_the_press_on_the_icon_saw() {
        let s = Duration::from_secs;
        for (shown, focused, lost, seen, expected) in [
            // Hidden: shown, whatever else is known.
            (false, false, None, None, Press::Show),
            (false, false, Some(s(1)), Some((s(1), true)), Press::Show),
            // A press was reported: it decides, for a minute.
            (true, false, Some(s(2)), Some((s(2), true)), Press::Hide),
            (true, false, Some(s(59)), Some((s(59), true)), Press::Hide),
            (
                true,
                false,
                Some(s(60)),
                Some((s(60), true)),
                Press::Forward,
            ),
            (true, false, Some(s(2)), Some((s(1), false)), Press::Forward),
            (true, true, None, Some((s(1), false)), Press::Forward),
            // No press reported: the keyboard now, or until a few seconds ago.
            (true, true, None, None, Press::Hide),
            (true, false, Some(s(2)), None, Press::Hide),
            (true, false, Some(s(9)), None, Press::Hide),
            (true, false, Some(s(10)), None, Press::Forward),
            (true, false, Some(s(600)), None, Press::Forward),
            (true, false, None, None, Press::Forward),
        ] {
            assert_eq!(
                tray_item(shown, focused, lost, seen),
                expected,
                "shown {shown}, focused {focused}, lost focus {lost:?} ago, press {seen:?}"
            );
        }
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
