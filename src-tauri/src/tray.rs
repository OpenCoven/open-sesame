//! The tray icon. Its menu shows or hides the window and quits, and works everywhere. On macOS
//! and Linux a click only opens the menu: Tauri's tray emits no click events on Linux. On
//! Windows a left click opens or closes the rail's panel, and a right click opens the menu
//! (issue #71). Where the window is the rail (`rail.rs`), the menu's Show or Hide takes the
//! whole rail off the screen and puts the strip back.

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
            TOGGLE => window::toggle_shown(app),
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
