//! Declares `bridge_request` as the application's only command. A declared command is refused
//! unless a capability grants it, and the only capability names the main window.

fn main() {
    let manifest = tauri_build::AppManifest::new().commands(&["bridge_request"]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("the Tauri build configuration is valid");
}
