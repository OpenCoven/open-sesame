//! The stored types and the rules a write must satisfy.
//!
//! Field names on the wire are camelCase and follow the UI's current models (`dist/app.js`,
//! `dist/item-workflow.js`, `dist/task-manager-model.js`, `dist/reading.js`) so its port is direct.

use super::{invalid, StorageError};
use serde::{Deserialize, Serialize};

/// The capture box in the UI takes this many characters.
pub const MAX_TEXT_CHARS: usize = 20_000;
/// The longest title any part of the UI writes: a saved feed entry's.
pub const MAX_TITLE_CHARS: usize = 300;
pub const MAX_FEED_TITLE_CHARS: usize = 300;
pub const MAX_BODY_BYTES: usize = 262_144;
pub const MAX_URL_BYTES: usize = 2048;
pub const MAX_PROJECT_NAME_CHARS: usize = 40;
pub const MAX_PATH_BYTES: usize = 4096;
pub const MAX_SETTING_BYTES: usize = 65_536;

/// An enum stored and sent as a lower-case word.
macro_rules! word_enum {
    ($(#[$meta:meta])* $name:ident { $($(#[$variant_meta:meta])* $variant:ident => $word:literal),+ $(,)? }) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
        #[serde(rename_all = "lowercase")]
        pub enum $name { $($(#[$variant_meta])* $variant),+ }

        impl $name {
            pub fn as_str(self) -> &'static str {
                match self { $(Self::$variant => $word),+ }
            }
            pub(super) fn parse(word: &str) -> Option<Self> {
                match word { $($word => Some(Self::$variant),)+ _ => None }
            }
        }
    };
}

word_enum!(
    /// What an item is. An item can change kind; its ID does not.
    Kind { Note => "note", Task => "task", Bookmark => "bookmark" }
);
word_enum!(
    /// Where an item is on the board.
    #[derive(Default)]
    Stage { #[default] Inbox => "inbox", Active => "active", Review => "review", Done => "done" }
);
word_enum!(Priority { High => "high", Normal => "normal", Low => "low" });
word_enum!(WidgetState { Active => "active", Inactive => "inactive", Uninstalled => "uninstalled" });

/// A note, task or bookmark as stored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub kind: Kind,
    /// What the user wrote: a whole capture, or a task's wording. The UI writes this for every
    /// item and shows it wherever there is no title.
    pub text: String,
    /// Optional. Empty for a single-line note and for most bookmarks.
    pub title: String,
    pub body: String,
    pub url: String,
    /// Empty means the inbox.
    pub project_id: String,
    pub stage: Stage,
    pub previous_stage: Option<Stage>,
    pub done: bool,
    pub priority: Option<Priority>,
    /// `YYYY-MM-DD`, or empty.
    pub due_date: String,
    pub read: bool,
    pub reading_later: bool,
    /// Milliseconds since the Unix epoch.
    pub created_at: i64,
    pub updated_at: i64,
}

/// What the UI sends to save an item. Without an `id` the core creates the item and assigns an
/// ID. With an `id` the UI chose and no `expectedUpdatedAt`, the core creates the item under that
/// ID; the same create sent again after a lost reply finds it and writes nothing, unless the item
/// was deleted in between, when it is created again. An edit sends the item's `id` and the
/// `updatedAt` it started from as `expectedUpdatedAt`, and replaces every field only while the
/// stored item still has that `updatedAt`; see [`Storage::save_item`](super::Storage::save_item).
/// After a lost reply the UI sends the same save again, or reloads, before any newer one: a
/// different save from the same starting point is a conflict once the first has committed.
/// Timestamps are never taken from the UI.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ItemDraft {
    #[serde(default)]
    pub id: Option<String>,
    pub kind: Kind,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub project_id: String,
    #[serde(default)]
    pub stage: Stage,
    #[serde(default)]
    pub previous_stage: Option<Stage>,
    #[serde(default)]
    pub done: bool,
    #[serde(default)]
    pub priority: Option<Priority>,
    #[serde(default)]
    pub due_date: String,
    #[serde(default)]
    pub read: bool,
    #[serde(default)]
    pub reading_later: bool,
    /// The `updatedAt` of the copy the UI edited. Every edit sends it; the save is refused with a
    /// conflict, changing nothing, if the stored row has changed since.
    #[serde(default)]
    pub expected_updated_at: Option<i64>,
}

impl ItemDraft {
    pub(super) fn validate(&self) -> Result<(), StorageError> {
        if self.text.is_empty() && self.title.is_empty() {
            return Err(invalid("An item needs some text."));
        }
        check_chars(&self.text, MAX_TEXT_CHARS, "That text is too long to save.")?;
        check_chars(&self.title, MAX_TITLE_CHARS, "That title is too long.")?;
        check_bytes(&self.body, MAX_BODY_BYTES, "That text is too long to save.")?;
        if self.url.is_empty() {
            if self.kind == Kind::Bookmark {
                return Err(invalid("A bookmark needs a web address."));
            }
        } else {
            check_web_url(&self.url)?;
        }
        if !self.due_date.is_empty() && !is_date(&self.due_date) {
            return Err(invalid("That due date is not a valid date."));
        }
        Ok(())
    }
}

/// Which items to list. Every field is optional; an empty `projectId` means the inbox.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ItemFilter {
    #[serde(default)]
    pub kind: Option<Kind>,
    #[serde(default)]
    pub project_id: Option<String>,
    /// Matches the text, title, body and web address, ignoring case.
    #[serde(default)]
    pub query: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    /// The project's folder: absolute or starting with `~/`, or empty.
    pub root_path: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectDraft {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub root_path: String,
    /// The `updatedAt` of the copy the UI edited. Every edit sends it; the save is refused with a
    /// conflict, changing nothing, if the stored row has changed since.
    #[serde(default)]
    pub expected_updated_at: Option<i64>,
}

impl ProjectDraft {
    /// Returns the trimmed name.
    pub(super) fn validate(&self) -> Result<&str, StorageError> {
        let name = self.name.trim();
        if name.is_empty() {
            return Err(invalid("A project needs a name."));
        }
        check_chars(
            name,
            MAX_PROJECT_NAME_CHARS,
            "That project name is too long.",
        )?;
        let path = &self.root_path;
        if !path.is_empty()
            && (path.len() > MAX_PATH_BYTES || has_control(path) || !is_absolute(path))
        {
            return Err(invalid("A project folder must be a full path."));
        }
        Ok(name)
    }
}

/// A feed or reader entry the user chose to keep.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedItem {
    pub id: String,
    pub title: String,
    pub url: String,
    pub body: String,
    pub source: String,
    /// When the entry was published, in milliseconds since the Unix epoch, when known.
    pub published_at: Option<i64>,
    pub read: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeedItemDraft {
    #[serde(default)]
    pub id: Option<String>,
    pub title: String,
    pub url: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub published_at: Option<i64>,
    #[serde(default)]
    pub read: bool,
    /// The `updatedAt` of the copy the UI edited. Every edit sends it; the save is refused with a
    /// conflict, changing nothing, if the stored row has changed since.
    #[serde(default)]
    pub expected_updated_at: Option<i64>,
}

impl FeedItemDraft {
    pub(super) fn validate(&self) -> Result<(), StorageError> {
        check_chars(&self.title, MAX_FEED_TITLE_CHARS, "That title is too long.")?;
        check_chars(
            &self.source,
            MAX_FEED_TITLE_CHARS,
            "That source name is too long.",
        )?;
        check_bytes(&self.body, MAX_BODY_BYTES, "That text is too long to save.")?;
        if self.url.is_empty() {
            return Err(invalid("A saved article needs a web address."));
        }
        check_web_url(&self.url)
    }
}

const CREDENTIAL_REFUSED: &str = "Credentials are kept in the system keychain, not in settings.";

/// A settings key: letters, digits, `.`, `_` and `-`, at most 100 characters, and not the name of
/// a credential. Tokens belong in the operating system's credential store.
pub(super) fn check_setting_key(key: &str) -> Result<(), StorageError> {
    let shaped = !key.is_empty()
        && key.len() <= 100
        && key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'));
    if !shaped {
        return Err(invalid("That setting name is not valid."));
    }
    if names_credential(key) {
        return Err(invalid(CREDENTIAL_REFUSED));
    }
    Ok(())
}

/// A settings value: no field in it, at any depth, may be named for a credential.
pub(super) fn check_setting_value(value: &serde_json::Value) -> Result<(), StorageError> {
    if value_names_credential(value) {
        return Err(invalid(CREDENTIAL_REFUSED));
    }
    Ok(())
}

/// Whether a name contains `token`, `secret`, `password`, `passwd`, `passphrase`, `credential`,
/// `apikey`, `privatekey` or `bearer`, ignoring case and the separators `.`, `_` and `-`.
pub(super) fn names_credential(name: &str) -> bool {
    let plain: String = name
        .chars()
        .filter(|c| !matches!(c, '.' | '_' | '-'))
        .collect::<String>()
        .to_ascii_lowercase();
    [
        "token",
        "secret",
        "password",
        "passwd",
        "passphrase",
        "credential",
        "apikey",
        "privatekey",
        "bearer",
    ]
    .iter()
    .any(|word| plain.contains(word))
}

/// Whether a settings value carries a field named for a credential at any depth, such as
/// `{"auth": {"refreshToken": "..."}}`. This reads names only: what a string holds is not
/// inspected, so the code that handles tokens must never write them to settings at all.
pub(super) fn value_names_credential(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Object(fields) => fields
            .iter()
            .any(|(name, inner)| names_credential(name) || value_names_credential(inner)),
        serde_json::Value::Array(values) => values.iter().any(value_names_credential),
        _ => false,
    }
}

/// An ID the UI chose for a new row: a version 4 UUID in lower case with hyphens, as
/// `crypto.randomUUID()` gives.
pub(super) fn check_client_id(id: &str) -> Result<(), StorageError> {
    if is_uuid_version(id, 4) {
        Ok(())
    } else {
        Err(invalid("That ID is not valid."))
    }
}

/// Whether an ID has the form of one the core assigns: a version 7 UUID in lower case with
/// hyphens. A row with such an ID was created by the core, so if it is missing it was deleted.
pub(super) fn assigned_by_core(id: &str) -> bool {
    is_uuid_version(id, 7)
}

fn is_uuid_version(id: &str, version: usize) -> bool {
    uuid::Uuid::parse_str(id).is_ok_and(|parsed| {
        parsed.get_version_num() == version && parsed.hyphenated().to_string() == id
    })
}

/// The name of a command-line tool whose path the user may override: a lower-case letter, then
/// lower-case letters, digits, `_` and `-`, at most 32 characters.
pub(super) fn check_cli_name(name: &str) -> Result<(), StorageError> {
    let bytes = name.as_bytes();
    let shaped = bytes.first().is_some_and(u8::is_ascii_lowercase)
        && bytes.len() <= 32
        && bytes.iter().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'-')
        });
    if shaped {
        Ok(())
    } else {
        Err(invalid("That tool name is not valid."))
    }
}

/// An override path: absolute on this operating system, valid UTF-8 without control characters,
/// at most 4096 bytes. Whether the file exists is the resolver's question, not storage's.
pub(super) fn check_cli_path(path: &std::path::Path) -> Result<&str, StorageError> {
    match path.to_str() {
        Some(text) if path.is_absolute() && text.len() <= MAX_PATH_BYTES && !has_control(text) => {
            Ok(text)
        }
        _ => Err(invalid("A tool path must be a full path.")),
    }
}

/// A widget ID: lower-case letters, digits and `-`, at most 64 characters.
pub(super) fn check_widget_id(id: &str) -> Result<(), StorageError> {
    let shaped = !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-');
    if shaped {
        Ok(())
    } else {
        Err(invalid("That widget name is not valid."))
    }
}

fn check_chars(text: &str, max: usize, message: &str) -> Result<(), StorageError> {
    if text.chars().count() > max {
        return Err(invalid(message));
    }
    Ok(())
}

fn check_bytes(text: &str, max: usize, message: &str) -> Result<(), StorageError> {
    if text.len() > max {
        return Err(invalid(message));
    }
    Ok(())
}

fn has_control(text: &str) -> bool {
    text.chars().any(char::is_control)
}

/// An `http` or `https` address with a host and no embedded user name or password.
fn check_web_url(url: &str) -> Result<(), StorageError> {
    let lower = url.to_ascii_lowercase();
    let rest = lower
        .strip_prefix("https://")
        .or_else(|| lower.strip_prefix("http://"));
    let authority = rest.map(|rest| rest.split(['/', '?', '#']).next().unwrap_or(""));
    let valid = url.len() <= MAX_URL_BYTES
        && !url.chars().any(|c| c.is_control() || c.is_whitespace())
        && authority.is_some_and(|authority| !authority.is_empty() && !authority.contains('@'));
    if valid {
        Ok(())
    } else {
        Err(invalid("That web address is not valid."))
    }
}

fn is_absolute(path: &str) -> bool {
    let bytes = path.as_bytes();
    let drive = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'\\' | b'/');
    path.starts_with('/') || path.starts_with("~/") || path.starts_with("\\\\") || drive
}

/// `YYYY-MM-DD` naming a real calendar day. The year 0000 is refused, as in the UI.
fn is_date(text: &str) -> bool {
    let bytes = text.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    let number =
        |range: std::ops::Range<usize>| text.get(range).and_then(|part| part.parse::<u32>().ok());
    let digits = bytes
        .iter()
        .enumerate()
        .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit());
    let (Some(year), Some(month), Some(day), true) =
        (number(0..4), number(5..7), number(8..10), digits)
    else {
        return false;
    };
    if year == 0 {
        return false;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1..=days).contains(&day)
}
