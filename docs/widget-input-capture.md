# Widget input and Live audio patch

This implementation note records early widget releases. Use the [documentation index](README.md), [capability matrix](capabilities.md) and current source for today’s entrypoints and acceptance limits. Versioned verification examples reproduce their historical candidate; they do not select the current release or task.

The private v0.0.1 patch adds a single Live audio setup: choose **Transcribe** or **Record audio**, choose the source, then Start. Stop finishes the current capture and exposes its output. Transcription creates text without saving an audio file; recording creates audio without transcription. Questions appear once there is transcript text. The question composer no longer contains a second recording control or competing microphone button.

On macOS, Microphone uses native speech recognition for transcription and a native AAC recorder for audio. The selected system microphone name appears during capture. Save audio opens the macOS save dialog for an `.m4a` file. Save before quitting or starting another recording; audio stays in a temporary local file until then. Clearing a transcript preserves an existing recording. The recorder's input and metering use Apple's [AVAudioRecorder](https://developer.apple.com/documentation/avfaudio/avaudiorecorder).

Shared tab/screen audio is offered only where the browser exposes display capture. Shared transcription additionally requires the supported desktop Chromium speech-track API. Unsupported choices are disabled with an explanation. No microphone or share picker opens merely from visiting Live. The optional demo remains a sample, and Start after a stopped sample opens real capture rather than replaying the sample.

## Other widget fixes

- **Option–Space:** a native global shortcut opens the launcher while the application is running, including when its widget is hidden. Quit ends the shortcut. The status menu indicates if another registration prevents the shortcut from being installed.
- **Keyboard focus:** the native panel activates on click, and terminal clicks explicitly give the web view and xterm keyboard focus. The launcher refocuses its input when reopened.
- **Placement and appearance:** expanding or opening uses the widget's existing display. Native and CSS corner masks match, use a dark material, and remove bright lower-corner reflections.
- **Console rail:** Shells and Desktops share the Reader rail frame, with compact 30-point shell rows. Double-click a shell name or press F2 to rename it; Enter/blur saves, Escape cancels, and the live session stays connected.
- **Bookmarks:** URL changes commit as a complete valid address, persist before refreshing the preview, and roll back if storage fails. Both Projects and Reader use separate native WKWebViews in the Mac app. External pages have no application RPC bridge; browser preview keeps its iframe fallback.
- **YouTube:** the Mac app loads a bundled player page into its own WKWebView with the installed bundle identity as the HTTPS base URL. This follows YouTube's [embedded player client identity guidance](https://developers.google.com/youtube/terms/required-minimum-functionality#embedded-youtube-player-services-api-client-identity-and-credentials) for supplying the HTTP Referer required to avoid error 153. Player controls and queue events use a separate, restricted bridge. Browser playback retains its existing path.

## Verification and remaining device acceptance

JavaScript checks cover native capture lifecycle, final speech while stopping, segment rotation, denial recovery, cancelled and late microphone permission, sample-to-microphone transitions, saving, independent transcript/recording outputs, bookmark URL rollback, terminal focus/input forwarding, shell renaming, player events, and embedded-view lifetime. These checks use simulated speech, recorder, DOM, and bridge responses. Native URL validation executes without opening a view. The arm64 app is compiled and its packaged signature and helper are checked separately.

A real GUI session is still required to accept Option–Space from another application, hidden-widget reopening, terminal typing, actual microphone capture and Save audio, permission denial/retry, YouTube playback, bookmark navigation, dialog overlap, and two-monitor placement. Computer-use and native GUI launch were unavailable in the build environment; mocked checks and compilation do not establish these device results. Real PTY qualification for the reliability candidate is tracked in the [current work ledger](work-tracking.md); it does not establish GUI input or device acceptance.

## Navigation follow-up in v0.0.2

The primary Focus, Projects, Console, Reader, Live, and Plugins tabs now form a compact column of icons on the left. Each keeps its view name as a tooltip and accessible label. Up/Down and Home/End navigate the vertical tab list. Widget options sits at the bottom of the rail; each workspace keeps its own secondary tabs and sidebar. The standalone launcher retains its full-width layout.

## Live content and Markdown preview

Live now puts output, source, language, Start/Stop, and settings in a compact toolbar. The status strip distinguishes text-only transcription from an audio file, keeps elapsed time visible, and exposes the longer capture explanation through Capture details. Unsupported-source explanations open automatically. Source/mode controls remain locked while capture is starting, active, or stopping. Removing the empty settings row and separate field headings leaves more of the fixed widget for the transcript and answer columns; narrow layouts retain a stacked fallback.

Agent replies render through the bundled GFM parser and HTML sanitizer, including headings, emphasis, lists, tables, links, and code blocks. Raw HTML and images are removed before DOM parsing, and links are limited to credential-free HTTP(S) targets with noreferrer. Answers cannot automatically load remote images or media. Errors and pending messages stay plain text. Question text, saved answer text, and the transcript supplied to a CLI remain unchanged. The preview renderer is isolated from the reader's normal Markdown/image handling.

Plugin setup, current native OAuth limits, and private configuration handling are documented in the [plugin setup notes](desktop-polish-plan.md#plugin-setup-and-private-configuration). Verification uses synthetic transcripts and credentials; the user's screenshot was used only as a layout reference, with none of its conversation content copied into fixtures or documentation. Native rendered layout, live OAuth authorization, and actual media playback still require device acceptance.

## Flat dark appearance in v0.0.7

The widget stays opaque while clicking, typing, holding, resizing, and changing views. The native blur layer and Alt-hold/Space opacity gesture are removed. Background holding remains a speech-entry action. Menus and controls use solid dark surfaces; keyboard focus is visible without a surface fade. Static navigation dots replace the animated edge and retain the existing enabled preference. See the [four UI refinements](desktop-polish-plan.md#flat-dark-ui-polish) for the palette, selection states, compact controls, and acceptance limits.
