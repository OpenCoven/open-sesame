//! The stored types and the rules a write must satisfy.
//!
//! Field names on the wire are camelCase and follow the UI's current models (`dist/app.js`,
//! `dist/item-workflow.js`, `dist/task-manager-model.js`, `dist/reading.js`) so its port is direct.

use super::{invalid, StorageError};
use serde::{Deserialize, Serialize};

pub const MAX_TITLE_CHARS: usize = 200;
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

/// What the UI sends to save an item. Without an `id` the core creates the item and assigns one;
/// with an `id` it replaces every field of that item. Timestamps are never taken from the UI.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ItemDraft {
    #[serde(default)]
    pub id: Option<String>,
    pub kind: Kind,
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
}

impl ItemDraft {
    pub(super) fn validate(&self) -> Result<(), StorageError> {
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
    /// Matches the title, body and web address, ignoring case.
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
        return Err(invalid(
            "Credentials are kept in the system keychain, not in settings.",
        ));
    }
    Ok(())
}

/// Whether a name contains `token`, `secret`, `password`, `credential` or `apikey`, ignoring case
/// and the separators `.`, `_` and `-`.
pub(super) fn names_credential(name: &str) -> bool {
    let plain: String = name
        .chars()
        .filter(|c| !matches!(c, '.' | '_' | '-'))
        .collect::<String>()
        .to_ascii_lowercase();
    ["token", "secret", "password", "credential", "apikey"]
        .iter()
        .any(|word| plain.contains(word))
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

/// `YYYY-MM-DD` naming a real calendar day.
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
