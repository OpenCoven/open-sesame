//! The companion rail: the main window as a strip against one edge of the display the pointer is
//! on, which opens into the panel.
//!
//! On macOS, Windows and X11 the one window has no frame, stays above other windows and is placed
//! by this module. Collapsed, it is a short strip of view buttons against the edge, centred on
//! the display's work area. Expanded, it is the panel, as tall as the work area and anchored to
//! the same edge; nothing is reserved, so it lies over whatever is there. A thread asks where the
//! pointer is several times a second: a collapsed rail moves to the display the pointer is on, a
//! pointer that rests on the strip opens the panel as a peek, and a peek nobody clicked in closes
//! when the pointer leaves. The shortcut, `open-sesame --toggle`, a second launch and a click on a
//! view button open the panel to stay.
//!
//! A Wayland session lets an application neither place a window nor ask where the pointer is.
//! Where the compositor has the layer-shell protocol the rail is a layer surface docked against
//! the edge (`layer.rs`): the session picks the output, so the strip does not follow the pointer
//! from display to display, and the rail learns only whether the pointer is over it. Elsewhere on
//! Wayland the window stays the ordinary one that `window.rs` has always made ([`Presentation`]).
//!
//! Positions are worked out in one space per system, because Tauri's physical positions are not
//! one space on a Mac with displays of different densities: points on macOS, physical pixels on
//! Windows and X11 ([`Screen`]).
//!
//! The edge and the hover setting are kept like the shortcut is (`summon.rs`): in memory in a
//! release build, and in the folder named by `OPEN_SESAME_DEV_CONFIG_DIR` in a development build.

use crate::summon::{self, Session};
use open_sesame_core::gate::{MAIN_WINDOW, NOT_ON_OS, UNSUPPORTED};
use open_sesame_core::protocol::{BridgeError, BridgeResult};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;
use tauri::webview::WebviewWindowBuilder;
use tauri::window::{Effect, EffectState, EffectsBuilder};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

/// The rail methods this crate answers. Each is also listed in the gate's `PORTED`.
pub const METHODS: &[&str] = &["rail.status", "rail.set"];

pub const INVALID_REQUEST: &str = "Invalid rail request.";
pub const NOT_SAVED: &str = "Open Sesame could not save the rail setting.";
/// The host message that carries the status after every change.
pub const CHANGED_EVENT: &str = "rail.changed";

/// Sizes in logical pixels. `ui/rail.css` lays the page out for the same numbers.
/// The window's corner, in logical pixels: cut by the panel on macOS and drawn by the page
/// elsewhere (`--radius-window` in ui/tokens.css).
pub const CORNER_RADIUS: f64 = 18.0;
pub const COLLAPSED_WIDTH: f64 = 56.0;
pub const COLLAPSED_HEIGHT: f64 = 376.0;
pub const EXPANDED_WIDTH: f64 = 400.0;
pub const WIDE_WIDTH: f64 = 860.0;
/// The gap between the rail and the edges of the work area.
pub const MARGIN: f64 = 8.0;
/// How far outside the open panel the pointer may stray before a peek counts it as gone.
const REACH: f64 = 16.0;

/// How often the pointer is asked for.
const TICK: Duration = Duration::from_millis(60);
/// Ticks the pointer rests on the strip before the panel opens: long enough that a pointer on
/// its way to the next display does not open it.
const PEEK_TICKS: u8 = 2;
/// Ticks the pointer is away from a peek before it closes.
const LEAVE_TICKS: u8 = 6;
/// Ticks the pointer is on another display before the collapsed rail follows it.
const FOLLOW_TICKS: u8 = 2;
/// Ticks between two readings of the displays, which change far less often than the pointer.
const SCREEN_TICKS: u8 = 32;

#[cfg_attr(not(any(debug_assertions, test)), allow(dead_code))]
const SETTINGS_FILE: &str = "rail.json";

/// A rectangle with its origin at the top left.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    pub fn contains(&self, (x, y): (f64, f64)) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.y + self.height
    }

    /// The rectangle with `by` added on every side.
    pub fn grown(&self, by: f64) -> Rect {
        Rect {
            x: self.x - by,
            y: self.y - by,
            width: self.width + 2.0 * by,
            height: self.height + 2.0 * by,
        }
    }
}

/// The edge of the display the rail sits against.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Edge {
    Left,
    Right,
}

impl Edge {
    pub fn name(self) -> &'static str {
        match self {
            Edge::Left => "left",
            Edge::Right => "right",
        }
    }

    fn named(name: &str) -> Option<Edge> {
        match name {
            "left" => Some(Edge::Left),
            "right" => Some(Edge::Right),
            _ => None,
        }
    }
}

/// What the window is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Presentation {
    /// The rail this module places.
    Rail,
    /// An ordinary window the session places: Wayland.
    Window,
}

impl Presentation {
    pub fn name(self) -> &'static str {
        match self {
            Presentation::Rail => "rail",
            Presentation::Window => "window",
        }
    }
}

/// The presentation for a session. An application can place its window and ask for the pointer
/// on macOS, Windows and X11, and cannot on Wayland; [`presentation`] adds the Wayland sessions
/// that can dock the window instead.
pub fn presentation_for(session: Session) -> Presentation {
    match session {
        Session::Wayland => Presentation::Window,
        Session::MacOs | Session::Windows | Session::X11 => Presentation::Rail,
    }
}

/// The presentation of this process. A development build started with
/// `OPEN_SESAME_PRESENTATION=window` uses the ordinary window on any system, which is how the
/// Wayland fallback is looked at on a Mac; a release build never reads it.
pub fn presentation() -> Presentation {
    #[cfg(debug_assertions)]
    if std::env::var("OPEN_SESAME_PRESENTATION").as_deref() == Ok("window") {
        return Presentation::Window;
    }
    let session = summon::session();
    // A Wayland session that has the layer-shell protocol docks the window for the rail.
    #[cfg(target_os = "linux")]
    if session == Session::Wayland && crate::layer::supported() {
        return Presentation::Rail;
    }
    presentation_for(session)
}

/// Whether the rail is a Wayland layer surface, which the session places (`layer.rs`).
fn layered() -> bool {
    #[cfg(target_os = "linux")]
    {
        crate::layer::docked()
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

/// A layer surface is on whichever output the session put it, and the rail is told only whether
/// the pointer is over it. So the decisions are made against one stand-in display that is never
/// left, with the pointer either in the middle of the rail or at [`LAYER_AWAY`].
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
const LAYER_SCREEN: Screen = Screen {
    bounds: Rect {
        x: -100_000.0,
        y: -100_000.0,
        width: 300_000.0,
        height: 300_000.0,
    },
    area: Rect {
        x: 0.0,
        y: 0.0,
        width: 4000.0,
        height: 3000.0,
    },
    unit: 1.0,
};
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
const LAYER_AWAY: (f64, f64) = (-50_000.0, -50_000.0);

/// The shapes the rail takes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Shape {
    Collapsed,
    Expanded,
    Wide,
}

/// Where the rail goes on a display whose usable `area` is given. `unit` is how many of the
/// area's units make one logical pixel. The strip is centred on the area and the panel fills its
/// height, so the strip's buttons stay where they are when the panel opens around them. A
/// display too small for a shape gets what fits.
pub fn frame(area: Rect, unit: f64, edge: Edge, shape: Shape) -> Rect {
    let margin = MARGIN * unit;
    let room_width = (area.width - 2.0 * margin).max(1.0);
    let room_height = (area.height - 2.0 * margin).max(1.0);
    let (width, height) = match shape {
        Shape::Collapsed => (COLLAPSED_WIDTH * unit, COLLAPSED_HEIGHT * unit),
        Shape::Expanded => (EXPANDED_WIDTH * unit, room_height),
        Shape::Wide => (WIDE_WIDTH * unit, room_height),
    };
    let width = width.min(room_width).round();
    let height = height.min(room_height).round();
    let x = match edge {
        Edge::Left => area.x + margin,
        Edge::Right => area.x + area.width - margin - width,
    };
    Rect {
        x: x.round(),
        y: (area.y + (area.height - height) / 2.0).round(),
        width,
        height,
    }
}

/// One display, in the space positions are worked out in: its whole `bounds`, the `area` a
/// window may use, and how many units make one logical pixel there.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Screen {
    pub bounds: Rect,
    pub area: Rect,
    pub unit: f64,
}

/// How long the pointer has been where it is, in ticks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Dwell {
    inside: u8,
    outside: u8,
    elsewhere: u8,
    /// Whether resting on the strip may open the panel. A rail that has just closed under the
    /// pointer would open again at once, so the pointer has to leave the strip first.
    armed: bool,
}

impl Default for Dwell {
    fn default() -> Self {
        Dwell {
            inside: 0,
            outside: 0,
            elsewhere: 0,
            armed: true,
        }
    }
}

/// What the pointer thread looks at.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Glance {
    pub expanded: bool,
    /// Opened to stay: by the shortcut, a launch or a click on a view button.
    pub held: bool,
    /// The window has the keyboard.
    pub focused: bool,
    /// Something keeps the window as it is: a dialog, a sign-in in the browser, a drag, a pin.
    pub kept: bool,
    /// Resting on the strip opens the panel.
    pub hover: bool,
    pub frame: Option<Rect>,
    /// The work area of the display the rail is on.
    pub area: Option<Rect>,
}

/// What the pointer's position asks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Act {
    Stay,
    /// Move the collapsed rail to the display at this index.
    Follow(usize),
    /// Open the panel until the pointer leaves.
    Peek,
    /// Close a peek.
    Retreat,
}

/// One tick of the pointer thread. Only a collapsed rail follows the pointer to another display,
/// only a peek nobody is using closes by itself, and a pointer between displays changes nothing.
pub fn decide(glance: &Glance, dwell: &mut Dwell, pointer: (f64, f64), screens: &[Screen]) -> Act {
    let Some(index) = screens
        .iter()
        .position(|screen| screen.bounds.contains(pointer))
    else {
        return Act::Stay;
    };
    let on = &screens[index];
    if glance.expanded {
        dwell.inside = 0;
        dwell.elsewhere = 0;
        let near = glance
            .frame
            .is_some_and(|frame| frame.grown(REACH * on.unit).contains(pointer));
        if glance.held || glance.focused || glance.kept || near {
            dwell.outside = 0;
            return Act::Stay;
        }
        dwell.outside += 1;
        if dwell.outside < LEAVE_TICKS {
            return Act::Stay;
        }
        dwell.outside = 0;
        return Act::Retreat;
    }
    dwell.outside = 0;
    if glance.area != Some(on.area) {
        dwell.inside = 0;
        dwell.elsewhere += 1;
        // A rail that has not been placed yet goes to the pointer's display at once.
        if glance.area.is_some() && dwell.elsewhere < FOLLOW_TICKS {
            return Act::Stay;
        }
        dwell.elsewhere = 0;
        return Act::Follow(index);
    }
    dwell.elsewhere = 0;
    if !glance.frame.is_some_and(|frame| frame.contains(pointer)) {
        dwell.inside = 0;
        dwell.armed = true;
        return Act::Stay;
    }
    if !glance.hover || !dwell.armed {
        return Act::Stay;
    }
    dwell.inside += 1;
    if dwell.inside < PEEK_TICKS {
        return Act::Stay;
    }
    dwell.inside = 0;
    Act::Peek
}

/// What is kept between launches.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Settings {
    pub edge: Edge,
    /// Resting the pointer on the strip opens the panel.
    pub hover: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            edge: Edge::Right,
            hover: true,
        }
    }
}

impl Settings {
    /// Reads the settings file. A missing or damaged file, or a value that is not one of the
    /// choices, gives the default: a setting that cannot be read must not stop the application.
    pub fn load(path: &Path) -> Settings {
        let defaults = Settings::default();
        let Ok(text) = std::fs::read_to_string(path) else {
            return defaults;
        };
        let Ok(Value::Object(saved)) = serde_json::from_str::<Value>(&text) else {
            return defaults;
        };
        Settings {
            edge: saved
                .get("edge")
                .and_then(Value::as_str)
                .and_then(Edge::named)
                .unwrap_or(defaults.edge),
            hover: saved
                .get("hover")
                .and_then(Value::as_bool)
                .unwrap_or(defaults.hover),
        }
    }

    /// Writes the settings file through a temporary file, so a crash leaves the old one whole.
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(folder) = path.parent() {
            std::fs::create_dir_all(folder)?;
        }
        let text = json!({"edge": self.edge.name(), "hover": self.hover}).to_string();
        let temporary = path.with_extension("json.tmp");
        std::fs::write(&temporary, text)?;
        std::fs::rename(&temporary, path)
    }
}

#[derive(Debug, Clone, Default)]
struct State {
    /// Whether the rail is on screen at all; the tray's Show or Hide changes it.
    shown: bool,
    expanded: bool,
    held: bool,
    wide: bool,
    focused: bool,
    /// A layer surface's open panel has the keyboard to itself (`layer::Keyboard::Exclusive`).
    #[cfg(target_os = "linux")]
    grab: bool,
    /// The pointer has been over the panel since it took the keyboard.
    #[cfg(target_os = "linux")]
    grab_entered: bool,
    /// The display the rail is on: its work area and unit.
    area: Option<Rect>,
    unit: f64,
    frame: Option<Rect>,
    dwell: Dwell,
    screens: Vec<Screen>,
    /// Ticks until the displays are read again.
    screens_due: u8,
}

/// The rail state the application keeps.
pub struct Rail {
    presentation: Presentation,
    path: Option<PathBuf>,
    settings: Mutex<Settings>,
    state: Mutex<State>,
    stop: Arc<AtomicBool>,
    /// A tick is waiting for the main thread. Another is not queued behind it.
    pending: Arc<AtomicBool>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Rail {
    /// `path` is the settings file, or `None` to keep nothing between launches.
    pub fn new(presentation: Presentation, path: Option<PathBuf>) -> Rail {
        let settings = path.as_deref().map(Settings::load).unwrap_or_default();
        Rail {
            presentation,
            path,
            settings: Mutex::new(settings),
            state: Mutex::new(State {
                shown: true,
                ..State::default()
            }),
            stop: Arc::default(),
            pending: Arc::default(),
        }
    }

    fn is_rail(&self) -> bool {
        self.presentation == Presentation::Rail
    }

    fn shape(&self) -> Shape {
        let state = lock(&self.state);
        match (state.expanded, state.wide) {
            (false, _) => Shape::Collapsed,
            (true, false) => Shape::Expanded,
            (true, true) => Shape::Wide,
        }
    }

    pub fn status(&self) -> Value {
        let settings = *lock(&self.settings);
        let state = lock(&self.state);
        // The ordinary window is always the whole panel.
        let rail = self.is_rail();
        json!({
            "presentation": self.presentation.name(),
            "shown": state.shown,
            "expanded": !rail || state.expanded,
            "held": !rail || state.held,
            "wide": state.wide,
            "edge": settings.edge.name(),
            "hover": settings.hover,
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
}

/// The window as the rail: no frame, above other windows, on every workspace, absent from the
/// taskbar, and not shown until it has been placed.
pub fn shape<'a, R: Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    let builder = builder
        .inner_size(COLLAPSED_WIDTH, COLLAPSED_HEIGHT)
        .decorations(false)
        // GTK does not resize a window that may not be resized. Without a frame there is
        // nothing to drag on Linux; on Windows a frameless window that may be resized has a
        // border a person can drag, so it may not be there.
        .resizable(cfg!(target_os = "linux"))
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .shadow(true)
        .focused(false)
        .visible(false)
        // A click on the strip reaches the page although the window does not have the keyboard.
        .accept_first_mouse(true);
    // On Linux the page draws the rounded corners, where a compositor shows what is behind
    // them. macOS rounds the panel itself (`panel.rs`) and Windows 11 rounds a window that has
    // a shadow.
    #[cfg(target_os = "linux")]
    let builder = builder.transparent(true);
    if material() {
        // Each system applies the first effect in the list that it has: the popover material on
        // macOS, which follows the light or dark appearance, and Mica on Windows 11. A Windows
        // that has no Mica leaves the see-through window with the page's own tint.
        return builder.transparent(true).effects(
            EffectsBuilder::new()
                .effects([Effect::Popover, Effect::Mica])
                .state(EffectState::Active)
                .radius(CORNER_RADIUS)
                .build(),
        );
    }
    builder
}

/// Whether the rail's window has the system's own material behind the page: a vibrancy view on
/// macOS and Mica on Windows 11. Linux has no such material to ask for, so the page is solid
/// there. `OPEN_SESAME_MATERIAL=off` gives a solid page in any build, which is the way back if a
/// system draws the material badly.
pub fn material() -> bool {
    let wanted = std::env::var("OPEN_SESAME_MATERIAL").as_deref() != Ok("off");
    wanted && cfg!(any(target_os = "macos", windows))
}

/// How the page draws its background, handed to it before any script runs (`window.rs`):
/// `"material"` where the system's material shows through a see-through page, `"page"` where
/// the window is see-through with nothing behind it and the page draws the rounded window
/// itself (Linux), and `"solid"` for the ordinary window and for a rail with neither.
pub fn surface(presentation: Presentation) -> &'static str {
    match presentation {
        Presentation::Window => "solid",
        Presentation::Rail if cfg!(target_os = "linux") => "page",
        Presentation::Rail if material() => "material",
        Presentation::Rail => "solid",
    }
}

/// The settings file, or `None` to keep the settings in memory. See the note at the top.
fn settings_path() -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    if let Some(folder) = std::env::var_os("OPEN_SESAME_DEV_CONFIG_DIR") {
        return Some(PathBuf::from(folder).join(SETTINGS_FILE));
    }
    None
}

/// Keeps the rail state and, for a rail, starts the thread that asks where the pointer is. The
/// rail is placed and shown by that thread's first tick.
pub fn start<R: Runtime>(app: &AppHandle<R>, presentation: Presentation) {
    let rail = Rail::new(presentation, settings_path());
    let (stop, pending) = (Arc::clone(&rail.stop), Arc::clone(&rail.pending));
    #[cfg(target_os = "linux")]
    let edge = lock(&rail.settings).edge;
    app.manage(rail);
    if presentation != Presentation::Rail {
        return;
    }
    // On Wayland the window becomes a layer surface before it is first shown.
    #[cfg(target_os = "linux")]
    if summon::session() == Session::Wayland {
        let window = app.get_webview_window(MAIN_WINDOW);
        if !window
            .as_ref()
            .is_some_and(|window| crate::layer::dock(window, edge))
        {
            // Nothing can place the window now. It is shown where the session puts it.
            eprintln!("open-sesame: the window could not be docked against the screen edge");
            if let Some(window) = window {
                let _ = window.show();
            }
            return;
        }
    }
    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("rail-pointer".into())
        .spawn(move || {
            while !stop.load(Ordering::SeqCst) {
                // Displays and the pointer are asked for on the main thread, where GTK and
                // AppKit want it; a main thread that is busy gets one tick, not a queue of them.
                if !pending.swap(true, Ordering::SeqCst) {
                    let (handle, done) = (app.clone(), Arc::clone(&pending));
                    let queued = app.run_on_main_thread(move || {
                        tick(&handle);
                        done.store(false, Ordering::SeqCst);
                    });
                    if queued.is_err() {
                        pending.store(false, Ordering::SeqCst);
                    }
                }
                std::thread::sleep(TICK);
            }
        });
    if let Err(error) = spawned {
        eprintln!("open-sesame: the rail cannot follow the pointer: {error}");
    }
}

/// Ends the pointer thread. Called on the way out.
pub fn stop<R: Runtime>(app: &AppHandle<R>) {
    if let Some(rail) = app.try_state::<Rail>() {
        rail.stop.store(true, Ordering::SeqCst);
    }
}

/// Whether the window is the rail.
pub fn active<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.try_state::<Rail>().is_some_and(|rail| rail.is_rail())
}

/// Whether the panel is open only until the pointer leaves or the window loses the keyboard.
pub fn peeking<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.try_state::<Rail>().is_some_and(|rail| {
        let state = lock(&rail.state);
        rail.is_rail() && state.expanded && !state.held
    })
}

/// The displays, in the space positions are worked out in.
fn screens<R: Runtime>(app: &AppHandle<R>) -> Vec<Screen> {
    if layered() {
        return vec![LAYER_SCREEN];
    }
    let Ok(monitors) = app.available_monitors() else {
        return Vec::new();
    };
    monitors
        .iter()
        .map(|monitor| {
            let scale = monitor.scale_factor();
            // On macOS a monitor's physical values are its points times its own scale.
            let (divide, unit) = if cfg!(target_os = "macos") {
                (scale, 1.0)
            } else {
                (1.0, scale)
            };
            let rect = |x: i32, y: i32, width: u32, height: u32| Rect {
                x: f64::from(x) / divide,
                y: f64::from(y) / divide,
                width: f64::from(width) / divide,
                height: f64::from(height) / divide,
            };
            let (position, size, area) = (monitor.position(), monitor.size(), monitor.work_area());
            Screen {
                bounds: rect(position.x, position.y, size.width, size.height),
                area: rect(
                    area.position.x,
                    area.position.y,
                    area.size.width,
                    area.size.height,
                ),
                unit,
            }
        })
        .collect()
}

/// Where the pointer is, in the same space as [`screens`].
fn pointer<R: Runtime>(app: &AppHandle<R>) -> Option<(f64, f64)> {
    #[cfg(debug_assertions)]
    if let Some(stand_in) = stand_in_pointer() {
        return Some(stand_in);
    }
    #[cfg(target_os = "linux")]
    if layered() {
        let window = app.get_webview_window(MAIN_WINDOW)?;
        let frame = app
            .try_state::<Rail>()
            .and_then(|rail| lock(&rail.state).frame);
        return Some(match frame {
            Some(frame) if crate::layer::pointer_over(&window) => {
                (frame.x + frame.width / 2.0, frame.y + frame.height / 2.0)
            }
            _ => LAYER_AWAY,
        });
    }
    let at = app.cursor_position().ok()?;
    // On macOS the pointer's physical position is its points times the primary display's scale.
    let divide = if cfg!(target_os = "macos") {
        app.primary_monitor()
            .ok()
            .flatten()
            .map_or(1.0, |monitor| monitor.scale_factor())
    } else {
        1.0
    };
    Some((at.x / divide, at.y / divide))
}

/// A development build started with `OPEN_SESAME_DEV_POINTER` naming a file takes the pointer's
/// position from that file while it holds two numbers, in the space of [`screens`]. A
/// launched-app check moves the rail this way without moving the pointer of a person who is
/// using the machine; what it shows is labelled synthetic. A release build never reads it.
#[cfg(debug_assertions)]
fn stand_in_pointer() -> Option<(f64, f64)> {
    let path = std::env::var_os("OPEN_SESAME_DEV_POINTER")?;
    let text = std::fs::read_to_string(path).ok()?;
    let mut numbers = text.split_whitespace().map(str::parse::<f64>);
    match (numbers.next(), numbers.next()) {
        (Some(Ok(x)), Some(Ok(y))) => Some((x, y)),
        _ => None,
    }
}

/// One look at the pointer, on the main thread.
fn tick<R: Runtime>(app: &AppHandle<R>) {
    let Some(rail) = app.try_state::<Rail>() else {
        return;
    };
    if !lock(&rail.state).shown {
        return;
    }
    let Some(pointer) = pointer(app) else {
        return;
    };
    #[cfg(target_os = "linux")]
    if layered() {
        loosen(app, &rail, pointer != LAYER_AWAY);
    }
    let reread = {
        let mut state = lock(&rail.state);
        let due = state.screens_due == 0
            || !state
                .screens
                .iter()
                .any(|screen| screen.bounds.contains(pointer));
        state.screens_due = if due {
            SCREEN_TICKS
        } else {
            state.screens_due - 1
        };
        due
    };
    if reread {
        let found = screens(app);
        lock(&rail.state).screens = found;
    }
    let kept = app
        .try_state::<summon::Summon>()
        .is_some_and(|summon| !summon.free());
    let hover = lock(&rail.settings).hover;
    let remembered = lock(&rail.state).focused;
    let focused = has_keyboard(app, remembered);
    let act = {
        let mut state = lock(&rail.state);
        let glance = Glance {
            expanded: state.expanded,
            held: state.held,
            focused,
            kept,
            hover,
            frame: state.frame,
            area: state.area,
        };
        let mut dwell = state.dwell;
        let act = decide(&glance, &mut dwell, pointer, &state.screens);
        state.dwell = dwell;
        match act {
            Act::Follow(index) => {
                let screen = state.screens[index];
                state.area = Some(screen.area);
                state.unit = screen.unit;
            }
            Act::Peek => {
                state.expanded = true;
                state.held = false;
            }
            Act::Retreat => state.expanded = false,
            Act::Stay => {}
        }
        act
    };
    if act != Act::Stay {
        #[cfg(debug_assertions)]
        eprintln!("open-sesame: rail {act:?}");
        settle(app, Focus::Leave);
    }
}

/// A layer surface's open panel takes the keyboard to itself, because a Wayland session gives a
/// layer surface the keyboard in no other way without a click, and would keep it from every
/// other window for as long as it is open. Once the pointer has been over the panel and has left
/// it, the panel goes back to having the keyboard only after a click, and the session gives the
/// keyboard to the window that had it before. A panel the pointer never visits keeps the
/// keyboard until it closes.
#[cfg(target_os = "linux")]
fn loosen<R: Runtime>(app: &AppHandle<R>, rail: &Rail, over: bool) {
    let loosened = {
        let mut state = lock(&rail.state);
        if !(state.expanded && state.grab) {
            state.grab_entered = false;
            false
        } else if over {
            state.grab_entered = true;
            false
        } else if state.grab_entered {
            state.grab = false;
            state.grab_entered = false;
            true
        } else {
            false
        }
    };
    if loosened {
        if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
            crate::layer::keyboard(&window, crate::layer::Keyboard::OnDemand);
        }
    }
}

/// What a change does with the keyboard.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Focus {
    /// Give it to the page, for a panel a command opened from the strip or from nothing: the
    /// shortcut, `open-sesame --toggle`, a launch. A layer surface then also comes up on the
    /// output the session picks now, which is the one a person is working on.
    Summon,
    /// Give it to the page.
    Take,
    /// Give it back to whatever had it before the panel.
    Release,
    /// Leave it where it is.
    Leave,
}

/// Makes the window match the state: its frame, whether it is on screen and who has the
/// keyboard, and tells the page. On the main thread.
fn settle<R: Runtime>(app: &AppHandle<R>, focus: Focus) {
    let (Some(rail), Some(window)) = (app.try_state::<Rail>(), app.get_webview_window(MAIN_WINDOW))
    else {
        return;
    };
    let shape = rail.shape();
    let edge = lock(&rail.settings).edge;
    let remembered = lock(&rail.state).focused;
    let had_keyboard = has_keyboard(app, remembered);
    let (shown, target) = {
        let mut state = lock(&rail.state);
        let target = state
            .area
            .map(|area| frame(area, state.unit.max(0.1), edge, shape));
        // A display the rail was never placed on has no frame yet; the first tick gives one.
        let changed = target.filter(|target| state.frame != Some(*target));
        if target.is_some() {
            state.frame = target;
        }
        (
            state.shown,
            changed.map(|frame| (frame, state.screens.clone())),
        )
    };
    #[cfg(target_os = "linux")]
    if layered() {
        let (keyboard, placed) = {
            let mut state = lock(&rail.state);
            if !state.expanded {
                state.grab = false;
                // The strip has given the keyboard up. A session with no other window to give
                // it to says so only later, when the keyboard next moves.
                state.focused = false;
            } else if matches!(focus, Focus::Summon | Focus::Take) {
                state.grab = true;
                state.grab_entered = false;
            }
            (
                crate::layer::keyboard_for(state.expanded, state.grab),
                state.frame.is_some(),
            )
        };
        if !shown {
            let _ = window.hide();
        } else if placed {
            #[cfg(debug_assertions)]
            eprintln!("open-sesame: rail layer {shape:?} {keyboard:?}");
            crate::layer::settle(&window, edge, shape, keyboard, focus == Focus::Summon);
        }
        emit(app, rail.status());
        return;
    }
    if !shown {
        let _ = window.hide();
    } else {
        if let Some((frame, screens)) = target {
            place(&window, frame, &screens);
        }
        let placed = {
            let state = lock(&rail.state);
            state.frame.map(|frame| (frame, state.screens.clone()))
        };
        if placed.is_some() {
            reveal(
                &window,
                focus,
                shape != Shape::Collapsed,
                had_keyboard,
                placed,
            );
        }
    }
    emit(app, rail.status());
}

/// Moves and sizes the window.
fn place<R: Runtime>(window: &WebviewWindow<R>, frame: Rect, screens: &[Screen]) {
    #[cfg(debug_assertions)]
    eprintln!(
        "open-sesame: rail frame {} {} {} {}",
        frame.x, frame.y, frame.width, frame.height
    );
    #[cfg(target_os = "macos")]
    {
        // AppKit counts from the bottom of the display whose origin is the origin.
        let primary = screens
            .iter()
            .find(|screen| screen.bounds.x == 0.0 && screen.bounds.y == 0.0)
            .map(|screen| screen.bounds.height);
        if let Some(height) = primary {
            if crate::panel::set_frame(window, frame, height) {
                return;
            }
        }
        let _ = window.set_size(tauri::LogicalSize::new(frame.width, frame.height));
        let _ = window.set_position(tauri::LogicalPosition::new(frame.x, frame.y));
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = screens;
        let _ = window.set_size(tauri::PhysicalSize::new(
            frame.width as u32,
            frame.height as u32,
        ));
        let (x, y) = (frame.x as i32, frame.y as i32);
        // On Windows a window with a shadow and no frame keeps the unseen border a frame has for
        // resizing, 8 pixels at 100% on the left, right and bottom. A position is that border's
        // corner, so the border is taken off for what a person sees to be where `frame` says.
        #[cfg(windows)]
        let (x, y) = match (window.inner_position(), window.outer_position()) {
            (Ok(inner), Ok(outer)) => (x - (inner.x - outer.x), y - (inner.y - outer.y)),
            _ => (x, y),
        };
        let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
    }
}

/// Puts the placed window on screen and settles the keyboard. `expanded` is whether the panel is
/// open, `had_keyboard` whether the window had the keyboard when the change began, and `frame`
/// where the window belongs.
fn reveal<R: Runtime>(
    window: &WebviewWindow<R>,
    focus: Focus,
    expanded: bool,
    had_keyboard: bool,
    frame: Option<(Rect, Vec<Screen>)>,
) {
    #[cfg(target_os = "macos")]
    {
        // Tauri's `show` makes a window key. The strip must appear without taking the
        // keyboard from the application a person is typing in. A panel that does not
        // activate needs none of what the other systems do below.
        let _ = (expanded, had_keyboard, &frame);
        let done = match focus {
            Focus::Summon | Focus::Take => crate::panel::show(window),
            Focus::Release => crate::panel::rest(window),
            Focus::Leave => crate::panel::order_front(window),
        };
        if done {
            return;
        }
    }
    // Elsewhere the strip is a window that refuses the keyboard, so a click on it does not take
    // the keyboard from the application a person is typing in, and the open panel is one that
    // accepts it.
    let _ = window.set_focusable(expanded);
    let visible = window.is_visible().unwrap_or(false);
    if focus == Focus::Release && had_keyboard && visible {
        // A window that has the keyboard keeps it when it starts refusing it. Leaving the
        // screen for a moment gives the keyboard back to the window that had it before.
        let _ = window.hide();
        let _ = window.show();
        // A window manager may place a window again when it comes back.
        if let Some((frame, screens)) = frame {
            place(window, frame, &screens);
        }
    } else if !visible {
        let _ = window.show();
    }
    if matches!(focus, Focus::Summon | Focus::Take) {
        let _ = window.set_focus();
    }
}

fn emit<R: Runtime>(app: &AppHandle<R>, status: Value) {
    if let Some(state) = app.try_state::<crate::AppState>() {
        (state.emit)(json!({"event": CHANGED_EVENT, "status": status}));
    }
}

/// Runs `change` on the main thread and waits for it, so a caller's reply describes the rail
/// after the change. A caller already on the main thread runs it in place.
fn on_main<R: Runtime>(app: &AppHandle<R>, change: impl FnOnce(&AppHandle<R>) + Send + 'static) {
    let (done, finished) = std::sync::mpsc::channel();
    let handle = app.clone();
    let queued = app.run_on_main_thread(move || {
        change(&handle);
        let _ = done.send(());
    });
    if queued.is_ok() {
        let _ = finished.recv_timeout(Duration::from_secs(2));
    }
}

/// Opens the panel to stay and gives it the keyboard, for a command: the shortcut, a launch,
/// the Dock, a tray click.
pub fn open<R: Runtime>(app: &AppHandle<R>) {
    open_as(app, true);
}

/// `summoned` is whether a command asked, and not a click in the page.
fn open_as<R: Runtime>(app: &AppHandle<R>, summoned: bool) {
    on_main(app, move |app| {
        let Some(rail) = app.try_state::<Rail>() else {
            return;
        };
        let was_open = {
            let mut state = lock(&rail.state);
            let was_open = state.shown && state.expanded;
            state.shown = true;
            state.expanded = true;
            state.held = true;
            was_open
        };
        #[cfg(debug_assertions)]
        eprintln!("open-sesame: rail opened");
        settle(
            app,
            if summoned && !was_open {
                Focus::Summon
            } else {
                Focus::Take
            },
        );
    });
}

/// Closes the panel to the strip and gives the keyboard back.
pub fn collapse<R: Runtime>(app: &AppHandle<R>) {
    on_main(app, |app| {
        let Some(rail) = app.try_state::<Rail>() else {
            return;
        };
        {
            let mut state = lock(&rail.state);
            if !state.expanded {
                return;
            }
            state.expanded = false;
            state.held = false;
            // The pointer is likely still over the strip; it must leave before a rest opens it.
            state.dwell = Dwell {
                armed: false,
                ..Dwell::default()
            };
        }
        #[cfg(debug_assertions)]
        eprintln!("open-sesame: rail collapsed");
        settle(app, Focus::Release);
    });
}

/// The shortcut and `open-sesame --toggle`: a panel that is open to stay closes, and anything
/// else, a peek and a hidden rail included, opens to stay. Answers which it was, in the terms of
/// a press on the ordinary window (`summon::Press`): `Hide` for closing to the strip, `Show`
/// for opening. The rail is above other windows, so it is never `Forward`.
pub fn toggle<R: Runtime>(app: &AppHandle<R>) -> summon::Press {
    let open_to_stay = app.try_state::<Rail>().is_some_and(|rail| {
        let state = lock(&rail.state);
        state.shown && state.expanded && state.held
    });
    if open_to_stay {
        collapse(app);
        summon::Press::Hide
    } else {
        open(app);
        summon::Press::Show
    }
}

/// The tray's menu item: takes the rail off the screen (`Hide`), or puts the strip back
/// (`Show`).
pub fn toggle_shown<R: Runtime>(app: &AppHandle<R>) -> summon::Press {
    let was_shown = app
        .try_state::<Rail>()
        .is_some_and(|rail| lock(&rail.state).shown);
    on_main(app, |app| {
        let Some(rail) = app.try_state::<Rail>() else {
            return;
        };
        let shown = {
            let mut state = lock(&rail.state);
            state.shown = !state.shown;
            state.expanded = false;
            state.held = false;
            state.dwell = Dwell::default();
            state.shown
        };
        #[cfg(debug_assertions)]
        eprintln!(
            "open-sesame: rail {}",
            if shown { "shown" } else { "hidden" }
        );
        settle(app, Focus::Leave);
    });
    if was_shown {
        summon::Press::Hide
    } else {
        summon::Press::Show
    }
}

/// Whether a person is typing in the rail's window. `remembered` is what the window's own focus
/// events last said, which is the answer on macOS and Linux. On Windows those events follow the
/// web view inside the window: it says it has the keyboard as soon as it exists, while another
/// application's window is still the one in front, and says nothing more when the window does
/// come to the front. So Windows is asked which window is in front.
fn has_keyboard<R: Runtime>(app: &AppHandle<R>, remembered: bool) -> bool {
    #[cfg(windows)]
    {
        #[link(name = "user32")]
        extern "system" {
            fn GetForegroundWindow() -> *mut std::ffi::c_void;
        }
        if let Some(Ok(hwnd)) = app
            .get_webview_window(MAIN_WINDOW)
            .map(|window| window.hwnd())
        {
            // SAFETY: the function takes nothing and returns a handle that is only compared.
            return unsafe { GetForegroundWindow() } == hwnd.0;
        }
    }
    let _ = app;
    remembered
}

/// The window got or lost the keyboard. Answers whether that is news: a session may say again
/// that the window lost a keyboard the rail already knows it gave up, and nothing should close
/// because of it.
pub fn focus_changed<R: Runtime>(app: &AppHandle<R>, focused: bool) -> bool {
    let Some(rail) = app.try_state::<Rail>() else {
        return true;
    };
    let changed = {
        let mut state = lock(&rail.state);
        let changed = state.focused != focused;
        state.focused = focused;
        changed
    };
    #[cfg(debug_assertions)]
    if rail.is_rail() {
        eprintln!("open-sesame: rail keyboard {focused}");
    }
    changed
}

/// Answers a rail method the gate has allowed.
pub fn handle<R: Runtime>(
    app: &AppHandle<R>,
    method: &str,
    params: &Map<String, Value>,
) -> BridgeResult {
    let rail = app
        .try_state::<Rail>()
        .ok_or_else(|| BridgeError::from(UNSUPPORTED))?;
    match method {
        "rail.status" => Ok(rail.status()),
        "rail.set" => {
            // The ordinary window has nothing to set.
            if !rail.is_rail() {
                return Err(BridgeError::from(NOT_ON_OS));
            }
            let change = Change::read(params)?;
            if change.edge.is_some() || change.hover.is_some() {
                let settings = {
                    let current = *lock(&rail.settings);
                    Settings {
                        edge: change.edge.unwrap_or(current.edge),
                        hover: change.hover.unwrap_or(current.hover),
                    }
                };
                rail.save(&settings)?;
                *lock(&rail.settings) = settings;
            }
            if let Some(wide) = change.wide {
                lock(&rail.state).wide = wide;
            }
            match change.expanded {
                Some(true) => open_as(app, false),
                Some(false) => collapse(app),
                None => {}
            }
            // An edge or a width that changed moves the window even when nothing opened.
            on_main(app, |app| settle(app, Focus::Leave));
            Ok(rail.status())
        }
        _ => Err(BridgeError::from(UNSUPPORTED)),
    }
}

/// What a `rail.set` request asks for. Every field is optional; one that is present must have
/// its type, an unknown one is refused, and a request that asks for nothing is refused.
#[derive(Debug, Default, PartialEq, Eq)]
struct Change {
    expanded: Option<bool>,
    wide: Option<bool>,
    edge: Option<Edge>,
    hover: Option<bool>,
}

impl Change {
    fn read(params: &Map<String, Value>) -> Result<Change, BridgeError> {
        let invalid = || BridgeError::from(INVALID_REQUEST);
        let mut change = Change::default();
        for (name, value) in params {
            match (name.as_str(), value) {
                ("expanded", Value::Bool(expanded)) => change.expanded = Some(*expanded),
                ("wide", Value::Bool(wide)) => change.wide = Some(*wide),
                ("hover", Value::Bool(hover)) => change.hover = Some(*hover),
                ("edge", Value::String(edge)) => {
                    change.edge = Some(Edge::named(edge).ok_or_else(invalid)?);
                }
                _ => return Err(invalid()),
            }
        }
        if change == Change::default() {
            return Err(invalid());
        }
        Ok(change)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const AREA: Rect = Rect {
        x: 0.0,
        y: 25.0,
        width: 1728.0,
        height: 1055.0,
    };

    fn screen(x: f64, width: f64, unit: f64) -> Screen {
        Screen {
            bounds: Rect {
                x,
                y: 0.0,
                width,
                height: 1080.0,
            },
            area: Rect {
                x,
                y: 30.0,
                width,
                height: 1050.0,
            },
            unit,
        }
    }

    #[test]
    fn the_strip_is_centred_against_the_edge_and_the_panel_fills_the_height() {
        let strip = frame(AREA, 1.0, Edge::Right, Shape::Collapsed);
        assert_eq!(
            strip,
            Rect {
                x: 1728.0 - 8.0 - 56.0,
                y: (25.0_f64 + (1055.0 - 376.0) / 2.0).round(),
                width: 56.0,
                height: 376.0
            }
        );
        let panel = frame(AREA, 1.0, Edge::Right, Shape::Expanded);
        assert_eq!(
            panel,
            Rect {
                x: 1728.0 - 8.0 - 400.0,
                y: 33.0,
                width: 400.0,
                height: 1039.0
            }
        );
        // The panel opens around the strip: same outer edge, and the strip's middle is its own.
        assert_eq!(strip.x + strip.width, panel.x + panel.width);
        let middle = |rect: Rect| rect.y + rect.height / 2.0;
        assert!((middle(strip) - middle(panel)).abs() <= 0.5);
        let wide = frame(AREA, 1.0, Edge::Left, Shape::Wide);
        assert_eq!((wide.x, wide.width), (8.0, 860.0));
        assert_eq!(frame(AREA, 1.0, Edge::Left, Shape::Collapsed).x, 8.0);
    }

    #[test]
    fn sizes_follow_the_unit_and_never_leave_the_area() {
        // Physical pixels at 150%: every logical size is one and a half times as many.
        let area = Rect {
            x: 2560.0,
            y: 0.0,
            width: 2880.0,
            height: 1620.0,
        };
        let strip = frame(area, 1.5, Edge::Right, Shape::Collapsed);
        assert_eq!((strip.width, strip.height), (84.0, 564.0));
        assert_eq!(strip.x, 2560.0 + 2880.0 - 12.0 - 84.0);
        // A display smaller than a shape gets what fits, inside the margins.
        let small = Rect {
            x: 0.0,
            y: 0.0,
            width: 640.0,
            height: 300.0,
        };
        for shape in [Shape::Collapsed, Shape::Expanded, Shape::Wide] {
            let placed = frame(small, 1.0, Edge::Right, shape);
            assert!(
                placed.x >= 8.0 && placed.x + placed.width <= 632.0,
                "{shape:?}"
            );
            assert!(
                placed.y >= 8.0 && placed.y + placed.height <= 292.0,
                "{shape:?}"
            );
        }
        assert_eq!(frame(small, 1.0, Edge::Right, Shape::Wide).width, 624.0);
    }

    fn glance(expanded: bool, area: Option<Rect>, frame: Option<Rect>) -> Glance {
        Glance {
            expanded,
            held: false,
            focused: false,
            kept: false,
            hover: true,
            frame,
            area,
        }
    }

    #[test]
    fn a_collapsed_rail_follows_the_pointer_to_another_display() {
        let screens = [screen(0.0, 1920.0, 1.0), screen(1920.0, 2560.0, 2.0)];
        let mut dwell = Dwell::default();
        // Not placed yet: it goes where the pointer is at once.
        assert_eq!(
            decide(
                &glance(false, None, None),
                &mut dwell,
                (2000.0, 500.0),
                &screens
            ),
            Act::Follow(1)
        );
        let on_second = glance(false, Some(screens[1].area), None);
        assert_eq!(
            decide(&on_second, &mut dwell, (2100.0, 500.0), &screens),
            Act::Stay
        );
        // The pointer crosses to the first display: one tick is not enough, the second is.
        assert_eq!(
            decide(&on_second, &mut dwell, (100.0, 500.0), &screens),
            Act::Stay
        );
        assert_eq!(
            decide(&on_second, &mut dwell, (120.0, 500.0), &screens),
            Act::Follow(0)
        );
        // A pointer that came back before the second tick moves nothing.
        assert_eq!(
            decide(&on_second, &mut dwell, (100.0, 500.0), &screens),
            Act::Stay
        );
        assert_eq!(
            decide(&on_second, &mut dwell, (2100.0, 500.0), &screens),
            Act::Stay
        );
        assert_eq!(
            decide(&on_second, &mut dwell, (100.0, 500.0), &screens),
            Act::Stay
        );
        // A pointer on no display, as between two readings of them, changes nothing.
        assert_eq!(
            decide(&on_second, &mut dwell, (-50.0, -50.0), &screens),
            Act::Stay
        );
    }

    #[test]
    fn an_open_panel_stays_on_its_display() {
        let screens = [screen(0.0, 1920.0, 1.0), screen(1920.0, 2560.0, 1.0)];
        let panel = frame(screens[0].area, 1.0, Edge::Right, Shape::Expanded);
        let mut open = glance(true, Some(screens[0].area), Some(panel));
        open.held = true;
        let mut dwell = Dwell::default();
        for _ in 0..20 {
            assert_eq!(
                decide(&open, &mut dwell, (3000.0, 500.0), &screens),
                Act::Stay
            );
        }
    }

    #[test]
    fn resting_on_the_strip_opens_a_peek_and_leaving_closes_it() {
        let screens = [screen(0.0, 1920.0, 1.0)];
        let area = screens[0].area;
        let strip = frame(area, 1.0, Edge::Right, Shape::Collapsed);
        let on_strip = (strip.x + 10.0, strip.y + 10.0);
        let collapsed = glance(false, Some(area), Some(strip));
        let mut dwell = Dwell::default();
        assert_eq!(
            decide(&collapsed, &mut dwell, on_strip, &screens),
            Act::Stay
        );
        assert_eq!(
            decide(&collapsed, &mut dwell, on_strip, &screens),
            Act::Peek
        );
        // A pointer that only passes over does not open it.
        let mut dwell = Dwell::default();
        assert_eq!(
            decide(&collapsed, &mut dwell, on_strip, &screens),
            Act::Stay
        );
        assert_eq!(
            decide(&collapsed, &mut dwell, (500.0, 500.0), &screens),
            Act::Stay
        );
        assert_eq!(
            decide(&collapsed, &mut dwell, on_strip, &screens),
            Act::Stay
        );
        // With hover off, resting does nothing.
        let mut off = collapsed;
        off.hover = false;
        let mut dwell = Dwell::default();
        for _ in 0..10 {
            assert_eq!(decide(&off, &mut dwell, on_strip, &screens), Act::Stay);
        }

        let panel = frame(area, 1.0, Edge::Right, Shape::Expanded);
        let peek = glance(true, Some(area), Some(panel));
        let away = (500.0, 500.0);
        let mut dwell = Dwell::default();
        // Inside the panel, and just outside it, the peek stays.
        for at in [(panel.x + 5.0, 600.0), (panel.x - 10.0, 600.0)] {
            for _ in 0..20 {
                assert_eq!(decide(&peek, &mut dwell, at, &screens), Act::Stay);
            }
        }
        for _ in 1..LEAVE_TICKS {
            assert_eq!(decide(&peek, &mut dwell, away, &screens), Act::Stay);
        }
        assert_eq!(decide(&peek, &mut dwell, away, &screens), Act::Retreat);
        // A pointer that came back in time starts the count again.
        let mut dwell = Dwell::default();
        for _ in 1..LEAVE_TICKS {
            assert_eq!(decide(&peek, &mut dwell, away, &screens), Act::Stay);
        }
        assert_eq!(
            decide(&peek, &mut dwell, (panel.x + 5.0, 600.0), &screens),
            Act::Stay
        );
        assert_eq!(decide(&peek, &mut dwell, away, &screens), Act::Stay);
    }

    #[test]
    fn a_panel_someone_is_using_does_not_close_when_the_pointer_leaves() {
        let screens = [screen(0.0, 1920.0, 1.0)];
        let area = screens[0].area;
        let panel = frame(area, 1.0, Edge::Right, Shape::Expanded);
        let peek = glance(true, Some(area), Some(panel));
        for change in [
            |glance: &mut Glance| glance.held = true,
            |glance: &mut Glance| glance.focused = true,
            |glance: &mut Glance| glance.kept = true,
        ] {
            let mut used = peek;
            change(&mut used);
            let mut dwell = Dwell::default();
            for _ in 0..(LEAVE_TICKS * 3) {
                assert_eq!(
                    decide(&used, &mut dwell, (100.0, 100.0), &screens),
                    Act::Stay
                );
            }
        }
    }

    #[test]
    fn a_rail_closed_under_the_pointer_waits_for_it_to_leave() {
        let screens = [screen(0.0, 1920.0, 1.0)];
        let area = screens[0].area;
        let strip = frame(area, 1.0, Edge::Right, Shape::Collapsed);
        let on_strip = (strip.x + 10.0, strip.y + 10.0);
        let collapsed = glance(false, Some(area), Some(strip));
        let mut dwell = Dwell {
            armed: false,
            ..Dwell::default()
        };
        for _ in 0..10 {
            assert_eq!(
                decide(&collapsed, &mut dwell, on_strip, &screens),
                Act::Stay
            );
        }
        assert_eq!(
            decide(&collapsed, &mut dwell, (500.0, 500.0), &screens),
            Act::Stay
        );
        assert_eq!(
            decide(&collapsed, &mut dwell, on_strip, &screens),
            Act::Stay
        );
        assert_eq!(
            decide(&collapsed, &mut dwell, on_strip, &screens),
            Act::Peek
        );
    }

    #[test]
    fn wayland_keeps_the_ordinary_window() {
        assert_eq!(presentation_for(Session::Wayland), Presentation::Window);
        for session in [Session::MacOs, Session::Windows, Session::X11] {
            assert_eq!(presentation_for(session), Presentation::Rail, "{session:?}");
        }
    }

    #[test]
    fn settings_are_read_back_and_a_damaged_file_gives_the_defaults() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("nested").join(SETTINGS_FILE);
        assert_eq!(Settings::load(&path), Settings::default());
        assert_eq!(
            Settings::default(),
            Settings {
                edge: Edge::Right,
                hover: true
            }
        );
        let chosen = Settings {
            edge: Edge::Left,
            hover: false,
        };
        chosen.save(&path).unwrap();
        assert_eq!(Settings::load(&path), chosen);
        assert!(!path.with_extension("json.tmp").exists());
        for damaged in ["", "[]", "{\"edge\":\"top\",\"hover\":\"yes\"}", "{"] {
            std::fs::write(&path, damaged).unwrap();
            assert_eq!(Settings::load(&path), Settings::default(), "{damaged}");
        }
    }

    #[test]
    fn a_change_names_known_fields_with_their_types() {
        let read = |value: Value| Change::read(value.as_object().unwrap());
        assert_eq!(
            read(json!({"expanded": true, "wide": false, "edge": "left", "hover": false})),
            Ok(Change {
                expanded: Some(true),
                wide: Some(false),
                edge: Some(Edge::Left),
                hover: Some(false),
            })
        );
        for bad in [
            json!({}),
            json!({"expanded": "yes"}),
            json!({"edge": "top"}),
            json!({"edge": true}),
            json!({"wide": 1}),
            json!({"unexpected": true}),
            json!({"expanded": true, "unexpected": true}),
        ] {
            assert_eq!(
                read(bad.clone()),
                Err(BridgeError::from(INVALID_REQUEST)),
                "{bad}"
            );
        }
    }

    #[test]
    fn the_rail_methods_are_all_ported() {
        for method in METHODS {
            assert!(open_sesame_core::gate::PORTED.contains(method), "{method}");
        }
    }

    #[test]
    fn the_ordinary_window_reports_itself_as_the_whole_panel() {
        let window = Rail::new(Presentation::Window, None).status();
        assert_eq!(window["presentation"], json!("window"));
        assert_eq!(window["expanded"], json!(true));
        let rail = Rail::new(Presentation::Rail, None).status();
        assert_eq!(
            rail,
            json!({"presentation": "rail", "shown": true, "expanded": false, "held": false,
                   "wide": false, "edge": "right", "hover": true})
        );
    }
}
