//! macOS only: the main window as a panel (issue #71).
//!
//! A normal window cannot be shown on another application's full-screen space: showing it
//! activates this application, and macOS switches to the space where its windows live. A panel
//! that does not activate the application and is allowed beside a full-screen window can. The
//! window keeps its title bar, close button and resizing; closing still hides it.

use tauri::{Manager, Runtime, WebviewWindow};
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, ManagerExt, StyleMask, WebviewPanelManager, WebviewWindowExt,
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
pub fn adopt(window: &WebviewWindow) -> tauri::Result<()> {
    let panel = window.to_panel::<SummonPanel>()?;
    panel
        .set_style_mask(StyleMask::new().nonactivating_panel().into())
        .map_err(|error| std::io::Error::other(format!("{error:?}")))?;
    // Shown on whichever space is in front, a full-screen one included, and nowhere else.
    panel.set_collection_behavior(
        CollectionBehavior::new()
            .move_to_active_space()
            .full_screen_auxiliary()
            .into(),
    );
    // Hiding is this application's decision (the close button, the toggle, the blur rule).
    panel.set_hides_on_deactivate(false);
    Ok(())
}

/// Shows the panel and gives the page the keyboard without activating the application. Returns
/// `false` when the window is not a panel, which only a test's window is.
///
/// The panel crate's `show_and_make_key` is not used: it makes the panel's content view the
/// first responder, which takes the keyboard from the web view, so what was typed after the
/// shortcut reached nothing (issue #142). Here the panel is ordered in front and made key, and
/// then the web view is made the first responder. The web view keeps the element the page had
/// focused, a terminal's input for instance, and gives it the keyboard again.
pub fn show<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    let app = window.app_handle();
    // Without the plugin the lookup below would panic; only a test runs without it.
    if app.try_state::<WebviewPanelManager<R>>().is_none() {
        return false;
    }
    match app.get_webview_panel(window.label()) {
        // AppKit aborts the process when a window is ordered from another thread, and the
        // callers are a second launch, the shortcut and the bridge, none on the main thread.
        // The web view's focus is asked from the same task, so it follows the ordering.
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
