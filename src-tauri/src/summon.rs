//! Summon: the ways to make the window appear from anywhere (issue #71).
//!
//! The tests below are written first. They name what this module must provide: the `--toggle`
//! argument, the kind of desktop session, shortcut validation, the settings file, a reported
//! registration failure, the Wayland message, the hide-on-blur rule and the tray popover's
//! position. Nothing is implemented yet, so the crate's tests do not build.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_toggle_argument_toggles() {
        assert_eq!(launch(&["open-sesame"]), Launch::Show);
        assert_eq!(launch(&["open-sesame", "--toggle"]), Launch::Toggle);
        assert_eq!(launch(&["open-sesame", "--other", "--toggle"]), Launch::Toggle);
        // The program's own name is not an argument, whatever it is called.
        assert_eq!(launch(&["--toggle"]), Launch::Show);
        assert_eq!(launch(&["open-sesame", "--toggle=1"]), Launch::Show);
        assert_eq!(launch(&["open-sesame", "toggle"]), Launch::Show);
        assert_eq!(launch::<&str>(&[]), Launch::Show);
    }

    #[test]
    fn the_session_decides_whether_a_key_can_be_grabbed() {
        assert_eq!(session_from("macos", None, None, None), Session::MacOs);
        assert_eq!(session_from("windows", None, None, None), Session::Windows);
        assert_eq!(session_from("linux", Some("x11"), None, None), Session::X11);
        assert_eq!(session_from("linux", None, None, None), Session::X11);
        assert_eq!(session_from("linux", Some("wayland"), None, None), Session::Wayland);
        assert_eq!(session_from("linux", Some("Wayland"), None, None), Session::Wayland);
        assert_eq!(session_from("linux", None, Some("wayland-0"), None), Session::Wayland);
        assert_eq!(session_from("linux", Some("tty"), Some(""), None), Session::X11);
        // The toolkit was told to use X11, so the window is an X11 window.
        assert_eq!(
            session_from("linux", Some("wayland"), Some("wayland-0"), Some("x11")),
            Session::X11
        );
        // A Wayland variable on another system means nothing.
        assert_eq!(session_from("macos", Some("wayland"), Some("wayland-0"), None), Session::MacOs);
        assert!(Session::X11.has_global_shortcuts());
        assert!(Session::MacOs.has_global_shortcuts());
        assert!(Session::Windows.has_global_shortcuts());
        assert!(!Session::Wayland.has_global_shortcuts());
    }

    #[test]
    fn a_shortcut_needs_a_modifier_and_a_key() {
        for good in [DEFAULT_SHORTCUT, "Control+Alt+K", "super+shift+o", " Alt+F1 ", "CmdOrCtrl+Shift+Space"] {
            assert!(parse_shortcut(good).is_ok(), "{good}");
        }
        for bad in ["", "Space", "K", "F5", "Alt", "Alt+Shift", "Alt+Nothing", "Alt++K", "Alt+K+L"] {
            assert_eq!(parse_shortcut(bad).unwrap_err().0, INVALID_SHORTCUT, "{bad}");
        }
    }

    #[test]
    fn the_default_is_not_a_shortcut_other_launchers_take() {
        let default = parse_shortcut(DEFAULT_SHORTCUT).unwrap();
        for taken in ["Alt+Space", "Control+Alt+Space", "Control+Shift+Space", "Super+Space", "Control+Space"] {
            assert_ne!(default, parse_shortcut(taken).unwrap(), "{taken}");
        }
    }

    #[test]
    fn settings_survive_a_round_trip_and_a_damaged_file() {
        let folder = std::env::temp_dir().join(format!("open-sesame-summon-{}", std::process::id()));
        let path = folder.join("nested").join(SETTINGS_FILE);
        assert_eq!(Settings::load(&path), Settings::default());
        let saved = Settings {
            shortcut: "Control+Alt+K".to_string(),
            hide_on_blur: true,
        };
        saved.save(&path).unwrap();
        assert_eq!(Settings::load(&path), saved);
        assert!(!path.with_extension("json.tmp").exists());
        // None is a choice and is kept.
        let none = Settings {
            shortcut: String::new(),
            hide_on_blur: false,
        };
        none.save(&path).unwrap();
        assert_eq!(Settings::load(&path), none);
        // A file that is not the expected shape, or holds a shortcut that cannot be one, gives
        // the defaults for what it got wrong and keeps the rest.
        for damaged in ["", "not json", "[]", r#"{"shortcut": 7}"#, r#"{"shortcut": "Space"}"#] {
            std::fs::write(&path, damaged).unwrap();
            assert_eq!(Settings::load(&path), Settings::default(), "{damaged}");
        }
        std::fs::write(&path, r#"{"shortcut": "Space", "hideOnBlur": true}"#).unwrap();
        assert_eq!(
            Settings::load(&path),
            Settings {
                shortcut: DEFAULT_SHORTCUT.to_string(),
                hide_on_blur: true
            }
        );
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn a_refused_shortcut_is_reported_and_remembered() {
        let summon = Summon::new(Session::X11, None);
        assert!(summon.register_with(DEFAULT_SHORTCUT, |_| true).is_ok());
        assert_eq!(summon.status()["registered"], json!(true));
        assert_eq!(summon.status()["message"], json!(""));

        let error = summon.register_with("Alt+Space", |_| false).unwrap_err();
        assert_eq!(
            error.0,
            "Open Sesame could not register Alt+Space. Another application may already use it. Choose a different shortcut."
        );
        assert_eq!(summon.status()["registered"], json!(false));
        assert_eq!(summon.status()["message"], json!(error.0));

        // None registers nothing and is not a failure.
        let mut asked = false;
        assert!(summon.register_with("", |_| { asked = true; true }).is_ok());
        assert!(!asked);
        assert_eq!(summon.status()["registered"], json!(false));
        assert_eq!(summon.status()["message"], json!(""));
    }

    #[test]
    fn wayland_never_tries_to_grab_a_key_and_names_the_command() {
        let summon = Summon::new(Session::Wayland, None);
        let mut asked = false;
        assert!(summon.register_with(DEFAULT_SHORTCUT, |_| { asked = true; true }).is_ok());
        assert!(!asked, "nothing is registered on Wayland");
        let status = summon.status();
        assert_eq!(status["session"], json!("wayland"));
        assert_eq!(status["registered"], json!(false));
        assert_eq!(status["message"], json!(WAYLAND));
        assert!(WAYLAND.ends_with(TOGGLE_COMMAND));
        assert_eq!(status["toggleCommand"], json!("open-sesame --toggle"));
    }

    #[test]
    fn blur_hides_only_when_asked_and_nothing_holds_the_window() {
        assert!(hides_on_blur(true, 0, false, false));
        assert!(!hides_on_blur(false, 0, false, false), "off unless turned on");
        assert!(!hides_on_blur(true, 1, false, false), "a dialog or sign-in is open");
        assert!(!hides_on_blur(true, 0, true, false), "a drag is in progress");
        assert!(!hides_on_blur(true, 0, false, true), "the window is pinned");

        let summon = Summon::new(Session::MacOs, None);
        assert!(!summon.should_hide_on_blur());
        lock(&summon.settings).hide_on_blur = true;
        assert!(summon.should_hide_on_blur());
        {
            let _dialog = summon.hold();
            let _sign_in = summon.hold();
            assert!(!summon.should_hide_on_blur());
        }
        assert!(summon.should_hide_on_blur(), "the holds were released");
        summon.set_pinned(true);
        assert!(!summon.should_hide_on_blur());
        summon.set_pinned(false);
        summon.held_by_page.store(true, Ordering::SeqCst);
        assert!(!summon.should_hide_on_blur());
    }

    #[test]
    fn the_popover_sits_against_the_tray_icon_and_stays_on_screen() {
        let area = ((0.0, 0.0), (1920.0, 1040.0));
        let size = (1090.0, 613.0);
        // Taskbar at the bottom: above the icon, centred on it, pulled in from the right edge.
        assert_eq!(popover_position(((1800.0, 1050.0), (24.0, 24.0)), size, area), (830.0, 427.0));
        assert_eq!(popover_position(((900.0, 1050.0), (24.0, 24.0)), size, area), (367.0, 427.0));
        // Menu bar at the top: below the icon.
        assert_eq!(popover_position(((1000.0, 0.0), (24.0, 24.0)), size, area), (467.0, 32.0));
        // A second screen to the left of the first.
        let left = ((-1920.0, 0.0), (1920.0, 1040.0));
        assert_eq!(popover_position(((-1900.0, 1050.0), (24.0, 24.0)), size, left), (-1920.0, 427.0));
        // A window larger than the area starts at the area's corner.
        assert_eq!(popover_position(((10.0, 10.0), (24.0, 24.0)), (4000.0, 3000.0), area), (0.0, 0.0));
    }
}
