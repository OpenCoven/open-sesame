# macOS companion

The companion hosts the authored `dist/` UI in AppKit/WKWebView and starts the Python bridge over stdio. It requires macOS 13+, Xcode with Swift 6.2+, and an executable Python 3 installation. The build is ad hoc signed for local development; notarized distribution and other operating systems have separate acceptance requirements.

WorkOS login is required before the widget or its local host starts. The production OpenSesame project, native PKCE flow, Keychain storage, application URLs and remaining live verification are documented in [WorkOS login](../docs/workos-login.md). The local HTTP preview no longer exposes an unauthenticated WebSocket host. Building from source now also requires Swift 6.2 or newer; the pinned official Swift SDK builds offline from its verified source archive.

## Build and launch

```sh
bash desktop/build-macos.sh
codesign --verify --deep --strict --verbose=2 'build/Open Sesame.app'
plutil -lint 'build/Open Sesame.app/Contents/Info.plist'
open 'build/Open Sesame.app'
```

`npm run dev:macos` combines building and opening. Rebuild after changing Python installations, web assets, or helper modules. The native executable is `OpenSesame`; the historical bundle identifier stays stable for website data and permissions. Run `npm run verify` for the bounded automated baseline and retain its report. See the [current acceptance ledger](../docs/work-tracking.md) before interpreting earlier validation claims.

## Local shell smoke pass

1. Complete WorkOS sign-in in the system browser and return to the widget. Choose Console from the left activity rail, then Shells. Open Shell preferences with the sliders button, choose Connect project, and select an existing local folder.
2. Select the connected project and use Add new pane → Shell to open a local shell. Run `pwd`, print a distinctive marker, and confirm the actual project folder and returned output. Check resize, Tab completion, and Ctrl+C during a long-running command.
3. Collapse and reopen the widget. Confirm the existing pane and output remain usable.
4. Quit Open Sesame. Verify that the helper and shell processes started by this pass have exited. Use their recorded identities; do not terminate unrelated Python processes or shells.

The menu-bar control shows/hides the panel; its secondary menu provides Quit. M switches placement, E toggles expansion, and Escape closes contextual UI or collapses when not editing. Keep microphone, speech, account, and SSH checks separate from the local-shell smoke pass.

Local and SSH panes use real PTYs and the system shell/OpenSSH. Reload restores configuration without automatically executing commands. External embedded pages cannot call the allowlisted native bridge. Feeds and reader retrieval use bounded HTTP helpers; the browser has publisher CORS restrictions. Coven Familiars uses the installed CLI through the authenticated native host; fixture checks do not establish live-provider acceptance. Provider and device limits are listed in the [capability matrix](../docs/capabilities.md).

The loopback preview (`npm run dev`) serves sign-in and downloads; it does not expose a machine-operation WebSocket host. Use the authenticated native app for local tools. The hosted static site serves only `dist/` and has no shell endpoint. Optional message-controller setup remains in [controller-setup.md](controller-setup.md); live delivery is outside baseline verification.

## Coven Familiars

Open Console → Familiars and choose Connect Coven to discover the installed roster. Select a familiar, review its draft and Run with choice, then explicitly Send to start a provider turn. Discovery, selecting a familiar, and reopening saved history do not send messages. Stop preserves captured text; New chat preserves previous local history. Existing saved Coven panes redirect to the familiar picker.

See the [integration happy path](../docs/coven-familiars-integration.md) and [consumer example](../examples/coven_familiars.py) for setup and fixture verification. Provider sign-in stays in Coven. The reliability qualification uses isolated CLI fixtures and does not send to real familiars or qualify provider responses.

## Appearance

The widget uses an opaque charcoal surface with solid menus, cards, and controls. Opacity cycling, the Alt-hold/Space glass gesture, native vibrancy, animated edge glow, and view fades have been removed. The native surface and web palette use the same base color. Holding an empty background to speak remains available; keyboard controls and text editing keep their normal behavior. See the [four UI refinements](../docs/desktop-polish-plan.md#flat-dark-ui-polish) for navigation, readability, controls, and accessible activity feedback.

For screen-share privacy, open the eye-off control or Option–Shift–P in the focused widget, choose a display and explicitly Start protected share. In Google Meet, choose Present now → A window → **Open Sesame — Protected Share** and inspect Meet's preview before presenting. The native ScreenCaptureKit output excludes Open Sesame's process while its widget stays visible locally; it captures no audio and saves no recording. Close or stop the share window to end capture. Sharing your entire display can still include the widget, and someone physically viewing your monitor can still see it. See [Protected Share](../docs/protected-share.md) for the API boundary and acceptance steps.

## Geometry and floating windows

Settings offers **Small, Medium, Large, Max**. All four retain a **16:9** ratio, rounded to whole pixels. This landscape shape gives the navigation and content rails more room while preserving useful reading height. Sizes adapt to the selected simulated desktop; the native companion uses the real screen dimensions. Max targets **45% of screen area**, bounded by the screen edges. Small is 800 × 450 px on common laptop displays and scales down on constrained screens; the other presets interpolate to Max. At 1512 × 982, the presets are 800 × 450, 897 × 505, 993 × 559, and 1090 × 613 px. Medium is 22% wider and 8% shorter than the previous 4:3 shape. At 1280 × 800, the presets are 800 × 450, 835 × 470, 870 × 489, and 905 × 509 px. Full continues to use the display's own proportions.

The docked notch follows the display containing the pointer, including when collapsed or expanded. It moves the existing panel without activating another app or recreating sessions, and recalculates presets using the target display's logical dimensions. Movement pauses during mouse presses, resizing, file pickers and authentication dialogs; it resumes after the interaction ends. Detached windows stay where you place them. Menu and quick-search placement choose the pointer's display when opened. See [display-follow acceptance](../docs/notch-display-follow.md) for the synthetic checks and the separate physical multi-monitor pass.

The pop-out button detaches the existing Mac panel into a movable floating window. Its content keeps the same 16:9 ratio as the docked presets while you resize it, and its width is remembered across app launches. Restored bounds fit the current screen's usable area, including the title bar. It keeps the same web view and connections, stays above normal app windows, and supports other Spaces. Dock it with the same button or close control. Full fills the display; in a titled floating window it temporarily releases the ratio to maximize within the display's usable area, then restores the wide size and ratio. The native build compiles on macOS; GUI acceptance remains unverified because the computer-use service is unavailable.

Clicking outside the Mac widget collapses it back to the compact notch or menu position. A floating widget docks and collapses without taking focus back from the application you clicked. Its title-bar close button also returns it to the compact position. Pin open keeps automatic outside dismissal disabled; an explicit collapse gesture still works. Drag a docked resize edge inward well past Small, wait for Release to collapse, then release. Drag back or press Escape to cancel. Reopening restores the preferred expanded size, with drafts and running sessions retained. Native menus, file pickers, and dialogs are excluded from outside dismissal. These native mouse/focus paths compile but still need device acceptance.

Earlier detailed feature descriptions and environment-specific results are preserved in the [desktop README archive](../docs/archive/2026-11-06-desktop-readme.md).
