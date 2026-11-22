//! Attention signals (issue #80): which agent needs a decision, which is still working and
//! which has finished, without looking at every terminal.
//!
//! Claude Code reports what its sessions do through hooks. With the person's consent,
//! [`hook`] adds an HTTP hook for a few events to Claude Code's settings file. The change is
//! shown before it is written, and removing it puts the file back byte for byte. Claude Code
//! then posts each event to [`listener`], which accepts requests only on the loopback address
//! and only with the token in the hook's address. [`board`] turns the events into one state
//! per session.
//!
//! Only the event's name, the session, its folder, the tool's name and the notice's sentence
//! are kept. The transcript, the prompt and the tool's input are never read or stored, and the
//! listener never answers with a decision, so Claude Code asks the person as it always does.
//! Nothing here launches a CLI or touches a credential.

pub mod board;
pub mod hook;
pub mod listener;
