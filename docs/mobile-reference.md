# Mobile v0.3 design reference

[Issue #34](https://github.com/OpenCoven/open-sesame/issues/34) preserves the exact approved interaction specimen under [examples/mobile-reference](../examples/mobile-reference/README.md). It is a self-contained demo, separate from the production authored `dist/`, native resources and public login handoff. [The mobile epic](https://github.com/OpenCoven/open-sesame/issues/33) and [host decision](https://github.com/OpenCoven/open-sesame/issues/35) retain their own implementation, ratification and device gates. After [the desktop restart](https://github.com/OpenCoven/open-sesame/issues/58) it is the visual source of truth for the mobile app and a candidate visual reference for the new desktop shell ([#76](https://github.com/OpenCoven/open-sesame/issues/76), [#77](https://github.com/OpenCoven/open-sesame/issues/77)), pending [decision #61](https://github.com/OpenCoven/open-sesame/issues/61); neither use makes its demo storage or scripted familiars a production contract.

## Source and reproduction

The supplied standalone HTML and the source ZIP's [dist/index.html](../examples/mobile-reference/dist/index.html) are identical: SHA-256 `f9fbd88673b3cdfc754540ad864fd58c34b47498bbae95c8e5d0555fb7de281a`. The ZIP digest is `5d4fc2401534ddf2350edc529c874bc26bdcaa695c1c66e3509fb38fe7d60274`. [The preservation manifest](../examples/mobile-reference/upstream-files.json) records all eighteen imported files, including the original README, verification narrative, scripts, CSS, fonts and licenses. Seventeen are stored without edits. The README additionally carries one delimited repository note, between `open-sesame:repository-note` comment markers, that records the status above; the wrapper removes exactly that block and requires the remaining bytes to equal the supplied README. Other repository integration lives in the wrapper, browser fixture and this guide.

Run these commands from the repository root:

```sh
npm run check:mobile-reference
npm run check:docs
```

[The wrapper](../scripts/check-mobile-reference.mjs), also discovered by `npm run check`, checks the imported file hashes and the README note's required statements, runs all twelve original model/render checks and rebuilds the theme twice in a disposable temporary copy. Both rebuilds must equal the delivered HTML byte-for-byte. Qualification never rewrites the checked-in reference. A deliberate future design revision needs its own approved artifact and an explicitly reviewed provenance/manifest update.

For a local browser preview, serve only the reference directory on loopback:

```sh
python3 -m http.server 4197 --bind 127.0.0.1 --directory examples/mobile-reference/dist
```

Open `http://127.0.0.1:4197/`. The HTML also works offline as a standalone file; persistence for `file:` URLs varies by browser. Use one isolated demo origin/tab, since simultaneous tabs are not reconciled. Do not copy prototype localStorage into production data or authenticated session state.

## Visual contract and provenance

[Editable luxe.css](../examples/mobile-reference/design/luxe.css) supplies opaque charcoal surfaces, warm ivory text and lilac accents. EB Garamond provides display headings and italic details; Inter supplies controls, body text and timer numerals. Base colors are `#121214`, `#f0ede7`, `#c1bdc7`, `#a8a4af` and `#cbbfdb`. The CSS is the source of truth for spacing, compact-height adjustments, rules and restrained card treatment; the reference README explains the product choices.

The doorway beside the Today heading, diamond details on the note card and focus dial, violet selection markers, and distinct initial seals remain part of the approved reference. Initial seals represent demo presentation only. They do not establish familiar identity, presence, connection or authorization. Keyboard focus uses a two-pixel outline; the identity layer uses `#C9A7FF`. Decorative transitions are enabled only when reduced motion is not requested.

[Brand provenance](../examples/mobile-reference/design/brand/PROVENANCE.md) pins the crown/lotus to `OpenCoven/brand` commit `798e2f5f2f1a69f5d156ccc0a9aafc4f7da55fc8`, path `web/assets/mark.svg`, SHA-256 `3cc1d06c3f957221760984937715f6cde38ac9f69cfa1eb18041c4cbd935c078`. The vendored SVG preserves its path, transform and square `0 0 212 212` viewBox; the theme builder embeds that geometry without distortion. Brand rights and the prototype's design exception are retained in the provenance document.

All six WOFF faces and both SIL Open Font License 1.1 texts are bundled and embedded in the standalone HTML. [Font metadata](../examples/mobile-reference/design/fonts/sources.json) records upstream TTF URLs and source hashes; those source hashes describe the upstream TTFs, not the bundled WOFF representations. The preservation manifest separately pins the actual WOFF bytes. Running or rebuilding the reference needs no font downloads or provider calls.

## Behavior and evidence boundaries

Today capture, Projects search/edit/task controls, Widgets visibility, Focus deadline recovery and per-familiar scripted Console histories remain inspectable. Prototype state uses `opensesame.mobile.prototype.v1`, with session-only fallback when storage is unavailable. It is neither the production persistence contract nor an identity/session authority. The supplied [README](../examples/mobile-reference/README.md) details host, storage, synchronization and security limitations; the original [verification report](../examples/mobile-reference/VERIFICATION.md) is historical evidence from the design session.

The optional [browser fixture](../scripts/fixtures/mobile-reference-browser.mjs) runs the actual preserved HTML in Chromium and WebKit at 320×640 and 390×844. It owns a temporary loopback server and isolated contexts, blocks other requests, checks all five destinations, captures screenshots, and exercises capture/search/edit/reload, task completion/restore, widget add/remove, timer recovery/single completion, separate scripted histories, modal keyboard traversal, visible focus, reduced motion and exported JSON bytes. A separate offline context loads the standalone file and checks its six loaded font faces without HTTP requests. Browser-generated tab cycling may briefly focus the document body; the fixture rejects focus on background controls while a modal is open.

```sh
npm ci --ignore-scripts
npx playwright install chromium webkit
npm run test:mobile-reference:browser
```

Browser artifacts default to ignored `build/mobile-reference-browser/`; set `SESAME_REFERENCE_OUTPUT` to retain a separate run. The original design report's export download observation timed out, so it remains a historical limitation. The repository fixture independently observes download completion and compares parsed JSON with actual saved demo state; it does not claim an import feature or cross-device round-trip.

Run `npm run verify` for the required Mac regression scope, or `npm run verify -- --portable` only for explicitly portable qualification. Local checks, browser rendering, native compilation, hosted CI, installed-device behavior, live providers, merge and release remain separate evidence classes. The reference cannot establish iOS/Android support, VoiceOver/TalkBack acceptance, real mobile keyboard behavior, WorkOS login, connected familiar sessions or transport authorization.

## Handoff to mobile implementation

Use this reference as a presentation and interaction specimen for the host decision in #35, the mobile views in [#39](https://github.com/OpenCoven/open-sesame/issues/39) and, only if #61 adopts it, the desktop views in #77. Reuse the existing canonical application models, widget lifecycle, focus owner and Coven clients when implementing production behavior. Do not add a second authoritative database, import demo fixtures as real identities, or infer protected authority from a responsive page. Task ownership, exact source fingerprints, current acceptance audits and machine-specific receipts belong in the common-Git task register, following [the development workflow](development-workflow.md).
