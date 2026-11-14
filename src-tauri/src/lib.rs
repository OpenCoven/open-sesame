//! Open Sesame desktop application: the Tauri shell around the headless core.
//!
//! This crate owns the window, the tray and one command, [`router::bridge_request`]. Every request
//! from the UI passes the core's gate before anything runs. The window label is not an isolation
//! boundary: any script in the main document has the whole bridge, so the main window loads only
//! bundled pages and no third-party script may ever be loaded there.

mod events;
mod router;
mod tray;
mod window;

pub use open_sesame_core as core;

use open_sesame_core::protocol::Emit;
use open_sesame_core::Core;
use std::sync::Arc;
use tauri::{Manager, RunEvent};

/// What the command and the features share.
pub struct AppState {
    pub core: Arc<Core>,
    /// Sends a host message to the main window. Features that report something later, such as
    /// a pane exiting, send it through this.
    pub emit: Emit,
}

/// Builds and runs the application. Returns when the application exits.
pub fn run() {
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![router::bridge_request])
        .setup(|app| {
            app.manage(AppState {
                core: Arc::new(Core::new()),
                emit: events::emitter(app.handle()),
            });
            window::create_main(app.handle())?;
            tray::create(app.handle())?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Open Sesame could not start");
    app.run(|app, event| match event {
        // Every way out ends here: the tray's Quit, the application menu and a system shutdown.
        RunEvent::Exit => {
            if let Some(state) = app.try_state::<AppState>() {
                state.core.shutdown();
            }
        }
        // Clicking the Dock icon brings back the window that closing only hid.
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => window::show(app),
        _ => {}
    });
}
