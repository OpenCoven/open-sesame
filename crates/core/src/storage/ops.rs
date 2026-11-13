//! The operations on each table. Every statement is a fixed string with bound parameters.

use super::commands::BAD_REQUEST;
use super::model::{
    assigned_by_core, check_cli_name, check_cli_path, check_client_id, check_setting_key,
    check_setting_value, check_widget_id,
};
use super::{
    invalid, FeedItem, FeedItemDraft, Item, ItemDraft, ItemFilter, Kind, Priority, Project,
    ProjectDraft, Stage, Storage, StorageError, WidgetState, MAX_SETTING_BYTES,
};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const ITEM_COLUMNS: &str = "id, kind, title, body, url, project_id, stage, previous_stage, done, priority, due_date, read, reading_later, created_at, updated_at, text";
const PROJECT_COLUMNS: &str = "id, name, root_path, created_at, updated_at";
const FEED_COLUMNS: &str =
    "id, title, url, body, source, published_at, read, created_at, updated_at";

fn new_id() -> String {
    uuid::Uuid::now_v7().to_string()
}

/// A stored word that no longer parses means the row was written outside these functions.
fn stored<T>(column: usize, value: Option<T>) -> rusqlite::Result<T> {
    value.ok_or_else(|| {
        rusqlite::Error::InvalidColumnType(column, "word".into(), rusqlite::types::Type::Text)
    })
}

fn item_from(row: &Row) -> rusqlite::Result<Item> {
    let kind: String = row.get(1)?;
    let stage: String = row.get(6)?;
    let previous: Option<String> = row.get(7)?;
    let priority: Option<String> = row.get(9)?;
    Ok(Item {
        id: row.get(0)?,
        kind: stored(1, Kind::parse(&kind))?,
        title: row.get(2)?,
        body: row.get(3)?,
        url: row.get(4)?,
        project_id: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
        stage: stored(6, Stage::parse(&stage))?,
        previous_stage: previous
            .map(|word| stored(7, Stage::parse(&word)))
            .transpose()?,
        done: row.get(8)?,
        priority: priority
            .map(|word| stored(9, Priority::parse(&word)))
            .transpose()?,
        due_date: row.get(10)?,
        read: row.get(11)?,
        reading_later: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
        text: row.get(15)?,
    })
}

fn project_from(row: &Row) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        root_path: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

fn feed_item_from(row: &Row) -> rusqlite::Result<FeedItem> {
    Ok(FeedItem {
        id: row.get(0)?,
        title: row.get(1)?,
        url: row.get(2)?,
        body: row.get(3)?,
        source: row.get(4)?,
        published_at: row.get(5)?,
        read: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

/// The lower-cased search text, or `None` when the query is blank and matches everything.
fn needle(query: Option<&str>) -> Option<String> {
    query
        .map(|query| query.trim().to_lowercase())
        .filter(|query| !query.is_empty())
}

/// Case-insensitive substring match done in Rust, so it is right beyond ASCII and `%` and `_`
/// in the query are ordinary characters.
fn matches(needle: &Option<String>, fields: &[&str]) -> bool {
    match needle {
        None => true,
        Some(needle) => fields.join(" ").to_lowercase().contains(needle),
    }
}

/// What a save needs to know about one table.
struct Rows {
    /// Selects `created_at, updated_at` of the row whose ID is `?1`.
    times: &'static str,
    /// The message when an edit names a row that is gone.
    missing: &'static str,
    /// The message when an edit started from a copy that is no longer current.
    changed: &'static str,
}

const ITEM_ROWS: Rows = Rows {
    times: "SELECT created_at, updated_at FROM items WHERE id = ?1",
    missing: "That item no longer exists.",
    changed: "That item was changed after you opened it. Your changes were not saved.",
};
const PROJECT_ROWS: Rows = Rows {
    times: "SELECT created_at, updated_at FROM projects WHERE id = ?1",
    missing: "That project no longer exists.",
    changed: "That project was changed after you opened it. Your changes were not saved.",
};
const FEED_ROWS: Rows = Rows {
    times: "SELECT created_at, updated_at FROM feed_items WHERE id = ?1",
    missing: "That saved article no longer exists.",
    changed: "That saved article was changed after you opened it. Your changes were not saved.",
};

/// The row a save writes.
enum Target {
    /// Write the row with this ID and these times.
    Write {
        id: String,
        created_at: i64,
        updated_at: i64,
    },
    /// The row exists, and the save does not name its current `updated_at`. The save is refused
    /// unless it would change nothing; see [`unchanged`].
    Changed { id: String },
}

/// Decides which row a save writes. No save replaces a row blindly:
///
/// - With no `id`: a new row under a new ID.
/// - With an `id` that has no row, and no `expectedUpdatedAt`: a new row under that ID, which the
///   UI chose as a UUID v4. A missing UUID v7 is a row the core created and someone deleted, so
///   it is "no longer exists", not a new row.
/// - With an `id` whose row has `updated_at` equal to `expectedUpdatedAt`: that row, replaced.
///   `created_at` is kept, and `updated_at` moves forward even when the clock stood still or was
///   set back, so a change never hides behind an unchanged timestamp.
/// - With an `id` that has a row, and no `expectedUpdatedAt` or a different one: refused as a
///   conflict unless the save would change nothing. A create or an edit sent again after its
///   reply was lost therefore succeeds without writing twice, while a different save from the
///   same starting point is a conflict.
/// - With `expectedUpdatedAt` and an `id` that has no row: "no longer exists", so an edit never
///   brings back a deleted row.
fn target(
    conn: &Connection,
    rows: &Rows,
    id: Option<&str>,
    expected: Option<i64>,
    now: i64,
) -> Result<Target, StorageError> {
    let Some(id) = id else {
        if expected.is_some() {
            return Err(invalid(BAD_REQUEST));
        }
        return Ok(Target::Write {
            id: new_id(),
            created_at: now,
            updated_at: now,
        });
    };
    let stored: Option<(i64, i64)> = conn
        .query_row(rows.times, [id], |row| Ok((row.get(0)?, row.get(1)?)))
        .optional()?;
    match (stored, expected) {
        (Some((created, updated)), Some(expected)) if updated == expected => Ok(Target::Write {
            id: id.to_string(),
            created_at: created,
            updated_at: now.max(updated.saturating_add(1)),
        }),
        (Some(_), _) => Ok(Target::Changed { id: id.to_string() }),
        (None, None) if !assigned_by_core(id) => {
            check_client_id(id)?;
            Ok(Target::Write {
                id: id.to_string(),
                created_at: now,
                updated_at: now,
            })
        }
        (None, _) => Err(StorageError::NotFound(rows.missing.to_string())),
    }
}

/// A save that does not name the row's current `updated_at` succeeds only when the stored row
/// already holds exactly what it sends, as when the same create or edit is sent again after its
/// reply was lost. It then writes nothing and returns the stored row. Any other such save is a
/// conflict.
fn unchanged<T: PartialEq>(sent: T, stored: T, rows: &Rows) -> Result<T, StorageError> {
    if sent == stored {
        Ok(stored)
    } else {
        Err(StorageError::Conflict(rows.changed.to_string()))
    }
}

impl Storage {
    // ---- Notes, tasks and bookmarks ----

    /// Creates an item, or replaces every field of an existing one. Which row is written, and
    /// when a save is refused because the row changed after the UI read it, is decided by
    /// [`target`].
    pub fn save_item(&self, draft: ItemDraft) -> Result<Item, StorageError> {
        draft.validate()?;
        self.write(|tx, now| {
            let target = target(tx, &ITEM_ROWS, draft.id.as_deref(), draft.expected_updated_at, now)?;
            let mut item = Item {
                id: String::new(),
                kind: draft.kind,
                text: draft.text,
                title: draft.title,
                body: draft.body,
                url: draft.url,
                project_id: draft.project_id,
                stage: draft.stage,
                previous_stage: draft.previous_stage,
                done: draft.done,
                priority: draft.priority,
                due_date: draft.due_date,
                read: draft.read,
                reading_later: draft.reading_later,
                created_at: 0,
                updated_at: 0,
            };
            match target {
                Target::Write { id, created_at, updated_at } => {
                    (item.id, item.created_at, item.updated_at) = (id, created_at, updated_at);
                }
                Target::Changed { id } => {
                    let sql = format!("SELECT {ITEM_COLUMNS} FROM items WHERE id = ?1");
                    let stored = tx.query_row(&sql, [&id], item_from)?;
                    (item.id, item.created_at, item.updated_at) = (id, stored.created_at, stored.updated_at);
                    return unchanged(item, stored, &ITEM_ROWS);
                }
            }
            // Checked after the conflict decision, so a save refused as a conflict says so.
            if !item.project_id.is_empty() {
                let exists: Option<i64> =
                    tx.query_row("SELECT 1 FROM projects WHERE id = ?1", [&item.project_id], |row| row.get(0)).optional()?;
                if exists.is_none() {
                    return Err(invalid("That project no longer exists."));
                }
            }
            tx.execute(
                "INSERT INTO items (id, kind, title, body, url, project_id, stage, previous_stage, done, priority, due_date, read, reading_later, created_at, updated_at, text)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
                 ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, title = excluded.title, text = excluded.text, body = excluded.body, url = excluded.url,
                     project_id = excluded.project_id, stage = excluded.stage, previous_stage = excluded.previous_stage, done = excluded.done,
                     priority = excluded.priority, due_date = excluded.due_date, read = excluded.read, reading_later = excluded.reading_later,
                     updated_at = excluded.updated_at",
                params![
                    item.id,
                    item.kind.as_str(),
                    item.title,
                    item.body,
                    item.url,
                    Some(&item.project_id).filter(|project| !project.is_empty()),
                    item.stage.as_str(),
                    item.previous_stage.map(Stage::as_str),
                    item.done,
                    item.priority.map(Priority::as_str),
                    item.due_date,
                    item.read,
                    item.reading_later,
                    item.created_at,
                    item.updated_at,
                    item.text,
                ],
            )?;
            Ok(item)
        })
    }

    pub fn get_item(&self, id: &str) -> Result<Option<Item>, StorageError> {
        self.read(|conn| {
            let sql = format!("SELECT {ITEM_COLUMNS} FROM items WHERE id = ?1");
            Ok(conn.query_row(&sql, [id], item_from).optional()?)
        })
    }

    /// Items matching the filter, most recently changed first.
    pub fn list_items(&self, filter: &ItemFilter) -> Result<Vec<Item>, StorageError> {
        let needle = needle(filter.query.as_deref());
        let kind = filter.kind.map(Kind::as_str);
        let project = filter.project_id.as_deref();
        self.read(|conn| {
            let sql = format!(
                "SELECT {ITEM_COLUMNS} FROM items
                 WHERE (?1 IS NULL OR kind = ?1)
                   AND (?2 IS NULL OR (?2 = '' AND project_id IS NULL) OR project_id = ?2)
                 ORDER BY updated_at DESC, id DESC"
            );
            let mut statement = conn.prepare(&sql)?;
            let rows = statement.query_map(params![kind, project], item_from)?;
            let mut items = Vec::new();
            for item in rows {
                let item = item?;
                if matches(&needle, &[&item.text, &item.title, &item.body, &item.url]) {
                    items.push(item);
                }
            }
            Ok(items)
        })
    }

    /// Deletes an item. Returns whether there was one to delete.
    pub fn delete_item(&self, id: &str) -> Result<bool, StorageError> {
        self.write(|tx, _| Ok(tx.execute("DELETE FROM items WHERE id = ?1", [id])? > 0))
    }

    // ---- Projects ----

    /// Creates a project, or replaces the name and folder of an existing one. Names are unique
    /// ignoring case.
    pub fn save_project(&self, draft: ProjectDraft) -> Result<Project, StorageError> {
        let name = draft.validate()?.to_string();
        let key = name.to_lowercase();
        self.write(|tx, now| {
            let (id, created_at, updated_at) =
                match target(tx, &PROJECT_ROWS, draft.id.as_deref(), draft.expected_updated_at, now)? {
                    Target::Write { id, created_at, updated_at } => (id, created_at, updated_at),
                    Target::Changed { id } => {
                        let sql = format!("SELECT {PROJECT_COLUMNS} FROM projects WHERE id = ?1");
                        let stored = tx.query_row(&sql, [&id], project_from)?;
                        let sent = Project {
                            id,
                            name: name.clone(),
                            root_path: draft.root_path.clone(),
                            created_at: stored.created_at,
                            updated_at: stored.updated_at,
                        };
                        return unchanged(sent, stored, &PROJECT_ROWS);
                    }
                };
            let taken: Option<i64> = tx
                .query_row("SELECT 1 FROM projects WHERE name_key = ?1 AND id <> ?2", params![key, id], |row| row.get(0))
                .optional()?;
            if taken.is_some() {
                return Err(StorageError::Conflict("A project with that name already exists.".into()));
            }
            let project = Project { id, name, root_path: draft.root_path, created_at, updated_at };
            tx.execute(
                "INSERT INTO projects (id, name, name_key, root_path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT (id) DO UPDATE SET name = excluded.name, name_key = excluded.name_key,
                     root_path = excluded.root_path, updated_at = excluded.updated_at",
                params![project.id, project.name, key, project.root_path, project.created_at, project.updated_at],
            )?;
            Ok(project)
        })
    }

    pub fn get_project(&self, id: &str) -> Result<Option<Project>, StorageError> {
        self.read(|conn| {
            let sql = format!("SELECT {PROJECT_COLUMNS} FROM projects WHERE id = ?1");
            Ok(conn.query_row(&sql, [id], project_from).optional()?)
        })
    }

    /// Projects whose name contains the query, ignoring case, in name order.
    pub fn list_projects(&self, query: Option<&str>) -> Result<Vec<Project>, StorageError> {
        let needle = needle(query);
        self.read(|conn| {
            let sql = format!("SELECT {PROJECT_COLUMNS} FROM projects ORDER BY name_key, id");
            let mut statement = conn.prepare(&sql)?;
            let rows = statement.query_map([], project_from)?;
            let mut projects = Vec::new();
            for project in rows {
                let project = project?;
                if matches(&needle, &[&project.name]) {
                    projects.push(project);
                }
            }
            Ok(projects)
        })
    }

    /// Deletes a project and moves its items to the inbox, in one transaction.
    pub fn delete_project(&self, id: &str) -> Result<bool, StorageError> {
        self.write(|tx, now| {
            tx.execute(
                "UPDATE items SET project_id = NULL, updated_at = max(updated_at + 1, ?2) WHERE project_id = ?1",
                params![id, now],
            )?;
            Ok(tx.execute("DELETE FROM projects WHERE id = ?1", [id])? > 0)
        })
    }

    // ---- Saved feed items ----

    pub fn save_feed_item(&self, draft: FeedItemDraft) -> Result<FeedItem, StorageError> {
        draft.validate()?;
        self.write(|tx, now| {
            let target = target(tx, &FEED_ROWS, draft.id.as_deref(), draft.expected_updated_at, now)?;
            let mut item = FeedItem {
                id: String::new(),
                title: draft.title,
                url: draft.url,
                body: draft.body,
                source: draft.source,
                published_at: draft.published_at,
                read: draft.read,
                created_at: 0,
                updated_at: 0,
            };
            match target {
                Target::Write { id, created_at, updated_at } => {
                    (item.id, item.created_at, item.updated_at) = (id, created_at, updated_at);
                }
                Target::Changed { id } => {
                    let sql = format!("SELECT {FEED_COLUMNS} FROM feed_items WHERE id = ?1");
                    let stored = tx.query_row(&sql, [&id], feed_item_from)?;
                    (item.id, item.created_at, item.updated_at) = (id, stored.created_at, stored.updated_at);
                    return unchanged(item, stored, &FEED_ROWS);
                }
            }
            tx.execute(
                "INSERT INTO feed_items (id, title, url, body, source, published_at, read, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT (id) DO UPDATE SET title = excluded.title, url = excluded.url, body = excluded.body,
                     source = excluded.source, published_at = excluded.published_at, read = excluded.read,
                     updated_at = excluded.updated_at",
                params![
                    item.id,
                    item.title,
                    item.url,
                    item.body,
                    item.source,
                    item.published_at,
                    item.read,
                    item.created_at,
                    item.updated_at
                ],
            )?;
            Ok(item)
        })
    }

    pub fn get_feed_item(&self, id: &str) -> Result<Option<FeedItem>, StorageError> {
        self.read(|conn| {
            let sql = format!("SELECT {FEED_COLUMNS} FROM feed_items WHERE id = ?1");
            Ok(conn.query_row(&sql, [id], feed_item_from).optional()?)
        })
    }

    /// Saved feed items whose title, text, source or address contains the query, ignoring case,
    /// most recently changed first.
    pub fn list_feed_items(&self, query: Option<&str>) -> Result<Vec<FeedItem>, StorageError> {
        let needle = needle(query);
        self.read(|conn| {
            let sql =
                format!("SELECT {FEED_COLUMNS} FROM feed_items ORDER BY updated_at DESC, id DESC");
            let mut statement = conn.prepare(&sql)?;
            let rows = statement.query_map([], feed_item_from)?;
            let mut items = Vec::new();
            for item in rows {
                let item = item?;
                if matches(&needle, &[&item.title, &item.body, &item.source, &item.url]) {
                    items.push(item);
                }
            }
            Ok(items)
        })
    }

    pub fn delete_feed_item(&self, id: &str) -> Result<bool, StorageError> {
        self.write(|tx, _| Ok(tx.execute("DELETE FROM feed_items WHERE id = ?1", [id])? > 0))
    }

    // ---- Settings ----

    pub fn get_setting(&self, key: &str) -> Result<Option<Value>, StorageError> {
        self.read(|conn| {
            let text: Option<String> = conn
                .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
                    row.get(0)
                })
                .optional()?;
            text.map(|text| {
                serde_json::from_str(&text).map_err(|error| StorageError::Read(error.to_string()))
            })
            .transpose()
        })
    }

    /// Every setting, by key.
    pub fn settings(&self) -> Result<Map<String, Value>, StorageError> {
        self.read(|conn| {
            let mut statement = conn.prepare("SELECT key, value FROM settings ORDER BY key")?;
            let rows = statement.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            let mut settings = Map::new();
            for row in rows {
                let (key, text) = row?;
                let value = serde_json::from_str(&text)
                    .map_err(|error| StorageError::Read(error.to_string()))?;
                settings.insert(key, value);
            }
            Ok(settings)
        })
    }

    /// Stores a JSON value under a key. A key, or a field inside the value, that is named for a
    /// credential is refused; see [`check_setting_key`] and [`check_setting_value`].
    pub fn set_setting(&self, key: &str, value: &Value) -> Result<(), StorageError> {
        check_setting_key(key)?;
        check_setting_value(value)?;
        let text = value.to_string();
        if text.len() > MAX_SETTING_BYTES {
            return Err(invalid("That setting is too large to save."));
        }
        self.write(|tx, now| {
            tx.execute(
                "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = max(updated_at + 1, excluded.updated_at)",
                params![key, text, now],
            )?;
            Ok(())
        })
    }

    pub fn delete_setting(&self, key: &str) -> Result<bool, StorageError> {
        self.write(|tx, _| Ok(tx.execute("DELETE FROM settings WHERE key = ?1", [key])? > 0))
    }

    // ---- Per-tool path overrides (read by the process runner, #73) ----

    /// The path the user set for a command-line tool, if any.
    pub fn cli_path(&self, name: &str) -> Result<Option<PathBuf>, StorageError> {
        self.read(|conn| {
            let path: Option<String> = conn
                .query_row(
                    "SELECT path FROM cli_paths WHERE name = ?1",
                    [name],
                    |row| row.get(0),
                )
                .optional()?;
            Ok(path.map(PathBuf::from))
        })
    }

    /// Every override, by tool name.
    pub fn cli_paths(&self) -> Result<BTreeMap<String, String>, StorageError> {
        self.read(|conn| {
            let mut statement = conn.prepare("SELECT name, path FROM cli_paths ORDER BY name")?;
            let rows = statement.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            let mut paths = BTreeMap::new();
            for row in rows {
                let (name, path) = row?;
                paths.insert(name, path);
            }
            Ok(paths)
        })
    }

    /// Sets the path for a tool, or clears it with `None`.
    pub fn set_cli_path(&self, name: &str, path: Option<&Path>) -> Result<(), StorageError> {
        check_cli_name(name)?;
        let path = path.map(check_cli_path).transpose()?;
        self.write(|tx, now| {
            match path {
                None => tx.execute("DELETE FROM cli_paths WHERE name = ?1", [name])?,
                Some(path) => tx.execute(
                    "INSERT INTO cli_paths (name, path, updated_at) VALUES (?1, ?2, ?3)
                     ON CONFLICT (name) DO UPDATE SET path = excluded.path, updated_at = max(updated_at + 1, excluded.updated_at)",
                    params![name, path, now],
                )?,
            };
            Ok(())
        })
    }

    // ---- Widget on/off state ----

    pub fn widget_states(&self) -> Result<BTreeMap<String, WidgetState>, StorageError> {
        self.read(|conn| {
            let mut statement = conn.prepare("SELECT id, state FROM widget_states ORDER BY id")?;
            let rows = statement.query_map([], |row| {
                let state: String = row.get(1)?;
                Ok((
                    row.get::<_, String>(0)?,
                    stored(1, WidgetState::parse(&state))?,
                ))
            })?;
            let mut states = BTreeMap::new();
            for row in rows {
                let (id, state) = row?;
                states.insert(id, state);
            }
            Ok(states)
        })
    }

    pub fn set_widget_state(&self, id: &str, state: WidgetState) -> Result<(), StorageError> {
        check_widget_id(id)?;
        self.write(|tx, now| {
            tx.execute(
                "INSERT INTO widget_states (id, state, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT (id) DO UPDATE SET state = excluded.state, updated_at = max(updated_at + 1, excluded.updated_at)",
                params![id, state.as_str(), now],
            )?;
            Ok(())
        })
    }
}
