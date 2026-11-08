# Open Sesame

Open Sesame is a local widget workspace with a macOS AppKit/WKWebView companion, a real Python PTY/SSH bridge, and a browser preview. It combines notes, tasks, bookmarks, focus, reading, media, and terminal panes. Some provider surfaces remain previews; see the [current capability matrix](docs/capabilities.md).

The Mac app now requires WorkOS login through the existing **OpenSesame** production project. Sign-in opens in the system browser; verified sessions stay in the macOS Keychain. See [login setup, saved application URLs and remaining live checks](docs/workos-login.md). The local HTTP preview shows the sign-in screen and downloads; machine operations are available through the authenticated native app.

The current widget uses an opaque, flat charcoal palette. Transparency gestures, native vibrancy, animated edges, and view fades have been removed. Navigation, text hierarchy, controls, and static activity feedback share the [four UI refinements](docs/desktop-polish-plan.md#flat-dark-ui-polish); historical glass descriptions are archived.

Plugin cards include setup and repair instructions. See [plugin setup and private configuration](docs/desktop-polish-plan.md#plugin-setup-and-private-configuration) for supported hosts, credential handling, and the remaining native OAuth work. Live answers render as sanitized Markdown inside a compact transcript workspace; see [Live content and Markdown preview](docs/widget-input-capture.md#live-content-and-markdown-preview).

## Coven Familiars

Connect local Coven in Console → Familiars, choose any familiar from its roster, and send a reviewed message. See the [integration happy path](docs/coven-familiars-integration.md) and [runnable example](examples/coven_familiars.py) for discovery, streaming, continuation, cancellation, and verification.

The authenticated native host uses the installed CLI; only an explicit Send starts a provider turn. Static hosted pages require a desktop connection. The local HTTP preview provides sign-in and downloads, with machine operations disabled. Baseline checks use deterministic CLI fixtures, so provider inference and native GUI acceptance remain separate.

## Development

Use Node.js, Python 3, and Git. Native compilation requires macOS 13+, Xcode with Swift 6.2+, and the verified vendored WorkOS SDK sources; the SDK builds offline. The bounded verifier requires Python 3.13+ on Mac for non-reaping process observation through [`os.waitid`](https://docs.python.org/3.13/library/os.html#os.waitid); this does not change the standalone app-build command. There are no npm or Python package dependencies for the core checks. Hygiene checks additionally use `lsof`. CI configures Node 22 and Python 3.13; local qualification records the versions actually executed.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Generate the source download and serve the loopback sign-in/download preview at `http://127.0.0.1:4173`. |
| `npm run dev:macos` | Build, sign for local development, and open `build/Open Sesame.app`. |
| `bash desktop/build-macos.sh` | Compile the Mac bundle without launching. |
| `npm run check` | Run widget/model checks and JavaScript syntax validation. |
| `npm run verify` | Run bounded widget, tooling, full Python, archive, native URL/authentication, and Mac build/signature/plist checks. |
| `npm run verify -- --portable` | Explicitly run the portable scope without Mac compilation. |
| `npm run build:desktop-source` | Generate the reproducible source ZIP in `dist/downloads/`. |
| `npm run project:inventory` | Report branches, worktrees, source state, generated candidates, processes, and owners. |
| `npm run project:check` | Explain ownership and evidence inconsistencies; no cleanup. |
| `npm run project:refresh` | Refresh all branch/open-PR pages through GitHub REST using `gh api`. |
| `npm run project:task -- --help` | Claim, checkpoint, or explicitly release a local task. |
| `npm run project:prune -- --help` | Plan guarded local retirement; dry run is the default. |

Verification stores logs and a JSON report under `build/verification/<UTC time>/`. A timeout or leaked owned process is a failure. The report records source fingerprints, tool versions, scope, exit codes, and process cleanup. Compilation and fixture results do not establish GUI, physical-device, live-provider, or hosted CI acceptance. The [work ledger](docs/work-tracking.md) records current evidence and blockers.

## Source and data boundaries

`dist/` contains authored application source and bundled libraries. Keep it in Git. `vendor-src/` and `dist/vendor/` retain upstream source, provenance, and licenses. Generated app bundles, verification logs, source downloads, Python caches, and Finder metadata are ignored. Task ownership, remote snapshots, and retirement receipts live under the shared Git directory, outside source packages. See [contributor instructions](AGENTS.md) and the [working protocol](docs/development-workflow.md).

The hosted static widget cannot open a visitor's local shell. The loopback development server serves sign-in and downloads; machine operations require the authenticated native app. Saved items and settings are device-local. Shell transcripts and SSH keys are not stored by Open Sesame. Application session credentials remain in the macOS Keychain as described in the login guide. Existing browser storage and the installed bundle identifier preserve rename compatibility.

See [desktop setup](desktop/README.md), the [priority roadmap](docs/desktop-polish-plan.md), and [historical validation snapshots](docs/archive/2026-11-06-prototype-readme.md).
