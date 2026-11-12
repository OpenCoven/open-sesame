//! Open Sesame desktop application.
//!
//! This crate is the workspace's application member. It has no Tauri dependency yet: the window,
//! tray and the single `bridge_request` command arrive with the Tauri shell in issue #70. Until
//! then it only pins the workspace layout and the dependency direction, application to core.

pub use open_sesame_core as core;
