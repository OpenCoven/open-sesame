//! Headless tests for the core's storage. Each test uses its own database in a temporary
//! directory, or in memory, and a clock the test controls.

use super::*;
use serde_json::{json, Map, Value};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use tempfile::TempDir;

const T0: i64 = 1_800_000_000_000;

/// The database is declared first so it closes before the directory is removed.
struct Rig {
    db: Storage,
    time: Arc<AtomicI64>,
    dir: TempDir,
}

fn clock(time: &Arc<AtomicI64>) -> Clock {
    let time = time.clone();
    Arc::new(move || time.load(Ordering::SeqCst))
}

fn rig() -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let time = Arc::new(AtomicI64::new(T0));
    let db = Storage::open_in_with_clock(dir.path(), clock(&time)).unwrap();
    Rig { dir, time, db }
}

impl Rig {
    fn tick(&self) -> i64 {
        self.time.fetch_add(1000, Ordering::SeqCst) + 1000
    }
    fn reopen(self) -> Rig {
        let Rig { dir, time, db } = self;
        drop(db);
        let db = Storage::open_in_with_clock(dir.path(), clock(&time)).unwrap();
        Rig { dir, time, db }
    }
}

fn draft(value: Value) -> ItemDraft {
    serde_json::from_value(value).unwrap()
}

fn note(title: &str, body: &str) -> ItemDraft {
    draft(json!({ "kind": "note", "title": title, "body": body }))
}

fn titles(items: &[Item]) -> Vec<&str> {
    items.iter().map(|item| item.title.as_str()).collect()
}

fn find(db: &Storage, filter: Value) -> Vec<Item> {
    db.list_items(&serde_json::from_value(filter).unwrap())
        .unwrap()
}

fn is_uuid(id: &str) -> bool {
    id.len() == 36 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

// ---- Notes, tasks and bookmarks ----

#[test]
fn note_create_edit_search_delete() {
    let rig = rig();
    let created = rig
        .db
        .save_item(note("Groceries", "Oat milk and **bread**"))
        .unwrap();
    assert!(is_uuid(&created.id));
    assert_eq!(
        (created.kind, created.created_at, created.updated_at),
        (Kind::Note, T0, T0)
    );
    assert_eq!(rig.db.get_item(&created.id).unwrap(), Some(created.clone()));

    let later = rig.tick();
    let mut edit = note("Groceries for Friday", "Oat milk");
    edit.id = Some(created.id.clone());
    edit.expected_updated_at = Some(created.updated_at);
    let edited = rig.db.save_item(edit).unwrap();
    assert_eq!(edited.id, created.id, "the ID is stable across edits");
    assert_eq!((edited.created_at, edited.updated_at), (T0, later));
    assert_eq!(edited.title, "Groceries for Friday");

    rig.db.save_item(note("Unrelated", "nothing here")).unwrap();
    assert_eq!(
        titles(&find(&rig.db, json!({ "query": "FRIDAY" }))),
        ["Groceries for Friday"]
    );
    assert_eq!(
        titles(&find(&rig.db, json!({ "query": "oat" }))),
        ["Groceries for Friday"]
    );
    assert!(
        find(&rig.db, json!({ "query": "bread" })).is_empty(),
        "the old body is gone"
    );

    assert!(rig.db.delete_item(&created.id).unwrap());
    assert_eq!(rig.db.get_item(&created.id).unwrap(), None);
    assert!(
        !rig.db.delete_item(&created.id).unwrap(),
        "deleting again reports nothing deleted"
    );
    assert_eq!(find(&rig.db, json!({})).len(), 1);
}

#[test]
fn task_create_edit_search_delete() {
    let rig = rig();
    let created = rig
        .db
        .save_item(draft(json!({ "kind": "task", "title": "File taxes", "priority": "high", "dueDate": "2027-04-15", "stage": "active" })))
        .unwrap();
    assert_eq!(created.kind, Kind::Task);
    assert_eq!(
        (created.priority, created.due_date.as_str(), created.stage),
        (Some(Priority::High), "2027-04-15", Stage::Active)
    );
    assert!(!created.done);

    rig.tick();
    let edited = rig
        .db
        .save_item(draft(json!({ "id": created.id, "expectedUpdatedAt": created.updated_at, "kind": "task", "title": "File taxes", "priority": "low", "stage": "done", "previousStage": "active", "done": true })))
        .unwrap();
    assert_eq!(
        (
            edited.priority,
            edited.stage,
            edited.previous_stage,
            edited.done
        ),
        (Some(Priority::Low), Stage::Done, Some(Stage::Active), true)
    );
    assert_eq!(
        edited.due_date, "",
        "a field left out of a save is cleared, not kept"
    );
    assert!(edited.updated_at > created.updated_at);

    rig.db.save_item(note("File cabinet", "")).unwrap();
    assert_eq!(
        titles(&find(&rig.db, json!({ "kind": "task", "query": "file" }))),
        ["File taxes"]
    );
    assert!(rig.db.delete_item(&created.id).unwrap());
    assert!(find(&rig.db, json!({ "kind": "task" })).is_empty());
}

#[test]
fn bookmark_create_edit_search_delete() {
    let rig = rig();
    let created = rig
        .db
        .save_item(draft(json!({ "kind": "bookmark", "title": "Tauri", "url": "https://v2.tauri.app/start/", "readingLater": true })))
        .unwrap();
    assert_eq!(
        (
            created.kind,
            created.url.as_str(),
            created.read,
            created.reading_later
        ),
        (Kind::Bookmark, "https://v2.tauri.app/start/", false, true)
    );

    rig.tick();
    let edited = rig
        .db
        .save_item(draft(json!({ "id": created.id, "expectedUpdatedAt": created.updated_at, "kind": "bookmark", "title": "Tauri docs", "url": "https://v2.tauri.app/", "read": true })))
        .unwrap();
    assert_eq!(
        (edited.title.as_str(), edited.read, edited.reading_later),
        ("Tauri docs", true, false)
    );

    assert_eq!(
        titles(&find(
            &rig.db,
            json!({ "kind": "bookmark", "query": "tauri.app" })
        )),
        ["Tauri docs"]
    );
    assert!(find(&rig.db, json!({ "kind": "note" })).is_empty());
    assert!(rig.db.delete_item(&created.id).unwrap());
    assert_eq!(rig.db.get_item(&created.id).unwrap(), None);
}

/// The UI's own shape: a capture is all `text` with no title, and can be far longer than a title.
#[test]
fn an_item_keeps_its_text_and_needs_no_title() {
    let rig = rig();
    let long = "word ".repeat(MAX_TEXT_CHARS / 5);
    assert_eq!(long.chars().count(), MAX_TEXT_CHARS);
    let capture = rig
        .db
        .save_item(draft(json!({ "kind": "note", "text": long })))
        .unwrap();
    assert_eq!(
        (capture.text.as_str(), capture.title.as_str()),
        (long.as_str(), "")
    );
    assert_eq!(rig.db.get_item(&capture.id).unwrap(), Some(capture.clone()));

    // The task manager writes the same wording to both fields.
    let task = rig
        .db
        .save_item(draft(
            json!({ "kind": "task", "text": "Call the plumber", "title": "Call the plumber" }),
        ))
        .unwrap();
    assert_eq!(
        (task.text.as_str(), task.title.as_str()),
        ("Call the plumber", "Call the plumber")
    );
    // Read later saves a bookmark under the feed entry's title, which can be 300 characters.
    let headline = "t".repeat(MAX_TITLE_CHARS);
    let bookmark = json!({ "kind": "bookmark", "text": "https://example.com/a", "title": headline, "url": "https://example.com/a" });
    assert!(rig.db.save_item(draft(bookmark)).is_ok());

    // Search reaches the text, and an edit replaces it.
    let found = find(&rig.db, json!({ "query": "WORD word" }));
    assert_eq!(
        found
            .iter()
            .map(|item| item.id.as_str())
            .collect::<Vec<_>>(),
        [capture.id.as_str()]
    );
    rig.tick();
    let edited = rig
        .db
        .save_item(draft(
            json!({ "id": capture.id, "expectedUpdatedAt": capture.updated_at, "kind": "note", "text": "short now" }),
        ))
        .unwrap();
    assert_eq!(edited.text, "short now");
    assert!(find(&rig.db, json!({ "query": "word word" })).is_empty());

    for bad in [
        json!({ "kind": "note" }),
        json!({ "kind": "note", "text": "", "title": "" }),
        json!({ "kind": "note", "text": "x".repeat(MAX_TEXT_CHARS + 1) }),
        json!({ "kind": "note", "text": "t", "title": "x".repeat(MAX_TITLE_CHARS + 1) }),
        json!({ "kind": "task", "text": "t", "dueDate": "0000-01-01" }),
    ] {
        let result = rig.db.save_item(draft(bad.clone()));
        assert!(
            matches!(result, Err(StorageError::Invalid(_))),
            "{result:?}"
        );
    }
    assert_eq!(find(&rig.db, json!({})).len(), 3);
}

#[test]
fn items_are_listed_newest_change_first_and_filtered_by_project() {
    let rig = rig();
    let project = rig
        .db
        .save_project(serde_json::from_value(json!({ "name": "Home" })).unwrap())
        .unwrap();
    rig.db.save_item(note("first", "")).unwrap();
    rig.tick();
    rig.db
        .save_item(draft(
            json!({ "kind": "task", "title": "second", "projectId": project.id }),
        ))
        .unwrap();
    rig.tick();
    rig.db.save_item(note("third", "")).unwrap();
    assert_eq!(
        titles(&find(&rig.db, json!({}))),
        ["third", "second", "first"]
    );
    assert_eq!(
        titles(&find(&rig.db, json!({ "projectId": project.id }))),
        ["second"]
    );
    assert_eq!(
        titles(&find(&rig.db, json!({ "projectId": "" }))),
        ["third", "first"],
        "an empty project means the inbox"
    );
}

#[test]
fn search_is_case_insensitive_beyond_ascii_and_treats_wildcards_as_text() {
    let rig = rig();
    rig.db.save_item(note("Überweisung", "100% sure")).unwrap();
    rig.db.save_item(note("plain", "a_b")).unwrap();
    assert_eq!(
        titles(&find(&rig.db, json!({ "query": "überWEISUNG" }))),
        ["Überweisung"]
    );
    assert_eq!(
        titles(&find(&rig.db, json!({ "query": "100%" }))),
        ["Überweisung"]
    );
    assert_eq!(titles(&find(&rig.db, json!({ "query": "a_b" }))), ["plain"]);
    assert!(
        find(&rig.db, json!({ "query": "%" })).len() == 1,
        "% matches only a literal percent sign"
    );
    assert!(find(&rig.db, json!({ "query": "_" })).len() == 1);
    assert_eq!(
        find(&rig.db, json!({ "query": "  " })).len(),
        2,
        "a blank query matches everything"
    );
}

#[test]
fn text_that_looks_like_sql_is_stored_as_text() {
    let rig = rig();
    let hostile = "'); DROP TABLE items; --";
    let saved = rig.db.save_item(note(hostile, hostile)).unwrap();
    assert_eq!(rig.db.get_item(&saved.id).unwrap().unwrap().title, hostile);
    assert_eq!(find(&rig.db, json!({ "query": hostile })).len(), 1);
    assert_eq!(rig.db.get_item("' OR 1=1 --").unwrap(), None);
    assert!(!rig.db.delete_item("' OR 1=1 --").unwrap());
    assert_eq!(find(&rig.db, json!({})).len(), 1);
}

#[test]
fn invalid_items_are_refused_and_nothing_is_written() {
    let rig = rig();
    let long_title = "x".repeat(MAX_TITLE_CHARS + 1);
    let cases = [
        json!({ "kind": "note", "title": long_title }),
        json!({ "kind": "bookmark", "title": "no address" }),
        json!({ "kind": "bookmark", "title": "t", "url": "javascript:alert(1)" }),
        json!({ "kind": "bookmark", "title": "t", "url": "https://user:pw@example.com/" }),
        json!({ "kind": "note", "title": "t", "url": "ftp://example.com/" }),
        json!({ "kind": "task", "title": "t", "dueDate": "tomorrow" }),
        json!({ "kind": "task", "title": "t", "dueDate": "2027-13-40" }),
        json!({ "kind": "note", "title": "t", "projectId": "no-such-project" }),
        json!({ "id": "no-such-item", "kind": "note", "title": "t" }),
    ];
    for case in cases {
        let result = rig.db.save_item(draft(case.clone()));
        assert!(
            matches!(
                result,
                Err(StorageError::Invalid(_)) | Err(StorageError::NotFound(_))
            ),
            "{case}: {result:?}"
        );
    }
    assert!(find(&rig.db, json!({})).is_empty());
    // Unknown kinds, stages and fields do not even parse.
    for bad in [
        json!({ "kind": "secret", "title": "t" }),
        json!({ "kind": "note", "title": "t", "stage": "later" }),
        json!({ "kind": "note", "title": "t", "sql": "DELETE FROM items" }),
        json!({ "kind": "note", "title": "t", "updatedAt": 1 }),
    ] {
        assert!(
            serde_json::from_value::<ItemDraft>(bad.clone()).is_err(),
            "{bad}"
        );
    }
}

// ---- Projects ----

fn project(name: &str) -> ProjectDraft {
    serde_json::from_value(json!({ "name": name })).unwrap()
}

#[test]
fn project_create_edit_search_delete() {
    let rig = rig();
    let created = rig.db.save_project(project("Open Sesame")).unwrap();
    assert!(is_uuid(&created.id));
    assert_eq!(
        (
            created.created_at,
            created.updated_at,
            created.root_path.as_str()
        ),
        (T0, T0, "")
    );

    let later = rig.tick();
    let edited = rig
        .db
        .save_project(serde_json::from_value(json!({ "id": created.id, "expectedUpdatedAt": created.updated_at, "name": "Open Sesame restart", "rootPath": "~/code/open-sesame" })).unwrap())
        .unwrap();
    assert_eq!(
        (edited.id.as_str(), edited.updated_at, edited.created_at),
        (created.id.as_str(), later, T0)
    );
    assert_eq!(edited.root_path, "~/code/open-sesame");

    rig.db.save_project(project("Garden")).unwrap();
    let found = rig.db.list_projects(Some("RESTART")).unwrap();
    assert_eq!(
        found.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(),
        ["Open Sesame restart"]
    );
    assert_eq!(rig.db.list_projects(None).unwrap().len(), 2);

    assert!(rig.db.delete_project(&created.id).unwrap());
    assert_eq!(rig.db.get_project(&created.id).unwrap(), None);
    assert!(!rig.db.delete_project(&created.id).unwrap());
}

#[test]
fn project_names_are_unique_ignoring_case_and_bounded() {
    let rig = rig();
    let home = rig.db.save_project(project("Home")).unwrap();
    assert!(matches!(
        rig.db.save_project(project("HOME")),
        Err(StorageError::Conflict(_))
    ));
    assert!(matches!(
        rig.db.save_project(project("  ")),
        Err(StorageError::Invalid(_))
    ));
    assert!(matches!(
        rig.db.save_project(project(&"x".repeat(41))),
        Err(StorageError::Invalid(_))
    ));
    let relative = serde_json::from_value(json!({ "name": "Rel", "rootPath": "code/x" })).unwrap();
    assert!(matches!(
        rig.db.save_project(relative),
        Err(StorageError::Invalid(_))
    ));
    // Renaming a project to its own name in another case is allowed.
    let renamed = serde_json::from_value(
        json!({ "id": home.id, "expectedUpdatedAt": home.updated_at, "name": "HOME" }),
    )
    .unwrap();
    assert_eq!(rig.db.save_project(renamed).unwrap().name, "HOME");
    assert_eq!(rig.db.list_projects(None).unwrap().len(), 1);
}

#[test]
fn deleting_a_project_moves_its_items_to_the_inbox() {
    let rig = rig();
    let home = rig.db.save_project(project("Home")).unwrap();
    let item = rig
        .db
        .save_item(draft(
            json!({ "kind": "task", "title": "Paint", "projectId": home.id }),
        ))
        .unwrap();
    let later = rig.tick();
    assert!(rig.db.delete_project(&home.id).unwrap());
    let moved = rig.db.get_item(&item.id).unwrap().unwrap();
    assert_eq!(moved.project_id, "");
    assert_eq!(
        moved.updated_at, later,
        "the move is a change, so the timestamp moves"
    );
}

// ---- Saved feed items ----

fn feed_item(title: &str, url: &str) -> FeedItemDraft {
    serde_json::from_value(
        json!({ "title": title, "url": url, "body": "<p>Body text</p>", "source": "Example Feed" }),
    )
    .unwrap()
}

#[test]
fn feed_item_create_edit_search_delete() {
    let rig = rig();
    let created = rig
        .db
        .save_feed_item(feed_item("Rust 2.0 announced", "https://example.com/rust"))
        .unwrap();
    assert!(is_uuid(&created.id));
    assert_eq!(
        (created.created_at, created.updated_at, created.read),
        (T0, T0, false)
    );

    let later = rig.tick();
    let edited = rig
        .db
        .save_feed_item(serde_json::from_value(json!({ "id": created.id, "expectedUpdatedAt": created.updated_at, "title": "Rust 2.0 announced", "url": "https://example.com/rust", "read": true, "publishedAt": 1_799_000_000_000i64 })).unwrap())
        .unwrap();
    assert_eq!(
        (
            edited.read,
            edited.published_at,
            edited.updated_at,
            edited.created_at
        ),
        (true, Some(1_799_000_000_000), later, T0)
    );

    rig.db
        .save_feed_item(feed_item("Gardening", "https://example.com/garden"))
        .unwrap();
    let found = rig.db.list_feed_items(Some("rust")).unwrap();
    assert_eq!(
        found
            .iter()
            .map(|item| item.title.as_str())
            .collect::<Vec<_>>(),
        ["Rust 2.0 announced"]
    );
    assert_eq!(
        rig.db.list_feed_items(Some("example feed")).unwrap().len(),
        1,
        "the edit cleared the first item's source"
    );
    assert_eq!(rig.db.list_feed_items(None).unwrap().len(), 2);

    assert!(rig.db.delete_feed_item(&created.id).unwrap());
    assert_eq!(rig.db.get_feed_item(&created.id).unwrap(), None);
    assert!(!rig.db.delete_feed_item(&created.id).unwrap());
}

#[test]
fn feed_items_need_a_web_address() {
    let rig = rig();
    assert!(matches!(
        rig.db.save_feed_item(feed_item("t", "")),
        Err(StorageError::Invalid(_))
    ));
    assert!(matches!(
        rig.db.save_feed_item(feed_item("t", "file:///etc/passwd")),
        Err(StorageError::Invalid(_))
    ));
    assert!(rig.db.list_feed_items(None).unwrap().is_empty());
}

// ---- Sending a save again, and edits from an out-of-date copy ----

/// A UUID as `crypto.randomUUID()` in the UI makes one.
const UI_ID: &str = "0b7c9f4e-2d1a-4c3b-9e8f-7a6b5c4d3e2f";

fn project_draft(value: Value) -> ProjectDraft {
    serde_json::from_value(value).unwrap()
}

fn feed_draft(value: Value) -> FeedItemDraft {
    serde_json::from_value(value).unwrap()
}

#[test]
fn a_create_sent_again_under_the_uis_id_saves_one_row() {
    let rig = rig();
    let note = || draft(json!({ "id": UI_ID, "kind": "note", "text": "Call the plumber" }));
    let first = rig.db.save_item(note()).unwrap();
    assert_eq!(
        (first.id.as_str(), first.created_at, first.updated_at),
        (UI_ID, T0, T0)
    );
    rig.tick();
    let again = rig.db.save_item(note()).unwrap();
    assert_eq!(again, first, "the same create again reports the saved item");
    assert_eq!(
        find(&rig.db, json!({})),
        [first],
        "one item, unchanged, not two"
    );

    let project = || project_draft(json!({ "id": UI_ID, "name": "Home" }));
    let first = rig.db.save_project(project()).unwrap();
    let again = rig.db.save_project(project()).unwrap();
    assert_eq!(again, first, "the same name under the same ID is no clash");
    assert_eq!(rig.db.list_projects(None).unwrap(), [first]);

    let article =
        || feed_draft(json!({ "id": UI_ID, "title": "Story", "url": "https://example.com/a" }));
    let first = rig.db.save_feed_item(article()).unwrap();
    assert_eq!(rig.db.save_feed_item(article()).unwrap(), first);
    assert_eq!(rig.db.list_feed_items(None).unwrap(), [first]);
}

#[test]
fn a_create_sent_again_after_another_change_does_not_undo_it() {
    let rig = rig();
    let create = draft(json!({ "id": UI_ID, "kind": "note", "text": "Home" }));
    // The create commits, but its reply is lost. An agent then edits the new item.
    let created = rig.db.save_item(create.clone()).unwrap();
    rig.tick();
    let renamed = rig
        .db
        .save_item(draft(json!({
            "id": UI_ID, "expectedUpdatedAt": created.updated_at, "kind": "note", "text": "House",
        })))
        .unwrap();
    rig.tick();
    assert_eq!(
        rig.db.save_item(create),
        Err(StorageError::Conflict(
            "That item was changed after you opened it. Your changes were not saved.".into()
        ))
    );
    assert_eq!(rig.db.get_item(UI_ID).unwrap(), Some(renamed));
}

#[test]
fn a_save_without_expected_updated_at_never_replaces_a_row() {
    let rig = rig();
    let created = rig.db.save_item(note("Plan", "first draft")).unwrap();
    rig.tick();
    let unchecked = |body: &str| {
        draft(json!({ "id": created.id, "kind": "note", "title": "Plan", "body": body }))
    };
    assert!(matches!(
        rig.db.save_item(unchecked("overwritten")),
        Err(StorageError::Conflict(_))
    ));
    assert_eq!(
        rig.db.save_item(unchecked("first draft")).unwrap(),
        created,
        "a save that changes nothing is not a conflict, and writes nothing"
    );
    assert_eq!(rig.db.get_item(&created.id).unwrap(), Some(created));
}

#[test]
fn a_deleted_row_the_core_created_is_not_brought_back() {
    let rig = rig();
    let item = rig.db.save_item(note("Gone", "soon")).unwrap();
    let home = rig.db.save_project(project("Home")).unwrap();
    let story = rig
        .db
        .save_feed_item(feed_item("Story", "https://example.com/a"))
        .unwrap();
    assert!(rig.db.delete_item(&item.id).unwrap());
    assert!(rig.db.delete_project(&home.id).unwrap());
    assert!(rig.db.delete_feed_item(&story.id).unwrap());
    // A save naming the ID without expectedUpdatedAt, as a UI that forgot it would send.
    let item_save = draft(json!({ "id": item.id, "kind": "note", "title": "Gone" }));
    assert_eq!(
        rig.db.save_item(item_save),
        Err(StorageError::NotFound("That item no longer exists.".into()))
    );
    let project_save = project_draft(json!({ "id": home.id, "name": "Home" }));
    assert_eq!(
        rig.db.save_project(project_save),
        Err(StorageError::NotFound(
            "That project no longer exists.".into()
        ))
    );
    let article_save =
        feed_draft(json!({ "id": story.id, "title": "Story", "url": "https://example.com/a" }));
    assert_eq!(
        rig.db.save_feed_item(article_save),
        Err(StorageError::NotFound(
            "That saved article no longer exists.".into()
        ))
    );
    assert_eq!(rig.db.get_item(&item.id).unwrap(), None);
    assert_eq!(rig.db.get_project(&home.id).unwrap(), None);
    assert_eq!(rig.db.get_feed_item(&story.id).unwrap(), None);
}

#[test]
fn a_stale_edit_whose_project_was_deleted_is_a_conflict() {
    let rig = rig();
    let home = rig.db.save_project(project("Home")).unwrap();
    let created = rig
        .db
        .save_item(draft(
            json!({ "kind": "note", "title": "t", "projectId": home.id }),
        ))
        .unwrap();
    rig.tick();
    // Deleting the project moves the item to the inbox, which changes it.
    assert!(rig.db.delete_project(&home.id).unwrap());
    let stale = draft(json!({
        "id": created.id, "expectedUpdatedAt": created.updated_at, "kind": "note",
        "title": "edited", "projectId": home.id,
    }));
    assert!(matches!(
        rig.db.save_item(stale),
        Err(StorageError::Conflict(_))
    ));
}

#[test]
fn a_create_sent_again_through_the_command_saves_one_item() {
    let db = Storage::open_in_memory().unwrap();
    let params = json!({ "item": { "id": UI_ID, "kind": "task", "text": "Renew passport" } });
    let first = call(&db, "items.save", params.clone()).unwrap();
    let again = call(&db, "items.save", params).unwrap();
    assert_eq!(first["item"]["id"], UI_ID);
    assert_eq!(again["item"]["id"], UI_ID);
    let listed = call(&db, "items.list", json!({})).unwrap();
    assert_eq!(listed["items"].as_array().unwrap().len(), 1);
}

#[test]
fn an_id_chosen_by_the_ui_must_be_a_lower_case_uuid() {
    let rig = rig();
    let refused = StorageError::Invalid("That ID is not valid.".into());
    for id in [
        "",
        "no-such-item",
        "0B7C9F4E-2D1A-4C3B-9E8F-7A6B5C4D3E2F",
        "0b7c9f4e2d1a4c3b9e8f7a6b5c4d3e2f",
        "{0b7c9f4e-2d1a-4c3b-9e8f-7a6b5c4d3e2f}",
        "urn:uuid:0b7c9f4e-2d1a-4c3b-9e8f-7a6b5c4d3e2f",
        "00000000-0000-0000-0000-000000000000",
        "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    ] {
        let item = draft(json!({ "id": id, "kind": "note", "text": "t" }));
        assert_eq!(rig.db.save_item(item).unwrap_err(), refused, "item {id:?}");
        let project = project_draft(json!({ "id": id, "name": "Home" }));
        assert_eq!(
            rig.db.save_project(project).unwrap_err(),
            refused,
            "project {id:?}"
        );
        let article = feed_draft(json!({ "id": id, "title": "t", "url": "https://example.com/" }));
        assert_eq!(
            rig.db.save_feed_item(article).unwrap_err(),
            refused,
            "article {id:?}"
        );
    }
    assert!(find(&rig.db, json!({})).is_empty());
    assert!(rig.db.list_projects(None).unwrap().is_empty());
    assert!(rig.db.list_feed_items(None).unwrap().is_empty());
}

#[test]
fn an_edit_from_an_out_of_date_copy_is_refused_and_changes_nothing() {
    let rig = rig();
    let created = rig.db.save_item(note("Plan", "first draft")).unwrap();
    // Two writers start from the same copy, as the UI and an agent through #81 might.
    let edit = |body: &str, expected: i64| {
        draft(json!({
            "id": created.id, "kind": "note", "title": "Plan", "body": body,
            "expectedUpdatedAt": expected,
        }))
    };
    rig.tick();
    let first = rig
        .db
        .save_item(edit("from the agent", created.updated_at))
        .unwrap();
    assert_eq!(first.body, "from the agent");
    rig.tick();
    assert_eq!(
        rig.db
            .save_item(edit("from the window", created.updated_at))
            .map_err(|error| error.to_string()),
        Err("That item was changed after you opened it. Your changes were not saved.".into())
    );
    assert_eq!(
        rig.db.get_item(&created.id).unwrap(),
        Some(first.clone()),
        "the other writer's change is kept"
    );
    let redone = rig
        .db
        .save_item(edit("from the window", first.updated_at))
        .unwrap();
    assert_eq!(
        redone.body, "from the window",
        "starting again from the current copy works"
    );
    assert!(redone.updated_at > first.updated_at);
}

#[test]
fn an_edit_sent_again_after_its_reply_was_lost_succeeds_and_writes_nothing() {
    let rig = rig();
    let created = rig.db.save_item(note("Plan", "first draft")).unwrap();
    let edit = draft(json!({
        "id": created.id, "kind": "note", "title": "Plan", "body": "second draft",
        "expectedUpdatedAt": created.updated_at,
    }));
    rig.tick();
    let saved = rig.db.save_item(edit.clone()).unwrap();
    rig.tick();
    assert_eq!(
        rig.db.save_item(edit).unwrap(),
        saved,
        "the same edit again reports the saved item"
    );
    assert_eq!(
        rig.db.get_item(&created.id).unwrap(),
        Some(saved),
        "and leaves it as it was"
    );
}

#[test]
fn projects_and_saved_articles_refuse_edits_from_an_out_of_date_copy() {
    let rig = rig();
    let home = rig.db.save_project(project("Home")).unwrap();
    let rename = |name: &str, expected: i64| {
        project_draft(json!({ "id": home.id, "name": name, "expectedUpdatedAt": expected }))
    };
    rig.tick();
    let renamed = rig
        .db
        .save_project(rename("House", home.updated_at))
        .unwrap();
    rig.tick();
    assert_eq!(
        rig.db.save_project(rename("Flat", home.updated_at)),
        Err(StorageError::Conflict(
            "That project was changed after you opened it. Your changes were not saved.".into()
        ))
    );
    assert_eq!(
        rig.db
            .save_project(rename("House", home.updated_at))
            .unwrap(),
        renamed,
        "the same rename again is not a conflict"
    );
    assert_eq!(rig.db.get_project(&home.id).unwrap(), Some(renamed));

    let story = rig
        .db
        .save_feed_item(feed_item("Story", "https://example.com/a"))
        .unwrap();
    let mark = |read: bool, expected: i64| {
        feed_draft(json!({
            "id": story.id, "title": "Story", "url": "https://example.com/a",
            "body": "<p>Body text</p>", "source": "Example Feed", "read": read,
            "expectedUpdatedAt": expected,
        }))
    };
    rig.tick();
    let read = rig.db.save_feed_item(mark(true, story.updated_at)).unwrap();
    rig.tick();
    assert_eq!(
        rig.db.save_feed_item(mark(false, story.updated_at)),
        Err(StorageError::Conflict(
            "That saved article was changed after you opened it. Your changes were not saved."
                .into()
        ))
    );
    assert_eq!(
        rig.db.save_feed_item(mark(true, story.updated_at)).unwrap(),
        read
    );
    assert_eq!(rig.db.get_feed_item(&story.id).unwrap(), Some(read));
}

#[test]
fn an_edit_does_not_bring_back_a_deleted_row() {
    let rig = rig();
    let item = rig.db.save_item(note("Gone", "soon")).unwrap();
    let home = rig.db.save_project(project("Home")).unwrap();
    let story = rig
        .db
        .save_feed_item(feed_item("Story", "https://example.com/a"))
        .unwrap();
    assert!(rig.db.delete_item(&item.id).unwrap());
    assert!(rig.db.delete_project(&home.id).unwrap());
    assert!(rig.db.delete_feed_item(&story.id).unwrap());
    let edited = rig.db.save_item(draft(json!({
        "id": item.id, "kind": "note", "title": "Gone", "expectedUpdatedAt": item.updated_at,
    })));
    assert_eq!(
        edited,
        Err(StorageError::NotFound("That item no longer exists.".into()))
    );
    let renamed = rig.db.save_project(project_draft(json!({
        "id": home.id, "name": "Home", "expectedUpdatedAt": home.updated_at,
    })));
    assert_eq!(
        renamed,
        Err(StorageError::NotFound(
            "That project no longer exists.".into()
        ))
    );
    let marked = rig.db.save_feed_item(feed_draft(json!({
        "id": story.id, "title": "Story", "url": "https://example.com/a",
        "expectedUpdatedAt": story.updated_at,
    })));
    assert_eq!(
        marked,
        Err(StorageError::NotFound(
            "That saved article no longer exists.".into()
        ))
    );
    assert_eq!(rig.db.get_item(&item.id).unwrap(), None);
    assert_eq!(rig.db.get_project(&home.id).unwrap(), None);
    assert_eq!(rig.db.get_feed_item(&story.id).unwrap(), None);
}

#[test]
fn a_new_row_has_no_earlier_copy_to_check() {
    let rig = rig();
    let refused = StorageError::Invalid(commands::BAD_REQUEST.into());
    let item = draft(json!({ "kind": "note", "text": "t", "expectedUpdatedAt": T0 }));
    assert_eq!(rig.db.save_item(item).unwrap_err(), refused);
    let item = draft(json!({
        "kind": "note", "text": "t", "projectId": "no-such-project", "expectedUpdatedAt": T0,
    }));
    assert_eq!(rig.db.save_item(item).unwrap_err(), refused);
    let project = project_draft(json!({ "name": "Home", "expectedUpdatedAt": T0 }));
    assert_eq!(rig.db.save_project(project).unwrap_err(), refused);
    let article =
        feed_draft(json!({ "title": "t", "url": "https://example.com/", "expectedUpdatedAt": T0 }));
    assert_eq!(rig.db.save_feed_item(article).unwrap_err(), refused);
    assert!(rig.db.list_projects(None).unwrap().is_empty());
    assert!(rig.db.list_feed_items(None).unwrap().is_empty());
    assert!(find(&rig.db, json!({})).is_empty());
}

// ---- Settings and widget state ----

#[test]
fn settings_are_set_read_replaced_and_deleted() {
    let rig = rig();
    assert_eq!(rig.db.get_setting("layout").unwrap(), None);
    rig.db
        .set_setting("layout", &json!({ "width": 420, "pinned": true }))
        .unwrap();
    rig.db.set_setting("volume", &json!(0.5)).unwrap();
    assert_eq!(
        rig.db.get_setting("layout").unwrap(),
        Some(json!({ "width": 420, "pinned": true }))
    );
    rig.db.set_setting("layout", &json!("compact")).unwrap();
    let all = rig.db.settings().unwrap();
    assert_eq!(
        Value::Object(all),
        json!({ "layout": "compact", "volume": 0.5 })
    );
    assert!(rig.db.delete_setting("layout").unwrap());
    assert!(!rig.db.delete_setting("layout").unwrap());
    assert_eq!(rig.db.get_setting("layout").unwrap(), None);
}

/// Tokens belong only in the operating system's credential store.
#[test]
fn settings_refuse_keys_that_name_a_credential_and_malformed_keys() {
    let rig = rig();
    for key in [
        "refreshToken",
        "workos.refresh_token",
        "api-secret",
        "PASSWORD",
        "auth.credential",
        "api_key",
        "pass-word",
        "",
        "has space",
        &"k".repeat(101),
    ] {
        assert!(
            matches!(
                rig.db.set_setting(key, &json!("x")),
                Err(StorageError::Invalid(_))
            ),
            "{key}"
        );
    }
    let huge = json!("x".repeat(MAX_SETTING_BYTES + 1));
    assert!(matches!(
        rig.db.set_setting("big", &huge),
        Err(StorageError::Invalid(_))
    ));
    assert!(rig.db.settings().unwrap().is_empty());
}

/// The key check alone would let a credential in as a field of the value.
#[test]
fn settings_refuse_values_with_a_field_named_for_a_credential() {
    let rig = rig();
    for value in [
        json!({ "token": "x" }),
        json!({ "auth": { "refreshToken": "x" } }),
        json!([{ "account": { "api_key": "x" } }]),
        json!({ "login": { "passwd": "x" } }),
        json!({ "ssh": { "privateKey": "x", "passphrase": "x" } }),
    ] {
        let result = rig.db.set_setting("account", &value);
        assert!(matches!(result, Err(StorageError::Invalid(_))), "{value}");
        assert_eq!(
            result.unwrap_err().to_string(),
            "Credentials are kept in the system keychain, not in settings."
        );
    }
    assert!(rig.db.settings().unwrap().is_empty());
    // Ordinary nested state is stored, and a word inside a string is not a field name.
    let layout = json!({ "panes": [{ "width": 420 }], "note": "token" });
    rig.db.set_setting("layout", &layout).unwrap();
    assert_eq!(rig.db.get_setting("layout").unwrap(), Some(layout));
}

#[test]
fn widget_state_is_kept_per_widget() {
    let rig = rig();
    assert!(rig.db.widget_states().unwrap().is_empty());
    rig.db
        .set_widget_state("task-manager", WidgetState::Active)
        .unwrap();
    rig.db
        .set_widget_state("github", WidgetState::Inactive)
        .unwrap();
    rig.db
        .set_widget_state("github", WidgetState::Uninstalled)
        .unwrap();
    let states = rig.db.widget_states().unwrap();
    assert_eq!(states.len(), 2);
    assert_eq!(states["task-manager"], WidgetState::Active);
    assert_eq!(states["github"], WidgetState::Uninstalled);
    assert!(matches!(
        rig.db
            .set_widget_state("Not A Widget!", WidgetState::Active),
        Err(StorageError::Invalid(_))
    ));
}

/// The interface the process runner (#73) reads: one optional absolute path per tool.
#[test]
fn cli_path_overrides_are_set_read_and_cleared() {
    let rig = rig();
    let path = rig.dir.path().join("bin").join("claude");
    assert_eq!(rig.db.cli_path("claude").unwrap(), None);
    rig.db.set_cli_path("claude", Some(&path)).unwrap();
    assert_eq!(rig.db.cli_path("claude").unwrap(), Some(path.clone()));
    assert_eq!(rig.db.cli_paths().unwrap().len(), 1);
    let rig = rig.reopen();
    assert_eq!(rig.db.cli_path("claude").unwrap(), Some(path));
    rig.db.set_cli_path("claude", None).unwrap();
    assert_eq!(rig.db.cli_path("claude").unwrap(), None);
    rig.db.set_cli_path("claude", None).unwrap();

    use std::path::Path;
    assert!(matches!(
        rig.db.set_cli_path("claude", Some(Path::new("bin/claude"))),
        Err(StorageError::Invalid(_))
    ));
    for name in ["", "Claude", "9lives", "has space", "a/b", &"n".repeat(33)] {
        let result = rig.db.set_cli_path(name, Some(rig.dir.path()));
        assert!(matches!(result, Err(StorageError::Invalid(_))), "{name}");
    }
    assert!(rig.db.cli_paths().unwrap().is_empty());
}

// ---- Durability, schema and failure ----

#[test]
fn data_survives_closing_and_reopening_the_database() {
    let rig = rig();
    let home = rig.db.save_project(project("Home")).unwrap();
    let item = rig
        .db
        .save_item(draft(
            json!({ "kind": "task", "title": "Paint", "projectId": home.id }),
        ))
        .unwrap();
    let feed = rig
        .db
        .save_feed_item(feed_item("Saved", "https://example.com/a"))
        .unwrap();
    rig.db.set_setting("layout", &json!("compact")).unwrap();
    rig.db
        .set_widget_state("shells", WidgetState::Active)
        .unwrap();

    let rig = rig.reopen();
    assert_eq!(rig.db.get_item(&item.id).unwrap(), Some(item));
    assert_eq!(rig.db.get_project(&home.id).unwrap(), Some(home));
    assert_eq!(rig.db.get_feed_item(&feed.id).unwrap(), Some(feed));
    assert_eq!(
        rig.db.get_setting("layout").unwrap(),
        Some(json!("compact"))
    );
    assert_eq!(
        rig.db.widget_states().unwrap()["shells"],
        WidgetState::Active
    );
}

const CHILD_DIR: &str = "OPEN_SESAME_STORAGE_TEST_DIR";

/// Not a test of its own: `a_saved_item_survives_the_process_dying` runs it in a child process.
#[test]
#[ignore = "helper run in a child process"]
fn child_saves_then_dies() {
    let Some(dir) = std::env::var_os(CHILD_DIR) else {
        return;
    };
    let db = Storage::open_in(std::path::Path::new(&dir)).unwrap();
    db.save_item(note("written before the crash", "")).unwrap();
    // The save has returned, so it must be on disk. Die without closing anything.
    std::process::abort();
}

#[test]
fn a_saved_item_survives_the_process_dying() {
    let dir = tempfile::tempdir().unwrap();
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "storage::tests::child_saves_then_dies",
            "--ignored",
            "--test-threads=1",
        ])
        .env(CHILD_DIR, dir.path())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .unwrap();
    assert!(
        !status.success(),
        "the child died without closing the database"
    );
    let db = Storage::open_in(dir.path()).unwrap();
    assert_eq!(titles(&find(&db, json!({}))), ["written before the crash"]);
}

/// The app and the MCP server (#81) may both start on a machine that has no database yet. Each
/// opener has its own connection, as a second process would, and none may be turned away: the
/// switch to write-ahead logging on a new file is the step that used to fail at once.
#[test]
fn a_new_database_can_be_opened_by_several_openers_at_once() {
    const OPENERS: usize = 8;
    for round in 0..20 {
        let dir = tempfile::tempdir().unwrap();
        let start = Arc::new(std::sync::Barrier::new(OPENERS));
        let openers: Vec<_> = (0..OPENERS)
            .map(|_| {
                let (path, start) = (dir.path().to_path_buf(), start.clone());
                std::thread::spawn(move || {
                    start.wait();
                    let db = Storage::open_in(&path)?;
                    db.save_item(note("saved by one opener", "")).map(|_| ())
                })
            })
            .collect();
        for opener in openers {
            let outcome = opener.join().unwrap();
            assert!(outcome.is_ok(), "round {round}: {outcome:?}");
        }
        let db = Storage::open_in(dir.path()).unwrap();
        assert_eq!(db.schema_version().unwrap(), SCHEMA_VERSION);
        assert_eq!(find(&db, json!({})).len(), OPENERS, "round {round}");
    }
}

/// The host shares one `Storage` between its command handlers.
#[test]
fn storage_can_be_shared_between_threads() {
    fn shared<T: Send + Sync>() {}
    shared::<Storage>();
}

#[test]
fn database_lives_in_the_given_directory_under_a_fixed_name() {
    let rig = rig();
    let expected = rig.dir.path().join(DATABASE_FILE);
    assert_eq!(rig.db.path(), Some(expected.as_path()));
    assert!(expected.is_file());
    let unexpected: Vec<_> = std::fs::read_dir(rig.dir.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| !name.starts_with(DATABASE_FILE))
        .collect();
    assert!(unexpected.is_empty(), "{unexpected:?}");
    // The directory is created when it does not exist yet; a relative path is refused.
    let nested = rig.dir.path().join("a").join("b");
    assert!(Storage::open_in(&nested).is_ok());
    assert!(nested.join(DATABASE_FILE).is_file());
    assert!(matches!(
        Storage::open_in(std::path::Path::new("relative/dir")),
        Err(StorageError::Invalid(_))
    ));
}

const COULD_NOT_OPEN: &str =
    "Open Sesame could not open its data file. The file has not been changed.";

/// A directory under the database's name is refused, and the failure reads as "could not open",
/// not as a failed save.
#[test]
fn a_directory_in_place_of_the_database_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join(DATABASE_FILE)).unwrap();
    let error = Storage::open_in(dir.path()).err().unwrap();
    assert!(matches!(error, StorageError::Unreadable(_)), "{error:?}");
    assert_eq!(error.to_string(), COULD_NOT_OPEN);

    // The data directory itself cannot be created under a plain file.
    let file = dir.path().join("plain-file");
    std::fs::write(&file, b"x").unwrap();
    let error = Storage::open_in(&file.join("data")).err().unwrap();
    assert!(matches!(error, StorageError::Unreadable(_)), "{error:?}");
    assert_eq!(error.to_string(), COULD_NOT_OPEN);
}

/// A symbolic link under the database's name would put the data outside the directory the host
/// chose, so it is refused and nothing is created where it points.
#[cfg(unix)]
#[test]
fn a_symbolic_link_in_place_of_the_database_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let link = dir.path().join(DATABASE_FILE);

    // A link to a file that does not exist yet.
    let target = outside.path().join("elsewhere.sqlite3");
    std::os::unix::fs::symlink(&target, &link).unwrap();
    let error = Storage::open_in(dir.path()).err().unwrap();
    assert!(matches!(error, StorageError::Unreadable(_)), "{error:?}");
    assert_eq!(error.to_string(), COULD_NOT_OPEN);
    assert!(!target.exists(), "nothing was created outside");

    // A link to a real database of this app in another directory.
    drop(Storage::open_in(outside.path()).unwrap());
    let real = outside.path().join(DATABASE_FILE);
    let before = std::fs::read(&real).unwrap();
    std::fs::remove_file(&link).unwrap();
    std::os::unix::fs::symlink(&real, &link).unwrap();
    assert!(matches!(
        Storage::open_in(dir.path()),
        Err(StorageError::Unreadable(_))
    ));
    assert_eq!(std::fs::read(&real).unwrap(), before);
}

#[cfg(unix)]
#[test]
fn database_file_is_private_to_the_user() {
    use std::os::unix::fs::PermissionsExt;
    let rig = rig();
    let mode = std::fs::metadata(rig.dir.path().join(DATABASE_FILE))
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o077, 0, "{mode:o}");
}

#[test]
fn schema_is_versioned_uses_wal_and_reopens_without_change() {
    let rig = rig();
    assert_eq!(rig.db.schema_version().unwrap(), SCHEMA_VERSION);
    assert_eq!(rig.db.journal_mode().unwrap().to_lowercase(), "wal");
    let rig = rig.reopen();
    assert_eq!(rig.db.schema_version().unwrap(), SCHEMA_VERSION);
}

#[test]
fn a_database_from_a_newer_version_is_refused_untouched() {
    let rig = rig();
    let item = rig.db.save_item(note("kept", "")).unwrap();
    let Rig { dir, time, db } = rig;
    drop(db);
    let path = dir.path().join(DATABASE_FILE);
    let raw = rusqlite::Connection::open(&path).unwrap();
    raw.execute(
        "UPDATE schema_version SET version = ?1",
        [SCHEMA_VERSION + 1],
    )
    .unwrap();
    drop(raw);
    assert!(matches!(
        Storage::open_in_with_clock(dir.path(), clock(&time)),
        Err(StorageError::NewerSchema { .. })
    ));
    let raw = rusqlite::Connection::open(&path).unwrap();
    let title: String = raw
        .query_row("SELECT title FROM items WHERE id = ?1", [&item.id], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(title, "kept");
}

/// A database whose last writer died keeps its committed changes in the write-ahead log. Refusing
/// the file must not fold that log into it: both stay byte for byte as they were.
#[test]
fn a_refused_database_keeps_its_write_ahead_log_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(DATABASE_FILE);
    let log = dir.path().join(format!("{DATABASE_FILE}-wal"));
    let item = Storage::open_in(dir.path())
        .unwrap()
        .save_item(note("kept", ""))
        .unwrap();

    // Stamp a newer version, and copy the file and its log before the writer closes: that is
    // the state a writer leaves when it dies.
    let raw = rusqlite::Connection::open(&path).unwrap();
    raw.execute(
        "UPDATE schema_version SET version = ?1",
        [SCHEMA_VERSION + 1],
    )
    .unwrap();
    let (database, pending) = (std::fs::read(&path).unwrap(), std::fs::read(&log).unwrap());
    assert!(!pending.is_empty(), "the change is still in the log");
    drop(raw);
    std::fs::write(&path, &database).unwrap();
    std::fs::write(&log, &pending).unwrap();

    assert!(matches!(
        Storage::open_in(dir.path()),
        Err(StorageError::NewerSchema { .. })
    ));
    assert_eq!(std::fs::read(&path).unwrap(), database);
    assert_eq!(std::fs::read(&log).unwrap(), pending);

    // The newer version can still read everything, including what was only in the log.
    let raw = rusqlite::Connection::open(&path).unwrap();
    let (version, title): (i64, String) = raw
        .query_row(
            "SELECT (SELECT version FROM schema_version), title FROM items WHERE id = ?1",
            [&item.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!((version, title.as_str()), (SCHEMA_VERSION + 1, "kept"));
}

#[test]
fn a_file_this_app_did_not_create_is_refused_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(DATABASE_FILE);
    std::fs::write(
        &path,
        b"this is not a database, it is a text file of some length",
    )
    .unwrap();
    let before = std::fs::read(&path).unwrap();
    let error = Storage::open_in(dir.path()).err().unwrap();
    assert!(matches!(error, StorageError::Unreadable(_)), "{error:?}");
    assert_eq!(
        error.to_string(),
        "Open Sesame could not open its data file. The file has not been changed."
    );
    assert_eq!(std::fs::read(&path).unwrap(), before);

    // A real SQLite database that belongs to something else.
    std::fs::remove_file(&path).unwrap();
    let raw = rusqlite::Connection::open(&path).unwrap();
    raw.execute_batch(
        "CREATE TABLE theirs (id INTEGER PRIMARY KEY); INSERT INTO theirs VALUES (7);",
    )
    .unwrap();
    drop(raw);
    let before = std::fs::read(&path).unwrap();
    assert!(matches!(
        Storage::open_in(dir.path()),
        Err(StorageError::Unreadable(_))
    ));
    assert_eq!(std::fs::read(&path).unwrap(), before);
}

#[test]
fn a_later_migration_keeps_existing_rows_and_a_failed_one_changes_nothing() {
    let rig = rig();
    let item = rig.db.save_item(note("kept", "")).unwrap();
    let Rig { dir, db, .. } = rig;
    drop(db);
    let mut raw = rusqlite::Connection::open(dir.path().join(DATABASE_FILE)).unwrap();
    let first = super::schema::MIGRATIONS[0];

    let broken = [
        first,
        "CREATE TABLE half_done (id TEXT) STRICT; INSERT INTO no_such_table VALUES (1);",
    ];
    assert!(super::schema::migrate_with(&mut raw, &broken).is_err());
    assert_eq!(
        super::schema::version(&raw).unwrap(),
        1,
        "the failed version is not recorded"
    );
    let leftovers: i64 = raw
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE name = 'half_done'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(leftovers, 0, "the failed migration rolled back whole");

    let next = [
        first,
        "ALTER TABLE items ADD COLUMN origin TEXT NOT NULL DEFAULT 'user';",
    ];
    super::schema::migrate_with(&mut raw, &next).unwrap();
    assert_eq!(super::schema::version(&raw).unwrap(), 2);
    let (title, origin): (String, String) = raw
        .query_row(
            "SELECT title, origin FROM items WHERE id = ?1",
            [&item.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!((title.as_str(), origin.as_str()), ("kept", "user"));
    // Running the same list again does nothing.
    super::schema::migrate_with(&mut raw, &next).unwrap();
    assert_eq!(super::schema::version(&raw).unwrap(), 2);
}

/// Tokens belong only in the operating system's credential store, so no column may hold one.
#[test]
fn no_table_has_a_column_for_a_credential() {
    let rig = rig();
    let raw = rusqlite::Connection::open(rig.dir.path().join(DATABASE_FILE)).unwrap();
    let tables: Vec<String> = raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(tables.len(), 7, "{tables:?}");
    for table in tables {
        let columns: Vec<String> = raw
            .prepare(&format!("SELECT name FROM pragma_table_info('{table}')"))
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        for column in columns {
            assert!(!super::model::names_credential(&column), "{table}.{column}");
        }
    }
}

#[test]
fn every_row_has_a_stable_id_and_a_modified_timestamp() {
    let rig = rig();
    let raw = rusqlite::Connection::open(rig.dir.path().join(DATABASE_FILE)).unwrap();
    for table in ["items", "projects", "feed_items"] {
        let columns: Vec<(String, bool, bool)> = raw
            .prepare(&format!(
                "SELECT name, \"notnull\", pk FROM pragma_table_info('{table}')"
            ))
            .unwrap()
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get::<_, i64>(2)? > 0))
            })
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert!(
            columns
                .iter()
                .any(|(name, _, primary)| name == "id" && *primary),
            "{table} has an id primary key"
        );
        assert!(
            columns
                .iter()
                .any(|(name, required, _)| name == "updated_at" && *required),
            "{table} requires updated_at"
        );
        assert!(
            columns
                .iter()
                .any(|(name, required, _)| name == "created_at" && *required),
            "{table} requires created_at"
        );
    }
    for table in ["settings", "widget_states", "cli_paths"] {
        let count: i64 = raw
            .query_row(&format!("SELECT count(*) FROM pragma_table_info('{table}') WHERE name = 'updated_at' AND \"notnull\" = 1"), [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1, "{table} requires updated_at");
    }
}

/// A change must never hide behind an unchanged timestamp: every write moves `updated_at`
/// forward, even when the clock stands still or is set back, and never touches the ID or
/// `created_at`.
#[test]
fn every_change_moves_the_modified_time_forward_whatever_the_clock_does() {
    let rig = rig();
    let home = rig.db.save_project(project("Home")).unwrap();
    let created = rig
        .db
        .save_item(draft(
            json!({ "kind": "note", "title": "one", "projectId": home.id }),
        ))
        .unwrap();
    let edit = |title: &str, expected: i64| {
        draft(json!({
            "id": created.id, "expectedUpdatedAt": expected, "kind": "note", "title": title,
            "projectId": home.id,
        }))
    };

    // The clock has not moved since the item was created.
    let same = rig.db.save_item(edit("two", created.updated_at)).unwrap();
    assert_eq!(same.updated_at, T0 + 1);

    // The clock is set back an hour.
    rig.time.store(T0 - 3_600_000, Ordering::SeqCst);
    let back = rig.db.save_item(edit("three", same.updated_at)).unwrap();
    assert_eq!(back.updated_at, T0 + 2);
    assert_eq!(
        (back.id.as_str(), back.created_at),
        (created.id.as_str(), T0)
    );
    assert_eq!(
        rig.db.get_item(&created.id).unwrap(),
        Some(back),
        "what was returned is what was stored"
    );

    // Changes made by other writes follow the same rule.
    let renamed = rig
        .db
        .save_project(
            serde_json::from_value(
                json!({ "id": home.id, "expectedUpdatedAt": home.updated_at, "name": "House" }),
            )
            .unwrap(),
        )
        .unwrap();
    assert_eq!((renamed.created_at, renamed.updated_at), (T0, T0 + 1));
    assert!(rig.db.delete_project(&home.id).unwrap());
    assert_eq!(
        rig.db.get_item(&created.id).unwrap().unwrap().updated_at,
        T0 + 3
    );
    rig.db.set_setting("layout", &json!("wide")).unwrap();
    rig.db.set_setting("layout", &json!("compact")).unwrap();
    rig.db
        .set_widget_state("shells", WidgetState::Active)
        .unwrap();
    rig.db
        .set_widget_state("shells", WidgetState::Inactive)
        .unwrap();
    let raw = rusqlite::Connection::open(rig.dir.path().join(DATABASE_FILE)).unwrap();
    for sql in [
        "SELECT updated_at FROM settings WHERE key = 'layout'",
        "SELECT updated_at FROM widget_states WHERE id = 'shells'",
    ] {
        let first_write = T0 - 3_600_000;
        let updated: i64 = raw.query_row(sql, [], |row| row.get(0)).unwrap();
        assert_eq!(updated, first_write + 1, "{sql}");
    }
}

#[test]
fn a_failed_write_returns_an_error_and_changes_nothing() {
    let rig = rig();
    let kept = rig.db.save_item(note("kept", "original")).unwrap();
    // Another connection holds the write lock, as a second writer would.
    let other = rusqlite::Connection::open(rig.dir.path().join(DATABASE_FILE)).unwrap();
    other.execute_batch("BEGIN IMMEDIATE").unwrap();
    rig.db
        .set_busy_timeout(std::time::Duration::from_millis(50))
        .unwrap();

    let mut edit = note("changed", "changed");
    edit.id = Some(kept.id.clone());
    edit.expected_updated_at = Some(kept.updated_at);
    assert!(matches!(
        rig.db.save_item(edit),
        Err(StorageError::Database(_))
    ));
    assert!(matches!(
        rig.db.save_item(note("new", "")),
        Err(StorageError::Database(_))
    ));
    assert!(matches!(
        rig.db.delete_item(&kept.id),
        Err(StorageError::Database(_))
    ));
    assert!(matches!(
        rig.db.set_setting("layout", &json!(1)),
        Err(StorageError::Database(_))
    ));

    other.execute_batch("ROLLBACK").unwrap();
    assert_eq!(rig.db.get_item(&kept.id).unwrap(), Some(kept));
    assert_eq!(find(&rig.db, json!({})).len(), 1);
    assert_eq!(rig.db.get_setting("layout").unwrap(), None);
}

#[test]
fn storage_errors_do_not_expose_sql() {
    let rig = rig();
    let other = rusqlite::Connection::open(rig.dir.path().join(DATABASE_FILE)).unwrap();
    other.execute_batch("BEGIN IMMEDIATE").unwrap();
    rig.db
        .set_busy_timeout(std::time::Duration::from_millis(50))
        .unwrap();
    let message = rig.db.save_item(note("x", "")).unwrap_err().to_string();
    assert!(
        !message.to_lowercase().contains("insert") && !message.contains("items"),
        "{message}"
    );
    assert_eq!(
        message,
        "Could not save. Your changes were not stored; try again."
    );
}

// ---- Commands: the only way the front end reaches storage ----

fn call(db: &Storage, method: &str, params: Value) -> Result<Value, String> {
    let params: Map<String, Value> = params.as_object().cloned().unwrap();
    commands::handle(db, method, &params).map_err(|error| error.0)
}

#[test]
fn commands_cover_every_item_type() {
    let db = Storage::open_in_memory().unwrap();
    let project = call(
        &db,
        "projects.save",
        json!({ "project": { "name": "Home" } }),
    )
    .unwrap();
    let project_id = project["project"]["id"].as_str().unwrap().to_string();

    let saved = call(
        &db,
        "items.save",
        json!({ "item": { "kind": "task", "title": "Paint", "projectId": project_id } }),
    )
    .unwrap();
    let id = saved["item"]["id"].as_str().unwrap().to_string();
    assert_eq!(saved["item"]["kind"], json!("task"));
    for key in [
        "id",
        "kind",
        "text",
        "title",
        "body",
        "url",
        "projectId",
        "stage",
        "previousStage",
        "done",
        "priority",
        "dueDate",
        "read",
        "readingLater",
        "createdAt",
        "updatedAt",
    ] {
        assert!(saved["item"].get(key).is_some(), "an item carries {key}");
    }
    assert_eq!(
        call(&db, "items.get", json!({ "id": id })).unwrap()["item"]["title"],
        json!("Paint")
    );
    assert_eq!(
        call(&db, "items.list", json!({ "kind": "task", "query": "pai" })).unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        call(&db, "items.list", json!({})).unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        call(&db, "items.delete", json!({ "id": id })).unwrap(),
        json!({ "deleted": true })
    );
    assert_eq!(
        call(&db, "items.get", json!({ "id": id })).unwrap(),
        json!({ "item": null })
    );

    assert_eq!(
        call(&db, "projects.list", json!({})).unwrap()["projects"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        call(&db, "projects.delete", json!({ "id": project_id })).unwrap(),
        json!({ "deleted": true })
    );

    let feed = call(
        &db,
        "feedItems.save",
        json!({ "item": { "title": "Saved", "url": "https://example.com/a" } }),
    )
    .unwrap();
    let feed_id = feed["item"]["id"].as_str().unwrap().to_string();
    assert_eq!(
        call(&db, "feedItems.list", json!({ "query": "saved" })).unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        call(&db, "feedItems.get", json!({ "id": feed_id })).unwrap()["item"]["url"],
        json!("https://example.com/a")
    );
    assert_eq!(
        call(&db, "feedItems.delete", json!({ "id": feed_id })).unwrap(),
        json!({ "deleted": true })
    );

    assert_eq!(
        call(
            &db,
            "settings.set",
            json!({ "key": "layout", "value": "compact" })
        )
        .unwrap(),
        json!({ "saved": true })
    );
    assert_eq!(
        call(&db, "settings.all", json!({})).unwrap(),
        json!({ "settings": { "layout": "compact" } })
    );
    assert_eq!(
        call(&db, "settings.delete", json!({ "key": "layout" })).unwrap(),
        json!({ "deleted": true })
    );
    let tool = std::env::temp_dir().join("tool");
    assert_eq!(
        call(
            &db,
            "settings.cliPaths.set",
            json!({ "name": "codex", "path": tool })
        )
        .unwrap(),
        json!({ "saved": true })
    );
    assert_eq!(
        call(&db, "settings.cliPaths.list", json!({})).unwrap(),
        json!({ "paths": { "codex": tool } })
    );
    assert_eq!(
        call(
            &db,
            "settings.cliPaths.set",
            json!({ "name": "codex", "path": null })
        )
        .unwrap(),
        json!({ "saved": true })
    );
    assert_eq!(
        call(&db, "settings.cliPaths.list", json!({})).unwrap(),
        json!({ "paths": {} })
    );
    assert_eq!(
        call(
            &db,
            "widgets.set",
            json!({ "id": "shells", "state": "active" })
        )
        .unwrap(),
        json!({ "saved": true })
    );
    assert_eq!(
        call(&db, "widgets.list", json!({})).unwrap(),
        json!({ "widgets": { "shells": "active" } })
    );
}

#[test]
fn commands_accept_no_sql_and_no_unknown_parameters() {
    let db = Storage::open_in_memory().unwrap();
    for (method, params) in [
        ("items.list", json!({ "sql": "SELECT * FROM items" })),
        ("items.list", json!({ "where": "1=1" })),
        ("items.list", json!({ "kind": "note; DROP TABLE items" })),
        ("items.get", json!({})),
        ("items.get", json!({ "id": 7 })),
        (
            "items.save",
            json!({ "item": { "kind": "note", "title": "t", "table": "projects" } }),
        ),
        ("items.save", json!({ "kind": "note", "title": "t" })),
        ("settings.set", json!({ "key": "layout" })),
        ("settings.cliPaths.set", json!({ "name": "codex" })),
        ("widgets.set", json!({ "id": "shells", "state": "on" })),
    ] {
        let error = call(&db, method, params.clone()).unwrap_err();
        assert_eq!(error, commands::BAD_REQUEST, "{method} {params}");
    }
    for method in [
        "storage.query",
        "storage.execute",
        "items.sql",
        "sql",
        "items.drop",
    ] {
        assert_eq!(
            call(&db, method, json!({ "sql": "SELECT 1" })).unwrap_err(),
            commands::UNKNOWN_COMMAND,
            "{method}"
        );
    }
}

#[test]
fn command_failures_are_plain_messages() {
    let db = Storage::open_in_memory().unwrap();
    let error = call(
        &db,
        "items.save",
        json!({ "item": { "kind": "bookmark", "title": "t" } }),
    )
    .unwrap_err();
    assert_eq!(error, "A bookmark needs a web address.");
    let error = call(
        &db,
        "items.save",
        json!({ "item": { "id": "missing", "kind": "note", "title": "t" } }),
    )
    .unwrap_err();
    assert_eq!(error, "That ID is not valid.");
    let error = call(
        &db,
        "items.save",
        json!({ "item": { "id": UI_ID, "kind": "note", "title": "t", "expectedUpdatedAt": 1 } }),
    )
    .unwrap_err();
    assert_eq!(error, "That item no longer exists.");
    let created = call(
        &db,
        "items.save",
        json!({ "item": { "kind": "note", "title": "t" } }),
    )
    .unwrap();
    let stale = json!({ "item": {
        "id": created["item"]["id"], "kind": "note", "title": "changed",
        "expectedUpdatedAt": created["item"]["updatedAt"].as_i64().unwrap() - 1,
    } });
    let error = call(&db, "items.save", stale).unwrap_err();
    assert_eq!(
        error,
        "That item was changed after you opened it. Your changes were not saved."
    );
}

/// Every command name is admitted by the gate, and the gate admits no other storage name.
#[test]
fn commands_and_the_gate_list_the_same_methods() {
    for method in commands::METHODS {
        assert!(
            crate::gate::PORTED.contains(method),
            "{method} is ported in the gate"
        );
    }
    // Every listed command is served: an empty request is understood or refused as a bad
    // request, never as an unknown command.
    let db = Storage::open_in_memory().unwrap();
    for method in commands::METHODS {
        let outcome = call(&db, method, json!({}));
        assert_ne!(
            outcome.err().as_deref(),
            Some(commands::UNKNOWN_COMMAND),
            "{method} has a handler"
        );
    }
    let prefixes = ["items.", "projects.", "feedItems.", "settings.", "widgets."];
    for method in crate::gate::PORTED
        .iter()
        .filter(|method| prefixes.iter().any(|prefix| method.starts_with(prefix)))
    {
        assert!(commands::METHODS.contains(method), "{method} has a handler");
    }
}
