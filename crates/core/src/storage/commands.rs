//! The typed commands the front end uses to reach storage.
//!
//! This is the whole surface. Each command takes named parameters with fixed types; unknown
//! parameters are refused, and no command takes SQL, a table name or a column name. The method
//! names here are admitted in [`crate::gate::PORTED`] and run signed out, as decided in #60.

use super::{
    FeedItemDraft, ItemDraft, ItemFilter, ProjectDraft, Storage, StorageError, WidgetState,
};
use crate::protocol::{BridgeError, BridgeResult};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Map, Value};

/// A command whose parameters are missing, mistyped or unknown.
pub const BAD_REQUEST: &str = "That request was not understood.";
/// A method name this module does not serve.
pub const UNKNOWN_COMMAND: &str = crate::gate::UNSUPPORTED;

/// Every storage command.
pub const METHODS: &[&str] = &[
    "items.list",
    "items.get",
    "items.save",
    "items.delete",
    "projects.list",
    "projects.save",
    "projects.delete",
    "feedItems.list",
    "feedItems.get",
    "feedItems.save",
    "feedItems.delete",
    "settings.all",
    "settings.set",
    "settings.delete",
    "settings.cliPaths.list",
    "settings.cliPaths.set",
    "widgets.list",
    "widgets.set",
];

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Nothing {}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ById {
    id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ByQuery {
    #[serde(default)]
    query: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SaveItem {
    item: ItemDraft,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SaveProject {
    project: ProjectDraft,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SaveFeedItem {
    item: FeedItemDraft,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SetSetting {
    key: String,
    value: Value,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ByKey {
    key: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SetCliPath {
    name: String,
    /// `null` clears the override. The field itself is required.
    path: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SetWidget {
    id: String,
    state: WidgetState,
}

fn parse<T: DeserializeOwned>(params: &Map<String, Value>) -> Result<T, BridgeError> {
    serde_json::from_value(Value::Object(params.clone()))
        .map_err(|_| BridgeError::from(BAD_REQUEST))
}

impl From<StorageError> for BridgeError {
    fn from(error: StorageError) -> Self {
        BridgeError(error.to_string())
    }
}

/// Runs one storage command. The caller has already passed the request through the gate.
pub fn handle(storage: &Storage, method: &str, params: &Map<String, Value>) -> BridgeResult {
    Ok(match method {
        "items.list" => json!({ "items": storage.list_items(&parse::<ItemFilter>(params)?)? }),
        "items.get" => json!({ "item": storage.get_item(&parse::<ById>(params)?.id)? }),
        "items.save" => json!({ "item": storage.save_item(parse::<SaveItem>(params)?.item)? }),
        "items.delete" => json!({ "deleted": storage.delete_item(&parse::<ById>(params)?.id)? }),
        "projects.list" => {
            json!({ "projects": storage.list_projects(parse::<ByQuery>(params)?.query.as_deref())? })
        }
        "projects.save" => {
            json!({ "project": storage.save_project(parse::<SaveProject>(params)?.project)? })
        }
        "projects.delete" => {
            json!({ "deleted": storage.delete_project(&parse::<ById>(params)?.id)? })
        }
        "feedItems.list" => {
            json!({ "items": storage.list_feed_items(parse::<ByQuery>(params)?.query.as_deref())? })
        }
        "feedItems.get" => json!({ "item": storage.get_feed_item(&parse::<ById>(params)?.id)? }),
        "feedItems.save" => {
            json!({ "item": storage.save_feed_item(parse::<SaveFeedItem>(params)?.item)? })
        }
        "feedItems.delete" => {
            json!({ "deleted": storage.delete_feed_item(&parse::<ById>(params)?.id)? })
        }
        "settings.all" => {
            parse::<Nothing>(params)?;
            json!({ "settings": storage.settings()? })
        }
        "settings.set" => {
            let SetSetting { key, value } = parse(params)?;
            storage.set_setting(&key, &value)?;
            json!({ "saved": true })
        }
        "settings.delete" => {
            json!({ "deleted": storage.delete_setting(&parse::<ByKey>(params)?.key)? })
        }
        "settings.cliPaths.list" => {
            parse::<Nothing>(params)?;
            json!({ "paths": storage.cli_paths()? })
        }
        "settings.cliPaths.set" => {
            if !params.contains_key("path") {
                return Err(BridgeError::from(BAD_REQUEST));
            }
            let SetCliPath { name, path } = parse(params)?;
            storage.set_cli_path(&name, path.as_deref().map(std::path::Path::new))?;
            json!({ "saved": true })
        }
        "widgets.list" => {
            parse::<Nothing>(params)?;
            json!({ "widgets": storage.widget_states()? })
        }
        "widgets.set" => {
            let SetWidget { id, state } = parse(params)?;
            storage.set_widget_state(&id, state)?;
            json!({ "saved": true })
        }
        _ => return Err(BridgeError::from(UNKNOWN_COMMAND)),
    })
}
