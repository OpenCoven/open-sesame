# Desktop smoke pass

This is the checklist for [issue #78][78]: the Tauri application of the desktop restart ([epic #58][58], [shell instructions](../src-tauri/AGENTS.md)) built, run and observed on real macOS, Windows and Linux machines before any optional widget is ported. It has one column per environment, with Linux X11 and Linux Wayland as separate columns. Lines moved here from other issues by owner decision link back to their source in the "From" column.

A result cell is filled only by a person or agent who observed that line in that environment at the tested commit. Compilation, hosted CI, test suites, browser or native-renderer fixtures, and a container with a virtual display answer other questions and never fill a cell. An empty cell means nobody has observed that line there yet. Every failure, and every layout or behaviour difference seen on WebView2 or WebKitGTK, gets an issue labelled `desktop-restart` with the matching `os:` label, linked from its cell and listed under [Failures and differences](#failures-and-differences). One line, A4, is defined by owner decision as a renderer probe run on a real Windows machine; its cell records that run on the device and says so.

## Tested commit

**`7dc2c31860735240da2c07cd77eaa7fec43112e8`**, `main` after [#120][120] ([#76][76], the views) merged on 16 November 2026, with [#119][119] ([#105][105], storage and the login-shell environment) and [#118][118] ([#94][94]) before it.

This is a partial run: only the macOS lines an agent can reach without a person, a real account or a tray click. The full pass runs at one later commit, once [#77][77] is closed; [#71][71] and [#72][72] closed on 16 November 2026, and their code is in the tested commit. To start it, move the [Environments](#environments) table and the checklist with its results to [Earlier runs](#earlier-runs), write the new commit here, and start again from empty cells, including macOS. A table never mixes results from two commits. A row that is pending on another issue at that commit stays pending there and runs in a later pass once that issue's change is on `main`.

### Environments

| | macOS | Windows | Linux X11 | Linux Wayland |
| --- | --- | --- | --- | --- |
| Operating system and build | macOS 27.2.1 (26B131), arm64 | | | |
| Desktop and session | Aqua; see each note for how the app was started | | | |
| Machine and GPU | Apple M5 Max, its integrated GPU | | | |
| Web engine | WKWebView, WebKit 22625.2.8.11.9 | | | |
| Binary and its SHA-256 | `target/debug/open-sesame`, development build, `176f3c8b9e5217ab814899653d49e169528c43a169ed7f3eec074890a1d56b41` | | | |
| Observed by and when | Agent session `claude-code:8bb702d6`, 16 November 2026 | | | |
| Evidence class | Launched app on one OS, driven by `--toggle`, accessibility actions, keyboard events posted to the app's own process, shortcut presses posted as synthetic system-level key events, and the development self-test; each note says which | | | |

## How to read a cell

- `pass` with a note: observed as the note describes. Notes for macOS are under [macOS observations](#macos-observations).
- `fail` with an issue link: observed failing; the issue holds the evidence.
- `pending #N`: the feature is not on the tested commit; the line runs once #N has merged.
- `n/a`: the line does not apply to that environment, for the reason given beside it.
- Empty: not observed yet. The [owner instructions](#owner-instructions) say how to fill it.

## Checklist

### Build and window

| ID | Check | From | macOS | Windows | Linux X11 | Linux Wayland |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | Build the development app from the tested commit: `npm run dev:app` (`cargo tauri dev --no-dev-server` in `src-tauri`) finishes compiling and starts the app | [#78][78] | pass, [M1](#m1-build-and-terminal-launch) | | | |
| A2 | Launch: the window opens and its status says it is connected ("Connected · Local workspace" when signed out), with one Open Sesame process and one `open-sesame: page loaded` line in the terminal | [#78][78]; Windows moved from [#70][70] | pass, [M1](#m1-build-and-terminal-launch), [M2](#m2-launch-from-the-desktop) | | | |
| A3 | Hide the window with its close button and show it again (Dock icon on macOS, tray menu elsewhere), four times: the `page loaded` count stays at one | Windows moved from [#70][70] | pass: [M7](#m7-close-and-reopen-and-the-agents-view) | | | |
| B1 | Tray menu Show or Hide, clicked by a person, hides and then shows the window | macOS moved from [#70][70] | | | | |
| B2 | Tray menu Quit, clicked by a person, leaves no Open Sesame process | macOS moved from [#70][70] | | | | |
| A4 | WebView2 startup trace: `scripts/fixtures/ui-shell-webview2.ps1` on the Windows machine exits 0 and its report says `"passed": true`, so a widget that is off loaded no script and no stylesheet at startup. A renderer probe with a synthetic bridge, not the launched app | moved from [#76][76] | n/a: Windows only; [#76][76] traced WKWebView | | n/a: Windows only; [#76][76] traced WebKitGTK | n/a: Windows only |

### Summon

| ID | Check | From | macOS | Windows | Linux X11 | Linux Wayland |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | `open-sesame --toggle`, run again from a terminal, hides and then shows the window three times; a plain second launch shows it; each second process exits at once, and one app process and one page load remain throughout | [#78][78]; [#71][71] | pass, [M3](#m3-summon-by---toggle) | | | |
| C2 | Press the shortcut (Control+Option+Shift+Space on a Mac, Control+Alt+Shift+Space elsewhere) twice: the window hides and shows, the page does not load again, and typing goes into the window after it shows | [#78][78]; hand check from [#71][71] | fail: hides and shows with one page load, but the keys typed next did not reach the page: [M9](#m9-the-shortcut-pressed-as-synthetic-key-events), [#142][142] | | | n/a: Wayland lets no application grab a key; see C4 |
| C3 | Put another app in full screen and press the shortcut: the window appears over it, the other app stays frontmost, and typing goes into the window | hand check from [#71][71] | fail: appears over a full-screen app, which stays frontmost, but the keys typed next did not reach the page: [M9](#m9-the-shortcut-pressed-as-synthetic-key-events), [#142][142] | n/a: macOS only | n/a: macOS only | n/a: macOS only |
| C4 | Bind a shortcut to `open-sesame --toggle` in the desktop's keyboard settings: it shows and hides the window, and the Shortcut section names that command | [#71][71] | n/a: Wayland only | n/a: Wayland only | n/a: Wayland only | |
| C5 | Save another shortcut in the Shortcut section: the new keys work at once and the old ones no longer do | hand check from [#71][71] | pass: [M9](#m9-the-shortcut-pressed-as-synthetic-key-events) | | | n/a: see C4 |
| C6 | Save a shortcut that another application already holds: the section says Open Sesame could not register it, and the previous shortcut still works | hand check from [#71][71] | n/a: macOS accepts a held shortcut and reports nothing; owner question on [#71][71] | | | n/a: see C4 |
| C7 | A left click on the tray icon places the window against the icon; with "Hide the window when it loses focus" on, a tray click hides a shown window and a click inside the page does not | hand check from [#71][71] | n/a: Windows only | | n/a: Windows only | n/a: Windows only |
| C8 | With the window open but behind another window (on a Mac also when it was left on another Space), one press of the shortcut, one `open-sesame --toggle`, the tray menu item and, on Windows, a tray click each bring it in front with the keyboard in it; with it in front, one press hides it; both with "Hide the window when it loses focus" on and off. Write in the cell what counted as in front on that system | moved from [#115][115] by [owner decision][115-decision] | pending [#115][115] | pending [#115][115] | pending [#115][115] | pending [#115][115] |
| C9 | With "Hide the window when it loses focus" on, the page's context menu, a select list and an input-method window each leave the window shown | moved from [#115][115] | pending [#115][115] | pending [#115][115] | pending [#115][115] | pending [#115][115] |

### Shells

| ID | Check | From | macOS | Windows | Linux X11 | Linux Wayland |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | New shell, then echo a marker (`echo os78-$((6*7))`; PowerShell `echo "os78-$(6*7)"`): `os78-42` arrives intact | [#78][78]; Windows moved from [#74][74] | pass: [M6](#m6-a-shell-typed-into-in-an-app-started-from-the-desktop); also by the self-test, [M4](#m4-shells-driven-by-the-development-self-test) | | | |
| D2 | Resize the window: the shell's size follows (`stty size`; PowerShell `$Host.UI.RawUI.WindowSize`) | [#78][78] | pass: [M6](#m6-a-shell-typed-into-in-an-app-started-from-the-desktop) | | | |
| D3 | Tab completion completes a path or command | [#78][78] | pass: [M6](#m6-a-shell-typed-into-in-an-app-started-from-the-desktop) | | | |
| D4 | Control+C stops a running program (`sleep 600`; Windows `ping -t 127.0.0.1`), the program is gone, and the prompt returns | [#78][78]; Windows moved from [#74][74] | pass: [M6](#m6-a-shell-typed-into-in-an-app-started-from-the-desktop) | | | |
| D5 | Print about 50 MB: the window does not freeze and no output is lost | Windows and a real Linux desktop moved from [#74][74] | pass by the self-test: [M4](#m4-shells-driven-by-the-development-self-test), and again in [M10](#m10-floods-frame-gaps-and-a-hidden-window) | | | |
| D6 | Close a pane over a long-running child: neither the shell nor the child remains three seconds later | Windows moved from [#74][74] | pass by the self-test: [M4](#m4-shells-driven-by-the-development-self-test) | | | |
| D7 | Quit with three panes open: no shell or SSH process remains | Windows moved from [#74][74] | pass: [M5](#m5-quit-with-shells-open) | | | |
| D8 | A project folder named `open sesame ünï` opens as the shell's working folder | Windows moved from [#74][74] | pass by the self-test: [M4](#m4-shells-driven-by-the-development-self-test) | | | |
| D9 | SSH pane: with SSH host and User filled in, New shell connects and runs a command; closing it leaves no `ssh` process | [#78][78] | | | | |
| D10 | A CLI installed only on the login-shell `PATH` is found when the built app is started from the desktop | moved from [#73][73] | pass: [M6](#m6-a-shell-typed-into-in-an-app-started-from-the-desktop) | n/a: the core reads no login shell on Windows (`Fallback::NotNeeded` in [env.rs](../crates/core/src/process/env.rs)) | | |
| D11 | Record the development self-test's flood step with the window on screen and not covered: its `longestFrameGapMs`, `longestTimerGapMs` and `frames`. The number from a real Linux desktop with WebKitGTK sets the frame-gap limit that [#112][112] asks for | moved from [#112][112], items 4 and 6, by [owner decision][112-decision] | recorded: at most 20 ms between frames and 15 ms between timers, 611 frames in 9.6 seconds, with the window on screen but half to two thirds under other windows: [M10](#m10-floods-frame-gaps-and-a-hidden-window) | n/a: the self-test drives a Unix shell (`stty`, `awk` and a here-document) | | |
| D12 | Run a flood once with the window shown and note the time it prints (macOS and Linux `s=$(date +%s); awk 'BEGIN { for (i = 1; i <= 7000000; i++) print i }'; echo "flood took $(( $(date +%s) - s )) s"`; PowerShell `$s = 'x' * 70; $t = Get-Date; 1..700000 \| ForEach-Object { "$_ $s" }; "flood took $([int]((Get-Date) - $t).TotalSeconds) s"`). Run it again, hide the window at once for twice that time and at least a minute, then show it: the last line before the time is the last number, the window responds at once, and the second time says whether the flood ran on while the window was hidden (about the first time) or waited for it (about the time hidden). Write both times in the cell | moved from [#112][112], item 8 | pass: 9 seconds shown and 11 seconds hidden, so it ran on while the window was hidden: [M10](#m10-floods-frame-gaps-and-a-hidden-window) | | | |
| D13 | Paste about 5,000 characters into a shell with the paste keys (Command+V on a Mac, Control+Shift+V elsewhere): all of them arrive | Windows moved from [#112][112], item 7 | | | | |
| D14 | On a Windows build before 26100 (Windows 10, or Windows 11 before 24H2): close a pane over `ping -t 127.0.0.1`, and close a pane the moment New shell has opened it; each close returns within about five seconds and the other panes keep taking typing meanwhile. Write the build number in the cell | moved from [#112][112], item 7 | n/a: Windows only | | n/a: Windows only | n/a: Windows only |

At the tested commit the application reads the login-shell environment at startup ([#105][105]), but no feature looks a tool up with it yet; only a development probe (`OPEN_SESAME_RUNTIME_PROBE_DIR`) does. D10 is therefore observed through a shell pane, which is a login shell on macOS and Linux.

D14 is [#112][112]'s question from reading: Microsoft documents that `ClosePseudoConsole` waits for the pseudo-console to exit on builds before 26100, and the hosted runner is 26100, so only such a machine shows whether a close can hold the pane list up. On build 26100 or later write `n/a` and the build number.

### Programs the app runs

| ID | Check | From | macOS | Windows | Linux X11 | Linux Wayland |
| --- | --- | --- | --- | --- | --- | --- |
| P1 | A command the app runs through the core runner that opens the browser with `xdg-open` leaves the browser open after the command returns, once with a browser already running and once with none | moved from [#97][97], decision 4, by [owner decision][97-decision] | n/a: Linux only | n/a: Linux only | pending [#83][83], [#84][84] | pending [#83][83], [#84][84] |

At the tested commit nothing in the app runs a program through the core runner except the login-shell capture at startup, so P1 waits for the first feature that opens a browser that way; [#83][83] and [#84][84] decide whether they need an exception to the rule that a finished program's helpers are killed.

### Sign-in with a real account

These rows are [#72][72]'s [owner checklist][72-checklist] and stay empty until a person signs in with a real account. #72 closed on 16 November 2026 and its code is in the tested commit, so they can run now. A macOS development build cannot receive the callback, and a bundle must not be built or launched on a Mac where the installed Swift app owns the `opensesame` scheme until [#87][87] settles the identifier, so the macOS column needs a Mac or user account without the Swift app.

| ID | Check | From | macOS | Windows | Linux X11 | Linux Wayland |
| --- | --- | --- | --- | --- | --- | --- |
| E1 | Sign in, allow the browser to open Open Sesame: the Account section says "Signed in as" with the account's email; on Windows and Linux one Open Sesame process and one window remain after the callback | [#78][78]; [#72][72] steps 1 to 3 | | | | |
| E2 | The credential is in the system store, as one entry | [#72][72] step 4 | | | | |
| E3 | Quit from the tray and start again: "Signed in as" within a few seconds, and the browser does not open | [#78][78] relaunch; [#72][72] step 5 | | | | |
| E4 | Ten minutes later it still says "Signed in as" | [#72][72] step 6 | | | | |
| E5 | Network off until the access token expires (about five minutes): Account returns to "Not signed in" with a sentence and the rest of the window keeps working; network on: "Signed in as" again within about half a minute, without the browser | [#72][72] step 7 | | | | |
| E6 | Sign out: "Signed out on this computer.", the browser opens once and returns, and the entry from E2 is gone | [#72][72] step 8 | | | | |
| E7 | Quit and start again: still "Not signed in", and the browser does not open | [#72][72] step 9 | | | | |
| E8 | On a session with no Secret Service, Sign in is refused before the browser opens and names GNOME Keyring and KWallet | [#72][72] step 10 (optional) | n/a: Linux only | n/a: Linux only | | |

### Sign-in links

These are [#116][116]'s hand checks for sign-in links, [added to this list on #78][116-checks]. The change is pull request [#129][129], a draft at the tested commit, so every row waits for it. Only L6, L7 and L8 need a real account; the others need the application and the link shown.

| ID | Check | From | macOS | Windows | Linux X11 | Linux Wayland |
| --- | --- | --- | --- | --- | --- | --- |
| L1 | Development build: a page cannot hear a link. In the main window's developer tools run `window.__TAURI__.event.listen('deep-link://new-url', e => console.log(e))`, then deliver `opensesame://auth/callback?code=x&state=y` (a second launch with it as the only argument on Windows and Linux, `open` on a macOS bundle): nothing is logged | [#116][116], [added on #78][116-checks] | pending [#116][116] | pending [#116][116] | pending [#116][116] | pending [#116][116] |
| L2 | A callback reaches the running application and leaves no second one: with the app running, start `open-sesame.exe "opensesame://auth/callback?code=x&state=y"`, then open the same address from a browser or `start` in `cmd`; each time one Open Sesame process remains and the window comes forward | [#116][116], [added on #78][116-checks] | n/a: Windows only | pending [#116][116] | n/a: Windows only; see L5 | n/a: Windows only; see L5 |
| L3 | A link with nothing running opens nothing: with the app quit, open the callback address from a browser; no window appears and no process remains | [#116][116], [added on #78][116-checks] | n/a: Windows and Linux only | pending [#116][116] | pending [#116][116] | pending [#116][116] |
| L4 | A real desktop session with no D-Bus session bus (a bare X session without `dbus-launch`, or `env -u DBUS_SESSION_BUS_ADDRESS` in a terminal): start the app, then start it again with the callback address as its only argument; the second process exits by itself and one window remains | [#116][116], [added on #78][116-checks] | n/a: Linux only | n/a: Linux only | pending [#116][116] | pending [#116][116] |
| L5 | On a real GNOME or KDE desktop, L2's check with `gio open` and with a browser | [#116][116], [added on #78][116-checks] | n/a: Linux only | n/a: Linux only; see L2 | pending [#116][116] | pending [#116][116] |
| L6 | Installed bundle, after [#87][87] settles the identifier: with a sign-in waiting in the browser, finish it there; the app comes forward signed in (the `RunEvent::Opened` path, which no macOS development build receives). Needs a real account | [#116][116], [added on #78][116-checks] | pending [#116][116], [#87][87] | n/a: macOS only | n/a: macOS only | n/a: macOS only |
| L7 | With a sign-in waiting in the browser, deliver the callback address as in L1: the control still says "Finish signing in in your browser." and nothing changes; finishing in the browser then signs in, which needs a real account | [#116][116], [added on #78][116-checks] | pending [#116][116] | pending [#116][116] | pending [#116][116] | pending [#116][116] |
| L8 | After a real sign-in, record the persistence that Credential Manager (Windows Credentials) shows for the Open Sesame entry; the owner chose Local computer in [#131][131], so once its change merges it should say that | [#116][116], [added on #78][116-checks]; [#131][131] | n/a: Windows only | pending [#131][131] | n/a: Windows only | n/a: Windows only |
| L9 | After one development run, record what is left registered (Windows: `reg query HKCU\Software\Classes\opensesame`; Linux: `~/.local/share/applications/open-sesame-handler.desktop` and its line in `~/.config/mimeapps.list`), and that with no build running the callback address starts the development binary, which exits without a window; the owner chose in [#132][132] that a clean exit removes it, so once that change merges a clean exit leaves nothing and only a killed build leaves the registration, which [#72's checklist][72-checklist] removes by hand | [#116][116], [added on #78][116-checks]; [#132][132] | n/a: Windows and Linux only | pending [#116][116], [#132][132] | pending [#116][116], [#132][132] | pending [#116][116], [#132][132] |

### Views and data

| ID | Check | From | macOS | Windows | Linux X11 | Linux Wayland |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | Capture a note and a task from the palette (Control+K, Command+K on a Mac): both appear in Today and Projects | [#78][78]; [#77][77] | pending [#77][77] | pending [#77][77] | pending [#77][77] | pending [#77][77] |
| F2 | A focus session survives hide, show and relaunch with the correct remaining time | [#78][78]; [#77][77] | pending [#77][77] | pending [#77][77] | pending [#77][77] | pending [#77][77] |
| F3 | Notes, tasks, bookmarks, projects and saved feed items survive quitting and relaunching | moved from [#75][75] | pending [#77][77] | pending [#77][77] | pending [#77][77] | pending [#77][77] |
| F4 | Open a view whose widget is not ported yet, such as Agents: it says "This widget is not available in this version." | [#78][78]; [#76][76] | pass: [M7](#m7-close-and-reopen-and-the-agents-view) | | | |
| F5 | A shortcut saved in the Shortcut section is still there after Quit and a relaunch (a development build keeps it in the folder named by `OPEN_SESAME_DEV_CONFIG_DIR`) | [#78][78] relaunch; [#71][71] | pass: [M8](#m8-a-saved-shortcut-after-quit-and-relaunch) | | | n/a: see C4 |

At the tested commit the storage is wired into the application ([#105][105]), but no view saves a note, task or focus session until [#77][77], so F1 to F3 wait for #77 on every system. F4 and F5 run now.

### Quit

| ID | Check | From | macOS | Windows | Linux X11 | Linux Wayland |
| --- | --- | --- | --- | --- | --- | --- |
| G1 | Quit with a shell open (application menu on macOS, tray menu elsewhere): no Open Sesame, shell or child process remains | [#78][78]; Windows moved from [#70][70] | pass: [M1](#m1-build-and-terminal-launch) by the menu item, [M5](#m5-quit-with-shells-open) and [M6](#m6-a-shell-typed-into-in-an-app-started-from-the-desktop) with shells open | | | |

## Failures and differences

Filed at this commit, all on macOS:

- [#142][142]: after the shortcut shows the window, the keys typed next do not reach the page; the window itself has the keyboard focus. C2 and C3 fail on it.
- [#141][141]: the development terminal self-test never starts in an app started from the desktop. It is a development aid, so no line fails on it.
- [#140][140]: `cargo test` failed once with "could not start the shell" on a busy Mac. That is a headless test, not a line here; draft pull request [#117][117] proposes a retry.

## macOS observations

Every note is for commit `7dc2c31` on macOS 27.2.1 (26B131), arm64, binary `target/debug/open-sesame` with SHA-256 `176f3c8b9e5217ab814899653d49e169528c43a169ed7f3eec074890a1d56b41`, unless it says otherwise. The settings folder was a new disposable folder each time, named by `OPEN_SESAME_DEV_CONFIG_DIR`. Before each launch the run checked that no other Open Sesame build was running and that the single-instance socket was absent, because every development build shares one identifier. The receipts, with the application logs and window images, are in the common Git directory under `open-sesame/receipts/desktop-78-g2-8bb702d6/macos-7dc2c31/`.

### M1 Build and terminal launch

`npm run dev:app -- --no-watch` in a clean detached checkout of the tested commit compiled the application (`Finished dev profile … in 1m 35s`, with a load average of 67 from other sessions' work) and started it. One process; one window, "Open Sesame", 1090 by 645 points, on screen; one `page loaded tauri://localhost` line; the page showed "Connected · Local workspace", "Not signed in", the Shortcut section with `Control+Alt+Shift+Space` registered, and the Today view. Quit from the application menu (an accessibility action): the process was gone 0.05 seconds later, and neither an Open Sesame process nor the single-instance socket remained.

### M2 Launch from the desktop

The same binary was started through LaunchServices with an empty caller environment, as Finder starts an app: a minimal app bundle whose script sets `OPEN_SESAME_DEV_CONFIG_DIR` and replaces itself with the binary, opened with `env -i /usr/bin/open -n`. The app's parent was `launchd`, its `PATH` was `/usr/bin:/bin:/usr/sbin:/sbin`, `SHELL` was `/bin/zsh`, and it had 14 environment variables. One Open Sesame process, the window on screen, one page load, and the same page as in M1.

### M3 Summon by `--toggle`

With the app from M2 running, `open-sesame --toggle` was run six times from a terminal: the window went off screen, on, off, on, off and on, as the window list showed after each. Each second process exited with status 0 at once. Throughout, the only Open Sesame process was the first one and the page had loaded once. With the window hidden, a plain second launch (no argument) showed it; with the window shown, another plain launch left it shown; both exited with status 0. Afterwards the window had the keyboard focus. This was at 04:09 to 04:11 UTC, before another session's build briefly ran beside it (from 04:26).

### M4 Shells driven by the development self-test

From a terminal, the binary was started with a new disposable settings folder and `OPEN_SESAME_SELFTEST` set, which makes a development build run the terminal self-test of [#74][74] (`ui/dev/selftest.js`). It opened the Shells view by itself and drove real shells through the product's own pane launcher, sending text as the keyboard would but without keystrokes. Its report: the marker `open-sesame-marker` came back intact through a zsh pane in 1.7 seconds; a pane opened in a folder named `open sesame ünï` printed that folder as `$PWD`; characters whose bytes arrived in two messages were drawn whole (`S:é:€:🦊:E`); `awk` printed 7,000,000 numbered lines, 54,888,896 bytes, in 12.8 seconds, each line checked in order, while the page's timers never stopped for more than 18 ms (drawing paused for up to 2.1 seconds once; whether the window was covered at that moment is not known, but this run's log has the window hidden once by "Hide the window when it loses focus", which outside input had switched on, and M10 measured 20 ms with the window on screen); and closing a pane over `sleep 86400` left neither the shell nor the child 44 ms later, checked through a separate shell.

The same self-test in an app started from the desktop never started, in three launches, two of them with the window on screen throughout: the page was ready on the Today view and no shell was opened. The same bundle script run from a terminal passed. This is [#141][141]; no line is counted from or against it.

### M5 Quit with shells open

With the four shells of M4 open (three running `sleep 86400`, and the self-test's report shell), Command-Q, the key equivalent of the application menu's "Quit open-sesame" item, was delivered to the app's own process (a keyboard event posted to that process only, because another app held the front). The app, the four shells and the three children were gone 0.28 seconds later, and neither an Open Sesame process nor the single-instance socket remained.

### M6 A shell typed into, in an app started from the desktop

The app was started from the desktop as in M2, with a new disposable settings folder. The Shells view and New shell were pressed through the accessibility API, addressed to the app's process. Text was typed as keyboard events posted to that process only, into the terminal's input, which the accessibility API had focused; a plain second launch first gave the window the keyboard. Each command also wrote its output to a file through `tee`, read afterwards outside the app.

- D1: `echo os78-$((6*7))` gave `os78-42`.
- D10: the app's own `PATH` was `/usr/bin:/bin:/usr/sbin:/sbin`. In its shell, `command -v gh` gave `/opt/homebrew/bin/gh`, a Homebrew CLI on the login shell's `PATH` only. The development probe (`OPEN_SESAME_RUNTIME_PROBE_DIR`) reported the application's own environment as read from the login shell (`"source": "LoginShell"`, `"captureReady": true`).
- D2: `stty size` gave `12 148`; after the window was resized from 1090 by 645 to 820 by 500 points it gave `3 111`.
- D3: `echo /usr/sha` followed by Tab completed to `/usr/share`, and the command printed `/usr/share`. The first try is not counted: a stray outside keystroke had put an `n` before `echo`. The counted try is in a later launch of the same build.
- D4: `sleep 600` ran as a child of the pane's shell; after Control+C that process was gone, the shell was still running, and `echo after-$((1+1))` then printed `after-2`.
- G1: Command-Q, posted to the app's process, with the shell open: the app, its WebKit helpers and the shell were gone 0.03 seconds later, and no Open Sesame process or single-instance socket remained.

### M7 Close and reopen, and the Agents view

In a relaunch from the desktop, the window's close button was pressed through the accessibility API, and then the app was sent the reopen event, which is what a click on its Dock icon sends; the app has a Dock icon (application type Foreground). Four times the window went off screen after the close and came back after the reopen, and the page had loaded once throughout. The Agents view, pressed in the same launch, said "This widget is not available in this version."

### M8 A saved shortcut after Quit and relaunch

In the Shortcut section, `Control+Alt+Shift+K` was typed into the field and Save pressed: the section said "Press Control+Alt+Shift+K anywhere to show or hide Open Sesame." and the settings folder's `summon.json` held that shortcut. After Command-Q and a relaunch from the desktop, the app logged `"shortcut":"Control+Alt+Shift+K"` with `"registered":true`, and the field showed it. The default was then saved back. An earlier try is not counted: a stray outside keystroke had put a `v` before the keys, and the section rejected it as "not a shortcut Open Sesame can use" without saving anything.

### M9 The shortcut, pressed as synthetic key events

The app was started from the desktop with a new disposable settings folder and a shell open, and the other application was a new Script Editor document. The shortcut was pressed as keyboard events posted at the HID level, the path a keyboard's events take to the system's global shortcuts; an earlier run used System Events key codes, with the same results for hiding, showing and the saved keys. No person pressed the keys.

- C2: with Script Editor in front, Control+Option+Shift+Space hid the window and a second press showed it, with one page load throughout. Afterwards the accessibility API reported the app's focused element as the window itself, not the shell's input that had the focus before, and Script Editor stayed frontmost. `echo os78-c2 | tee c2.txt` and Return, posted to the app's process only, did not reach the shell: no file appeared, and the prompt stayed empty in the window image. This is [#142][142].
- C5: after `Control+Alt+K` was saved, its first press hid the window and its second showed it; two presses of Control+Option+Shift+Space then left the window shown. The page did not load again. Seen in two runs.
- C3: with the Script Editor document in full screen, the shortcut showed the window in front of it. In the window list, the Open Sesame window came directly before Script Editor's two full-screen windows, and Script Editor stayed frontmost and in full screen. The focus and the typed text behaved as in C2. In one earlier try, text posted at the HID level did not reach the shell either.

Typing through the system's keyboard path was tried in two runs and then stopped: people were using the Mac, and keys that missed Open Sesame could have reached their applications. Text was therefore posted to Open Sesame's process only. That path reached the shell in M6 whenever the page had the focus.

### M10 Floods: frame gaps and a hidden window

From a terminal, with a new disposable settings folder, the development self-test ran again with 7,000,000 lines while a sampler read the system's window list every quarter second (bounds and layers only). The window stayed on screen throughout, with half to two thirds of it under other people's windows and never all of it. All six steps passed. In the flood step 54,888,896 bytes arrived in 9.6 seconds and were drawn in 611 frames, with at most 20 ms between frames and 15 ms between timers (D11).

Then the app was started again from a terminal with another new settings folder; Shells and New shell were pressed through the accessibility API, and commands were typed as keyboard events posted to the app's process. The D12 command for macOS, which also wrote its start and end times to a file, took 9 seconds with the window shown. It was typed again, and 0.7 seconds after Return the window's close button was pressed through the accessibility API, which hid it. The window stayed off screen for 61 seconds and was then shown by a plain second launch. The flood's file had appeared 10.8 seconds after the window was hidden, and it reported 11 seconds, so the flood ran on while the window was hidden. After the window was shown, the pane ended with `7000000` and `flood took 11 s`, one page load remained, and `echo back`, typed next, came back in the shell; the whole step, including the tool's own typing, took 2.7 seconds. Command-Q, posted to the app's process, left no process. People were using the Mac during this run as well. Receipts: `macos-7dc2c31/08-flood-frames/`.

### Outside input during the run

The Mac was in use by others throughout: keyboard and pointer input arrived within a second of most steps, the front app changed, and the window was moved to another Space. Each line above is counted only from a try whose result was checked after it ran. One outside input switched on "Hide the window when it loses focus" in a disposable settings folder during M4; that folder was not used again.

## Owner instructions

These are the numbered steps for each system, written for a person at the machine. Each part takes under 30 minutes once the prerequisites are installed and the first build has finished. Part A can run at any commit that has #71's code (it is on `main`); part B's sign-in steps can run at the tested commit, which has #72's code, and its view steps need #77 closed. For the full pass, run both parts at the one commit written under [Tested commit](#tested-commit) and fill every empty cell in your column with `pass` or `fail`, the date, and one line of what you saw; a failure also gets an issue. Report the system's version, desktop, GPU, web engine version and the binary's SHA-256 in the [Environments](#environments) table.

### Before the clock starts, on every system

1. Check out the tested commit: `git fetch origin` and `git checkout --detach <commit>`.
2. Install the prerequisites once: Rust 1.95.0 through rustup, the Tauri CLI (`cargo install tauri-cli --locked`), Node.js with npm, and Git. Windows also needs the Visual Studio Build Tools with "Desktop development with C++" and the WebView2 runtime, which Windows 11 includes. Linux needs the packages the hosted workflow installs (`libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`), plus `xdg-utils` and an unlocked GNOME Keyring or KWallet for part B, on a GNOME or KDE session, and `xclip` on X11 or `wl-clipboard` on Wayland for part C.
3. Make a disposable settings folder and name it in the terminal you start the app from, so nothing is written to the app data in your home folder. macOS and Linux: `export OPEN_SESAME_DEV_CONFIG_DIR="$(mktemp -d)"`. Windows PowerShell: `$env:OPEN_SESAME_DEV_CONFIG_DIR = (New-Item -ItemType Directory -Force "$env:TEMP\os78-config").FullName`.
4. Make a project folder named `open sesame ünï` in your home folder (`mkdir -p ~/"open sesame ünï"`; PowerShell `New-Item -ItemType Directory "$env:USERPROFILE\open sesame ünï"`).
5. From the repository root run `npm run dev:app`. The first build takes several minutes. Keep that terminal visible: the app prints `open-sesame:` lines there, and the number of `open-sesame: page loaded` lines is how you see whether the page loaded again. This is A1 and A2.
6. Where to find the controls: the Account and Shortcut sections are under the title bar, with a row of views (Today, Projects, Focus, Shells, Agents) below them. The shell form (Folder, SSH host, User and the New shell button) is in the Shells view; "New shell" below means that button.
7. Record the binary's SHA-256: `shasum -a 256 target/debug/open-sesame` on macOS, `sha256sum target/debug/open-sesame` on Linux, `Get-FileHash target\debug\open-sesame.exe` on Windows.

### macOS, part A (about 10 minutes)

An agent observed A1 to A3, C1, C5, D1 to D8, D10 to D12, F4, F5 and G1 at the tested commit, and saw C2 and C3 fail on [#142][142]; see [macOS observations](#macos-observations). These steps need a person's hands; steps 3 and 4 also settle whether #142 happens with a real keyboard.

1. With the app started by `npm run dev:app`, open the Shells view and press New shell.
2. Click the Open Sesame icon in the menu bar and choose Show or Hide: the window hides. Choose it again: the window shows. Do it twice; the terminal still has one `page loaded` line. This is B1.
3. Click into the shell, then click another app. Press Control+Option+Shift+Space: the window hides. Press it again: it shows. Without clicking, type `echo hi` and Return: it should appear in the shell; an agent saw the keys go nowhere ([#142][142]), so write what you see. The terminal still has one `page loaded` line. This is C2.
4. Put another app in full screen (its green button), then press the shortcut: the window appears over the full-screen app; without clicking, typing should go into the shell (see step 3); and when you move the pointer to the top of the screen the menu bar still names the other app. Press the shortcut to hide the window and leave full screen. This is C3.
5. Fill in SSH host and User for a machine you can reach with SSH and press New shell: it connects; run `hostname`; close the pane with its ×; `pgrep -l ssh` shows no `ssh` left from it. This is D9.
6. Choose Quit from the menu-bar icon's menu. `pgrep -x open-sesame` prints nothing. This is B2.

### macOS, part B (about 25 minutes; sign-in now, the view steps after #77 closes)

1. On a Mac or user account without the installed Swift app, run `cargo tauri build` in `src-tauri`, move the application to the Applications folder and open it once. Do not do this beside the installed Swift app until #87 is settled.
2. Follow [#72's checklist][72-checklist], steps 1 to 9, for E1 to E7. Run steps 3 and 4 below during its ten-minute wait.
3. Open the palette with Command+K and capture a note and a task; both appear in Today and Projects. This is F1.
4. Start a focus session; hide and show the window; quit and open the app again; the remaining time is right. This is F2.
5. Add a bookmark and a project and save a feed item if the views offer them, quit, open the app again: the note, task, bookmark, project and feed item are all there. This is F3.

### Windows, part A (about 25 minutes)

Run every command in PowerShell; a second PowerShell window, outside the app, is used for checking processes.

1. Start the app with `npm run dev:app` (after the steps above). The window opens, its status says it is connected, and the terminal has one `page loaded` line. In the second window, `Get-Process open-sesame` lists one process. This is A1 and A2.
2. Close the window with its ×; it hides. Right-click the tray icon and choose Show or Hide; it shows. Do this four times; the terminal still has one `page loaded` line. This is A3 and B1.
3. In the second window run `& .\target\debug\open-sesame.exe --toggle` twice: the window hides, then shows. Run `& .\target\debug\open-sesame.exe` with no argument while it is hidden: it shows. Each command returns at once, `Get-Process open-sesame` still lists one process, and there is still one `page loaded` line. This is C1.
4. Press Control+Alt+Shift+Space twice: the window hides, then shows with the keyboard in it. This is C2.
5. Left-click the tray icon: the window appears against the icon. Tick "Hide the window when it loses focus", left-click the tray icon while the window is shown: it hides. Show it, click inside the page: it stays. Untick the box. This is C7.
6. In the Shortcut section save `Control+Alt+K`: Control+Alt+K now hides and shows the window and Control+Alt+Shift+Space does nothing. Then save a shortcut another application already holds, if you have one (a launcher's, for example): the section says Open Sesame could not register it, and Control+Alt+K still works. This is C5 and C6.
7. Leave `Control+Alt+K` saved and choose Quit from the tray menu. Start the app again with `npm run dev:app`: the Shortcut field shows `Control+Alt+K` and the section says to press it. Save `Control+Alt+Shift+Space` again. This is F5.
8. Open the Shells view, write `$env:USERPROFILE\open sesame ünï` in Folder and press New shell. Run `Get-Location` (it prints that folder), `echo "os78-$(6*7)"` (it prints `os78-42`) and `$PID`, and note the number. This is D8 and D1.
9. Run `$Host.UI.RawUI.WindowSize`, drag a corner of the window to resize it, and run it again: the width and height changed. Type `Get-ChildI` and press Tab: it completes to `Get-ChildItem`. This is D2 and D3.
10. Run `ping -t 127.0.0.1`, then press Control+C: ping prints its statistics and the prompt returns; `Get-Process ping` in the second window finds nothing. This is D4.
11. Run `$s = 'x' * 70; 1..700000 | ForEach-Object { "$_ $s" }`, about 54 MB. While it prints, move the window and click between tabs: the window keeps responding. At the end the last line is `700000 xxx…`, and the lines on screen and in the scrollback count up without a gap. This is D5; say in the cell that it was checked by eye.
12. Press New shell for a second pane, run `$PID` there and note the number, then run `ping -n 600 127.0.0.1`. In the second window note `(Get-Process ping).Id`. Close the pane with its ×, wait three seconds, and run `Get-Process -Id <shell PID>,<ping ID>`: neither is found. This is D6.
13. If you can reach a machine with SSH, fill in SSH host and User and press New shell: it connects; run `hostname`. This is D9.
14. Make sure three panes are open (the SSH one counts), and note each local pane's `$PID`. Choose Quit from the tray menu. In the second window, `Get-Process open-sesame, ssh -ErrorAction SilentlyContinue` prints nothing and `Get-Process -Id <each PID>` finds none. This is D7, G1 and B2.

### Windows, part B (about 25 minutes; sign-in now, the view steps after #77 closes)

1. Follow [#72's checklist][72-checklist], steps 1 to 9, with `npm run dev:app`, for E1 to E7. In step 3, `Get-Process open-sesame` lists one process. Run steps 2 to 6 below during its ten-minute wait.
2. Open the palette with Control+K and capture a note and a task; both appear in Today and Projects. This is F1.
3. Start a focus session; hide and show the window; quit and start the app again; the remaining time is right. This is F2.
4. Add a bookmark and a project and save a feed item if the views offer them, quit, start the app again: all five are there. This is F3.
5. Open a view whose widget is not ported yet, such as Agents: it says "This widget is not available in this version." This is F4.
6. The WebView2 startup trace, which needs neither #72 nor #77 and can run at any time. Download the WebView2 SDK that the probe loads: `Invoke-WebRequest https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2 -OutFile $env:TEMP\wv2.zip`, then `Expand-Archive -Force $env:TEMP\wv2.zip $env:TEMP\wv2-sdk`. From the repository root run `powershell -ExecutionPolicy Bypass -File scripts\fixtures\ui-shell-webview2.ps1 -Root (Get-Location).Path -Sdk $env:TEMP\wv2-sdk -Out $env:TEMP\os78-webview2.json`. A window opens and closes by itself; `$LASTEXITCODE` is 0, and the report file says `"passed": true` and lists the checks named `off widget does not load …`. Write the WebView2 version from the report in the cell. This is A4.

### Linux X11, part A (about 25 minutes)

Log in to an X11 session (on GNOME, choose "GNOME on Xorg" at the login screen; `echo $XDG_SESSION_TYPE` prints `x11`). The tray icon needs a panel that shows status icons, such as Ubuntu's or GNOME with the AppIndicator extension.

1. Make a CLI that only the login shell finds: `mkdir -p ~/os78-bin`, then `printf '#!/bin/sh\necho os78-cli-found\n' > ~/os78-bin/os78-cli` and `chmod +x ~/os78-bin/os78-cli`. Add the line `export PATH="$HOME/os78-bin:$PATH"` to the end of your login shell's own file: `~/.zprofile` for zsh, or for bash `~/.bash_profile` (if you create that file, make its first line `[ -f ~/.profile ] && . ~/.profile`). Do not log out. Remove the line and the folder when you finish.
2. Make a desktop launcher: in `~/.local/share/applications/os78.desktop` write `[Desktop Entry]`, `Type=Application`, `Name=OS78 smoke` and `Exec=env OPEN_SESAME_DEV_CONFIG_DIR=<your disposable folder> <repository>/target/debug/open-sesame`, with absolute paths. Delete it when you finish.
3. Start the app with `npm run dev:app`: the window opens, the terminal has one `page loaded` line, and `pgrep -c -f target/debug/open-sesame` prints 1. This is A1 and A2.
4. Close the window with its ×, then choose Show or Hide in the tray icon's menu: it shows. Four times; still one `page loaded` line. This is A3 and B1.
5. In another terminal run `target/debug/open-sesame --toggle` twice: the window hides, then shows. Run `target/debug/open-sesame` with no argument while it is hidden: it shows. Each returns at once; still one process and one `page loaded` line. This is C1.
6. Press Control+Alt+Shift+Space twice: the window hides, then shows with the keyboard in it. This is C2.
7. Save `Control+Alt+K` in the Shortcut section: it works at once, and Control+Alt+Shift+Space does nothing. Then save a shortcut your desktop already uses, such as `Control+Alt+T` where that opens a terminal: the section says Open Sesame could not register it, and Control+Alt+K still works. If no message appears, write in the cell which shortcut you tried. Leave `Control+Alt+K` saved, choose Quit in the tray menu, start the app again with `npm run dev:app`: the field shows `Control+Alt+K`. Save `Control+Alt+Shift+Space` again. This is C5, C6 and F5.
8. Open the Shells view, write `~/open sesame ünï` in Folder and press New shell. Run `pwd` (that folder) and `echo os78-$((6*7))` (`os78-42`). This is D8 and D1.
9. Run `stty size`, resize the window, run it again: the numbers changed. Type `ls /usr/sha` and press Tab: it completes to `/usr/share/`. This is D2 and D3.
10. Run `sleep 600`, press Control+C: the prompt returns and `pgrep -fl 'sleep 600'` in another terminal prints nothing. This is D4.
11. Run `seq 7000000` (about 55 MB). While it prints, move the window and click between tabs: it keeps responding, and the last line is `7000000`. This is D5 by eye; step 15 adds the byte-by-byte check.
12. New shell for a second pane, run `echo $$` in it and note the number, then run `sleep 600`. Close the pane with its ×, wait three seconds: `ps -p <shell PID>` shows no process and `pgrep -fl 'sleep 600'` prints nothing. This is D6.
13. If you can reach a machine with SSH, fill in SSH host and User and press New shell: it connects; run `hostname`. This is D9.
14. With three panes open, note each local pane's `echo $$`, choose Quit in the tray menu: `pgrep -fl 'target/debug/open-sesame|ssh '` prints nothing from the app, and `ps -p <each PID>` shows none. This is D7, G1 and B2.
15. Optional, for D5's byte-by-byte check: `export OPEN_SESAME_SELFTEST="{\"out\":\"/tmp/os78-selftest.json\",\"cwd\":\"$HOME/open sesame ünï\",\"cwdName\":\"open sesame ünï\",\"lines\":7000000}"` and `npm run dev:app`. The self-test opens the Shells view by itself once the window is ready. Leave the window alone until it says the self-test finished, then read `/tmp/os78-selftest.json`: every step has `"ok": true`, and the flood step reports its longest timer and frame gaps. Quit from the tray and check that none of the process IDs in its `quit` entry is still running. Unset the variable afterwards.
16. Open the app from the desktop: the "OS78 smoke" entry in the applications menu or grid. Open the Shells view, press New shell and run `os78-cli`: it prints `os78-cli-found`. Then in a terminal, `tr '\0' '\n' < /proc/$(pgrep -f target/debug/open-sesame)/environ | grep ^PATH=` does not contain `os78-bin`. Quit from the tray. This is D10.

### Linux X11, part B (about 25 minutes; sign-in now, the view steps after #77 closes)

1. Follow [#72's checklist][72-checklist], steps 1 to 10, with `npm run dev:app` on the X11 session, for E1 to E8. In step 3, `pgrep -c -f target/debug/open-sesame` prints 1. Run steps 2 to 5 below during its ten-minute wait.
2. Open the palette with Control+K and capture a note and a task; both appear in Today and Projects. This is F1.
3. Start a focus session; hide and show the window; quit and start the app again; the remaining time is right. This is F2.
4. Add a bookmark and a project and save a feed item if the views offer them, quit, start the app again: all five are there. This is F3.
5. Open a view whose widget is not ported yet, such as Agents: it says "This widget is not available in this version." This is F4.

### Linux Wayland, part A (about 20 minutes)

Log in to a Wayland session (on GNOME, the default "GNOME" entry; `echo $XDG_SESSION_TYPE` prints `wayland`). Steps 1 and 2 of the X11 part make the CLI and the launcher; skip them if they are still there.

1. Start the app with `npm run dev:app`: the window opens, one `page loaded` line, `pgrep -c -f target/debug/open-sesame` prints 1, and the Shortcut section says this Wayland session does not let an application register a shortcut and names `open-sesame --toggle`. This is A1 and A2.
2. Close the window with its ×, then choose Show or Hide in the tray icon's menu: it shows. Four times; still one `page loaded` line. This is A3 and B1.
3. In another terminal run `target/debug/open-sesame --toggle` twice: hidden, then shown. Run `target/debug/open-sesame` with no argument while it is hidden: shown. Each returns at once; still one process and one `page loaded` line. This is C1.
4. In the desktop's keyboard settings add a custom shortcut whose command is the absolute path of `target/debug/open-sesame` followed by `--toggle`. Press it twice: the window hides, then shows. Remove the shortcut afterwards. This is C4.
5. Run X11 part A steps 8 to 14 and 16 in this session. They are D1 to D10, G1 and B2 for the Wayland column.

### Linux Wayland, part B (about 25 minutes; sign-in now, the view steps after #77 closes)

Run X11 part B on the Wayland session, for E1 to E8 and F1 to F4 in the Wayland column.

### Sign-in links, every system (about 15 minutes, after #129 merges)

Each row under [Sign-in links](#sign-in-links) says what to deliver and what to see. Use the same disposable settings folder as part A.

1. macOS: L1 and L7 with the bundle of part B's step 1, and L6 once #87 is settled. L6 and the end of L7 need the real account of part B.
2. Windows: L1, L2, L3 and L7; L8 after part B's sign-in; L9 after one development run.
3. Linux, in the X11 session and again in the Wayland session: L1, L3, L4, L5, L7 and L9.

### Every system, part C (about 20 minutes; C8 and C9 after #115, P1 after #83 or #84)

These are the checks the owner moved here on 16 November 2026 from [#97][97], [#112][112] and [#115][115]. Steps 1 to 4 can run now at the tested commit; step 5 waits for [#115][115]'s change, and step 6 for the first feature that opens a browser through the core runner. On macOS an agent has run steps 1 and 2 ([M10](#m10-floods-frame-gaps-and-a-hidden-window)); a person runs step 3 there, because it writes the clipboard.

1. macOS and Linux (each Linux session): quit the app, run `rm -f /tmp/os78-selftest.json`, then `export OPEN_SESAME_SELFTEST="{\"out\":\"/tmp/os78-selftest.json\",\"cwd\":\"$HOME/open sesame ünï\",\"cwdName\":\"open sesame ünï\",\"lines\":7000000}"` and `npm run dev:app`. Keep the window on screen with nothing over it until it says the self-test finished. In `/tmp/os78-selftest.json` the flood step reports `longestFrameGapMs`, `longestTimerGapMs` and `frames`; write the three numbers in the D11 cell. Quit, run `unset OPEN_SESAME_SELFTEST`, and start the app again with `npm run dev:app`. On Linux this also covers X11 part A step 15.
2. Every system: in a shell pane run the D12 command for your system with the window shown and note the time it prints. Run it again and, as soon as numbers scroll, close the window with its close button, which hides it. Wait twice that time and at least a minute, then show the window (the Dock icon on a Mac, Show or Hide in the tray menu elsewhere) and wait for the flood to end if it has not. The last line before the time is the last number; type `echo back` and Return: it appears at once. Write both times in the D12 cell.
3. Every system: copy a 5,000-character command to the clipboard from a terminal outside the app. macOS: ``printf "p='%s'; echo \${#p}" "$(printf '0123456789%.0s' $(seq 500))" | pbcopy``; Linux: the same with `| xclip -selection clipboard` on X11 or `| wl-copy` on Wayland in place of `| pbcopy`; Windows PowerShell: ``Set-Clipboard ("`$p = '" + ('0123456789' * 500) + "'; `$p.Length")``. Click into a shell pane, press Command+V on a Mac or Control+Shift+V elsewhere, then Return: it prints `5000`. This is D13.
4. Windows: `(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').CurrentBuild` prints the build. At 26100 or above, write `n/a` and the build in D14. Below it, open three panes, run `ping -t 127.0.0.1` in one, close that pane with its × and at once type `echo still-here` and Return in another: the close finishes within about five seconds and the text appears. Then press New shell and close the new pane at once, and check the same. Write the build and what you saw in D14.
5. After [#115][115]'s change merges: show the window, then click a window of another app that covers it (on a Mac, also leave the window on one Space and switch to another). Press the shortcut once: the window comes in front, and `echo front` typed without clicking appears in the shell. Press it again: it hides. Do the same with `open-sesame --toggle` from a terminal, with Show or Hide in the tray menu and, on Windows, with a left click on the tray icon; then tick "Hide the window when it loses focus" and do it all again. Write in C8 what counted as in front. With the box still ticked, right-click in the page, open a select list where the page has one, and type with an input method that opens a window of its own (for example Japanese input): the window stays shown each time. Untick the box. This is C9.
6. Linux, after [#83][83] or [#84][84] adds a command that opens the browser through the core runner: with the browser running, use that command; the page opens and the browser is still open a minute later. Quit the browser and do it again. This is P1.

## Earlier runs

### `0d65d43`, 16 November 2026, macOS only

Commit `0d65d4341b97311f6c031016d2af57a8f4aebe5d` (`main` after [#113][113]), before the views of [#76][76] and the storage of [#105][105]. macOS 27.2.1 (26B131), arm64, binary `target/debug/open-sesame` with SHA-256 `67a9b2ef25b7e22f54c6f6dd73eabb678a4730d791d3c8eeae420db461c95c07`, observed by agent session `claude-code:8bb702d6`. A1 pass: `npm run dev:app -- --no-watch` compiled in 1 minute 9 seconds and started the app. A2 pass: one process, one window on screen, one `page loaded` line and "Connected to this machine.", both from a terminal and from the desktop (LaunchServices with an empty caller environment: parent `launchd`, `PATH` `/usr/bin:/bin:/usr/sbin:/sbin`). Quit from the application menu left no process 0.05 seconds later. No other line was run at this commit. Receipts: `open-sesame/receipts/desktop-78-g2-8bb702d6/macos-0d65d43/` in the common Git directory.

[58]: https://github.com/OpenCoven/open-sesame/issues/58
[70]: https://github.com/OpenCoven/open-sesame/issues/70
[71]: https://github.com/OpenCoven/open-sesame/issues/71
[72]: https://github.com/OpenCoven/open-sesame/issues/72
[72-checklist]: https://github.com/OpenCoven/open-sesame/issues/72#issuecomment-6873129487
[73]: https://github.com/OpenCoven/open-sesame/issues/73
[74]: https://github.com/OpenCoven/open-sesame/issues/74
[75]: https://github.com/OpenCoven/open-sesame/issues/75
[76]: https://github.com/OpenCoven/open-sesame/issues/76
[77]: https://github.com/OpenCoven/open-sesame/issues/77
[78]: https://github.com/OpenCoven/open-sesame/issues/78
[83]: https://github.com/OpenCoven/open-sesame/issues/83
[84]: https://github.com/OpenCoven/open-sesame/issues/84
[87]: https://github.com/OpenCoven/open-sesame/issues/87
[94]: https://github.com/OpenCoven/open-sesame/issues/94
[97]: https://github.com/OpenCoven/open-sesame/issues/97
[97-decision]: https://github.com/OpenCoven/open-sesame/issues/97#issuecomment-6910963289
[105]: https://github.com/OpenCoven/open-sesame/issues/105
[112]: https://github.com/OpenCoven/open-sesame/issues/112
[112-decision]: https://github.com/OpenCoven/open-sesame/issues/112#issuecomment-6910962644
[113]: https://github.com/OpenCoven/open-sesame/pull/113
[115]: https://github.com/OpenCoven/open-sesame/issues/115
[115-decision]: https://github.com/OpenCoven/open-sesame/issues/115#issuecomment-6910965635
[116]: https://github.com/OpenCoven/open-sesame/issues/116
[117]: https://github.com/OpenCoven/open-sesame/pull/117
[116-checks]: https://github.com/OpenCoven/open-sesame/issues/78#issuecomment-6906616293
[118]: https://github.com/OpenCoven/open-sesame/pull/118
[119]: https://github.com/OpenCoven/open-sesame/pull/119
[120]: https://github.com/OpenCoven/open-sesame/pull/120
[129]: https://github.com/OpenCoven/open-sesame/pull/129
[131]: https://github.com/OpenCoven/open-sesame/issues/131
[132]: https://github.com/OpenCoven/open-sesame/issues/132
[140]: https://github.com/OpenCoven/open-sesame/issues/140
[141]: https://github.com/OpenCoven/open-sesame/issues/141
[142]: https://github.com/OpenCoven/open-sesame/issues/142
