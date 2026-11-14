//! Choosing a project folder and showing one in the system's file manager (issue #74), through
//! the dialog and opener plugins. The plugins are used from Rust only: the page is granted none
//! of their commands.

use open_sesame_core::protocol::{BridgeError, BridgeResult};
use serde_json::{json, Map, Value};
use std::path::Path;
use tauri::{Runtime, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

/// Methods answered here.
pub const METHODS: &[&str] = &["project.chooseFolder", "project.reveal"];

const UNAVAILABLE: &str = "Folder unavailable.";

/// Blocking: `project.chooseFolder` waits for the person. Never call it on the UI thread.
pub fn handle<R: Runtime>(
    window: &WebviewWindow<R>,
    method: &str,
    params: &Map<String, Value>,
) -> BridgeResult {
    match method {
        "project.chooseFolder" => {
            let chosen = window
                .dialog()
                .file()
                .set_parent(window)
                .set_title("Use project folder")
                .blocking_pick_folder()
                .and_then(|folder| folder.into_path().ok());
            Ok(chosen_reply(chosen.as_deref()))
        }
        _ => {
            let path = revealable(params)?;
            window
                .opener()
                .reveal_item_in_dir(path)
                .map(|()| Value::Bool(true))
                .map_err(|_| BridgeError::from(UNAVAILABLE))
        }
    }
}

/// `{"path"}`: the chosen folder, or an empty string when the dialog was cancelled, as the
/// Swift host replies.
fn chosen_reply(chosen: Option<&Path>) -> Value {
    json!({"path": chosen.map(|path| path.to_string_lossy().into_owned()).unwrap_or_default()})
}

/// The path of a `project.reveal` request: absolute, and something that exists.
fn revealable(params: &Map<String, Value>) -> Result<&Path, BridgeError> {
    params
        .get("path")
        .and_then(Value::as_str)
        .filter(|path| !path.contains('\0'))
        .map(Path::new)
        .filter(|path| path.is_absolute() && path.exists())
        .ok_or_else(|| BridgeError::from(UNAVAILABLE))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(value: Value) -> Map<String, Value> {
        value.as_object().cloned().unwrap()
    }

    #[test]
    fn only_an_existing_absolute_path_can_be_revealed() {
        let here = std::env::current_dir().unwrap();
        assert_eq!(
            revealable(&params(json!({"path": here}))),
            Ok(here.as_path())
        );
        for request in [
            json!({}),
            json!({"path": 5}),
            json!({"path": ""}),
            json!({"path": "relative/folder"}),
            json!({"path": here.join("no-such-folder-here")}),
            json!({"path": format!("{}\u{0}", here.display())}),
        ] {
            assert_eq!(
                revealable(&params(request)),
                Err(BridgeError::from(UNAVAILABLE))
            );
        }
    }

    #[test]
    fn a_cancelled_dialog_is_an_empty_path() {
        assert_eq!(chosen_reply(None), json!({"path": ""}));
        let here = std::env::current_dir().unwrap();
        assert_eq!(
            chosen_reply(Some(&here)),
            json!({"path": here.to_string_lossy()})
        );
    }
}
