//! The main window: created in Rust, hidden instead of closed, and limited to bundled pages.

use crate::summon::{self, Session, Summon};
use open_sesame_core::gate::{MAIN_WINDOW, NOT_ON_OS, UNSUPPORTED};
use open_sesame_core::protocol::{BridgeError, BridgeResult};
use serde_json::{json, Map, Value};
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, LogicalSize, Manager, Runtime, Url, WebviewUrl, WebviewWindow};
use tauri::{WebviewWindowBuilder, WindowEvent};

const TITLE: &str = "Open Sesame";
const DEFAULT_SIZE: (f64, f64) = (1090.0, 613.0);
const MINIMUM_SIZE: (f64, f64) = (800.0, 450.0);
/// Larger than any display; a request beyond it is a mistake, not a preference.
const MAXIMUM_SIDE: f64 = 16384.0;

pub const INVALID_DIMENSIONS: &str = "Invalid window dimensions.";
pub const WINDOW_UNAVAILABLE: &str = "The Open Sesame window is not available.";

/// The window methods this crate answers. Each is also listed in the gate's `PORTED`.
pub const METHODS: &[&str] = &[
    "window.size",
    "window.focus",
    "window.fullscreen",
    "window.keepOpen",
];

/// Creates the one window. It is created here rather than in `tauri.conf.json` so the
/// initialisation script is attached before any page script runs.
pub fn create_main(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let version = app.package_info().version.to_string();
    let builder = WebviewWindowBuilder::new(app, MAIN_WINDOW, WebviewUrl::App("index.html".into()))
        .title(TITLE)
        .inner_size(DEFAULT_SIZE.0, DEFAULT_SIZE.1)
        .min_inner_size(MINIMUM_SIZE.0, MINIMUM_SIZE.1)
        .resizable(true)
        .initialization_script(initialization_script(&version))
        .initialization_script(selftest_script())
        .on_navigation({
            let dev_url = app.config().build.dev_url.clone();
            move |url| is_app_page(dev_url.as_ref(), url)
        })
        // The page may not open another window; nothing in the shell needs one.
        .on_new_window(|_, _| NewWindowResponse::Deny);
    // A Wayland session places windows itself; the application does not try to.
    let builder = if summon::session() == Session::Wayland {
        builder
    } else {
        builder.center()
    };
    #[cfg(debug_assertions)]
    let builder = builder.on_page_load(|_, payload| {
        if payload.event() == tauri::webview::PageLoadEvent::Finished {
            // Development evidence that hiding and showing the window does not load the page again.
            eprintln!("open-sesame: page loaded {}", payload.url());
        }
    });
    let window = builder.build()?;
    #[cfg(target_os = "macos")]
    crate::panel::adopt(&window)?;
    let handle = window.clone();
    window.on_window_event(move |event| match event {
        // Closing hides the window and keeps the page alive. Quit is the tray's explicit action.
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = handle.hide();
            #[cfg(debug_assertions)]
            eprintln!("open-sesame: hidden by the close button");
        }
        // Hidden only if the person asked for that and nothing holds the window (issue #71).
        WindowEvent::Focused(false) => summon::blurred(handle.app_handle()),
        _ => {}
    });
    Ok(window)
}

/// Sets the flags the UI reads, before any page script runs. They cannot be reassigned.
pub fn initialization_script(version: &str) -> String {
    let version = Value::String(version.to_string());
    format!(
        "Object.defineProperty(window,'__OPEN_SESAME_NATIVE__',{{value:true}});\
         Object.defineProperty(window,'__OPEN_SESAME_VERSION__',{{value:{version}}});"
    )
}

/// In a development build started with `OPEN_SESAME_SELFTEST` set to a JSON object, hands that
/// object to the page, which then runs the acceptance pass in `ui/dev/selftest.js`. A release
/// build never sets the flag, whatever the environment says.
fn selftest_script() -> String {
    if !cfg!(debug_assertions) {
        return String::new();
    }
    std::env::var("OPEN_SESAME_SELFTEST")
        .ok()
        .and_then(|text| selftest_flag(&text))
        .unwrap_or_default()
}

/// The script for a self-test request, or `None` when the text is not a JSON object. The value
/// is written back out as JSON, so it cannot carry script of its own.
fn selftest_flag(text: &str) -> Option<String> {
    let value: Value = serde_json::from_str(text).ok()?;
    value.is_object().then(|| {
        format!("Object.defineProperty(window,'__OPEN_SESAME_SELFTEST__',{{value:Object.freeze({value})}});")
    })
}

/// Whether `url` is a page bundled with the application. Tauri serves bundled files from
/// `tauri://localhost` on macOS and Linux and from `http://tauri.localhost` on Windows.
pub fn is_bundled_page(url: &Url) -> bool {
    let origin = if cfg!(windows) {
        url.scheme() == "http" && url.host_str() == Some("tauri.localhost")
    } else {
        url.scheme() == "tauri" && url.host_str() == Some("localhost")
    };
    origin && url.port().is_none() && url.username().is_empty() && url.password().is_none()
}

/// Whether `url` is a page of this application: a bundled page or, in a development build only,
/// a page on the loopback address `cargo tauri dev` serves the same files from. A release build
/// has no development address, whatever the configuration says.
pub fn is_app_page(dev_url: Option<&Url>, url: &Url) -> bool {
    is_bundled_page(url)
        || (cfg!(debug_assertions) && dev_url.is_some_and(|dev| is_dev_server_page(dev, url)))
}

fn is_dev_server_page(dev_url: &Url, url: &Url) -> bool {
    let loopback = matches!(
        dev_url.host_str(),
        Some("127.0.0.1" | "localhost" | "[::1]")
    );
    loopback
        && dev_url.scheme() == "http"
        && url.scheme() == "http"
        && url.host_str() == dev_url.host_str()
        && url.port_or_known_default() == dev_url.port_or_known_default()
        && url.username().is_empty()
        && url.password().is_none()
}

/// Brings the window forward: a second launch, and on macOS a click on the Dock icon.
pub fn show<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = focus(&window);
    }
}

pub fn hide<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = conceal(&window);
    }
}

fn conceal<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    // Development evidence where nothing outside the application can see the window, as in
    // a headless Wayland session.
    #[cfg(debug_assertions)]
    eprintln!("open-sesame: window hidden");
    window.hide()
}

/// Whether the person can see the window. A minimized window still counts as visible to the
/// system, so it is treated as hidden here: showing it must also restore it.
pub fn is_shown<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false)
}

/// Shows the window if it is hidden and hides it if it is shown: the tray menu, the shortcut
/// and `open-sesame --toggle` all end here.
pub fn toggle<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = if is_shown(&window) {
            conceal(&window)
        } else {
            focus(&window)
        };
    }
}

/// The tray popover: hides the window if it is shown; otherwise moves it against the tray icon
/// at `icon`, inside the work area of the screen the icon is on, and shows it. A window the
/// person made full-screen or maximized is shown where it is.
pub fn toggle_at<R: Runtime>(app: &AppHandle<R>, icon: tauri::Rect) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    if is_shown(&window) {
        let _ = conceal(&window);
        return;
    }
    let placed = window.is_fullscreen().unwrap_or(false) || window.is_maximized().unwrap_or(false);
    if !placed {
        let _ = place_against(&window, icon);
    }
    let _ = focus(&window);
}

fn place_against<R: Runtime>(window: &WebviewWindow<R>, icon: tauri::Rect) -> tauri::Result<()> {
    // The tray reports physical pixels; a logical value is converted with the window's scale.
    let scale = window.scale_factor()?;
    let at = icon.position.to_physical::<f64>(scale);
    let extent = icon.size.to_physical::<f64>(scale);
    let Some(monitor) = window.monitor_from_point(at.x, at.y)? else {
        return Ok(());
    };
    let area = monitor.work_area();
    let size = window.outer_size()?;
    let (x, y) = summon::popover_position(
        ((at.x, at.y), (extent.width, extent.height)),
        (f64::from(size.width), f64::from(size.height)),
        (
            (f64::from(area.position.x), f64::from(area.position.y)),
            (f64::from(area.size.width), f64::from(area.size.height)),
        ),
    );
    window.set_position(tauri::PhysicalPosition::new(
        x.round() as i32,
        y.round() as i32,
    ))
}

fn focus<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    #[cfg(debug_assertions)]
    eprintln!("open-sesame: window shown");
    window.show()?;
    window.unminimize()?;
    // On macOS the window is a panel that takes the keyboard without activating the
    // application, so it can appear over another application's full-screen space.
    #[cfg(target_os = "macos")]
    if crate::panel::show(window) {
        return Ok(());
    }
    window.set_focus()
}

/// Answers a window method the gate has allowed.
pub fn handle<R: Runtime>(
    window: &WebviewWindow<R>,
    method: &str,
    params: &Map<String, Value>,
) -> BridgeResult {
    let unavailable = |_: tauri::Error| BridgeError::from(WINDOW_UNAVAILABLE);
    match method {
        "window.size" => {
            let (width, height) = requested_size(params)?;
            window
                .set_size(LogicalSize::new(width, height))
                .map_err(unavailable)?;
            Ok(json!(true))
        }
        "window.focus" => {
            focus(window).map_err(unavailable)?;
            Ok(json!(true))
        }
        "window.fullscreen" => {
            let fullscreen = !window.is_fullscreen().map_err(unavailable)?;
            window.set_fullscreen(fullscreen).map_err(unavailable)?;
            Ok(json!({"fullscreen": fullscreen}))
        }
        "window.keepOpen" => {
            let summon = window.app_handle().try_state::<Summon>();
            // A Wayland session decides stacking itself; forcing a window on top is not offered.
            if summon
                .as_ref()
                .is_some_and(|summon| summon.session() == Session::Wayland)
            {
                return Err(BridgeError::from(NOT_ON_OS));
            }
            let pinned = params.get("pinned") == Some(&Value::Bool(true));
            window.set_always_on_top(pinned).map_err(unavailable)?;
            // A pinned window also stays when it loses focus.
            if let Some(summon) = summon {
                summon.set_pinned(pinned);
            }
            Ok(json!({"pinned": pinned}))
        }
        _ => Err(BridgeError::from(UNSUPPORTED)),
    }
}

/// The inner size a `window.size` request asks for, in logical pixels, kept within the window's
/// minimum and a sane maximum.
fn requested_size(params: &Map<String, Value>) -> Result<(f64, f64), BridgeError> {
    let side = |name: &str, minimum: f64| {
        params
            .get(name)
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite() && *value > 0.0)
            .map(|value| value.clamp(minimum, MAXIMUM_SIDE))
            .ok_or_else(|| BridgeError::from(INVALID_DIMENSIONS))
    };
    Ok((
        side("width", MINIMUM_SIZE.0)?,
        side("height", MINIMUM_SIZE.1)?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(value: Value) -> Map<String, Value> {
        value.as_object().unwrap().clone()
    }

    #[test]
    fn only_bundled_pages_are_bundled() {
        let bundled = if cfg!(windows) {
            [
                "http://tauri.localhost/",
                "http://tauri.localhost/index.html",
            ]
        } else {
            ["tauri://localhost", "tauri://localhost/index.html"]
        };
        for url in bundled {
            assert!(is_bundled_page(&Url::parse(url).unwrap()), "{url}");
        }
        let other_system = if cfg!(windows) {
            "tauri://localhost/index.html"
        } else {
            "http://tauri.localhost/index.html"
        };
        for url in [
            other_system,
            "https://example.com/",
            "http://localhost/",
            "http://localhost:1420/",
            "https://tauri.localhost.example.com/",
            "tauri://example.com/index.html",
            "tauri://localhost.example.com/",
            "tauri://user@localhost/",
            "tauri://localhost:8080/",
            "file:///index.html",
            "about:blank",
            "data:text/html,<p>hi</p>",
            "javascript:void(0)",
            "blob:tauri://localhost/1",
        ] {
            assert!(!is_bundled_page(&Url::parse(url).unwrap()), "{url}");
        }
    }

    #[cfg(debug_assertions)]
    #[test]
    fn a_development_build_also_serves_its_loopback_dev_server() {
        let dev = Url::parse("http://127.0.0.1:1430/").unwrap();
        let page = |url: &str| is_app_page(Some(&dev), &Url::parse(url).unwrap());
        assert!(page("http://127.0.0.1:1430/index.html"));
        for url in [
            "http://127.0.0.1:1431/index.html",
            "http://127.0.0.1/index.html",
            "https://127.0.0.1:1430/index.html",
            "http://localhost:1430/index.html",
            "http://user@127.0.0.1:1430/index.html",
            "http://127.0.0.1.example.com:1430/",
            "https://example.com/",
        ] {
            assert!(!page(url), "{url}");
        }
        // Only a loopback address counts, and no address means bundled pages only.
        let lan = Url::parse("http://192.0.2.10:1430/").unwrap();
        let lan_page = Url::parse("http://192.0.2.10:1430/index.html").unwrap();
        assert!(!is_app_page(Some(&lan), &lan_page));
        let secure = Url::parse("https://127.0.0.1:1430/").unwrap();
        assert!(!is_app_page(
            Some(&secure),
            &Url::parse("https://127.0.0.1:1430/").unwrap()
        ));
        assert!(!is_app_page(
            None,
            &Url::parse("http://127.0.0.1:1430/index.html").unwrap()
        ));
    }

    #[test]
    fn the_initialization_script_sets_both_flags_as_valid_script() {
        let script = initialization_script("0.1.0");
        assert!(script.contains("'__OPEN_SESAME_NATIVE__',{value:true}"));
        assert!(script.contains("'__OPEN_SESAME_VERSION__',{value:\"0.1.0\"}"));
        // A version is quoted as a JSON string, so it cannot end the script early.
        let odd = initialization_script("1.0\"});alert(1);//");
        assert!(odd.contains(r#"{value:"1.0\"});alert(1);//"}"#));
    }

    #[test]
    fn a_selftest_request_must_be_a_json_object() {
        assert_eq!(selftest_flag("not json"), None);
        assert_eq!(selftest_flag("\"});alert(1);//\""), None);
        assert_eq!(selftest_flag("[1]"), None);
        let script = selftest_flag(r#"{"out":"/tmp/x y.json"}"#).unwrap();
        assert!(script.contains(r#"{value:Object.freeze({"out":"/tmp/x y.json"})}"#));
    }

    #[test]
    fn a_requested_size_is_kept_within_bounds() {
        let size = |value| requested_size(&params(value));
        assert_eq!(
            size(json!({"width": 1200, "height": 700.5})),
            Ok((1200.0, 700.5))
        );
        assert_eq!(size(json!({"width": 280, "height": 35})), Ok(MINIMUM_SIZE));
        assert_eq!(
            size(json!({"width": 1e9, "height": 1e9})),
            Ok((MAXIMUM_SIDE, MAXIMUM_SIDE))
        );
        for bad in [
            json!({}),
            json!({"width": 900}),
            json!({"height": 600}),
            json!({"width": "900", "height": 600}),
            json!({"width": 0, "height": 600}),
            json!({"width": -900, "height": 600}),
            json!({"width": null, "height": 600}),
        ] {
            assert_eq!(
                size(bad.clone()),
                Err(BridgeError::from(INVALID_DIMENSIONS)),
                "{bad}"
            );
        }
    }

    #[test]
    fn the_window_methods_are_all_ported() {
        for method in METHODS {
            assert!(open_sesame_core::gate::PORTED.contains(method), "{method}");
        }
    }
}
