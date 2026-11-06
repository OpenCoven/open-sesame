# Widget input and Live audio patch

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

A real GUI session is still required to accept Option–Space from another application, hidden-widget reopening, terminal typing, actual microphone capture and Save audio, permission denial/retry, YouTube playback, bookmark navigation, dialog overlap, and two-monitor placement. Computer-use and native GUI launch were unavailable in the build environment; mocked checks and compilation do not establish these device results. The complete real PTY suite also remains unverified.

## Navigation follow-up in v0.0.2

The primary Focus, Projects, Console, Reader, Live, and Plugins tabs now form a compact column of icons on the left. Each keeps its view name as a tooltip and accessible label. Up/Down and Home/End navigate the vertical tab list. Widget options sits at the bottom of the rail; each workspace keeps its own secondary tabs and sidebar. The standalone launcher retains its full-width layout.
