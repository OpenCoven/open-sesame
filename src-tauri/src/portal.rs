//! The XDG GlobalShortcuts portal (issue #108). On Wayland an application cannot grab a key
//! (`summon.rs`), but a desktop that offers this portal runs a shortcut for it: the
//! application asks for a session, offers the saved keys as the preferred trigger, and the
//! desktop binds the keys it chooses, which may ask the person first, and reports each press.
//! KDE Plasma, GNOME from version 48 and Hyprland offer it; a desktop that does not keeps
//! today's instruction to bind `open-sesame --toggle` by hand.
//!
//! [`Client`] is the conversation with the portal in plain types, with no D-Bus in it, so it is
//! tested on every system. The D-Bus side (`linux`) is built only on Linux, runs on its own
//! thread, and never delays the window: until the portal answers, the status is the one the
//! page already shows on Wayland. Changing the keys from the page is not offered; what that
//! should mean under the portal is the owner's question on #108.
//!
//! Protocol: <https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.GlobalShortcuts.html>

// The client runs only on Linux; on the other systems only its tests use it.
#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use serde_json::{json, Value};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};

/// The one shortcut Open Sesame asks for.
pub const SHORTCUT_ID: &str = "summon";
/// What the desktop lists the shortcut as in its own settings.
pub const DESCRIPTION: &str = "Show Open Sesame, or hide it when it is in front";
/// The start of every token this client gives the portal; a token is part of an object path.
const TOKEN: &str = "open_sesame";

/// Where the portal stands, for `summon.status`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum State {
    /// Not asked: not a Wayland session, or no shortcut to bind.
    #[default]
    Unused,
    /// Asked, with no answer yet. The desktop may be asking the person.
    Asking,
    /// Bound. `trigger` is the desktop's own description of the keys, which may differ from
    /// the saved ones; it may be empty.
    Bound { trigger: String },
    /// No portal, a portal without GlobalShortcuts, or one that failed.
    Unavailable,
    /// The person declined in the desktop's dialog, or removed the shortcut later.
    Declined,
}

impl State {
    pub fn name(&self) -> &'static str {
        match self {
            State::Unused => "unused",
            State::Asking => "asking",
            State::Bound { .. } => "bound",
            State::Unavailable => "unavailable",
            State::Declined => "declined",
        }
    }

    /// The `portal` part of `summon.status`.
    pub fn status(&self) -> Value {
        let trigger = match self {
            State::Bound { trigger } => trigger.as_str(),
            _ => "",
        };
        json!({"state": self.name(), "trigger": trigger})
    }
}

/// The saved keys as a preferred trigger, in the form of the XDG shortcuts specification:
/// `CTRL`, `ALT`, `SHIFT` and `LOGO` joined by `+`, then the key's xkb name. `None` for a key
/// without a name here, so that the desktop asks the person rather than binding a guess.
pub fn preferred_trigger(shortcut: &Shortcut) -> Option<String> {
    let key = key_name(shortcut.key)?;
    let mut parts: Vec<String> = [
        (Modifiers::CONTROL, "CTRL"),
        (Modifiers::ALT, "ALT"),
        (Modifiers::SHIFT, "SHIFT"),
    ]
    .into_iter()
    .filter(|(modifier, _)| shortcut.mods.contains(*modifier))
    .map(|(_, name)| name.to_string())
    .collect();
    if shortcut.mods.intersects(Modifiers::SUPER | Modifiers::META) {
        parts.push("LOGO".to_string());
    }
    parts.push(key);
    Some(parts.join("+"))
}

/// The xkb keysym name of a key, for the keys a shortcut can use.
fn key_name(code: Code) -> Option<String> {
    let debug = format!("{code:?}");
    if let Some(letter) = debug.strip_prefix("Key") {
        return Some(letter.to_lowercase());
    }
    if let Some(digit) = debug.strip_prefix("Digit") {
        return Some(digit.to_string());
    }
    if let Some(digit) = debug.strip_prefix("Numpad").filter(|rest| rest.len() == 1) {
        return Some(format!("KP_{digit}"));
    }
    if debug.len() <= 3 && debug.starts_with('F') && debug[1..].parse::<u8>().is_ok() {
        return Some(debug);
    }
    let name = match code {
        Code::Space => "space",
        Code::Enter => "Return",
        Code::Tab => "Tab",
        Code::Escape => "Escape",
        Code::Backspace => "BackSpace",
        Code::Delete => "Delete",
        Code::Insert => "Insert",
        Code::Home => "Home",
        Code::End => "End",
        Code::PageUp => "Page_Up",
        Code::PageDown => "Page_Down",
        Code::ArrowUp => "Up",
        Code::ArrowDown => "Down",
        Code::ArrowLeft => "Left",
        Code::ArrowRight => "Right",
        Code::Minus => "minus",
        Code::Equal => "equal",
        Code::BracketLeft => "bracketleft",
        Code::BracketRight => "bracketright",
        Code::Backslash => "backslash",
        Code::Semicolon => "semicolon",
        Code::Quote => "apostrophe",
        Code::Backquote => "grave",
        Code::Comma => "comma",
        Code::Period => "period",
        Code::Slash => "slash",
        Code::NumpadEnter => "KP_Enter",
        Code::NumpadAdd => "KP_Add",
        Code::NumpadSubtract => "KP_Subtract",
        Code::NumpadMultiply => "KP_Multiply",
        Code::NumpadDivide => "KP_Divide",
        Code::NumpadDecimal => "KP_Decimal",
        Code::MediaPlayPause => "XF86AudioPlay",
        Code::MediaStop => "XF86AudioStop",
        Code::MediaTrackNext => "XF86AudioNext",
        Code::MediaTrackPrevious => "XF86AudioPrev",
        Code::AudioVolumeUp => "XF86AudioRaiseVolume",
        Code::AudioVolumeDown => "XF86AudioLowerVolume",
        Code::AudioVolumeMute => "XF86AudioMute",
        _ => return None,
    };
    Some(name.to_string())
}

/// Where the portal answers a request: the documented rule, from this connection's unique bus
/// name without its `:` and with `.` as `_`, and the request's token. Knowing it before the
/// request is made lets the answer be listened for first, so it cannot be missed.
pub fn request_path(unique_name: &str, token: &str) -> String {
    let sender = unique_name.trim_start_matches(':').replace('.', "_");
    format!("/org/freedesktop/portal/desktop/request/{sender}/{token}")
}

/// What the portal said, in plain types.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Signal {
    /// A request's answer: `code` 0 is success, 1 is declined by the person, 2 anything else.
    /// `session` is the new session's handle, from creating one; `shortcuts` the bound
    /// shortcuts' ids and trigger descriptions, from binding.
    Response {
        path: String,
        code: u32,
        session: Option<String>,
        shortcuts: Vec<(String, String)>,
    },
    /// A shortcut was pressed.
    Activated { session: String, id: String },
    /// The person changed the session's shortcuts in the desktop's settings.
    ShortcutsChanged {
        session: String,
        shortcuts: Vec<(String, String)>,
    },
    /// The portal closed a session.
    Closed { session: String },
    /// The portal left the bus: it crashed, or was restarted, and its sessions with it.
    PortalGone,
}

/// What the D-Bus side does next.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    /// Ask to bind the shortcut in `session`, with `handle_token` for the request.
    Bind {
        session: String,
        handle_token: String,
    },
    /// One press on the window, as `open-sesame --toggle` is.
    Toggle,
    /// The status changed.
    Report(State),
}

/// The tokens of the first request, creating the session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateSession {
    pub handle_token: String,
    pub session_handle_token: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Phase {
    Creating { answer: String },
    Binding { session: String, answer: String },
    Bound { session: String },
    Ended,
}

/// The conversation with the portal: make a session, bind the shortcut, then toggle on each of
/// its presses and follow changes made in the desktop's settings.
#[derive(Debug)]
pub struct Client {
    unique_name: String,
    phase: Phase,
}

impl Client {
    /// A client for the connection with this unique bus name, and the first request to make.
    pub fn new(unique_name: &str) -> (Client, CreateSession) {
        let create = CreateSession {
            handle_token: format!("{TOKEN}_1"),
            session_handle_token: format!("{TOKEN}_s1"),
        };
        let client = Client {
            unique_name: unique_name.to_string(),
            phase: Phase::Creating {
                answer: request_path(unique_name, &create.handle_token),
            },
        };
        (client, create)
    }

    fn ours(&self, session: &str) -> bool {
        matches!(&self.phase, Phase::Bound { session: ours } | Phase::Binding { session: ours, .. } if ours == session)
    }

    pub fn on_signal(&mut self, signal: Signal) -> Vec<Action> {
        match (signal, &self.phase) {
            (
                Signal::Response {
                    path,
                    code,
                    session,
                    ..
                },
                Phase::Creating { answer },
            ) if path == *answer => match (code, session) {
                (0, Some(session)) => {
                    let handle_token = format!("{TOKEN}_2");
                    self.phase = Phase::Binding {
                        answer: request_path(&self.unique_name, &handle_token),
                        session: session.clone(),
                    };
                    vec![Action::Bind {
                        session,
                        handle_token,
                    }]
                }
                _ => self.end(State::Unavailable),
            },
            (
                Signal::Response {
                    path,
                    code,
                    shortcuts,
                    ..
                },
                Phase::Binding { answer, session },
            ) if path == *answer => match code {
                0 => {
                    let session = session.clone();
                    match trigger_of(&shortcuts) {
                        Some(trigger) => {
                            self.phase = Phase::Bound { session };
                            vec![Action::Report(State::Bound { trigger })]
                        }
                        None => self.end(State::Declined),
                    }
                }
                1 => self.end(State::Declined),
                _ => self.end(State::Unavailable),
            },
            (Signal::Activated { session, id }, _) if id == SHORTCUT_ID && self.ours(&session) => {
                vec![Action::Toggle]
            }
            (Signal::Closed { session }, _) if self.ours(&session) => self.end(State::Unavailable),
            (Signal::PortalGone, phase) if *phase != Phase::Ended => self.end(State::Unavailable),
            (Signal::ShortcutsChanged { session, shortcuts }, Phase::Bound { .. })
                if self.ours(&session) =>
            {
                vec![Action::Report(match trigger_of(&shortcuts) {
                    Some(trigger) => State::Bound { trigger },
                    None => State::Declined,
                })]
            }
            _ => Vec::new(),
        }
    }

    /// Whether nothing more will come of this client: the session was not made, or the
    /// shortcut was never bound.
    pub fn ended(&self) -> bool {
        self.phase == Phase::Ended
    }

    fn end(&mut self, state: State) -> Vec<Action> {
        self.phase = Phase::Ended;
        vec![Action::Report(state)]
    }
}

/// The trigger description of Open Sesame's shortcut among those listed, if it is there.
fn trigger_of(shortcuts: &[(String, String)]) -> Option<String> {
    shortcuts
        .iter()
        .find(|(id, _)| id == SHORTCUT_ID)
        .map(|(_, trigger)| trigger.clone())
}

/// The D-Bus side, on Linux only.
#[cfg(target_os = "linux")]
pub use linux::start;

#[cfg(target_os = "linux")]
mod linux {
    use super::{Action, Client, Signal, State, DESCRIPTION, SHORTCUT_ID};
    use std::collections::HashMap;
    use std::time::Duration;
    use tauri::{AppHandle, Runtime};
    use zbus::blocking::{MessageIterator, Proxy};
    use zbus::message::Type;
    use zbus::proxy::CacheProperties;
    use zbus::zvariant::{ObjectPath, OwnedObjectPath, OwnedValue, Value};
    use zbus::MatchRule;

    const DESTINATION: &str = "org.freedesktop.portal.Desktop";
    const PATH: &str = "/org/freedesktop/portal/desktop";
    const INTERFACE: &str = "org.freedesktop.portal.GlobalShortcuts";
    const REQUEST: &str = "org.freedesktop.portal.Request";
    const SESSION: &str = "org.freedesktop.portal.Session";
    const BUS: &str = "org.freedesktop.DBus";
    /// A shortcut as the portal lists it, `(sa{sv})`.
    type Listed = (String, HashMap<String, OwnedValue>);

    /// How long one call to the portal may take. The first may start the portal, which at
    /// login can take a while; nothing waits for this thread, so the limit is generous. The
    /// answers to requests come later, as signals, and are waited for as long as the person
    /// takes in the desktop's dialog.
    const CALL_TIMEOUT: Duration = Duration::from_secs(30);

    /// Asks the portal on its own thread, so nothing here delays the window. `preferred` is
    /// the saved keys as a trigger, or `None` to let the desktop ask the person.
    pub fn start<R: Runtime>(app: &AppHandle<R>, preferred: Option<String>) {
        let app = app.clone();
        let spawned = std::thread::Builder::new()
            .name("shortcut-portal".into())
            .spawn(move || {
                let emit = crate::events::emitter(&app);
                if let Err(error) = run(&app, preferred.as_deref(), &emit) {
                    eprintln!("open-sesame: the GlobalShortcuts portal is not available: {error}");
                    crate::summon::portal_changed(&app, State::Unavailable, &emit);
                }
            });
        if let Err(error) = spawned {
            eprintln!("open-sesame: the GlobalShortcuts portal cannot be asked: {error}");
        }
    }

    fn run<R: Runtime>(
        app: &AppHandle<R>,
        preferred: Option<&str>,
        emit: &open_sesame_core::protocol::Emit,
    ) -> zbus::Result<()> {
        let connection = zbus::blocking::connection::Builder::session()?
            .method_timeout(CALL_TIMEOUT)
            .build()?;
        // Everything this connection receives, from before the first request: the portal's
        // signals, and the bus's word when the portal's name changes owner.
        let incoming = MessageIterator::from(&connection);
        let bus = zbus::blocking::fdo::DBusProxy::new(&connection)?;
        bus.add_match_rule(
            MatchRule::builder()
                .msg_type(Type::Signal)
                .sender(DESTINATION)?
                .build(),
        )?;
        bus.add_match_rule(
            MatchRule::builder()
                .msg_type(Type::Signal)
                .sender(BUS)?
                .interface(BUS)?
                .member("NameOwnerChanged")?
                .arg(0, DESTINATION)?
                .build(),
        )?;
        let portal = zbus::blocking::proxy::Builder::<Proxy>::new(&connection)
            .destination(DESTINATION)?
            .path(PATH)?
            .interface(INTERFACE)?
            .cache_properties(CacheProperties::No)
            .build()?;
        // A portal without this interface, or none at all, fails here.
        let version: u32 = portal.get_property("version")?;
        #[cfg(debug_assertions)]
        eprintln!("open-sesame: GlobalShortcuts portal version {version}");
        #[cfg(not(debug_assertions))]
        let _ = version;
        // Only the portal's own signals are read: any program on the bus can send a signal
        // that names the portal's path, but not one from the portal's connection.
        let owner = bus
            .get_name_owner(zbus::names::BusName::try_from(DESTINATION)?)?
            .to_string();
        let unique = connection
            .unique_name()
            .map(|name| name.to_string())
            .unwrap_or_default();
        let (mut client, create) = Client::new(&unique);
        let options: HashMap<&str, Value> = HashMap::from([
            ("handle_token", Value::from(create.handle_token.as_str())),
            (
                "session_handle_token",
                Value::from(create.session_handle_token.as_str()),
            ),
        ]);
        let _: OwnedObjectPath = portal.call("CreateSession", &(options,))?;
        for message in incoming {
            let message = message?;
            let Some(signal) = signal_of(&message, &owner) else {
                continue;
            };
            for action in client.on_signal(signal) {
                match action {
                    Action::Bind {
                        session,
                        handle_token,
                    } => {
                        let mut shortcut: HashMap<&str, Value> =
                            HashMap::from([("description", Value::from(DESCRIPTION))]);
                        if let Some(preferred) = preferred {
                            shortcut.insert("preferred_trigger", Value::from(preferred));
                        }
                        let options: HashMap<&str, Value> =
                            HashMap::from([("handle_token", Value::from(handle_token.as_str()))]);
                        let session = ObjectPath::try_from(session.as_str())?;
                        let _: OwnedObjectPath = portal.call(
                            "BindShortcuts",
                            &(session, vec![(SHORTCUT_ID, shortcut)], "", options),
                        )?;
                    }
                    Action::Toggle => {
                        // Development evidence that a press reached the application this way.
                        #[cfg(debug_assertions)]
                        eprintln!("open-sesame: the portal reported a press");
                        crate::window::toggle(app);
                    }
                    Action::Report(state) => {
                        crate::summon::portal_changed(app, state, emit);
                        // A session that never bound has nothing more to say.
                        if client.ended() {
                            return Ok(());
                        }
                    }
                }
            }
        }
        Ok(())
    }

    /// The portal's signal in plain types, or `None` for one this client does not read:
    /// anything that is not a signal, and any signal not sent by `owner`, the portal's
    /// connection, except the bus's own word that the portal's name changed owner.
    fn signal_of(message: &zbus::Message, owner: &str) -> Option<Signal> {
        let header = message.header();
        if header.message_type() != Type::Signal {
            return None;
        }
        let sender = header.sender()?.to_string();
        let interface = header.interface()?.as_str().to_string();
        let member = header.member()?.as_str().to_string();
        let path = header.path()?.to_string();
        let body = message.body();
        if sender == BUS && interface == BUS && member == "NameOwnerChanged" {
            let (name, _, _): (String, String, String) = body.deserialize().ok()?;
            return (name == DESTINATION).then_some(Signal::PortalGone);
        }
        if sender != owner {
            return None;
        }
        match (interface.as_str(), member.as_str()) {
            (SESSION, "Closed") => Some(Signal::Closed { session: path }),
            (REQUEST, "Response") => {
                let (code, results): (u32, HashMap<String, OwnedValue>) =
                    body.deserialize().ok()?;
                Some(Signal::Response {
                    path,
                    code,
                    session: results.get("session_handle").and_then(|v| text(v)),
                    shortcuts: results
                        .get("shortcuts")
                        .map(|v| shortcuts_of(v))
                        .unwrap_or_default(),
                })
            }
            (INTERFACE, "Activated") => {
                let (session, id, _, _): (
                    OwnedObjectPath,
                    String,
                    u64,
                    HashMap<String, OwnedValue>,
                ) = body.deserialize().ok()?;
                Some(Signal::Activated {
                    session: session.to_string(),
                    id,
                })
            }
            (INTERFACE, "ShortcutsChanged") => {
                let (session, listed): (OwnedObjectPath, Vec<Listed>) = body.deserialize().ok()?;
                Some(Signal::ShortcutsChanged {
                    session: session.to_string(),
                    shortcuts: listed
                        .into_iter()
                        .map(|(id, properties)| {
                            let trigger = properties
                                .get("trigger_description")
                                .and_then(|v| text(v))
                                .unwrap_or_default();
                            (id, trigger)
                        })
                        .collect(),
                })
            }
            _ => None,
        }
    }

    /// A string or object path, inside any number of variants.
    fn text(value: &Value) -> Option<String> {
        match value {
            Value::Str(text) => Some(text.as_str().to_string()),
            Value::ObjectPath(path) => Some(path.to_string()),
            Value::Value(inner) => text(inner),
            _ => None,
        }
    }

    /// The `shortcuts` of a bind's answer, `a(sa{sv})`, as ids and trigger descriptions.
    fn shortcuts_of(value: &Value) -> Vec<(String, String)> {
        let value = match value {
            Value::Value(inner) => inner.as_ref(),
            other => other,
        };
        let Value::Array(listed) = value else {
            return Vec::new();
        };
        listed
            .iter()
            .filter_map(|entry| {
                let Value::Structure(entry) = entry else {
                    return None;
                };
                let [Value::Str(id), Value::Dict(properties)] = entry.fields() else {
                    return None;
                };
                let trigger = properties
                    .iter()
                    .find_map(|(key, value)| match key {
                        Value::Str(key) if key.as_str() == "trigger_description" => text(value),
                        _ => None,
                    })
                    .unwrap_or_default();
                Some((id.as_str().to_string(), trigger))
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};

    fn trigger(mods: Modifiers, key: Code) -> Option<String> {
        preferred_trigger(&Shortcut::new(Some(mods), key))
    }

    /// The saved keys are offered in the form of the XDG shortcuts specification: modifiers in
    /// capitals joined by `+`, then the key's xkb name.
    #[test]
    fn the_saved_keys_are_offered_as_the_preferred_trigger() {
        let all = Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT;
        assert_eq!(
            trigger(all, Code::Space).as_deref(),
            Some("CTRL+ALT+SHIFT+space")
        );
        assert_eq!(
            trigger(Modifiers::SUPER, Code::KeyK).as_deref(),
            Some("LOGO+k")
        );
        assert_eq!(
            trigger(Modifiers::CONTROL | Modifiers::SHIFT, Code::Digit1).as_deref(),
            Some("CTRL+SHIFT+1")
        );
        assert_eq!(
            trigger(Modifiers::ALT, Code::F12).as_deref(),
            Some("ALT+F12")
        );
        assert_eq!(
            trigger(Modifiers::CONTROL, Code::Enter).as_deref(),
            Some("CTRL+Return")
        );
        assert_eq!(
            trigger(Modifiers::CONTROL, Code::Slash).as_deref(),
            Some("CTRL+slash")
        );
        // A key with no name here is not guessed at: the desktop asks the person instead.
        assert_eq!(trigger(Modifiers::CONTROL, Code::IntlRo), None);
    }

    /// Where the portal answers a request, from the bus name and the token (the portal's
    /// documented rule), so the answer can be listened for before the request is made.
    #[test]
    fn the_request_path_is_worked_out_from_the_bus_name_and_token() {
        assert_eq!(
            request_path(":1.42", "open_sesame_1"),
            "/org/freedesktop/portal/desktop/request/1_42/open_sesame_1"
        );
    }

    fn response(
        path: &str,
        code: u32,
        session: Option<&str>,
        shortcuts: &[(&str, &str)],
    ) -> Signal {
        Signal::Response {
            path: path.to_string(),
            code,
            session: session.map(str::to_string),
            shortcuts: shortcuts
                .iter()
                .map(|(id, trigger)| (id.to_string(), trigger.to_string()))
                .collect(),
        }
    }

    const SESSION: &str = "/org/freedesktop/portal/desktop/session/1_42/open_sesame_s1";

    /// The whole of a good answer: a session, the shortcut bound to the keys the desktop chose,
    /// and a press of it toggling the window.
    #[test]
    fn a_session_is_made_the_shortcut_bound_and_its_press_toggles() {
        let (mut client, create) = Client::new(":1.42");
        assert_eq!(create.handle_token, "open_sesame_1");
        assert_eq!(create.session_handle_token, "open_sesame_s1");
        let created = request_path(":1.42", &create.handle_token);
        let actions = client.on_signal(response(&created, 0, Some(SESSION), &[]));
        assert_eq!(
            actions,
            vec![Action::Bind {
                session: SESSION.to_string(),
                handle_token: "open_sesame_2".to_string(),
            }]
        );
        let bound = request_path(":1.42", "open_sesame_2");
        let actions = client.on_signal(response(
            &bound,
            0,
            None,
            &[(SHORTCUT_ID, "Ctrl+Alt+Shift+Space")],
        ));
        assert_eq!(
            actions,
            vec![Action::Report(State::Bound {
                trigger: "Ctrl+Alt+Shift+Space".to_string()
            })]
        );
        let press = Signal::Activated {
            session: SESSION.to_string(),
            id: SHORTCUT_ID.to_string(),
        };
        assert_eq!(client.on_signal(press.clone()), vec![Action::Toggle]);
        assert_eq!(client.on_signal(press), vec![Action::Toggle]);
    }

    /// Signals that are not this client's answers change nothing: another application's
    /// requests, another session's presses, another shortcut of ours, and a press before the
    /// session exists.
    #[test]
    fn signals_that_are_not_ours_change_nothing() {
        let (mut client, create) = Client::new(":1.42");
        let early = Signal::Activated {
            session: SESSION.to_string(),
            id: SHORTCUT_ID.to_string(),
        };
        assert_eq!(client.on_signal(early), vec![]);
        let elsewhere = request_path(":1.7", &create.handle_token);
        assert_eq!(
            client.on_signal(response(&elsewhere, 0, Some(SESSION), &[])),
            vec![]
        );
        let created = request_path(":1.42", &create.handle_token);
        assert_eq!(
            client
                .on_signal(response(&created, 0, Some(SESSION), &[]))
                .len(),
            1
        );
        // The answer to creating the session again, once it is made, is not a second session.
        assert_eq!(
            client.on_signal(response(&created, 0, Some(SESSION), &[])),
            vec![]
        );
        let bound = request_path(":1.42", "open_sesame_2");
        client.on_signal(response(&bound, 0, None, &[(SHORTCUT_ID, "Super+O")]));
        let other_session = Signal::Activated {
            session: "/org/freedesktop/portal/desktop/session/1_7/x".to_string(),
            id: SHORTCUT_ID.to_string(),
        };
        assert_eq!(client.on_signal(other_session), vec![]);
        let other_id = Signal::Activated {
            session: SESSION.to_string(),
            id: "something-else".to_string(),
        };
        assert_eq!(client.on_signal(other_id), vec![]);
    }

    /// The person may decline in the desktop's dialog, and the portal may fail either request.
    #[test]
    fn a_declined_or_failed_request_is_reported_and_ends_the_client() {
        // Declined (1) when binding.
        let (mut client, create) = Client::new(":1.42");
        let created = request_path(":1.42", &create.handle_token);
        client.on_signal(response(&created, 0, Some(SESSION), &[]));
        let bound = request_path(":1.42", "open_sesame_2");
        assert_eq!(
            client.on_signal(response(&bound, 1, None, &[])),
            vec![Action::Report(State::Declined)]
        );
        let press = Signal::Activated {
            session: SESSION.to_string(),
            id: SHORTCUT_ID.to_string(),
        };
        assert_eq!(client.on_signal(press), vec![]);
        // Another failure (2) when making the session.
        let (mut client, create) = Client::new(":1.42");
        let created = request_path(":1.42", &create.handle_token);
        assert_eq!(
            client.on_signal(response(&created, 2, None, &[])),
            vec![Action::Report(State::Unavailable)]
        );
        // A good answer with no session in it is a failure too.
        let (mut client, create) = Client::new(":1.42");
        let created = request_path(":1.42", &create.handle_token);
        assert_eq!(
            client.on_signal(response(&created, 0, None, &[])),
            vec![Action::Report(State::Unavailable)]
        );
        // A bind that answers without our shortcut bound nothing.
        let (mut client, create) = Client::new(":1.42");
        let created = request_path(":1.42", &create.handle_token);
        client.on_signal(response(&created, 0, Some(SESSION), &[]));
        let bound = request_path(":1.42", "open_sesame_2");
        assert_eq!(
            client.on_signal(response(&bound, 0, None, &[("other", "Super+X")])),
            vec![Action::Report(State::Declined)]
        );
    }

    /// The person can change or remove the shortcut in the desktop's settings; the status
    /// follows.
    #[test]
    fn a_change_in_the_desktops_settings_is_followed() {
        let (mut client, create) = Client::new(":1.42");
        let created = request_path(":1.42", &create.handle_token);
        client.on_signal(response(&created, 0, Some(SESSION), &[]));
        let bound = request_path(":1.42", "open_sesame_2");
        client.on_signal(response(&bound, 0, None, &[(SHORTCUT_ID, "Super+O")]));
        let changed = |shortcuts: &[(&str, &str)], session: &str| Signal::ShortcutsChanged {
            session: session.to_string(),
            shortcuts: shortcuts
                .iter()
                .map(|(id, trigger)| (id.to_string(), trigger.to_string()))
                .collect(),
        };
        assert_eq!(
            client.on_signal(changed(&[(SHORTCUT_ID, "Super+P")], SESSION)),
            vec![Action::Report(State::Bound {
                trigger: "Super+P".to_string()
            })]
        );
        assert_eq!(
            client.on_signal(changed(&[(SHORTCUT_ID, "Super+Q")], "/elsewhere")),
            vec![]
        );
        assert_eq!(
            client.on_signal(changed(&[], SESSION)),
            vec![Action::Report(State::Declined)]
        );
        // Bound again later by the person in the desktop's settings.
        assert_eq!(
            client.on_signal(changed(&[(SHORTCUT_ID, "Super+R")], SESSION)),
            vec![Action::Report(State::Bound {
                trigger: "Super+R".to_string()
            })]
        );
    }

    /// The session can end from the portal's side: the session is closed, or the portal
    /// leaves the bus (it crashed or was restarted). Presses stop either way, so the status
    /// says the portal is not there and the client ends.
    #[test]
    fn a_closed_session_or_a_portal_that_leaves_ends_the_client() {
        let bound_client = || {
            let (mut client, create) = Client::new(":1.42");
            let created = request_path(":1.42", &create.handle_token);
            client.on_signal(response(&created, 0, Some(SESSION), &[]));
            let bound = request_path(":1.42", "open_sesame_2");
            client.on_signal(response(&bound, 0, None, &[(SHORTCUT_ID, "Super+O")]));
            client
        };
        let mut client = bound_client();
        let elsewhere = Signal::Closed {
            session: "/org/freedesktop/portal/desktop/session/1_7/x".to_string(),
        };
        assert_eq!(client.on_signal(elsewhere), vec![]);
        assert_eq!(
            client.on_signal(Signal::Closed {
                session: SESSION.to_string()
            }),
            vec![Action::Report(State::Unavailable)]
        );
        assert!(client.ended());
        let mut client = bound_client();
        assert_eq!(
            client.on_signal(Signal::PortalGone),
            vec![Action::Report(State::Unavailable)]
        );
        assert!(client.ended());
        assert_eq!(client.on_signal(Signal::PortalGone), vec![]);
        // Gone while the session was still being made.
        let (mut client, _) = Client::new(":1.42");
        assert_eq!(
            client.on_signal(Signal::PortalGone),
            vec![Action::Report(State::Unavailable)]
        );
    }

    /// What `summon.status` carries for each state.
    #[test]
    fn each_state_has_a_name_and_the_desktops_keys_when_bound() {
        assert_eq!(State::default(), State::Unused);
        assert_eq!(
            State::Unused.status(),
            serde_json::json!({"state": "unused", "trigger": ""})
        );
        assert_eq!(State::Asking.status()["state"], "asking");
        assert_eq!(State::Unavailable.status()["state"], "unavailable");
        assert_eq!(State::Declined.status()["state"], "declined");
        assert_eq!(
            State::Bound {
                trigger: "Super+O".to_string()
            }
            .status(),
            serde_json::json!({"state": "bound", "trigger": "Super+O"})
        );
    }
}
