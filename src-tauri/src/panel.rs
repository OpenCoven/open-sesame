//! macOS only: the main window as a panel (issue #71).
//!
//! A normal window cannot be shown on another application's full-screen space: showing it
//! activates this application, and macOS switches to the space where its windows live. A panel
//! that does not activate the application and is allowed beside a full-screen window can. As
//! the ordinary window it keeps its title bar, close button and resizing; closing still hides
//! it. As the rail (`rail.rs`) it has no frame, floats above other windows on every Space, and
//! is moved, shown and given the keyboard only through the functions here.

use crate::rail::{Presentation, Rect, CORNER_RADIUS};
use tauri::{Manager, Runtime, WebviewWindow};
// The `tauri_panel!` macro below brings `msg_send!`, `NSRect`, `NSPoint` and `NSSize` into this
// module's scope itself; importing them here as well is an error.
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, ManagerExt, PanelHandle, PanelLevel, StyleMask,
    WebviewPanelManager, WebviewWindowExt,
};

tauri_panel! {
    panel!(SummonPanel {
        config: {
            can_become_key_window: true,
            can_become_main_window: true,
            is_floating_panel: false
        }
    })
}

/// Turns the freshly built window into the panel.
pub fn adopt(window: &WebviewWindow, presentation: Presentation) -> tauri::Result<()> {
    let panel = window.to_panel::<SummonPanel>()?;
    let rail = presentation == Presentation::Rail;
    let mask = if rail {
        StyleMask::empty().borderless().nonactivating_panel()
    } else {
        StyleMask::new().nonactivating_panel()
    };
    panel
        .set_style_mask(mask.into())
        .map_err(|error| std::io::Error::other(format!("{error:?}")))?;
    let behavior = if rail {
        // On every Space at once, a full-screen one included, and left out of window cycling:
        // the strip is always there, so it never has to be moved to the Space in front.
        CollectionBehavior::new()
            .can_join_all_spaces()
            .stationary()
            .ignores_cycle()
            .full_screen_auxiliary()
    } else {
        // Shown on whichever space is in front, a full-screen one included, and nowhere else.
        CollectionBehavior::new()
            .move_to_active_space()
            .full_screen_auxiliary()
    };
    panel.set_collection_behavior(behavior.into());
    // Hiding is this application's decision (the close button, the toggle, the blur rule).
    panel.set_hides_on_deactivate(false);
    if rail {
        // Above ordinary windows and below the Dock, the menu bar and their menus.
        panel.set_level(PanelLevel::Floating.value());
        panel.set_floating_panel(true);
        // The corners are cut from the content view's layer, with nothing private: the window
        // is clear, the layer is rounded and clips the web view, and the shadow follows it.
        panel.set_transparent(true);
        panel.set_corner_radius(CORNER_RADIUS);
        let content = panel.content_view();
        // SAFETY: `layer` is a `CALayer` once `set_corner_radius` has asked the view for one,
        // and `setMasksToBounds:` takes a `BOOL`.
        unsafe {
            let layer: *mut tauri_nspanel::AnyObject = msg_send![&*content, layer];
            if !layer.is_null() {
                let _: () = msg_send![layer, setMasksToBounds: true];
            }
        }
        panel.set_has_shadow(true);
    }
    Ok(())
}

/// The panel behind `window`, or `None` when the window is not a panel, which only a test's
/// window is.
fn panel_of<R: Runtime>(window: &WebviewWindow<R>) -> Option<PanelHandle<R>> {
    let app = window.app_handle();
    // Without the plugin the lookup below would panic; only a test runs without it.
    app.try_state::<WebviewPanelManager<R>>()?;
    app.get_webview_panel(window.label()).ok()
}

/// Moves and sizes the rail in one step. `frame` is in points from the top left of the display
/// whose origin is the origin, and `primary_height` is that display's height: AppKit counts
/// from its bottom. Returns `false` when the window is not a panel.
pub fn set_frame<R: Runtime>(window: &WebviewWindow<R>, frame: Rect, primary_height: f64) -> bool {
    let Some(panel) = panel_of(window) else {
        return false;
    };
    let rect = NSRect::new(
        NSPoint::new(frame.x, primary_height - frame.y - frame.height),
        NSSize::new(frame.width, frame.height),
    );
    window
        .run_on_main_thread(move || {
            // SAFETY: `setFrame:display:` takes an `NSRect` and a `BOOL`, on the main thread.
            unsafe {
                let _: () = msg_send![panel.as_panel(), setFrame: rect, display: true];
            }
        })
        .is_ok()
}

/// Puts the rail on screen without giving it the keyboard: the strip appears, and a peek opens,
/// while a person types in another application. Returns `false` when the window is not a panel.
pub fn order_front<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    let Some(panel) = panel_of(window) else {
        return false;
    };
    window
        .run_on_main_thread(move || panel.order_front_regardless())
        .is_ok()
}

/// Keeps the rail on screen and gives the keyboard back to the application that had it before
/// the panel took it. Returns `false` when the window is not a panel.
pub fn rest<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    let Some(panel) = panel_of(window) else {
        return false;
    };
    window
        .run_on_main_thread(move || {
            panel.order_front_regardless();
            panel.resign_key_window();
        })
        .is_ok()
}

/// Shows the panel and gives the page the keyboard without activating the application. Returns
/// `false` when the window is not a panel, which only a test's window is.
///
/// The panel crate's `show_and_make_key` is not used: it asks for the panel's content view as
/// the first responder, the content view refuses, and AppKit makes the window itself the first
/// responder. That took the keyboard from the web view, so what was typed after the shortcut
/// reached nothing (issue #142). Here the panel is ordered in front and made key, and then the
/// web view is made the first responder. In a launched app that gave the keyboard back to the
/// element the page had focused, a shell's input (synthetic input on macOS, issue #142).
pub fn show<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    let app = window.app_handle();
    // Without the plugin the lookup below would panic; only a test runs without it.
    if app.try_state::<WebviewPanelManager<R>>().is_none() {
        return false;
    }
    match app.get_webview_panel(window.label()) {
        // AppKit aborts the process when a window is ordered from another thread, and a second
        // launch, the shortcut and the bridge call from other threads. A caller already on the
        // main thread, as the Dock and the tray are, runs the task in place. The web view's
        // focus is asked from the same task, so it follows the ordering.
        Ok(panel) => {
            let webview = window.as_ref().clone();
            window
                .run_on_main_thread(move || {
                    panel.order_front_regardless();
                    panel.make_key_window();
                    let _ = webview.set_focus();
                })
                .is_ok()
        }
        Err(_) => false,
    }
}
