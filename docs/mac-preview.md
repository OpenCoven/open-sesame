# Mac preview

The Mac preview is the restart's companion rail ([#161](https://github.com/OpenCoven/open-sesame/issues/161)) built as an application you install once and use every day, beside the installed Swift app and without touching it. It is a local build: not signed with a developer certificate, not notarized, not a release.

| | Swift app | Mac preview |
| --- | --- | --- |
| Application | `/Applications/Open Sesame.app` | `/Applications/Open Sesame Preview.app` |
| Identifier | `com.perch.widgetstudio` | `org.opencoven.open-sesame.preview` (the owner's choice, 20 November 2026; the final identifier is still [#87](https://github.com/OpenCoven/open-sesame/issues/87)'s) |
| `opensesame://` links, including sign-in's callback | Registered | Not registered |
| Data | The Swift app's own | `~/Library/Application Support/org.opencoven.open-sesame.restart-development`, the folder every restart build uses |

[preview.conf.json](../src-tauri/preview.conf.json) is the only difference from an ordinary build. It is laid over [tauri.conf.json](../src-tauri/tauri.conf.json) by `npm run build:preview`, which leaves the #87 default untouched, and [check-tauri-sign-in.mjs](../scripts/check-tauri-sign-in.mjs) holds it to the table above.

**Sign-in is not available in the preview.** The callback arrives on the `opensesame` scheme, which the Swift app owns on this Mac, and a scheme of the preview's own would need a redirect address registered with WorkOS. Sign-in waits for #87 and [#132](https://github.com/OpenCoven/open-sesame/issues/132). Everything else works signed out on the local workspace: Today, Projects, Focus, Shells, Agents, Commands and Settings.

## Install

1. From the repository root run `npm run build:preview`. It takes about two minutes on a warm build and ends with `Finished 1 bundle at: …/target/release/bundle/macos/Open Sesame Preview.app`.
2. Quit any development build of the restart (`npm run dev:app`) first: it uses the same data folder.
3. Copy it: `ditto "target/release/bundle/macos/Open Sesame Preview.app" "/Applications/Open Sesame Preview.app"`. To update it later, choose Quit Open Sesame Preview from its tray menu and copy it again.
4. Open it from /Applications. A build made on this Mac carries no quarantine, so macOS opens it without asking.
5. To start it at login: System Settings, General, Login Items, the + under "Open at Login", and choose Open Sesame Preview.

The shortcut is Control+Option+Shift+Space. If Settings says another application holds it, the Swift app may; choose another there. `open-sesame --toggle` is `"/Applications/Open Sesame Preview.app/Contents/MacOS/open-sesame" --toggle`.

## Run sheet

Each line is one check with your own pointer and keyboard. Write pass or fail with a few words in the macOS column of [the smoke pass](desktop-smoke-pass.md#checklist), with the commit printed by `git -C <clone> rev-parse --short HEAD` where you built it, and open an issue for any failure.

1. **First launch.** The strip appears against the right edge of the display your pointer is on, centred on its height. Say whether the preview took the keyboard when it started (an agent saw it stay in front for six seconds and more, [#212](https://github.com/OpenCoven/open-sesame/issues/212)), and whether the window you were typing in has it afterwards: type a few characters there.
2. **R1.** Move the pointer to another display and wait a second: the strip follows. Open the panel, then move the pointer to the other display: the panel stays.
3. **R2.** Rest the pointer on the strip: the panel opens, and the icons under the pointer do not move. The keyboard stays in your other app. Move away: it closes. Rest again, click inside the panel, then click another window: it closes.
4. **R3.** Click Projects on the strip: the panel opens on Projects and stays when the pointer leaves, and typing goes into it. Press Escape: it closes, and typing goes into the app you were in.
5. **R4.** Click Shells: the panel opens wide. The control in the bar makes it narrow and wide again; the shell fits both ways. Click Today: the panel is narrow.
6. **R5.** In Focus, start a session, then close the panel: the Focus icon carries a mark. Wait for the session to end with the panel closed: the mark changes and the top of the strip carries one too. Open Focus: both clear.
7. **R6.** In Settings, under Rail, choose Left: the strip and the panel move to the left edge. Turn off "Open when the pointer rests on the rail": a rest no longer opens it, and a click still does. Put both back.
8. **C1.** Run the `--toggle` command above in Terminal three times: the panel opens, closes and opens, and each command returns at once.
9. **C2.** Press the shortcut: the panel opens and typing goes into it. Press it again: it closes to the strip and typing goes back to the app you were in.
10. **C3.** Put another app in full screen and press the shortcut: the panel appears over it, typing goes into the panel, and the strip is over the full-screen app before and after.
11. **Data across Quit.** Capture a note and a task in Today, and open a project in Projects. Choose Quit Open Sesame Preview from the tray icon's menu, then open the preview again: the note, the task and the project are there.
12. **Shells.** Open a shell, run `echo hi`, press Control+C on `sleep 30`, then Quit with the shell open: no shell process is left (`pgrep -fl zsh` lists only your own terminals).

## Remove

Choose Quit Open Sesame Preview from the tray icon's menu, remove it from Login Items if you added it, and move `/Applications/Open Sesame Preview.app` to the Trash. The Swift app and its data are not touched. The restart's data folder above stays for development builds; delete it only if you want your preview notes, tasks and projects gone too.

## What has been seen

Launched runs by an agent on this Mac, recorded in [companion-rail.md](companion-rail.md#macos), with events addressed to the application's process only: no pointer, no keyboard, no rest. They are evidence of the build, not of a person's use; the run sheet above is the person's part.
