//! Local storage owned by the core (issue #75).
//!
//! One SQLite database in the app data directory holds the user's notes, tasks, bookmarks,
//! projects and saved feed items, the settings and the widget on/off state. The front end reaches
//! it only through the typed commands in [`commands`]; no command takes SQL, a table name or a
//! column name, and every statement here is a fixed string with bound parameters.
//!
//! Rules that must hold:
//!
//! - Every row has an ID the core assigns and never changes, and an `updated_at` the core sets on
//!   every write. Sync is not built; these are what would make it possible later.
//! - A write either commits or returns an error. Nothing reports success before the commit.
//! - The schema only moves forward. A database written by a newer version is refused, untouched.
//! - Tokens are never stored here. They belong in the operating system's credential store.
//! - Nothing is migrated from the old `localStorage` keys.
//!
//! Notes, tasks and bookmarks share one `items` table with a `kind` column, because the UI models
//! them as one item that can change kind and they share every field.

pub mod commands;
mod model;
mod ops;
mod schema;

#[cfg(test)]
mod tests;

pub use model::{
    FeedItem, FeedItemDraft, Item, ItemDraft, ItemFilter, Kind, Priority, Project, ProjectDraft,
    Stage, WidgetState, MAX_BODY_BYTES, MAX_SETTING_BYTES, MAX_TITLE_CHARS,
};
pub use schema::SCHEMA_VERSION;

use rusqlite::{Connection, Transaction, TransactionBehavior};
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// The database's file name inside the app data directory.
pub const DATABASE_FILE: &str = "open-sesame.sqlite3";

/// How long a write waits for another writer (the MCP server in #81 shares this database).
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

/// The current time in milliseconds since the Unix epoch. Injected so tests control it.
pub type Clock = Arc<dyn Fn() -> i64 + Send + Sync>;

/// Why a storage call failed. `Display` is the plain message the UI shows; it never contains SQL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StorageError {
    /// The request broke a rule. The message says which.
    Invalid(String),
    /// The row to change no longer exists.
    NotFound(String),
    /// The change collides with another row.
    Conflict(String),
    /// A write did not commit. The detail is for logs, not for the UI.
    Database(String),
    /// A read failed. The detail is for logs, not for the UI.
    Read(String),
    /// The database was written by a newer version of the app.
    NewerSchema { found: i64, supported: i64 },
    /// The file could not be opened as this app's database. It was not changed.
    Unreadable(String),
}

impl fmt::Display for StorageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Invalid(message) | Self::NotFound(message) | Self::Conflict(message) => {
                f.write_str(message)
            }
            Self::Database(_) => {
                f.write_str("Could not save. Your changes were not stored; try again.")
            }
            Self::Read(_) => f.write_str("Could not read your saved data. Try again."),
            Self::NewerSchema { .. } => f.write_str(
                "This data was saved by a newer version of Open Sesame. Update the app to open it.",
            ),
            Self::Unreadable(_) => f.write_str(
                "Open Sesame could not open its data file. The file has not been changed.",
            ),
        }
    }
}

impl std::error::Error for StorageError {}

impl From<rusqlite::Error> for StorageError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Database(error.to_string())
    }
}

fn invalid(message: &str) -> StorageError {
    StorageError::Invalid(message.to_string())
}

/// The core's database.
pub struct Storage {
    conn: Mutex<Connection>,
    clock: Clock,
    path: Option<PathBuf>,
}

impl Storage {
    /// Opens, creating if needed, the database in `app_data_dir`, which must be absolute.
    pub fn open_in(app_data_dir: &Path) -> Result<Self, StorageError> {
        Self::open_in_with_clock(app_data_dir, system_clock())
    }

    pub fn open_in_with_clock(app_data_dir: &Path, clock: Clock) -> Result<Self, StorageError> {
        if !app_data_dir.is_absolute() {
            return Err(invalid("The data directory must be an absolute path."));
        }
        let io = |error: std::io::Error| StorageError::Database(error.to_string());
        std::fs::create_dir_all(app_data_dir).map_err(io)?;
        let path = app_data_dir.join(DATABASE_FILE);
        create_private(&path).map_err(io)?;
        Self::prepare(Connection::open(&path)?, clock, Some(path))
    }

    /// A database that lives only as long as this value. For tests and previews.
    pub fn open_in_memory() -> Result<Self, StorageError> {
        Self::prepare(Connection::open_in_memory()?, system_clock(), None)
    }

    fn prepare(
        conn: Connection,
        clock: Clock,
        path: Option<PathBuf>,
    ) -> Result<Self, StorageError> {
        let on_disk = path.is_some();
        // A failure before the first statement that writes means the file was not changed.
        let conn = Self::configure(conn, on_disk).map_err(|error| match error {
            StorageError::Database(detail) => StorageError::Unreadable(detail),
            other => other,
        })?;
        Ok(Self {
            conn: Mutex::new(conn),
            clock,
            path,
        })
    }

    fn configure(mut conn: Connection, on_disk: bool) -> Result<Connection, StorageError> {
        conn.busy_timeout(BUSY_TIMEOUT)?;
        schema::inspect(&conn, SCHEMA_VERSION)?;
        // Write-ahead logging lets a second process read while this one writes. FULL keeps a
        // committed write on disk through a power loss.
        let mode: String = conn.query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))?;
        if on_disk && !mode.eq_ignore_ascii_case("wal") {
            return Err(StorageError::Unreadable(
                "write-ahead logging is not available for this file".into(),
            ));
        }
        conn.execute_batch(
            "PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF;",
        )?;
        schema::migrate(&mut conn)?;
        Ok(conn)
    }

    /// The database file, or `None` for an in-memory database.
    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    pub fn schema_version(&self) -> Result<i64, StorageError> {
        self.read(schema::version)
    }

    pub fn journal_mode(&self) -> Result<String, StorageError> {
        self.read(|conn| Ok(conn.query_row("PRAGMA journal_mode", [], |row| row.get(0))?))
    }

    /// How long a write waits for another writer before it fails.
    pub fn set_busy_timeout(&self, timeout: Duration) -> Result<(), StorageError> {
        Ok(self.lock().busy_timeout(timeout)?)
    }

    fn lock(&self) -> MutexGuard<'_, Connection> {
        self.conn
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn now(&self) -> i64 {
        (self.clock)()
    }

    /// Runs a read. A database failure is reported as a read failure.
    fn read<T>(
        &self,
        work: impl FnOnce(&Connection) -> Result<T, StorageError>,
    ) -> Result<T, StorageError> {
        work(&self.lock()).map_err(|error| match error {
            StorageError::Database(detail) => StorageError::Read(detail),
            other => other,
        })
    }

    /// Runs a write in one transaction that takes the write lock up front. The work is committed
    /// only if it returns `Ok`; any error rolls everything back.
    fn write<T>(
        &self,
        work: impl FnOnce(&Transaction, i64) -> Result<T, StorageError>,
    ) -> Result<T, StorageError> {
        let now = self.now();
        let mut conn = self.lock();
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let value = work(&tx, now)?;
        tx.commit()?;
        Ok(value)
    }
}

fn system_clock() -> Clock {
    Arc::new(|| {
        let elapsed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();
        i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
    })
}

/// Creates the database file readable and writable by the user only, where the system has such
/// permissions. SQLite gives its `-wal` and `-shm` files the same permissions as the database.
fn create_private(path: &Path) -> std::io::Result<()> {
    let mut options = std::fs::OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path).map(|_| ())
}
