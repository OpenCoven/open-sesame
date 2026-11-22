//! Attention signals in the application (issue #80): the core's hook listener and agent board
//! (`open_sesame_core::attention`), the opt-in change to Claude Code's settings, the tray's
//! count of waiting agents and the optional notification when one starts waiting.
//!
//! Nothing is written to Claude Code's settings until the page asks for it with
//! `attention.install`, after showing the exact text from `attention.preview`. With the hook
//! off, the listener does not run and nothing of Claude Code's is read or touched. The token,
//! the port and whether notifications are on are kept in `attention.json`, and the settings
//! file's bytes as they were in `claude-settings.backup`, both in the application's data folder.

use crate::events;
use open_sesame_core::attention::board::{Board, Change};
use open_sesame_core::attention::{hook, listener};
use open_sesame_core::gate::UNSUPPORTED;
use open_sesame_core::protocol::{BridgeError, BridgeResult, Emit};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use tauri::{AppHandle, Manager, Runtime};

pub const METHODS: &[&str] = &[
    "attention.status",
    "attention.preview",
    "attention.install",
    "attention.remove",
    "attention.setNotify",
];
/// The host message sent when the board or the hook's state changes. `ui/attention-settings.js`
/// names the same string.
pub const CHANGED_EVENT: &str = "attention.changed";
const CONFIG_FILE: &str = "attention.json";
const BACKUP_FILE: &str = "claude-settings.backup";
const INVALID_REQUEST: &str = "Open Sesame could not read that request.";
pub(crate) const CHANGED_SINCE: &str = "Claude Code's settings file changed after the change was shown. Show the change again before adding the hook.";
pub(crate) const PORT_TAKEN: &str = "The port the hook was going to use is taken now, so Open Sesame chose another. Show the change again before adding the hook.";
pub(crate) const CONFIG_UNREADABLE: &str = "Open Sesame's record of the hook (attention.json) cannot be read. If the hook is still in Claude Code's settings file, take out the entries that post to 127.0.0.1.";
const NO_FOLDER: &str =
    "Open Sesame has no folder to keep the hook's settings in, so the hook cannot be installed.";

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Where things are: the application's own folder, and Claude Code's settings file.
#[derive(Clone, Debug)]
pub struct Paths {
    pub folder: PathBuf,
    pub settings: PathBuf,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Config {
    token: String,
    port: u16,
    installed: bool,
    notify: bool,
    /// Moves on at each removal, so that an event a stopped listener was still reading is
    /// dropped instead of filling the board again. Not saved.
    #[serde(skip)]
    generation: u64,
}

pub struct Attention {
    paths: Option<Paths>,
    config: Mutex<Config>,
    board: Mutex<Board>,
    listener: Mutex<Option<listener::Listener>>,
    /// A sentence about the hook that the page shows, such as a port that is taken.
    problem: Mutex<String>,
}

impl Attention {
    pub fn new(paths: Option<Paths>) -> Self {
        let saved = paths
            .as_ref()
            .and_then(|paths| std::fs::read(paths.folder.join(CONFIG_FILE)).ok());
        let config = saved
            .as_deref()
            .map(serde_json::from_slice::<Config>)
            .transpose();
        let problem = if config.is_err() {
            CONFIG_UNREADABLE.to_string()
        } else {
            String::new()
        };
        Attention {
            paths,
            config: Mutex::new(config.ok().flatten().unwrap_or_default()),
            board: Mutex::new(Board::default()),
            listener: Mutex::new(None),
            problem: Mutex::new(problem),
        }
    }

    fn paths(&self) -> Result<&Paths, BridgeError> {
        self.paths
            .as_ref()
            .ok_or_else(|| BridgeError::from(NO_FOLDER))
    }

    fn save(&self, config: &Config) -> Result<(), BridgeError> {
        let paths = self.paths()?;
        let failed = |error: std::io::Error| {
            BridgeError::from(format!(
                "Open Sesame could not save the hook's settings: {error}"
            ))
        };
        std::fs::create_dir_all(&paths.folder).map_err(failed)?;
        let text = serde_json::to_vec_pretty(config).expect("settings serialise");
        std::fs::write(paths.folder.join(CONFIG_FILE), text).map_err(failed)
    }

    pub fn status(&self) -> Value {
        let config = lock(&self.config).clone();
        let mut status = lock(&self.board).status();
        status["hook"] = json!({
            "installed": config.installed,
            "listening": lock(&self.listener).is_some(),
            "settingsPath": self.paths.as_ref().map(|paths| paths.settings.display().to_string()),
            "problem": lock(&self.problem).clone(),
        });
        status["notify"] = json!(config.notify);
        status
    }

    /// The text Claude Code's settings file has now and would have with the hook. The token
    /// and port are made here the first time, so what is shown is exactly what is written.
    fn preview(&self) -> BridgeResult {
        let paths = self.paths()?.clone();
        let config = self.prepared()?;
        let before = match std::fs::read(&paths.settings) {
            Ok(bytes) => Some(bytes),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => {
                return Err(BridgeError::from(format!(
                    "Claude Code's settings file cannot be read: {error}"
                )))
            }
        };
        let after = hook::plan(before.as_deref(), &hook::url(config.port, &config.token))
            .map_err(BridgeError::from)?;
        Ok(json!({
            "path": paths.settings.display().to_string(),
            "exists": before.is_some(),
            "before": before.map(|bytes| String::from_utf8_lossy(&bytes).into_owned()).unwrap_or_default(),
            "after": String::from_utf8_lossy(&after),
        }))
    }

    /// The configuration with a token and a port, made and saved if there were none.
    fn prepared(&self) -> Result<Config, BridgeError> {
        let mut config = lock(&self.config).clone();
        if config.token.is_empty() || config.port == 0 {
            config.token = hook::new_token();
            config.port = free_port()?;
            self.save(&config)?;
            *lock(&self.config) = config.clone();
        }
        Ok(config)
    }

    fn backup(&self) -> Result<PathBuf, BridgeError> {
        Ok(self.paths()?.folder.join(BACKUP_FILE))
    }

    fn set_installed(&self, installed: bool) -> Result<(), BridgeError> {
        let mut config = lock(&self.config).clone();
        config.installed = installed;
        self.save(&config)?;
        *lock(&self.config) = config;
        Ok(())
    }
}

/// A port no one is listening on now. It is kept, because the hook's address names it.
fn free_port() -> Result<u16, BridgeError> {
    std::net::TcpListener::bind(("127.0.0.1", 0))
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .map_err(|error| {
            BridgeError::from(format!(
                "Open Sesame could not find a free port for the hook: {error}"
            ))
        })
}

/// Claude Code's user settings file: in `CLAUDE_CONFIG_DIR` when that is set, as Claude Code
/// reads it, otherwise `.claude/settings.json` in the home folder. A development build reads
/// `OPEN_SESAME_DEV_CLAUDE_SETTINGS` first, so a test run never touches the real one.
pub fn settings_file(home: Option<&Path>) -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    if let Some(path) = std::env::var_os("OPEN_SESAME_DEV_CLAUDE_SETTINGS") {
        return Some(PathBuf::from(path));
    }
    if let Some(folder) = std::env::var_os("CLAUDE_CONFIG_DIR").filter(|folder| !folder.is_empty())
    {
        return Some(PathBuf::from(folder).join("settings.json"));
    }
    home.map(|home| home.join(".claude").join("settings.json"))
}

/// Applies one hook event and tells the page, the tray and, when it is on and an agent has just
/// started waiting, the system's notifications.
fn received<R: Runtime>(app: &AppHandle<R>, event: Value, generation: u64, emit: &Emit) {
    let Some(attention) = app.try_state::<Attention>() else {
        return;
    };
    {
        let config = lock(&attention.config);
        if !config.installed || config.generation != generation {
            return;
        }
    }
    let (change, waiting, agent) = {
        let mut board = lock(&attention.board);
        let change = board.apply(&event);
        let agent = board.agents().into_iter().next();
        (change, board.waiting(), agent)
    };
    if change == Change::Unchanged {
        return;
    }
    crate::tray::show_waiting(app, waiting);
    let status = attention.status();
    // Development evidence of what the board holds; the page and the tray show the same.
    #[cfg(debug_assertions)]
    eprintln!("open-sesame: attention {status}");
    emit(json!({"event": CHANGED_EVENT, "status": status}));
    if change == Change::StartedWaiting && lock(&attention.config).notify {
        if let Some(agent) = agent {
            notify(app, &agent.reason, &agent.folder);
        }
    }
}

/// A notification that an agent is waiting. The folder's last part names the project.
fn notify<R: Runtime>(app: &AppHandle<R>, reason: &str, folder: &str) {
    use tauri_plugin_notification::NotificationExt;
    if app
        .try_state::<tauri_plugin_notification::Notification<R>>()
        .is_none()
    {
        return;
    }
    let project = Path::new(folder)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let title = if project.is_empty() {
        "Claude Code is waiting".to_string()
    } else {
        format!("Claude Code is waiting in {project}")
    };
    let _ = app
        .notification()
        .builder()
        .title(title)
        .body(reason)
        .show();
}

/// Starts the listener when the hook is installed. A port that is taken is reported, not fatal.
/// A listener for the hook in `config`, whose events go to the board while that install lasts.
fn bind<R: Runtime>(
    app: &AppHandle<R>,
    config: &Config,
    emit: Emit,
) -> std::io::Result<listener::Listener> {
    let handle = app.clone();
    let generation = config.generation;
    listener::start(config.port, &config.token, move |event| {
        received(&handle, event, generation, &emit)
    })
}

/// Starts the listener at launch when the hook is installed. A port that is taken is
/// reported, not fatal.
fn listen<R: Runtime>(app: &AppHandle<R>, attention: &Attention, emit: Emit) {
    let config = lock(&attention.config).clone();
    let mut running = lock(&attention.listener);
    if !config.installed || running.is_some() || config.token.is_empty() {
        return;
    }
    match bind(app, &config, emit) {
        Ok(listener) => {
            *running = Some(listener);
            lock(&attention.problem).clear();
        }
        Err(error) => {
            *lock(&attention.problem) = format!(
                "Open Sesame cannot listen for Claude Code's hook on port {}: {error}",
                config.port
            );
        }
    }
}

pub fn start<R: Runtime>(app: &AppHandle<R>, paths: Option<Paths>) {
    let attention = Attention::new(paths);
    app.manage(attention);
    if let Some(attention) = app.try_state::<Attention>() {
        listen(app, &attention, events::emitter(app));
    }
}

/// Stops the listener at exit.
pub fn stop<R: Runtime>(app: &AppHandle<R>) {
    if let Some(attention) = app.try_state::<Attention>() {
        if let Some(listener) = lock(&attention.listener).take() {
            listener.stop();
        }
    }
}

pub fn handle<R: Runtime>(
    app: &AppHandle<R>,
    method: &str,
    params: &Map<String, Value>,
) -> BridgeResult {
    handle_with(app, method, params, events::emitter(app))
}

fn handle_with<R: Runtime>(
    app: &AppHandle<R>,
    method: &str,
    params: &Map<String, Value>,
    emit: Emit,
) -> BridgeResult {
    let attention = app
        .try_state::<Attention>()
        .ok_or_else(|| BridgeError::from(UNSUPPORTED))?;
    match method {
        "attention.status" => Ok(attention.status()),
        "attention.preview" => attention.preview(),
        "attention.install" => {
            let Some(Value::String(expected)) = params.get("expected") else {
                return Err(BridgeError::from(INVALID_REQUEST));
            };
            let paths = attention.paths()?.clone();
            let mut config = attention.prepared()?;
            // The port is the listener's before the hook names it.
            let mut running = lock(&attention.listener);
            let listener = match running.take() {
                Some(listener) => listener,
                None => match bind(app, &config, emit) {
                    Ok(listener) => listener,
                    Err(_) => {
                        config.port = free_port()?;
                        attention.save(&config)?;
                        *lock(&attention.config) = config;
                        return Err(BridgeError::from(PORT_TAKEN));
                    }
                },
            };
            let url = hook::url(config.port, &config.token);
            let current = std::fs::read(&paths.settings).ok();
            if hook::plan(current.as_deref(), &url).ok().as_deref() != Some(expected.as_bytes()) {
                listener.stop();
                return Err(BridgeError::from(CHANGED_SINCE));
            }
            if let Err(error) = hook::install(&paths.settings, &attention.backup()?, &url) {
                listener.stop();
                return Err(BridgeError::from(error));
            }
            attention.set_installed(true)?;
            *running = Some(listener);
            drop(running);
            lock(&attention.problem).clear();
            Ok(attention.status())
        }
        "attention.remove" => {
            let paths = attention.paths()?.clone();
            let config = lock(&attention.config).clone();
            hook::remove(
                &paths.settings,
                &attention.backup()?,
                &hook::url(config.port, &config.token),
            )
            .map_err(BridgeError::from)?;
            // The next install starts afresh: a new token, and a port bound when it is made.
            let forgotten = Config {
                notify: config.notify,
                generation: config.generation + 1,
                ..Config::default()
            };
            attention.save(&forgotten)?;
            *lock(&attention.config) = forgotten;
            if let Some(listener) = lock(&attention.listener).take() {
                listener.stop();
            }
            *lock(&attention.board) = Board::default();
            lock(&attention.problem).clear();
            crate::tray::show_waiting(app, 0);
            Ok(attention.status())
        }
        "attention.setNotify" => {
            let Some(Value::Bool(enabled)) = params.get("enabled") else {
                return Err(BridgeError::from(INVALID_REQUEST));
            };
            let mut config = lock(&attention.config).clone();
            config.notify = *enabled;
            attention.save(&config)?;
            *lock(&attention.config) = config;
            Ok(attention.status())
        }
        _ => Err(BridgeError::from(UNSUPPORTED)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::sync::Arc;
    use std::time::{Duration, Instant};
    use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};

    fn app_with(folder: &Path) -> (tauri::App<MockRuntime>, Paths) {
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let paths = Paths {
            folder: folder.join("open-sesame"),
            settings: folder.join("claude").join("settings.json"),
        };
        app.manage(Attention::new(Some(paths.clone())));
        (app, paths)
    }

    fn sent() -> (Emit, Arc<Mutex<Vec<Value>>>) {
        let sent = Arc::new(Mutex::new(Vec::new()));
        let into = Arc::clone(&sent);
        (Arc::new(move |message| lock(&into).push(message)), sent)
    }

    fn post(port: u16, token: &str, body: &Value) -> String {
        let body = body.to_string();
        let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(
            stream,
            "POST /hook/{token} HTTP/1.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        )
        .unwrap();
        let mut reply = String::new();
        let _ = stream.read_to_string(&mut reply);
        reply
    }

    /// Off by default: nothing is listening and Claude Code's settings are not read or touched.
    /// The preview is the exact text the install then writes; a permission request then shows
    /// as waiting and is sent to the page; removing restores the file byte for byte.
    #[test]
    fn the_hook_is_shown_installed_heard_and_removed() {
        let root = tempfile::tempdir().unwrap();
        let (app, paths) = app_with(root.path());
        let handle = app.handle();
        let (emit, messages) = sent();
        let call = |method: &str, params: Value| {
            handle_with(
                handle,
                method,
                params.as_object().unwrap(),
                Arc::clone(&emit),
            )
        };
        std::fs::create_dir_all(paths.settings.parent().unwrap()).unwrap();
        let original = b"{\"model\": \"opus\"}";
        std::fs::write(&paths.settings, original).unwrap();
        let status = call("attention.status", json!({})).unwrap();
        assert_eq!(status["hook"]["installed"], json!(false));
        assert_eq!(status["hook"]["listening"], json!(false));
        assert!(
            !paths.folder.exists(),
            "nothing is saved before the person asks"
        );
        let preview = call("attention.preview", json!({})).unwrap();
        assert_eq!(preview["before"], json!("{\"model\": \"opus\"}"));
        assert_eq!(
            std::fs::read(&paths.settings).unwrap(),
            original,
            "a preview writes nothing"
        );
        let status = call("attention.install", json!({"expected": preview["after"]})).unwrap();
        assert_eq!(status["hook"]["installed"], json!(true));
        assert_eq!(status["hook"]["listening"], json!(true));
        assert_eq!(
            std::fs::read_to_string(&paths.settings).unwrap(),
            preview["after"].as_str().unwrap()
        );
        let config = lock(&app.state::<Attention>().config).clone();
        let reply = post(
            config.port,
            &config.token,
            &json!({"hook_event_name": "PermissionRequest", "session_id": "s1", "cwd": "/work/app", "tool_name": "Bash"}),
        );
        assert!(reply.starts_with("HTTP/1.1 204"), "{reply}");
        let started = Instant::now();
        while lock(&messages).is_empty() && started.elapsed() < Duration::from_secs(5) {
            std::thread::sleep(Duration::from_millis(10));
        }
        let message = lock(&messages)[0].clone();
        assert_eq!(message["event"], json!(CHANGED_EVENT));
        assert_eq!(message["status"]["waiting"], json!(1));
        assert_eq!(message["status"]["agents"][0]["state"], json!("waiting"));
        let status = call("attention.remove", json!({})).unwrap();
        assert_eq!(status["hook"]["installed"], json!(false));
        assert_eq!(status["waiting"], json!(0));
        assert_eq!(std::fs::read(&paths.settings).unwrap(), original);
        assert!(
            std::net::TcpStream::connect(("127.0.0.1", config.port)).is_err(),
            "the listener stopped"
        );
    }

    /// The setting is kept, and the next launch listens again when the hook is installed.
    #[test]
    fn notifications_are_a_kept_setting_and_the_next_launch_listens() {
        let root = tempfile::tempdir().unwrap();
        let (app, paths) = app_with(root.path());
        let (emit, _) = sent();
        let call = |method: &str, params: Value| {
            handle_with(
                app.handle(),
                method,
                params.as_object().unwrap(),
                Arc::clone(&emit),
            )
        };
        assert_eq!(
            call("attention.setNotify", json!({"enabled": "yes"})).unwrap_err(),
            BridgeError::from(INVALID_REQUEST)
        );
        assert_eq!(
            call("attention.setNotify", json!({"enabled": true})).unwrap()["notify"],
            json!(true)
        );
        let shown = call("attention.preview", json!({})).unwrap()["after"].clone();
        call("attention.install", json!({"expected": shown})).unwrap();
        stop(app.handle());
        let (again, _) = app_with(root.path());
        let attention = again.state::<Attention>();
        assert!(lock(&attention.config).notify);
        listen(again.handle(), &attention, Arc::clone(&emit));
        assert_eq!(attention.status()["hook"]["listening"], json!(true));
        stop(again.handle());
        handle_with(again.handle(), "attention.remove", &Map::new(), emit).unwrap();
        assert!(
            !paths.settings.exists(),
            "there was no file before the install"
        );
    }

    /// The install writes only the text the person was shown: a file changed since, or a
    /// request without the text, is refused, and nothing is written.
    #[test]
    fn the_install_writes_only_the_text_that_was_shown() {
        let root = tempfile::tempdir().unwrap();
        let (app, paths) = app_with(root.path());
        let (emit, _) = sent();
        let call = |method: &str, params: Value| {
            handle_with(
                app.handle(),
                method,
                params.as_object().unwrap(),
                Arc::clone(&emit),
            )
        };
        std::fs::create_dir_all(paths.settings.parent().unwrap()).unwrap();
        std::fs::write(&paths.settings, b"{}").unwrap();
        let shown = call("attention.preview", json!({})).unwrap()["after"].clone();
        assert_eq!(
            call("attention.install", json!({})).unwrap_err(),
            BridgeError::from(INVALID_REQUEST)
        );
        std::fs::write(&paths.settings, b"{\"model\": \"sonnet\"}").unwrap();
        assert_eq!(
            call("attention.install", json!({"expected": shown})).unwrap_err(),
            BridgeError::from(CHANGED_SINCE)
        );
        assert_eq!(
            std::fs::read(&paths.settings).unwrap(),
            b"{\"model\": \"sonnet\"}"
        );
        assert_eq!(
            app.state::<Attention>().status()["hook"]["installed"],
            json!(false)
        );
    }

    /// The port is the listener's before the hook names it. One taken since the change was
    /// shown is replaced, and the person is asked to look at the change again; a removal
    /// forgets the port and the token, so the next install starts afresh.
    #[test]
    fn a_taken_port_is_replaced_before_the_hook_names_it() {
        let root = tempfile::tempdir().unwrap();
        let (app, paths) = app_with(root.path());
        let (emit, messages) = sent();
        let call = |method: &str, params: Value| {
            handle_with(
                app.handle(),
                method,
                params.as_object().unwrap(),
                Arc::clone(&emit),
            )
        };
        let shown = call("attention.preview", json!({})).unwrap()["after"].clone();
        let taken = lock(&app.state::<Attention>().config).port;
        let squatter = std::net::TcpListener::bind(("127.0.0.1", taken)).unwrap();
        let refused = call("attention.install", json!({"expected": shown})).unwrap_err();
        assert_eq!(refused, BridgeError::from(PORT_TAKEN));
        assert!(!paths.settings.exists(), "nothing was written");
        let config = lock(&app.state::<Attention>().config).clone();
        assert_ne!(config.port, taken);
        let shown = call("attention.preview", json!({})).unwrap()["after"].clone();
        assert!(shown
            .as_str()
            .unwrap()
            .contains(&format!(":{}/hook/", config.port)));
        call("attention.install", json!({"expected": shown})).unwrap();
        drop(squatter);
        call("attention.remove", json!({})).unwrap();
        let forgotten = lock(&app.state::<Attention>().config).clone();
        assert!(forgotten.token.is_empty() && forgotten.port == 0);
        // An event that was already on its way when the hook was removed changes nothing.
        let before = lock(&messages).len();
        received(
            app.handle(),
            json!({"hook_event_name": "PermissionRequest", "session_id": "late", "tool_name": "Bash"}),
            config.generation,
            &emit,
        );
        assert_eq!(lock(&messages).len(), before);
        assert_eq!(app.state::<Attention>().status()["waiting"], json!(0));
    }

    /// A settings file of Open Sesame's own that cannot be read is said, not taken as "off".
    #[test]
    fn an_unreadable_settings_file_of_its_own_is_reported() {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("open-sesame");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join(CONFIG_FILE), b"{ broken").unwrap();
        let (app, _) = app_with(root.path());
        let status = app.state::<Attention>().status();
        assert_eq!(status["hook"]["problem"], json!(CONFIG_UNREADABLE));
    }

    #[test]
    fn claude_codes_settings_file_follows_its_config_folder() {
        // The development override is not set under test.
        if std::env::var_os("OPEN_SESAME_DEV_CLAUDE_SETTINGS").is_some() {
            return;
        }
        if std::env::var_os("CLAUDE_CONFIG_DIR").is_none() {
            assert_eq!(
                settings_file(Some(Path::new("/work/person"))),
                Some(PathBuf::from("/work/person/.claude/settings.json"))
            );
        }
    }
}
