//! Wayland: the rail as a layer-shell surface.
//!
//! A Wayland application cannot place its window. A compositor that has the wlr-layer-shell
//! protocol (KDE, Sway, Hyprland and the other wlroots compositors; not GNOME) lets a surface
//! ask to be docked against an edge of an output, above other windows, and `libgtk-layer-shell`
//! turns a GTK window into such a surface. The library is opened when the application starts
//! and is not linked, so the application starts without it. Where the library or the protocol
//! is missing the window is the ordinary one (`rail::presentation`), and
//! `OPEN_SESAME_LAYER_SHELL=off` asks for the ordinary window in any build.
//!
//! What the session decides and this module cannot: which output the surface is on (the one
//! the session picks when the surface appears, in practice the one a person is working on) and
//! where the pointer is while it is over another application.
//!
//! Every function here is called on the main thread, where GTK wants it.

use crate::rail::{
    Edge, Shape, COLLAPSED_HEIGHT, COLLAPSED_WIDTH, EXPANDED_WIDTH, MARGIN, WIDE_WIDTH,
};
use gtk::glib::translate::ToGlibPtr;
use gtk::prelude::*;
use std::ffi::{c_char, c_int, c_void, CStr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::{Runtime, WebviewWindow};

type Window = *mut gtk::ffi::GtkWindow;

/// The functions of gtk-layer-shell's C API that the rail uses, by their names there.
struct Library {
    is_supported: unsafe extern "C" fn() -> c_int,
    init_for_window: unsafe extern "C" fn(Window),
    set_namespace: unsafe extern "C" fn(Window, *const c_char),
    set_layer: unsafe extern "C" fn(Window, c_int),
    set_anchor: unsafe extern "C" fn(Window, c_int, c_int),
    set_margin: unsafe extern "C" fn(Window, c_int, c_int),
    set_keyboard_mode: unsafe extern "C" fn(Window, c_int),
    set_monitor: unsafe extern "C" fn(Window, *mut gtk::gdk::ffi::GdkMonitor),
}

// The values of the library's enumerations.
const LAYER_OVERLAY: c_int = 3;
const EDGE_LEFT: c_int = 0;
const EDGE_RIGHT: c_int = 1;
const EDGE_TOP: c_int = 2;
const EDGE_BOTTOM: c_int = 3;

static LIBRARY: OnceLock<Option<Library>> = OnceLock::new();
static DOCKED: AtomicBool = AtomicBool::new(false);

/// One function of the opened library.
///
/// # Safety
/// `F` must be the type of the C function called `name`.
unsafe fn function<F: Copy>(handle: *mut c_void, name: &CStr) -> Option<F> {
    let symbol = libc::dlsym(handle, name.as_ptr());
    if symbol.is_null() || std::mem::size_of::<F>() != std::mem::size_of::<*mut c_void>() {
        return None;
    }
    Some(std::mem::transmute_copy::<*mut c_void, F>(&symbol))
}

fn load() -> Option<Library> {
    // SAFETY: the name is a C string and a null handle is refused. The library is never closed.
    let handle = unsafe {
        libc::dlopen(
            c"libgtk-layer-shell.so.0".as_ptr(),
            libc::RTLD_NOW | libc::RTLD_LOCAL,
        )
    };
    if handle.is_null() {
        return None;
    }
    // SAFETY: each field's type is the signature gtk-layer-shell declares for the function of
    // that name. A library too old to have one of them is not used.
    unsafe {
        Some(Library {
            is_supported: function(handle, c"gtk_layer_is_supported")?,
            init_for_window: function(handle, c"gtk_layer_init_for_window")?,
            set_namespace: function(handle, c"gtk_layer_set_namespace")?,
            set_layer: function(handle, c"gtk_layer_set_layer")?,
            set_anchor: function(handle, c"gtk_layer_set_anchor")?,
            set_margin: function(handle, c"gtk_layer_set_margin")?,
            set_keyboard_mode: function(handle, c"gtk_layer_set_keyboard_mode")?,
            set_monitor: function(handle, c"gtk_layer_set_monitor")?,
        })
    }
}

fn library() -> Option<&'static Library> {
    LIBRARY.get_or_init(load).as_ref()
}

/// Whether this session can dock the window: the library is installed and the compositor has
/// the protocol. Asked once GTK has started.
pub fn supported() -> bool {
    if std::env::var("OPEN_SESAME_LAYER_SHELL").as_deref() == Ok("off") {
        return false;
    }
    // SAFETY: the function takes nothing and only asks the display GTK has opened.
    library().is_some_and(|library| unsafe { (library.is_supported)() } != 0)
}

/// Whether the window was made a layer surface.
pub fn docked() -> bool {
    DOCKED.load(Ordering::SeqCst)
}

/// Who may have the keyboard.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Keyboard {
    /// The surface never has it: the strip.
    None,
    /// A click in the surface gives it the keyboard and a click elsewhere takes it away.
    OnDemand,
    /// The surface has it until it gives it up. A session offers a layer surface no other way to
    /// take the keyboard without a click.
    Exclusive,
}

impl Keyboard {
    fn value(self) -> c_int {
        match self {
            Keyboard::None => 0,
            Keyboard::Exclusive => 1,
            Keyboard::OnDemand => 2,
        }
    }
}

/// The keyboard for a rail: none for the strip, the open panel's own while it holds it (`grab`),
/// and otherwise a click away.
pub fn keyboard_for(expanded: bool, grab: bool) -> Keyboard {
    match (expanded, grab) {
        (false, _) => Keyboard::None,
        (true, true) => Keyboard::Exclusive,
        (true, false) => Keyboard::OnDemand,
    }
}

/// How a shape is docked: the edges it is tied to and the size it asks for. A surface tied to
/// the top and the bottom is as tall as the output allows, whatever height it asks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Plan {
    pub left: bool,
    pub right: bool,
    pub fill: bool,
    pub width: i32,
    pub height: i32,
}

pub fn plan(edge: Edge, shape: Shape) -> Plan {
    let width = match shape {
        Shape::Collapsed => COLLAPSED_WIDTH,
        Shape::Expanded => EXPANDED_WIDTH,
        Shape::Wide => WIDE_WIDTH,
    };
    Plan {
        left: edge == Edge::Left,
        right: edge == Edge::Right,
        fill: shape != Shape::Collapsed,
        width: width as i32,
        height: COLLAPSED_HEIGHT as i32,
    }
}

fn raw(surface: &gtk::ApplicationWindow) -> Window {
    let window: &gtk::Window = surface.upcast_ref();
    window.to_glib_none().0
}

/// Makes the window a layer surface, as the strip. It has to happen before the window is first
/// shown; a window that already has a surface is left alone and `false` comes back.
pub fn dock<R: Runtime>(window: &WebviewWindow<R>, edge: Edge) -> bool {
    let (Some(library), Ok(surface)) = (library(), window.gtk_window()) else {
        return false;
    };
    if surface.is_realized() {
        return false;
    }
    let pointer = raw(&surface);
    // SAFETY: `pointer` is the live GTK window, on the main thread, before it has a surface.
    unsafe {
        (library.init_for_window)(pointer);
        (library.set_namespace)(pointer, c"open-sesame".as_ptr());
        (library.set_layer)(pointer, LAYER_OVERLAY);
        for side in [EDGE_LEFT, EDGE_RIGHT, EDGE_TOP, EDGE_BOTTOM] {
            (library.set_margin)(pointer, side, MARGIN as c_int);
        }
        (library.set_keyboard_mode)(pointer, Keyboard::None.value());
    }
    DOCKED.store(true, Ordering::SeqCst);
    arrange(&surface, library, plan(edge, Shape::Collapsed));
    true
}

fn arrange(surface: &gtk::ApplicationWindow, library: &Library, plan: Plan) {
    let pointer = raw(surface);
    // SAFETY: `pointer` is the live GTK window that `dock` made a layer surface.
    unsafe {
        (library.set_anchor)(pointer, EDGE_LEFT, c_int::from(plan.left));
        (library.set_anchor)(pointer, EDGE_RIGHT, c_int::from(plan.right));
        (library.set_anchor)(pointer, EDGE_TOP, c_int::from(plan.fill));
        (library.set_anchor)(pointer, EDGE_BOTTOM, c_int::from(plan.fill));
    }
    surface.set_size_request(plan.width, plan.height);
    surface.resize(plan.width, plan.height);
}

/// Makes the docked window match the rail: its shape, who may have the keyboard, and that it
/// is on screen. `rehome` takes a surface that is on screen off it first, so that it comes
/// back on the output the session picks now; a surface that was off the screen always does.
pub fn settle<R: Runtime>(
    window: &WebviewWindow<R>,
    edge: Edge,
    shape: Shape,
    keyboard: Keyboard,
    rehome: bool,
) {
    let (Some(library), Ok(surface)) = (library(), window.gtk_window()) else {
        return;
    };
    let visible = window.is_visible().unwrap_or(false);
    if rehome && visible {
        let _ = window.hide();
    }
    arrange(&surface, library, plan(edge, shape));
    let pointer = raw(&surface);
    // SAFETY: as in `arrange`. No output is named, so the session picks one when the surface
    // next appears.
    unsafe {
        (library.set_keyboard_mode)(pointer, keyboard.value());
        if rehome || !visible {
            (library.set_monitor)(pointer, std::ptr::null_mut());
        }
    }
    if rehome || !visible {
        let _ = window.show();
    }
}

/// Changes only who may have the keyboard.
pub fn keyboard<R: Runtime>(window: &WebviewWindow<R>, keyboard: Keyboard) {
    let (Some(library), Ok(surface)) = (library(), window.gtk_window()) else {
        return;
    };
    // SAFETY: as in `arrange`.
    unsafe { (library.set_keyboard_mode)(raw(&surface), keyboard.value()) };
}

/// Whether the pointer is over the application's own surface, which is all a Wayland session
/// tells an application about the pointer.
pub fn pointer_over<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    let Ok(surface) = window.gtk_window() else {
        return false;
    };
    surface
        .display()
        .default_seat()
        .and_then(|seat| seat.pointer())
        .is_some_and(|pointer| pointer.window_at_position().0.is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_strip_is_tied_to_one_edge_and_the_panel_also_to_the_top_and_bottom() {
        let strip = plan(Edge::Right, Shape::Collapsed);
        assert_eq!((strip.left, strip.right, strip.fill), (false, true, false));
        assert_eq!((strip.width, strip.height), (56, 376));
        let panel = plan(Edge::Right, Shape::Expanded);
        assert_eq!((panel.left, panel.right, panel.fill), (false, true, true));
        assert_eq!(panel.width, 400);
        let wide = plan(Edge::Left, Shape::Wide);
        assert_eq!((wide.left, wide.right, wide.fill), (true, false, true));
        assert_eq!(wide.width, 860);
    }

    #[test]
    fn the_strip_never_has_the_keyboard_and_the_panel_holds_it_only_while_it_grabs() {
        assert_eq!(keyboard_for(false, false), Keyboard::None);
        assert_eq!(keyboard_for(false, true), Keyboard::None);
        assert_eq!(keyboard_for(true, true), Keyboard::Exclusive);
        assert_eq!(keyboard_for(true, false), Keyboard::OnDemand);
        // The library's own numbers, which are not in this order.
        assert_eq!(
            [
                Keyboard::None.value(),
                Keyboard::Exclusive.value(),
                Keyboard::OnDemand.value()
            ],
            [0, 1, 2]
        );
    }
}
