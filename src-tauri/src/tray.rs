//! The tray icon. Its menu has one item that is one press on the window (it shows a hidden
//! window, brings one that is behind to the front and hides one that is in front, issue #115)
//! and one that quits, and it works everywhere. On macOS and Linux a click only opens the
//! menu: Tauri's tray emits no click events on Linux. On Windows a left click is the same
//! press, with a hidden window shown against the icon as a popover, and a right click opens
//! the menu (issue #71).
//! Where the window is the rail (`rail.rs`), the menu item takes the whole rail off the
//! screen and puts the strip back, and a left click on Windows opens or closes its panel.

use crate::{summon, window};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::AppHandle;

const TOGGLE: &str = "toggle";
const QUIT: &str = "quit";

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItemBuilder::with_id(TOGGLE, "Show or Hide Open Sesame").build(app)?;
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
            }
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            TOGGLE => {
                window::toggle_from_tray_menu(app);
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
