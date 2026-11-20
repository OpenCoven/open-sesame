# Open Sesame — mobile prototype

<!-- open-sesame:repository-note:start -->

## Status in this repository

Repository note for [issue #34](https://github.com/OpenCoven/open-sesame/issues/34), added on 12 November 2026 after the desktop restart. This reference is the visual source of truth for the mobile app in [epic #33](https://github.com/OpenCoven/open-sesame/issues/33) and a candidate visual reference for the new desktop shell ([#76](https://github.com/OpenCoven/open-sesame/issues/76), [#77](https://github.com/OpenCoven/open-sesame/issues/77)), pending decision [#61](https://github.com/OpenCoven/open-sesame/issues/61). Its demo storage and scripted familiars are not production contracts: the `opensesame.mobile.prototype.v1` localStorage, sample fixtures and Kitty/Cody/Nova replies define no persistence, identity, sign-in, permission or familiar-session behaviour. Everything outside this delimited note is the supplied v0.3 text, which [the repository check](../../scripts/check-mobile-reference.mjs) verifies against [upstream-files.json](upstream-files.json); it describes the design session, so see [the qualification guide](../../docs/mobile-reference.md) for current repository evidence.

<!-- open-sesame:repository-note:end -->

An interactive, self-contained mobile web prototype for Val. Version 0.3, refined 9 November 2026. This is a proposed mobile experience informed by the current OpenCoven/open-sesame repository, not a native mobile implementation or an approved architecture change.

## Open it

Open `dist/index.html` in a current browser. There are no build dependencies, network-loaded fonts, analytics, or model calls. A desktop browser displays a phone-sized workspace beside a short introduction; at phone widths the app fills the viewport. An iOS file preview may not execute JavaScript; a normal browser context or a separately authorized private hosting step is needed in that case.

For local serving from the project directory:

```sh
python3 -m http.server 4173 --directory dist
```

Then open `http://localhost:4173`. Browser storage belongs to that origin. Opening the HTML from another origin or as a file creates a separate storage context; local-file persistence varies by browser.

## The experience

| Destination | Working prototype behavior |
| --- | --- |
| Today | Quick capture; configurable focus, note, task, reading, and clock widgets; latest note; task completion; familiar entry |
| Projects | Notes/tasks/links; search; type and project filters; item detail; editing; confirmed deletion |
| Widgets | Add/remove five local widgets without deleting their content |
| Focus | 15/25/45-minute countdown; intention; pause/resume/reset; absolute-deadline recovery; session completion count |
| Console | Kitty/Cody/Nova sample roster; per-familiar local conversations; deterministic scripted responses; explicit disconnected companion state |
| Profile | Capability explanation; local JSON export; confirmed demo reset |

All sample project names, tasks, and familiar identities are demo fixtures. They are not live repository status, an authenticated roster, or identity-bound familiar sessions. The scripted focus response reads the prototype's sample local task list; no data is sent to a provider.

Data is namespaced to `opensesame.mobile.prototype.v1` in this browser's local storage. It is not encrypted by this app and is not synchronized to Coven, Open Sesame desktop, another tab, or another device. If storage is blocked, the app falls back to a session-only state. Clearing site data removes this prototype's state. Export before reset or deletion if you want to retain it. Multiple simultaneous tabs are not reconciled; use one app tab for stateful work.

## Visual decisions

The visual refinement uses embedded EB Garamond for expressive headings and italic accents, paired with Inter for controls, body text, and tabular timer numerals. Warm ivory text, a restrained lilac accent, and an opaque charcoal base keep the OpenCoven direction. A pale lavender note card is the main surface contrast; task lists and collections use fine rules, with less surrounding card chrome. Navigation uses a small active marker, and capture sheets follow the same spacing and typography.

Colors: base `#121214`, primary text `#f0ede7`, secondary text `#c1bdc7`, muted text `#a8a4af`, accent `#cbbfdb`. The palette is a proposed mobile interpretation of the source application's charcoal theme, not a production theme change. No canonical logo has been replaced.

Six font faces are bundled into the standalone HTML. No font requests occur when the prototype runs. The Latin/Latin-extended subsets fall back to system fonts for other scripts. Original source URLs and source SHA-256 values are recorded in `design/fonts/sources.json`; the font license files are included and embedded in the HTML. Both families use SIL Open Font License 1.1.

The editable design source is `design/luxe.css`. After changing that file or the bundled font metadata, run `npm run theme` to update the embedded theme in `dist/index.html`.

Today is a proposed mobile aggregation. The existing product names Projects, Widgets, Focus, and Console are retained. Live audio, shell controls, remote desktops, provider setup, and custom tool import are not imitated as working mobile features.

## OpenCoven identity refinement

Version 0.3 adds the canonical flat crown/lotus mark to the header, OpenCoven project, and Console navigation. It is vendored from `OpenCoven/brand` at immutable commit `798e2f5f2f1a69f5d156ccc0a9aafc4f7da55fc8`; the path and proportions are preserved. `design/brand/PROVENANCE.md` records source and SHA-256. No external asset request is needed.

A fine doorway motif connects the name Open Sesame to the home screen; the diamond detail appears on the focus dial and note card. Small violet selection marks and the desktop “AI that can stay.” signature establish family resemblance while retaining the earlier typography and spacing. Initial seals distinguish the three demo familiars. These are proposed UI treatments, not canonical familiar portraits or authentication/presence indicators. The disconnected and scripted-demo wording stays explicit. No storage, authority, identity binding, or execution behavior was changed.

## Source grounding

Read-only review of `OpenCoven/open-sesame` main at tree/commit SHA `924056cb0de80f6a3a241c931f729c4653febec3` informed this prototype. Relevant sources: `README.md`, `AGENTS.md`, `docs/capabilities.md`, `docs/repository-map.md`, `docs/desktop-polish-plan.md`, `dist/flat-theme.css`, and `dist/brand.css`.

The current repository describes a local widget workspace with an AppKit/WKWebView macOS host, WorkOS authentication, an installed Coven CLI familiar adapter, local data, and separate provider/device acceptance gates. It does not establish a qualified mobile host, account sync, or an authenticated phone-to-desktop transport. No repository source was changed, no branch/PR was created, and nothing was merged, released, or publicly deployed for this prototype.

## Implementation handoff

Keep production integration in the existing `OpenCoven/open-sesame` ownership boundary. Reuse the current item, widget, focus, and tool models where possible; this standalone HTML is an interaction specimen, not a second authoritative product database. A production UI should consume canonical clients and capabilities instead of inferring access from preview state.

Native iOS/Android work still needs a host choice, authentication design, secure storage, keyboard and background lifecycle handling, and real-device acceptance. Reuse canonical Coven identity and session binding, Threads authorization, Psyche orchestration semantics, and Coven daemon execution/state transitions. Do not create mobile-local permission authority or infer machine access from a logged-in UI. Any device pairing/transport design must be reviewed separately; the prototype deliberately offers no fake pairing success.

Prioritize capture, collections, focus, and clear disconnected capability states for the first mobile slice. Treat native share-sheet capture, optional local notifications, provider playback, cross-device synchronization, and familiar execution as separate follow-up work with explicit acceptance evidence.

## Verification

Run dependency-free checks with:

```sh
npm run check
```

The checks cover script syntax, rendering all five destinations, text escaping, safe link schemes and credential rejection, latest-note behavior, local-state restoration, absolute-deadline timer recovery, single completion, paused recovery, unavailable/malformed storage, unsafe stored links, and separate familiar histories. These are isolated JavaScript model/render checks with a minimal DOM stub, not browser or native-device tests.

Browser interaction and layout results are recorded in `VERIFICATION.md`. Real iPhone/Android hardware, native builds, mobile keyboards, screen readers, notifications, secure pairing, account login, and live model/provider behavior have not been qualified.
