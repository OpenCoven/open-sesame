# Open Sesame

Open Sesame is a local widget workspace with a macOS AppKit/WKWebView companion, a real Python PTY/SSH bridge, and a browser preview. It combines notes, tasks, bookmarks, focus, reading, media, and terminal panes. Some provider surfaces remain previews; see the [current capability matrix](docs/capabilities.md).

## Try Open Sesame

Start with the **[Mac build and launch guide](desktop/README.md#build-and-launch)**, then connect a local project or a Coven familiar. See [what is implemented and what still needs acceptance](docs/capabilities.md) before choosing an integration.

### Platform availability

| Surface | Available path | Important limit |
| --- | --- | --- |
| macOS native app | Build from source with the [desktop guide](desktop/README.md) | macOS 13+, Xcode/Swift 6.2+, Python and build prerequisites below; local development signing is not notarized distribution |
| Windows / Linux | Portable source checks and browser surfaces | No qualified packaged desktop host; passing portable tests does not establish local terminal, SSH or native app support |
| Local HTTP preview | `npm run dev`, then `http://127.0.0.1:4173` | Sign-in/download preview, not a machine-operation host |
| iOS / iPadOS / Android | [Mobile design direction](docs/mobile/adr-001-mobile-host.md) | Not implemented or qualified in the current baseline |

### First useful session on a Mac

1. Clone this repository and review the [development prerequisites](#development), including the native build requirements in the [desktop guide](desktop/README.md).
2. Run `npm run dev:macos` from the repository to build and open the locally signed app.
3. Complete WorkOS sign-in in your system browser and return to Open Sesame. See [login setup and remaining live checks](docs/workos-login.md) if sign-in does not complete.
4. Open **Console → Shells**, then **Shell preferences → Connect project** and choose a local folder. Select the project and **Add new pane → Shell**. Run `pwd` to confirm the shell is in the intended folder.
5. For an agent conversation, use **Console → Familiars → Connect Coven** with an installed, configured Coven CLI. Select a familiar, review the draft and Run with choice, then explicitly **Send**. See the [Coven integration guide](docs/coven-familiars-integration.md).

The shell step runs on your computer, not in a hosted sandbox. Provider sign-in and costs are separate; previews and fixture checks do not prove a real provider connection. For lifecycle validation, follow the [local shell smoke pass](desktop/README.md#local-shell-smoke-pass).

## Product details

The Mac app now requires WorkOS login through the existing **OpenSesame** production project. Sign-in opens in the system browser; verified sessions stay in the macOS Keychain. See [login setup, saved application URLs and remaining live checks](docs/workos-login.md). The local HTTP preview shows the sign-in screen and downloads; machine operations are available through the authenticated native app.

The current widget uses an opaque, flat charcoal palette. Transparency gestures, native vibrancy, animated edges, and view fades have been removed. Navigation, text hierarchy, controls, and static activity feedback share the [four UI refinements](docs/desktop-polish-plan.md#flat-dark-ui-polish); historical glass descriptions are archived.

Plugin cards include setup and repair instructions. See [plugin setup and private configuration](docs/desktop-polish-plan.md#plugin-setup-and-private-configuration) for supported hosts, credential handling, and the account/provider acceptance boundaries. Live answers render as sanitized Markdown inside a compact transcript workspace; see [Live content and Markdown preview](docs/widget-input-capture.md#live-content-and-markdown-preview).

## Start here

| Need | Read |
| --- | --- |
| Contribute a change | [Development workflow](docs/development-workflow.md), [agent instructions](AGENTS.md) |
| Agent instructions and source/test navigation | [AGENTS.md](AGENTS.md), [repository map](docs/repository-map.md), [documentation index](docs/README.md) |
| Find an active task or resume safely | [Current-state lookup](docs/work-tracking.md#find-current-work), [development workflow](docs/development-workflow.md) |
| Understand what is implemented versus accepted | [Capability matrix](docs/capabilities.md) |
| Add or generate a reusable tool | [Tool authoring and submissions](docs/tools.md) |
| Build or inspect the Mac host | [Desktop guide](desktop/README.md), [scoped host instructions](desktop/AGENTS.md) |
| Inspect UI without accounts, models or capture | [Isolated fixture guidance](scripts/AGENTS.md) |

## Coven Familiars

Connect local Coven in Console → Familiars, choose any familiar from its roster, and send a reviewed message. See the [integration happy path](docs/coven-familiars-integration.md) and [runnable example](examples/coven_familiars.py) for discovery, streaming, continuation, cancellation, and verification.

The authenticated native host uses the installed CLI; only an explicit Send starts a provider turn. Static hosted pages require a desktop connection. The local HTTP preview provides sign-in and downloads, with machine operations disabled. Baseline checks use deterministic CLI fixtures, so provider inference and native GUI acceptance remain separate.

## Development

Use Node.js 22 (matching CI), Python 3, and Git. GitHub CLI (`gh`) is needed for REST remote refresh and delivery, not for offline core checks. Native compilation requires macOS 13+, Xcode with Swift 6.2+, and the verified vendored WorkOS SDK sources; the SDK builds offline. The bounded verifier requires Python 3.13+ on Mac for non-reaping process observation through [`os.waitid`](https://docs.python.org/3.13/library/os.html#os.waitid); this does not change the standalone app-build command. There are no npm or Python package dependencies for the core checks. Optional VNC browser fixtures use the lockfile-pinned Playwright/ws development dependencies and a browser installation; see [VNC checks](docs/vnc-desktops.md#checks). Hygiene checks additionally use `lsof`. CI configures Node 22 and Python 3.13; local qualification records the versions actually executed.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Generate the source download and serve the loopback sign-in/download preview at `http://127.0.0.1:4173`. |
| `npm run dev:macos` | Build, sign for local development, and open `build/Open Sesame.app`. |
| `bash desktop/build-macos.sh` | Compile the Mac bundle without launching. |
| `npm run hooks:install` | Install versioned pre-commit secret checks for this worktree after checking prerequisites/custom hooks. |
| `npm run check:secrets` | Check staged content for secrets, literal network addresses, internal hosts, and machine-specific home paths. |
| `npm run test:vnc:browser` | Run the optional synthetic framebuffer probe after installing its separate prerequisites. |
| `npm run check:docs` | Validate first-party Markdown links, source paths and heading anchors without network access. |
| `npm run tools -- create my-tool` | Scaffold a declarative tool package; validate it with `npm run tools -- validate my-tool`. |
| `npm run check` | Run widget/model checks and JavaScript syntax validation. |
| `npm run verify` | Run bounded widget, tooling, full Python, archive, native URL/authentication/Screen notes, and Mac build/signature/plist/icon checks. |
| `npm run verify -- --portable` | Explicitly run the portable scope without Mac compilation. |
| `npm run build:desktop-source` | Generate the reproducible source ZIP in `dist/downloads/`. |
| `npm run project:inventory` | Report branches, worktrees, source state, generated candidates, processes, and owners. |
| `npm run project:check` | Explain ownership and evidence inconsistencies; no cleanup. |
| `npm run project:refresh` | Refresh all branch/open-PR pages through GitHub REST using `gh api`. |
| `npm run project:task -- --help` | Claim, checkpoint, or explicitly release a local task. |
| `npm run project:prune -- --help` | Plan guarded local retirement; dry run is the default. |

Before committing in a Git checkout, follow [pre-commit setup](docs/development-workflow.md#pre-commit-secret-checks); the hook uses Gitleaks and preserves existing custom hook paths.

Verification stores logs and a JSON report under `build/verification/<UTC time>/`. A timeout or leaked owned process is a failure. The report records source fingerprints, tool versions, scope, exit codes, and process cleanup. Compilation and fixture results do not establish GUI, physical-device, live-provider, or hosted CI acceptance. Find current owners and evidence through the [live-state lookup](docs/work-tracking.md#find-current-work); dated task narratives remain in the archive.

## Source and data boundaries

`dist/` contains authored application source and bundled libraries. Keep it in Git. `vendor-src/` and `dist/vendor/` retain upstream source, provenance, and licenses. Generated app bundles, verification logs, source downloads, Python caches, and Finder metadata are ignored. Task ownership, remote snapshots, and retirement receipts live under the shared Git directory, outside source packages. See [contributor instructions](AGENTS.md) and the [working protocol](docs/development-workflow.md).

The hosted static widget cannot open a visitor's local shell. The loopback development server serves sign-in and downloads; machine operations require the authenticated native app. Saved items and settings are device-local. Shell transcripts and SSH keys are not stored by Open Sesame. Application session credentials remain in the macOS Keychain as described in the login guide. Existing browser storage and the installed bundle identifier preserve rename compatibility.

See [desktop setup](desktop/README.md), the [priority roadmap](docs/desktop-polish-plan.md), and [historical validation snapshots](docs/archive/2026-11-06-prototype-readme.md).

Reusable tools use schemaVersion 2 with a declared page and appear as tabs beside the existing page tools. Import and preview them through Widgets → Tools or `/tools`; legacy v1 definitions remain compatible under Widgets. See [tool creation and submissions](docs/tools.md) and the [agent navigation map](docs/repository-map.md) for starter packages, the JSON contract, generation prompt and review workflow.
