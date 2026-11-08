# Open Sesame desktop companion

This source builds the widget into an AppKit menu-bar/notch app. Local sessions are real PTYs on the machine running Open Sesame. SSH sessions use that machine's OpenSSH client, configuration, keys, and agent. The private hosted Site remains a browser prototype and has no access to your shell.

See the [desktop polish plan](../docs/desktop-polish-plan.md) for the November 6 review, current verification, integration priorities, and cross-platform exploration. From this checkout, `npm run dev:macos` builds and opens the native app; `npm run dev` starts the local browser preview.

Open Sesame replaces the previous application name. The executable and source host are `OpenSesame`; the app is `Open Sesame.app`. The historical bundle identifier remains stable for existing website data and OS permissions. Browser storage copies legacy keys without deleting originals or overwriting newer values. Existing controller receipts and the old command prefix remain compatible; new setup uses `open sesame` commands and `OPEN_SESAME_*` environment variables.

## Build and run on your Mac

Requirements: macOS 13 or later, Xcode Command Line Tools, and Python 3. No npm install, API key, or remote terminal gateway is required for local shells.

Extract the ZIP, open Terminal in its `open-sesame-desktop` directory, and run:

```sh
./run-macos.sh
```

The script compiles `desktop/OpenSesame.swift`, bundles the web assets and Python bridge into `build/Open Sesame.app`, signs it ad hoc for local development, and opens it. This is source for a development build, not a notarized distribution binary. If Xcode tools are missing, install them with `xcode-select --install`. Python 3 must already be installed and executable. Rebuild after moving or replacing the Python installation.

The menu-bar eyes show/hide Open Sesame. Right-click them to quit. Click the compact notch to expand; choose Console in the left icon rail, then Shells. M switches notch/menu placement, E toggles expansion, and Escape closes contextual UI or collapses the panel when not editing text. The same browser controls remain available in the hosted studio for exploring geometry.

## Connect a project and open panes

1. In Terminal, open More → Connect project. Give the project a name and choose its local folder.
2. Select that project and add a pane. Its local login shell starts in the project folder.
3. Use Connection to choose Local, SSH, or Web terminal; assign a project, override a pane's working folder, or provide an SSH hostname and user.
4. Switch projects to filter the rail. Other live sessions stay mounted. All projects restores the full carousel.
5. More contains rail placement, Disconnect, and Close pane. Disconnect ends the shell; closing a pane also removes its saved configuration. Reload/relaunch ends sessions and restores metadata without automatically running commands.

Projects are shared with Items (notes, bookmarks, tasks). Paths are machine-specific. For SSH, specify the remote working folder separately; a local project path is not applied to a remote machine. SSH password, host-key verification, and key-passphrase prompts appear inside the actual terminal. Open Sesame never bypasses OpenSSH verification. Only connect to hosts you are authorized to use.

## How the connection works

- xterm renders real shell bytes. Its bundled MIT license and provenance are in `dist/vendor/THIRD-PARTY.txt`.
- A separate Python helper creates a controlling PTY per pane, forwards input/output, resizes the PTY, and cleans up process groups on disconnect/quit.
- The macOS host and helper communicate through stdio. The optional iMessage controller starts a token-protected loopback HTTP receiver only when explicitly enabled.
- Only the bundled top-level document may call native allowlisted methods. External previews cannot invoke shell actions. Outbound top-level web links open in the system browser.
- At most 16 active shells run at once. Local login-shell behavior, completion, history, and startup configuration are provided by your own shell.
- Open Sesame stores pane names, projects, folders, hosts, and layout metadata locally. It does not store terminal output or SSH credentials. Your shell may maintain its normal history.

## Development preview and checks

```sh
python3 desktop/dev_server.py --port 4173
python3 -m unittest discover -s desktop/tests -v
```

The development server defaults to loopback, serves `dist/`, and enables a same-origin WebSocket PTY transport for local QA. Do not expose that development server to untrusted clients: its intended local page can execute commands as the server user. Foreign-origin requests are rejected. The Sites static production configuration deploys only `dist/`, never this server or a shell service.

Verified in Linux: actual PTY execution, distinct project folders, controlling terminal, resize, Tab completion, Ctrl+C, cleanup, rejected invalid connections, and foreign-origin rejection. Browser review exercises the same renderer/bridge and the project carousel.

Not yet verified on hardware: compiling/running the AppKit host, physical camera-notch geometry, native material transparency, remote SSH authentication, and macOS media permissions. No Apple SDK is available in the build environment. The Music sample remains silent; Coven runs through its installed CLI; VNC requires an accessible web viewer gateway. Screen-share exclusion has not been implemented or claimed.

## Reading and feeds

Reading provides RSS 2.0/Atom subscriptions, a reading list, saved bookmarks, and explicit read/unread state. Read later saves linked articles as Bookmarks in Items. Feed bodies are rendered in Open Sesame's own reader; the original website remains one small icon away. Articles and embedded bookmark websites scroll within the fixed widget.

The native helper loads feeds on background threads through Python's HTTP client, with standard TLS verification, HTTP(S)-only URLs, no embedded credentials, a 10-second network timeout, and a 2 MB size limit. This avoids the browser CORS restriction without deploying a public proxy. Browser-only viewing supports feeds that allow cross-origin access and reports when the desktop companion is required. Feeds and reading state are device-local. The bundled sample feed is explicitly labeled and works offline.

The native build now bundles `feeds.py` alongside `bridge.py`. Run the eleven integration tests with the same unittest command above. The Apple host still requires compilation and hardware validation on a Mac.

## Coven Familiars

Open Console → Familiars and click Connect Coven. Choose a familiar from the installed roster, type a message, and press Send. Replies stream into that familiar’s own saved conversation. Stop preserves captured text; New chat preserves the previous local history. The Run with selector uses Coven Code, Codex, or Claude Code through the installed CLI and its provider sign-in. Messages use the familiar’s dedicated workspace with a read-only policy; browsing the roster and reopening a chat never start a provider turn.

See the [complete integration happy path](../docs/coven-familiars-integration.md), [runnable consumer example](../examples/coven_familiars.py), and fixture verification instructions. The historical mocked chat has been replaced by this live host transport. Existing saved Coven panes redirect to the familiar picker. `/agent` prepares a draft there for review; it does not automatically send the request.

Lockin combines Music, Focus, YouTube, and Media. Media can open local audio/video files through the native picker; the file is played locally and not uploaded. Codec support depends on WebKit. The YouTube embed requires internet access and the video's permission to embed; file-based native WebKit playback and YouTube's application/referrer requirements need Mac validation. The small external icon remains available.

The capture row also accepts `/computer <instruction>` or `/agent <task>` and prepares a draft in Familiars. Choose the familiar and explicitly Send; Coven supplies its own workspace and configured provider. Message text is passed as one literal CLI argument. Bash remains a separately reviewed Shells action. Hover a pane for its trash icon; the inline red six-second confirmation cancels unless you explicitly confirm.

Terminal fitting now excludes viewport padding, waits for visible layout, refreshes on pane/window/font changes, and coalesces PTY resize messages. Rebuild the app to update a previously built copy. Linux Chromium QA used a live curses interface across both placements; AppKit/WebKit hardware behavior remains unverified.

## Latest reader and capture changes

Rebuild from this source to include `reader.py`, updated Markdown assets, and the native EPUB save handler. `!` capture prepares an explicitly reviewed Bash command; the default setup shows the request and local/project defaults, with Advanced connection settings and a second Help disclosure. Commands never run on reload. Coven task arguments remain literal; Bash commands intentionally execute as shell code.

Reading loads bounded credential-free HTML/Markdown/JSON through `reading.fetch`, preserving safe article images and full text where available. arXiv/HF IDs include a PDF fallback. EPUB exports use a native Save panel; browser exports use downloads. PDF links embed using the system web/PDF viewer; native Print/save PDF opens the original source. The host save handler accepts a bounded EPUB payload only from the bundled main document and lets the user choose the destination. No external frame receives the bridge. These AppKit paths need compilation and device validation on macOS; Linux tests cover Python retrieval and PTY behavior.

## Site feeds and iMessage control

Reading → Add → Site → RSS discovers a published feed or generates entries from article links. Reading actions include pause/resume and RSS export. Reading → Options → iMessage controller contains a local command tester and provider setup. See [controller-setup.md](controller-setup.md) for BlueBubbles and the Photon Spectrum Stable adapter. Rebuild this companion to include the receiver and native RSS Save panel. Live providers and the macOS build remain unverified.

## Flat dark appearance, voice, and Focus calendar

The widget uses an opaque charcoal surface with solid menus, cards, and controls. Opacity cycling, the Alt-hold/Space glass gesture, native vibrancy, animated edge glow, and view fades have been removed. The native surface and web palette use the same base color. Holding an empty background to speak remains available; keyboard controls and text editing keep their normal behavior. See the [four UI refinements](../docs/desktop-polish-plan.md#flat-dark-ui-polish) for navigation, readability, controls, and accessible activity feedback.

The capture bar starts collapsed. Click its microphone to dictate a message or prepare a command, then review the draft before sending. Chat search also has a microphone. The native build now compiles VoiceInput.swift with Speech and AVFoundation and declares both speech-recognition and microphone usage descriptions. It asks permission only after clicking voice input, prefers on-device recognition when available, and releases microphone resources on completion/cancellation with a 30-second maximum. Browser speech requires support from the browser's recognition service. Coven conversations use the native CLI transport described above; voice input prepares a draft before Send.

Focus adds a device-local Day/Week/Month calendar beside its agenda. Scheduling stores a plan; it does not create system reminders or auto-start timers. Start now explicitly loads that agenda and starts the timer. Arrow-key pagination avoids typing and terminal contexts. The Mac host compiles; microphone permissions, terminal interaction, and native visual acceptance still require device verification.

## Live conversations

Open **Live**, choose **Transcribe** or **Record audio** and a source in the capture toolbar, then press **Start**. The status strip distinguishes text-only transcription from an audio file; Capture details opens the longer explanation. Microphone transcription in the macOS companion uses the system speech recognizer. Shared audio and recording use the sources offered by the browser or web view. Stop capture before changing the source or output mode.

For AI questions, install an up-to-date Claude Code or Codex CLI and sign in from your terminal. The companion looks on its PATH and in `~/.local/bin`, `/opt/homebrew/bin`, and `/usr/local/bin`. In Live → Session settings → Answer with, select the CLI and use Check again if you installed it while Open Sesame was open. Then type a question in the capture bar and press Enter. Each request uses up to the latest 24,000 characters of transcript (including the current partial phrase) and recent Q&A for that agent. Both adapters start a fresh, noninteractive CLI process in an empty temporary directory. Codex uses read-only sandboxing, ephemeral mode, and the saved CLI sign-in. Claude Code runs with built-in tools disabled.

The hosted widget offers local transcript search and a labeled sample you can try without a microphone. The desktop bridge runs in the companion or the loopback development app. Transcript and Q&A stay in the current view's memory until you clear the session or reload. Save or export the transcript before closing if you want to keep it.

## Floating windows and Full

The pop-out button detaches the existing Mac panel into a movable floating window. Its content keeps the same 16:9 ratio as the docked presets while you resize it, and its width is remembered across app launches. Restored bounds fit the current screen's usable area, including the title bar. It keeps the same web view and connections, stays above normal app windows, and supports other Spaces. Dock it with the same button or close control. Full fills the display; in a titled floating window it temporarily releases the ratio to maximize within the display's usable area, then restores the wide size and ratio. The native build compiles on macOS; GUI acceptance remains unverified because the computer-use service is unavailable.

Clicking outside the Mac widget collapses it back to the compact notch or menu position. A floating widget docks and collapses without taking focus back from the application you clicked. Its title-bar close button also returns it to the compact position. Pin open keeps automatic outside dismissal disabled; an explicit collapse gesture still works. Drag a docked resize edge inward well past Small, wait for Release to collapse, then release. Drag back or press Escape to cancel. Reopening restores the preferred expanded size, with drafts and running sessions retained. Native menus, file pickers, and dialogs are excluded from outside dismissal. These native mouse/focus paths compile but still need device acceptance.

In the hosted browser, pop-out uses Document Picture-in-Picture when available. Otherwise it opens a normal resizable window and explicitly identifies that always-on-top is unavailable. Keep the original tab open for a PiP window. Saved items, the capture draft, focus timer, reader, calendar, transcript/questions and local media queue are handed over in memory; media resumes only on a play action. Stop live recording and finish pending answers before moving the browser workspace. Music-provider sessions and embedded players may require reconnecting or pressing play in the new window. Full uses the real viewport, without the studio wallpaper or exterior padding, and the top-row Full control requests browser fullscreen where allowed.

### Hold to speak
Hold the compact widget or an empty area of the expanded widget for 450 ms, speak, and release to review the command. Click the voice button or use Option–Shift–V for hands-free entry. Recorder saves microphone audio; Transcriber starts a live transcript. Speech requires microphone/speech permission. The browser may rely on an online speech service.

The rebuilt macOS companion supports explicit computer controls: `computer volume 40`, `mute`, `unmute`, and `open Safari` (also Finder, Notes, Calendar, Music, Terminal, Calculator, System Settings). Controls run only after clicking the labeled action. The Python bridge accepts a fixed allowlist with no arbitrary script input. General computer requests still use the existing Coven preview; it is not an autonomous desktop operator.


### Local processes and activity indicators

Console → Processes discovers recognized Codex, Claude Code, Coven, Gemini CLI, Aider, and OpenCode processes owned by the companion's current local user. It refreshes every five seconds while the window is visible. CPU (the process's lifetime average reported by `ps`), resident memory, uptime, and OS scheduling state are read-only. Agent task progress and approval state are not inferred from scheduling state: a sleeping process may still be waiting for a model or network response. Remote machines, IDE-integrated agents and unknown executables are not included. Command arguments and prompts are not returned to the page or persisted by discovery. A `ps` failure shows an unavailable state, never an empty successful scan. Scanning runs separately from terminal input handling.

Rebuild the desktop app after this update (`bash desktop/build-macos.sh`); the hosted browser alone cannot inspect your machine. The dashboard's Try demo mode is explicitly simulated and does not drive actual process indicators.

Small, static status dots in the navigation rail reflect focus timers, recognized process state, and microphone use. The existing enabled preference is retained under Behavior → Activity indicators. Preview status demonstrates an explicitly labeled state for 12 seconds, then returns to live state. Indicators do not animate, change surface opacity, or infer an agent's task progress. A screen-reader status describes changes.
