# Restart UI shell

The restart serves [ui/index.html](../ui/index.html) directly as native ES modules with relative imports. It has no framework, bundle step, import map or npm runtime dependency. The shell implements navigation, the command palette and widget lifetimes for [issue 76](https://github.com/OpenCoven/open-sesame/issues/76), following the new-shell and default-set decisions in issues 61 and 62. The old `dist/` application and its hosts are preserved for their separately owned cutover; the new shell loads none of their studio sidebar, Present mode, guide dialog or polish stylesheets.

## Metadata and loading

[manifest.js](../ui/manifest.js) contains immutable metadata: widget identity/name, default on/off, panel title, settings label and commands with palette labels/actions. It has no imports or executable paths. The palette reads this index before any widget is imported. [widget-loaders.js](../ui/widget-loaders.js) is a closed first-party map of literal relative dynamic imports and stylesheet paths; imported JSON cannot extend it. A future widget port changes its entry there and supplies `mount(context)`.

The defaults are Today, Projects, Focus, Shells and Agents. Only the selected last-used view is imported at startup; other on widgets are available without loading their code. Today/Projects/Focus, Agents and the optional provider surfaces explicitly report unavailable until their separately owned ports land. These placeholders do not implement those issues. The existing terminal UI is the first operational widget. JSON widgets are the second tier, interpreted by the application's own renderer.

[main.js](../ui/main.js) owns the palette, navigation and on/off switches. Commands for off widgets remain searchable and enable the selected widget when invoked. Saved JSON instance names also feed discovery without importing the JSON renderer or validator. Ctrl/Command+K opens the palette; arrows move through results, Enter invokes, Tab remains inside the open palette and Escape closes it and returns focus. No third-party interactive script tier is admitted.

## Lifetime and persistence

[lifecycle.js](../ui/lifecycle.js) passes each mount a private surface, dependencies and AbortSignal. `mount` returns an optional `command(action)` and asynchronous `dispose()`. Off aborts immediately, removes the surface and stylesheet and retires activity. If import or mount completes late, it cannot reattach a surface or run the old command. Re-enable waits for old cleanup. An imported module stays in the browser cache; off removes its owned activity rather than claiming to unload parsed JavaScript. Switching views retains enabled surfaces and existing terminals.

Preferences use `settings.all`, `settings.set`, `widgets.list` and `widgets.set`. The core's active/inactive wire values map to the two on/off UI states; legacy uninstalled values are read as off. No prototype storage is migrated. Unreadable preferences remain untouched and writes fail visibly. Host storage wiring is owned by issue 105: until that handler is available, the shell remains usable in memory and reports that persistence is unavailable. It never represents a failed write as saved.

The Shells widget owns its terminal UI/CSS. Only opening a terminal loads the reviewed xterm bundle; selecting Shells loads its CSS, including the vendored emulator CSS. Turning Shells off closes its panes through the existing terminal owner. The native terminal self-test remains development-only and invokes the same pane launcher after loading Shells; the host's release flag rule and the core PTY/origin/cleanup assertions are unchanged.

## Declarative JSON widgets

[definitions.js](../ui/definitions.js) preserves the existing [v1/v2 tool contract](tools.md#contract-and-connections); its pure implementation is checked byte-for-byte against `dist/tools-model.js`. The UI uses the single word widget. Unknown fields, script paths, arbitrary bridge methods, HTML fields and unsupported operations are rejected. Component content is constructed as DOM text and fixed controls, never interpreted as HTML or script.

Import reads at most 100 KB, shows sample content and requested access without dispatching an action, and requires an explicit install or replace button. Each instance has separate configuration and an on/off switch; export contains only the definition. Replacement retains compatible saved fields and a prior definition for rollback. Removal requires a second explicit action. Corrupt saved instances are preserved and cannot be overwritten through this UI.

Installed content never substitutes fixtures for live data. Note saves use `items.save` and keep input on failure; a retry after a lost reply reuses the client UUID. An in-flight save can already have committed when a widget is turned off: off prevents new actions and discards late UI results, and does not claim to roll back a host write. Provider-backed reads and external link opening report unavailable until their reviewed ports exist. The JSON renderer introduces no new native capability. Definitions are saved under the core setting `shell.jsonWidgets`; writes are serialised, teardown drains dispatched settings writes before remount, and metadata discovery does not execute their content. Unrelated instances keep their lifetimes when another instance changes. Failed removal restores a usable lifetime, and explicit null or malformed storage is preserved. Retry IDs belong to one action and payload, and a confirmed note commit retires its ID even if its former surface is gone.

## Compatibility and verification

The feature audit uses WebKitGTK 2.36 as the conservative baseline listed in [Tauri's webview reference](https://v2.tauri.app/reference/webview-versions/), rather than assuming current Safari. Runtime code uses native modules/dynamic import, optional chaining, Object.hasOwn, AbortController, ResizeObserver and File.text; the CSS uses basic grid/flex layouts, media queries and focus-visible, with no import maps, cascade layers, nesting or container queries. This is a feature audit, not a newly declared distribution policy or execution proof on that oldest engine. Linux packaging remains issue 65; every executed engine version must be recorded with its trace.

Run the dependency-free contract checks and the normal discovered checks:

```sh
node scripts/check-ui-shell.mjs
node scripts/check-ui-declarative.mjs
npm run check
npm run check:docs
npm run verify
```

The optional [browser harness](../scripts/fixtures/ui-shell-browser.mjs) starts and closes its own loopback-only server, denies external requests, and runs the authored shell with a synthetic host. It records actual module/CSS requests, startup resource/paint entries, off-widget discovery, repeated real-emulator teardown, JSON isolation, failed-save draft retention, delayed-result retirement, reload and keyboard/narrow-layout behavior. Install the pinned development dependencies with `npm ci`; browser executables are separate prerequisites. Run `node scripts/fixtures/ui-shell-browser.mjs build/ui-shell-browser`; `UI_SHELL_ENGINES=chromium` explicitly selects one engine instead of the default Chromium and WebKit. `UI_SHELL_HEADLESS=0` explicitly selects a windowed browser for renderer diagnosis; it does not change the assertions or deadlines. Use the repository watchdog when qualifying a fixture, since browser startup itself can stall.

The [adversarial recovery harness](../scripts/fixtures/ui-shell-recovery.mjs), run as `node scripts/fixtures/ui-shell-recovery.mjs build/ui-shell-recovery`, covers settings writes across remount, unrelated-instance cancellation, lost-reply note IDs, failed removal and corrupt-data preservation. The browser suite also blocks the first widget import and checks that later navigation still persists. These cases reproduce findings from the fresh review.

The shared [native renderer probe](../scripts/fixtures/ui-shell-probe.js) and [synthetic host](../scripts/fixtures/ui-shell-host.js) run the same assertions in [WKWebView](../scripts/fixtures/ui-shell-wk.swift), [WebKitGTK](../scripts/fixtures/ui-shell-gtk.py) and [WebView2](../scripts/fixtures/ui-shell-webview2.ps1). The GTK runner starts its own loopback server and takes an output JSON path; run it under an owned graphical session or explicitly labelled Xvfb container. The WK runner takes repository root, loopback URL and output path, using the [owned server](../scripts/fixtures/ui-shell-server.py). The WebView2 runner takes Root, Sdk, Out and optional Scratch, stages only the authored UI and the reviewed emulator in scratch, and uses an isolated profile plus a virtual host mapping; the SDK and all generated data stay outside source. These are native-renderer checks with synthetic bridge responses, not a launched Tauri app, real PTY, real account, physical-device or human acceptance. Report containers separately from desktop sessions. Hosted CI, merge, release and deployment remain separate gates.
