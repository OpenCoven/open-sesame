//! The opt-in change to Claude Code's settings file: one HTTP hook per event read by
//! [`super::board`], pointing at [`super::listener`].
//!
//! [`plan`] is the exact text that would be written, so the page can show it before anything
//! is. It keeps every other setting and every hook of the person's own, in their order and in
//! their text: only the `hooks` member is written anew, and inside it only the arrays that gain
//! a hook. [`install`] keeps the file's bytes (or the fact that there was no file) in a backup
//! first. [`remove`] puts those bytes back exactly when the file is still what the install
//! wrote; when the person has changed it since, it takes out only the hooks with this address
//! and leaves their change. A file that does not parse is never written.

use serde::de::{Deserializer, MapAccess, Visitor};
use serde::Deserialize;
use serde_json::value::RawValue;
use serde_json::{json, Value};
use std::fmt;
use std::io::Write;
use std::path::{Path, PathBuf};

/// The events whose hooks are installed. Together they say when a session starts and ends,
/// when it works, when it needs the person and when its turn is over.
pub const EVENTS: &[&str] = &[
    "SessionStart",
    "UserPromptSubmit",
    "PermissionRequest",
    "PostToolUse",
    "PostToolUseFailure",
    "Notification",
    "Stop",
    "StopFailure",
    "SessionEnd",
];

/// Seconds Claude Code waits for an answer. The listener answers at once; when Open Sesame is
/// not running the connection is refused straight away.
pub const TIMEOUT_SECONDS: u64 = 5;

const UNREADABLE: &str =
    "Claude Code's settings file is not JSON that Open Sesame can read, so it was left alone.";
const NOT_AN_OBJECT: &str =
    "Claude Code's settings file does not hold one JSON object, so it was left alone.";
const UNKNOWN_HOOKS: &str = "Claude Code's settings file has hooks in a form Open Sesame does not know, so it was left alone.";
const BACKUP_DAMAGED: &str = "The copy Open Sesame kept of Claude Code's settings file cannot be read, so the file was left alone.";

/// A random 256-bit token, as URL-safe base64 without padding.
pub fn new_token() -> String {
    use base64::Engine;
    use ring::rand::SecureRandom;
    let mut bytes = [0u8; 32];
    ring::rand::SystemRandom::new()
        .fill(&mut bytes)
        .expect("the system's random source works");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

pub fn url(port: u16, token: &str) -> String {
    format!("http://127.0.0.1:{port}/hook/{token}")
}

/// A JSON object's members in the file's order, each value as its own text.
struct Ordered(Vec<(String, Box<RawValue>)>);

impl<'de> Deserialize<'de> for Ordered {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Members;
        impl<'de> Visitor<'de> for Members {
            type Value = Ordered;
            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("a JSON object")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Ordered, A::Error> {
                let mut members = Vec::new();
                while let Some(member) = map.next_entry::<String, Box<RawValue>>()? {
                    members.push(member);
                }
                Ok(Ordered(members))
            }
        }
        deserializer.deserialize_map(Members)
    }
}

/// The file's top-level object, or an empty one for a missing or empty file.
fn top(current: Option<&[u8]>) -> Result<Ordered, &'static str> {
    let text = current.unwrap_or(b"");
    if text.iter().all(u8::is_ascii_whitespace) {
        return Ok(Ordered(Vec::new()));
    }
    let value: Value = serde_json::from_slice(text).map_err(|_| UNREADABLE)?;
    if !value.is_object() {
        return Err(NOT_AN_OBJECT);
    }
    serde_json::from_slice(text).map_err(|_| UNREADABLE)
}

fn indent(depth: usize) -> String {
    "  ".repeat(depth)
}

/// A value written by this module at `depth`, indented to sit there.
fn written(value: &Value, depth: usize) -> String {
    let text = serde_json::to_string_pretty(value).expect("JSON values serialise");
    text.replace('\n', &format!("\n{}", indent(depth)))
}

fn key(name: &str) -> String {
    serde_json::to_string(name).expect("strings serialise")
}

/// An object from members whose values are already text for `depth + 1`.
fn object(members: &[(String, String)], depth: usize) -> String {
    if members.is_empty() {
        return "{}".into();
    }
    let inner = indent(depth + 1);
    let body: Vec<String> = members
        .iter()
        .map(|(name, value)| format!("{inner}{}: {value}", key(name)))
        .collect();
    format!("{{\n{}\n{}}}", body.join(",\n"), indent(depth))
}

fn array(items: &[String], depth: usize) -> String {
    if items.is_empty() {
        return "[]".into();
    }
    let inner = indent(depth + 1);
    let body: Vec<String> = items.iter().map(|item| format!("{inner}{item}")).collect();
    format!("[\n{}\n{}]", body.join(",\n"), indent(depth))
}

fn handler(url: &str) -> Value {
    json!({"type": "http", "url": url, "timeout": TIMEOUT_SECONDS})
}

/// Whether a matcher group holds a handler with this address.
fn holds(group: &Value, url: &str) -> bool {
    group["hooks"]
        .as_array()
        .is_some_and(|hooks| hooks.iter().any(|hook| hook["url"] == json!(url)))
}

/// The members of `hooks`, after checking they are arrays of objects as Claude Code reads them.
/// Each event's name with its matcher groups, each group as its own text.
type Events = Vec<(String, Vec<Box<RawValue>>)>;

fn hook_members(raw: Option<&RawValue>) -> Result<Events, &'static str> {
    let Some(raw) = raw else {
        return Ok(Vec::new());
    };
    let members: Ordered = serde_json::from_str(raw.get()).map_err(|_| UNKNOWN_HOOKS)?;
    members
        .0
        .into_iter()
        .map(|(name, groups)| {
            let groups: Vec<Box<RawValue>> =
                serde_json::from_str(groups.get()).map_err(|_| UNKNOWN_HOOKS)?;
            Ok((name, groups))
        })
        .collect()
}

/// The file with `hooks` replaced by `members`, or without it when `members` is `None`.
fn rebuilt(top: Ordered, hooks: Option<String>) -> Vec<u8> {
    let mut members: Vec<(String, String)> = Vec::new();
    let mut hooks = hooks;
    for (name, value) in top.0 {
        if name == "hooks" {
            if let Some(text) = hooks.take() {
                members.push((name, text));
            }
        } else {
            members.push((name, value.get().to_string()));
        }
    }
    if let Some(text) = hooks {
        members.push(("hooks".into(), text));
    }
    let mut text = object(&members, 0);
    text.push('\n');
    text.into_bytes()
}

/// The text the settings file would have with the hooks added. A hook already there with this
/// address is not added again, so planning an installed file gives the same file.
pub fn plan(current: Option<&[u8]>, url: &str) -> Result<Vec<u8>, String> {
    let top = top(current)?;
    let raw = top
        .0
        .iter()
        .find(|(name, _)| name == "hooks")
        .map(|(_, raw)| &**raw);
    let mut members = hook_members(raw)?;
    let mut changed = false;
    for event in EVENTS {
        let index = match members.iter().position(|(name, _)| name == event) {
            Some(index) => index,
            None => {
                members.push((event.to_string(), Vec::new()));
                members.len() - 1
            }
        };
        let groups = &mut members[index].1;
        let present = groups.iter().any(|group| {
            serde_json::from_str::<Value>(group.get()).is_ok_and(|group| holds(&group, url))
        });
        if !present {
            let group = json!({"hooks": [handler(url)]});
            groups.push(RawValue::from_string(written(&group, 3)).expect("JSON is JSON"));
            changed = true;
        }
    }
    if !changed {
        if let Some(current) = current {
            return Ok(current.to_vec());
        }
    }
    let hooks: Vec<(String, String)> = members
        .into_iter()
        .map(|(name, groups)| {
            let items: Vec<String> = groups.iter().map(|group| group.get().to_string()).collect();
            (name, array(&items, 2))
        })
        .collect();
    Ok(rebuilt(top, Some(object(&hooks, 1))))
}

/// The text with every handler with this address taken out. Groups and events left empty by
/// that go too, and so does `hooks` when nothing is left in it.
fn unplan(current: &[u8], url: &str) -> Result<Vec<u8>, String> {
    let top = top(Some(current))?;
    let raw = top
        .0
        .iter()
        .find(|(name, _)| name == "hooks")
        .map(|(_, raw)| &**raw);
    let members = hook_members(raw)?;
    let mut kept: Vec<(String, String)> = Vec::new();
    for (name, groups) in members {
        let mut items = Vec::new();
        let mut touched = false;
        for group in groups {
            let value: Value = serde_json::from_str(group.get()).map_err(|_| UNKNOWN_HOOKS)?;
            if !holds(&value, url) {
                items.push(group.get().to_string());
                continue;
            }
            touched = true;
            let mut value = value;
            if let Some(hooks) = value.get_mut("hooks").and_then(Value::as_array_mut) {
                hooks.retain(|hook| hook["url"] != json!(url));
                if !hooks.is_empty() {
                    items.push(written(&value, 3));
                }
            }
        }
        // An event is dropped only when taking out this address left it empty.
        if !touched || !items.is_empty() {
            kept.push((name, array(&items, 2)));
        }
    }
    let hooks = (!kept.is_empty()).then(|| object(&kept, 1));
    Ok(rebuilt(top, hooks))
}

/// Where the settings file's bytes really are: a link, as a dotfiles folder makes, is followed
/// so that the link itself stays.
fn target(settings: &Path) -> PathBuf {
    std::fs::canonicalize(settings).unwrap_or_else(|_| settings.to_path_buf())
}

fn read(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!(
            "Claude Code's settings file cannot be read: {error}"
        )),
    }
}

/// Replaces `path` with `bytes` through a file beside it, keeping the old file's permissions.
fn replace(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let failed =
        |error: std::io::Error| format!("Claude Code's settings file cannot be written: {error}");
    let folder = path.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(folder).map_err(failed)?;
    let mut temporary = tempfile_in(folder).map_err(failed)?;
    temporary.1.write_all(bytes).map_err(failed)?;
    temporary.1.sync_all().map_err(failed)?;
    if let Ok(metadata) = std::fs::metadata(path) {
        let _ = std::fs::set_permissions(&temporary.0, metadata.permissions());
    }
    std::fs::rename(&temporary.0, path).map_err(|error| {
        let _ = std::fs::remove_file(&temporary.0);
        failed(error)
    })
}

/// A new file in `folder` that no one else opened.
fn tempfile_in(folder: &Path) -> std::io::Result<(PathBuf, std::fs::File)> {
    for attempt in 0..16u32 {
        let path = folder.join(format!(
            ".settings.json.open-sesame-{}-{attempt}",
            std::process::id()
        ));
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(std::io::Error::other("no free name for a temporary file"))
}

/// The backup's first line says whether there was a file; the rest is its bytes.
const HAD_FILE: &[u8] = b"open-sesame backup: file\n";
const HAD_NONE: &[u8] = b"open-sesame backup: none\n";

/// Adds the hooks. The file's bytes as they were are kept in `backup` first, and kept from the
/// first install: installing again changes nothing.
pub fn install(settings: &Path, backup: &Path, url: &str) -> Result<(), String> {
    let path = target(settings);
    let current = read(&path)?;
    let after = plan(current.as_deref(), url)?;
    if !backup.exists() {
        let kept = match &current {
            Some(bytes) => [HAD_FILE, bytes].concat(),
            None => HAD_NONE.to_vec(),
        };
        if let Some(folder) = backup.parent() {
            std::fs::create_dir_all(folder).map_err(|error| error.to_string())?;
        }
        std::fs::write(backup, &kept).map_err(|error| {
            format!("Open Sesame could not keep a copy of Claude Code's settings file: {error}")
        })?;
    }
    if current.as_deref() != Some(&after[..]) {
        replace(&path, &after)?;
    }
    Ok(())
}

/// Takes the hooks out. When the file is still what the install wrote, the backup's bytes go
/// back exactly, and a file that did not exist is removed; otherwise only the hooks with this
/// address are taken out. The backup is deleted once the file is restored.
pub fn remove(settings: &Path, backup: &Path, url: &str) -> Result<(), String> {
    let path = target(settings);
    let current = read(&path)?;
    let kept = match std::fs::read(backup) {
        Ok(bytes) => Some(if let Some(bytes) = bytes.strip_prefix(HAD_FILE) {
            Some(bytes.to_vec())
        } else if bytes == HAD_NONE {
            None
        } else {
            return Err(BACKUP_DAMAGED.into());
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(format!("{BACKUP_DAMAGED} ({error})")),
    };
    match (kept, current) {
        (Some(before), Some(current))
            if plan(before.as_deref(), url).ok().as_deref() == Some(&current[..]) =>
        {
            match before {
                Some(bytes) => replace(&path, &bytes)?,
                None => std::fs::remove_file(&path).map_err(|error| error.to_string())?,
            }
        }
        (_, Some(current)) => {
            let after = unplan(&current, url)?;
            if after != current {
                replace(&path, &after)?;
            }
        }
        (_, None) => {}
    }
    match std::fs::remove_file(backup) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.to_string()),
        _ => Ok(()),
    }
}
