//! The tray icon. Its menu has one item that is one press on the window (it shows a hidden
//! window, brings one that is behind to the front and hides one that is in front, issue #115)
//! and one that quits, and it works everywhere. On macOS and Linux a click only opens the
//! menu: Tauri's tray emits no click events on Linux. On Windows a left click is the same
//! press, with a hidden window shown against the icon as a popover, and a right click opens
//! the menu (issue #71).
//! Where the window is the rail (`rail.rs`), the menu item takes the whole rail off the
//! screen and puts the strip back, and a left click on Windows opens or closes its panel.
//! The item's label names what choosing it does next, "Show Open Sesame" or "Hide Open
//! Sesame" (issue #115, the answer of 18 November 2026), and follows the window's state.

use crate::summon::{self, Press};
use crate::window;
use std::time::Duration;
use tauri::menu::{MenuBuilder, MenuItem, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime};

const TOGGLE: &str = "toggle";
const QUIT: &str = "quit";

/// The menu item that is one press on the window, kept so that its label can change.
struct Item<R: Runtime>(MenuItem<R>);

/// The item's label for what choosing it does. Bringing forward a window that is behind
/// shows it, so two labels cover the three outcomes.
pub fn label(press: Press) -> &'static str {
    match press {
        Press::Hide => "Hide Open Sesame",
        Press::Show | Press::Forward => "Show Open Sesame",
    }
}

/// Builds the menu item with the label for the state now and keeps it for [`refresh`].
pub(crate) fn manage_item<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<MenuItem<R>> {
    let text = window::tray_item_next(app).map_or(label(Press::Show), label);
    let item = MenuItemBuilder::with_id(TOGGLE, text).build(app)?;
    app.manage(Item(item.clone()));
    Ok(item)
}

/// Sets the item's label to what choosing it would do now (`window::tray_item_next`). Called
/// wherever that can change: the window gains or loses the keyboard, the icon is pressed, a
/// press acts on the window or it is shown or hidden, the rail starts, and the rail goes on or
/// off the screen.
pub fn refresh<R: Runtime>(app: &AppHandle<R>) {
    let (Some(item), Some(press)) = (app.try_state::<Item<R>>(), window::tray_item_next(app))
    else {
        return;
    };
    let _ = item.0.set_text(label(press));
}

/// Refreshes the label once `delay` has passed. What the item does also changes with time
/// alone, when an allowance runs out (`summon::TRAY_MENU_GRACE` after the window lost the
/// keyboard, `summon::TRAY_MENU_OPEN` after a press on the icon), and nothing else reports it.
/// The refresh itself runs on the main thread, where every other refresh runs, so an answer
/// worked out here cannot land on top of a newer one.
pub fn refresh_after<R: Runtime>(app: &AppHandle<R>, delay: Duration) {
    let app = app.clone();
    std::thread::spawn(move || {
        // A little after, because each allowance counts a moment equal to it as outside.
        std::thread::sleep(delay + Duration::from_millis(100));
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || refresh(&handle));
    });
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let toggle = manage_item(app)?;
    let quit = MenuItemBuilder::with_id(QUIT, "Quit Open Sesame").build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&toggle)
        .separator()
        .item(&quit)
        .build()?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Open Sesame")
        .menu(&menu)
        .show_menu_on_left_click(!cfg!(windows))
        .on_tray_icon_event(|tray, event| {
            // A press that opens the menu: what the window is doing is noted now, because the
            // menu may have the keyboard by the time its item is chosen (issue #115).
            if let TrayIconEvent::Click {
                button,
                button_state: MouseButtonState::Down,
                ..
            } = &event
            {
                if summon::opens_the_tray_menu(cfg!(windows), *button == MouseButton::Right) {
                    summon::tray_pressed(tray.app_handle());
                    refresh(tray.app_handle());
                    // The rail's label does not change with time.
                    if !crate::rail::active(tray.app_handle()) {
                        refresh_after(tray.app_handle(), summon::TRAY_MENU_OPEN);
                    }
                }
            }
            if let (
                true,
                TrayIconEvent::Click {
                    rect,
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                },
            ) = (cfg!(windows), event)
            {
                summon::tray_clicked(tray.app_handle(), rect);
                refresh(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            TOGGLE => {
                window::toggle_from_tray_menu(app);
                refresh(app);
            }
            // Exit runs the shutdown in `run`, so Quit and every other way out share one path.
            QUIT => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::summon::Press;

    /// Two words for three outcomes: bringing forward a window that is behind shows it.
    #[test]
    fn the_label_names_what_choosing_the_item_does() {
        assert_eq!(label(Press::Show), "Show Open Sesame");
        assert_eq!(label(Press::Forward), "Show Open Sesame");
        assert_eq!(label(Press::Hide), "Hide Open Sesame");
    }
}
