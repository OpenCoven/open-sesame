//! The tray icon. Its menu shows or hides the window and quits; a click only opens the menu,
//! because Tauri's tray emits no click events on Linux and the menu works everywhere.

use crate::window;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
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
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            TOGGLE => window::toggle(app),
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
