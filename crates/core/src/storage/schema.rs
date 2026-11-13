//! The schema and its forward-only migrations.
//!
//! To change the schema, append a migration. Never edit or reorder an existing one: a database
//! in the field has already run it.

use super::StorageError;
use rusqlite::{Connection, OptionalExtension, TransactionBehavior};

/// Marks the file as this app's database: the bytes `OSDB`.
pub(super) const APPLICATION_ID: i64 = 0x4F53_4442;

pub(super) const MIGRATIONS: &[&str] = &[
    // 1: the first schema.
    "
    CREATE TABLE projects (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL UNIQUE,
        root_path TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE items (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('note', 'task', 'bookmark')),
        text TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        project_id TEXT REFERENCES projects (id) ON DELETE SET NULL,
        stage TEXT NOT NULL DEFAULT 'inbox' CHECK (stage IN ('inbox', 'active', 'review', 'done')),
        previous_stage TEXT CHECK (previous_stage IS NULL OR previous_stage IN ('inbox', 'active', 'review', 'done')),
        done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
        priority TEXT CHECK (priority IS NULL OR priority IN ('high', 'normal', 'low')),
        due_date TEXT NOT NULL DEFAULT '',
        read INTEGER NOT NULL DEFAULT 0 CHECK (read IN (0, 1)),
        reading_later INTEGER NOT NULL DEFAULT 0 CHECK (reading_later IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX items_by_kind ON items (kind, updated_at);
    CREATE INDEX items_by_project ON items (project_id);

    CREATE TABLE feed_items (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        published_at INTEGER,
        read INTEGER NOT NULL DEFAULT 0 CHECK (read IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE cli_paths (
        name TEXT PRIMARY KEY NOT NULL,
        path TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE widget_states (
        id TEXT PRIMARY KEY NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('active', 'inactive', 'uninstalled')),
        updated_at INTEGER NOT NULL
    ) STRICT;
    ",
];

/// The schema version this build reads and writes.
pub const SCHEMA_VERSION: i64 = MIGRATIONS.len() as i64;

pub(super) fn version(conn: &Connection) -> Result<i64, StorageError> {
    Ok(conn.query_row("SELECT version FROM schema_version", [], |row| row.get(0))?)
}

fn foreign(detail: &str) -> StorageError {
    StorageError::Unreadable(detail.to_string())
}

/// Decides, without writing, whether this build may open the file. A new, empty file passes. A
/// file that is not this app's database, or that a newer version wrote, is refused.
pub(super) fn inspect(conn: &Connection, supported: i64) -> Result<(), StorageError> {
    let tables: i64 = conn.query_row(
        "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        [],
        |row| row.get(0),
    )?;
    if tables == 0 {
        return Ok(());
    }
    let application: i64 = conn.query_row("PRAGMA application_id", [], |row| row.get(0))?;
    let versioned: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    if application != APPLICATION_ID || versioned.is_none() {
        return Err(foreign("the file is a database this app did not create"));
    }
    let found = version(conn)?;
    if found > supported {
        return Err(StorageError::NewerSchema { found, supported });
    }
    if found < 0 {
        return Err(foreign("the schema version is negative"));
    }
    Ok(())
}

/// Brings the database to [`SCHEMA_VERSION`]. Call [`inspect`] first.
pub(super) fn migrate(conn: &mut Connection) -> Result<(), StorageError> {
    migrate_with(conn, MIGRATIONS)
}

/// Runs each migration the database has not had, one transaction each, so a failure leaves the
/// database at the last version that finished. Takes the list so tests can add a version.
pub(super) fn migrate_with(conn: &mut Connection, migrations: &[&str]) -> Result<(), StorageError> {
    conn.execute_batch(&format!(
        "BEGIN IMMEDIATE;
         PRAGMA application_id = {APPLICATION_ID};
         CREATE TABLE IF NOT EXISTS schema_version (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL) STRICT;
         INSERT OR IGNORE INTO schema_version (id, version) VALUES (1, 0);
         COMMIT;"
    ))?;
    let found = version(conn)?;
    for (index, migration) in migrations.iter().enumerate().skip(found.max(0) as usize) {
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        // Another process may have migrated while this one waited for the lock.
        if version(&tx)? != index as i64 {
            continue;
        }
        tx.execute_batch(migration)?;
        tx.execute("UPDATE schema_version SET version = ?1", [index as i64 + 1])?;
        tx.commit()?;
    }
    Ok(())
}
