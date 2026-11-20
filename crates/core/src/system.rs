//! `system.info`: what the UI needs to know about this machine.
//!
//! The reply keeps the field names of the Python bridge it replaces. The gate answers
//! `system.info` itself while signed out, so this handler only runs for a signed-in caller.

use crate::gate::platform;
use serde_json::{json, Value};

/// The full `system.info` reply.
pub fn info() -> Value {
    json!({
        "available": true,
        "authenticated": true,
        "platform": platform(),
        "machine": machine(),
        "home": home(),
        "shell": shell(),
    })
}

/// This machine's host name, as the UI labels local panes with it.
pub(crate) fn machine() -> String {
    gethostname::gethostname().to_string_lossy().into_owned()
}

/// The user's home folder, or an empty string when the system does not report one.
fn home() -> String {
    std::env::home_dir()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// The shell named by the environment, or the system's plain default. Which shell a new pane
/// starts is decided with the terminals in issue #74.
fn shell() -> String {
    std::env::var("SHELL")
        .ok()
        .filter(|shell| !shell.is_empty())
        .unwrap_or_else(|| String::from(DEFAULT_SHELL))
}

#[cfg(windows)]
const DEFAULT_SHELL: &str = "powershell.exe";
#[cfg(not(windows))]
const DEFAULT_SHELL: &str = "/bin/sh";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn info_has_exactly_the_fields_the_ui_reads() {
        let info = info();
        let object = info.as_object().unwrap();
        let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "authenticated",
                "available",
                "home",
                "machine",
                "platform",
                "shell"
            ]
        );
        assert_eq!(object["available"], json!(true));
        assert_eq!(object["authenticated"], json!(true));
        assert_eq!(object["platform"], json!(platform()));
    }

    #[test]
    fn machine_home_and_shell_are_reported() {
        assert!(!machine().is_empty());
        assert!(std::path::Path::new(&home()).is_absolute());
        assert!(!shell().is_empty());
    }
}
