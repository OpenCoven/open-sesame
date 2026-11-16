//! Open Sesame desktop application: the Tauri shell around the headless core.
//!
//! This crate owns the window, the tray and one command, [`router::bridge_request`]. Every request
//! from the UI passes the core's gate before anything runs. The window label is not an isolation
//! boundary: any script in the main document has the whole bridge, so the main window loads only
//! bundled pages and no third-party script may ever be loaded there.

mod auth;
mod data;
mod events;
#[cfg(target_os = "macos")]
mod panel;
mod project;
mod router;
#[cfg(debug_assertions)]
mod runtime_probe;
mod startup;
mod summon;
mod terminal;
mod tray;
mod window;

pub use open_sesame_core as core;

use open_sesame_core::protocol::Emit;
use open_sesame_core::storage::{Storage, StorageError};
use open_sesame_core::Core;
use std::sync::Arc;
use tauri::{Manager, RunEvent};

/// What the command and the features share.
pub struct AppState {
    pub core: Arc<Core>,
    pub startup: startup::Startup,
    /// Sends a host message to the main window. Features that report something later, such as
    /// a pane exiting, send it through this.
    pub emit: Emit,
}

impl AppState {
    /// Host features use the startup snapshot and the persisted per-tool path together.
    pub fn find_tool(
        &self,
        name: &str,
    ) -> Result<Option<std::path::PathBuf>, core::protocol::BridgeError> {
        self.core.find_tool(name, &self.startup.environment())
    }
}

/// Builds and runs the application. Returns when the application exits.
pub fn run() {
    let builder = tauri::Builder::default()
        // First, as the plugin requires: a second launch hands its arguments to the running
        // application and exits before it creates a window of its own.
        // On Windows and Linux the browser's sign-in callback arrives this way too: the plugin's
        // deep-link feature passes it to the deep-link plugin before this callback runs.
        .plugin(tauri_plugin_single_instance::init(|app, arguments, _| {
            summon::launched_again(app, &arguments);
        }))
        .plugin(summon::shortcut_plugin())
        .plugin(tauri_plugin_deep_link::init())
        // Used from Rust only. The capability grants the page none of these plugins' commands.
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());
    let app = builder
        .invoke_handler(tauri::generate_handler![router::bridge_request])
        .setup(|app| {
            let override_dir =
                std::env::var_os("OPEN_SESAME_DEV_CONFIG_DIR").map(std::path::PathBuf::from);
            let roots = app
                .path()
                .data_dir()
                .and_then(|data| {
                    app.path().home_dir().map(|home| data::Roots {
                        data,
                        home,
                        legacy_xdg_data: std::env::var_os("XDG_DATA_HOME")
                            .map(std::path::PathBuf::from),
                    })
                })
                .map_err(|error| StorageError::Unreadable(error.to_string()));
            let core = Arc::new(Core::new());
            data::start_storage(Arc::clone(&core), move || {
                roots
                    .and_then(|roots| data::directory(&roots, override_dir.as_deref()))
                    .and_then(|dir| Storage::open_in(&dir))
            });
            app.manage(AppState {
                core,
                startup: startup::Startup::start(core::process::ShellEnv::inherited()),
                emit: events::emitter(app.handle()),
            });
            // Before the window, so the page's first question about the session has an answer.
            auth::start(app.handle(), events::emitter(app.handle()));
            window::create_main(app.handle())?;
            tray::create(app.handle())?;
            // After the window exists, so a press that arrives at once has something to show.
            summon::start(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Open Sesame could not start");
    app.run(|app, event| match event {
        // Every way out ends here: the tray's Quit, the application menu and a system shutdown.
        RunEvent::Exit => {
            if let Some(auth) = app.try_state::<Arc<auth::Auth>>() {
                auth.shutdown();
            }
            if let Some(state) = app.try_state::<AppState>() {
                state.startup.shutdown();
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
