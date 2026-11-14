//! Open Sesame desktop application: the Tauri shell around the headless core.
//!
//! This crate owns the window, the tray and one command, [`router::bridge_request`]. Every request
//! from the UI passes the core's gate before anything runs. The window label is not an isolation
//! boundary: any script in the main document has the whole bridge, so the main window loads only
//! bundled pages and no third-party script may ever be loaded there.

mod events;
mod project;
mod router;
mod terminal;
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
        // Used from Rust only. The capability grants the page none of these plugins' commands.
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
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

#[cfg(test)]
mod test_support {
    /// Whether a process with this ID exists.
    #[cfg(unix)]
    pub fn alive(pid: u32) -> bool {
        // `kill -0` sends nothing; it only reports whether the process can be signalled.
        std::process::Command::new("kill")
            .args(["-0", &pid.to_string()])
            .stderr(std::process::Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
    }

    #[cfg(windows)]
    pub fn alive(pid: u32) -> bool {
        let filter = format!("PID eq {pid}");
        std::process::Command::new("tasklist")
            .args(["/FI", &filter, "/NH", "/FO", "CSV"])
            .output()
            .is_ok_and(|output| {
                String::from_utf8_lossy(&output.stdout).contains(&format!("\"{pid}\""))
            })
    }
}
