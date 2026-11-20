//! Open Sesame's headless core.
//!
//! Plain Rust with no Tauri dependency, so it builds and tests on macOS, Windows and Linux without
//! a window. The application crate owns the window and passes each UI request through
//! [`gate::dispatch`], which decides whether the request may run before any feature code does.
//! Allowed requests that need no window go to [`Core::handle`].

pub mod auth;
pub mod gate;
pub mod handler;
pub mod process;
pub mod protocol;
pub mod storage;
pub mod system;
pub mod terminal;

pub use handler::Core;
