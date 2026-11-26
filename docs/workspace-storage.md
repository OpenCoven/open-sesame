# Canonical workspace storage and recovery

[Issue #37](https://github.com/OpenCoven/open-sesame/issues/37) introduces an asynchronous persistence boundary underneath existing item, project, widget, draft, Reader and Focus owners. It does not introduce a second item database, mobile identity, timer or permission system. The ratified #35 direction permits this local stage; a native iOS adapter and its device acceptance remain #38/#44 gates. The mutable approval and task records live in common-Git storage, not this source document.

## Hydration and canonical values

[workspace-bootstrap.js](../dist/workspace-bootstrap.js) hydrates a non-native browser workspace before executing modules that read defaults or migrate saved data. [index.html](../dist/index.html) retains their source order as inert script descriptors; the bootstrap loads them in that order after hydration and then runs registered ready callbacks. Script initialization failures show recovery instead of continuing with writable defaults. The authenticated macOS host retains its localStorage backend and existing receiver/authentication boundaries. The explicit iOS host selects the native adapter before canonical modules execute; see [iOS host implementation and remaining acceptance](../ios/README.md). Browser qualification does not establish native/device durability.

[workspace-storage-model.js](../dist/workspace-storage-model.js) stores the existing serialized values in a schema-versioned generation with revision, mutation ID and SHA-256 over the sorted key/value map. Canonical owners continue interpreting their values and IDs. The exact allowlist is exported as `OpenSesameWorkspaceStorageModel.allowed`: items/legacy notes, projects, settings/current project/view, built-in and imported widget state/configuration/page tabs, Reader, Focus agenda/calendar/session, capture/familiar text drafts, a default-recipient preference resolved only against the real roster, edit/task/tool drafts and workspace rail preferences. Unsupported keys cannot be read, written, removed or imported through this interface.

Initial hydration copies allowlisted `perch-` values only where the current `open-sesame-` key is absent, validates before committing, and never removes the original local/session storage. A malformed current value cannot silently fall back to a legacy value. Unknown store versions, checksum failure, duplicate item/project IDs, missing project references, invalid serialized types, invalid tool definitions and credential/authority fields require recovery. The existing tool validator also runs before hydration, preview and commit; package definitions remain data rather than new operations.

Stored values are bounded by the sixteen MiB envelope, a reserved export overhead allowance, per-string and structural limits. All schema failures leave the original generation untouched. The model validates data shape and checksums; it does not treat a digest, caller flag, imported preference or mutation ID as authentication or authority.

## Commit and writer contract

The backend has `read()` and `commit(expectedRevision, next, options)`. Read returns `current`, `previous` and optional `recovery` records. Commit must compare revision and expected content in the same atomic transaction that replaces the current generation and records its predecessor. It resolves only after the transaction commits, returning the exact acknowledged generation. Known aborts carry `committed: false`; a lost or mismatched acknowledgment is uncertain and blocks further writes until explicit reconciliation. No mutation is automatically replayed.

[The IndexedDB backend](../dist/workspace-indexeddb.js) implements this contract for browser qualification using one read/write transaction and requested strict durability. Concurrent scenes cannot overwrite a newer revision: one writer wins and the other receives a conflict. Per-owner operations are queued. Identical values do not manufacture new revisions, but an unchanged save still checks the persisted head. A revision-preserving content change is rejected as corruption. Browser transaction completion is browser evidence, not an installed mobile durability or power-loss qualification.

[app.js](../dist/app.js) and the affected canonical owners await persistence before Saved labels, success events, clearing submitted drafts or publishing new task/widget configuration. A later capture/task draft is not cleared by an earlier acknowledgment. Related project/item and Reader/item mutations use the same generation transaction. Existing rollback and note-navigation vetoes remain in force. [window.js](../dist/window.js) awaits note completion when preparing a handoff; in-memory window snapshots remain distinct from persisted recovery.

Multiple browser views use revision-aware conflict rejection rather than silent last-writer-wins merging. Preserve open drafts and reload/reconcile the committed workspace before retrying a stale or uncertain write. The initial native host should use one writable scene or the same atomic revision contract; simultaneous iPad editing cannot be enabled merely because two WKWebViews share an origin.

## Draft and Focus recovery

[Capture](../dist/capture.js), [workspace-drafts.js](../dist/workspace-drafts.js) and existing Task Manager/tool/Familiar owners checkpoint unsent local text. Recovery reopens edits through the existing editors and matches existing item/instance IDs; it cannot fabricate a roster, account, conversation binding or execution session. Failed storage retains open text and provides an explicit open-draft recovery export. A quota failure cannot promise that unacknowledged text survived process death.

The canonical Focus globals remain the only timer. A versioned snapshot retains its ID, duration/topics, deadline, running/paused state and completion IDs. Start/pause and completion acknowledge persistence; restart recomputes against the deadline and records completion once. The same controls and interval remain responsible for display; there is no background timer service. Clock-change semantics, native suspension and actual device lifecycle remain part of #41/#38/#44 qualification.

## Export, import and rollback

In a non-native workspace, open Widgets → Workspace data. Export saved workspace JSON downloads acknowledged data; Export open drafts for recovery separately retains visible unsaved text. Application credential stores, OAuth callbacks, pairing/grants, native session material, prototype demo state and machine-host preferences are outside the allowlist. User-authored notes/drafts can contain sensitive text the user entered; exports are ordinary local files, not an encrypted backup service.

Import requires an explicit file selection and preview, then explicit Replace. The parser checks format/version, byte and structure limits, canonical value validation and current revision. A change after preview rejects the replacement. Replace is the supported conflict policy; no implicit merge, demo migration or identity admission occurs. After commit the old page owner is retired inside the operation, preventing queued old-model writes from overwriting the replacement. Reload is explicit and required before editing the imported workspace.

Normal commits retain one predecessor. Restore previous generation is explicit and revision-bound. If the current generation is damaged, bootstrap does not launch the feature modules: export a content-free recovery report or explicitly restore a valid previous generation. Recovery reports contain section names/sizes and generation metadata, not raw credential or user-content values. Damaged data stays in the separate recovery slot rather than being overwritten by defaults. Invalid metadata without a usable predecessor requires manual recovery; no reset/delete fallback is offered. These bounded generations are recovery aids, not unlimited history or cross-device sync.

## Proposed native backend policy for #38 review

The [iOS candidate](../ios/README.md) implements this policy locally; installed-device protection/backup acceptance remains open. The reviewed design is one SQLite database in Application Support with current/previous/recovery generations and a transaction that compares the expected revision/content before replacement. Configure and verify WAL plus `synchronous=FULL` rather than assume defaults; [SQLite's durability documentation](https://www.sqlite.org/pragma.html#pragma_synchronous) explains why WAL/NORMAL and WAL/FULL have different power-loss guarantees. The native receiver must validate bounded data and bind the exact owned main frame/session; it cannot expose arbitrary SQL, file paths or a generic RPC proxy.

Propose complete file protection for workspace database/supporting files, matching this local foreground-only milestone. Apple's [complete protection](https://developer.apple.com/documentation/foundation/fileprotectiontype/complete) makes file access unavailable while the device is locked or booting, so native writes denied by protection must preserve drafts and surface their actual status. Persist acknowledged edits before suspension; do not depend on one background callback. The #38 owner must review the database/journal protection behavior and locked-device recovery on actual hardware before implementing/qualifying this choice.

Propose including committed user workspace data in the operating system's normal app-data backup policy while excluding regenerable caches and temporary exports. Apple's [backup-exclusion property](https://developer.apple.com/documentation/foundation/urlresourcevalues/isexcludedfrombackup) is intended for resources not needed in backup. Keep credentials in their separately reviewed native secure store and preserve workspace data on logout. Consistent SQLite backup/restore, entitlement/container placement, Keychain accessibility and native file export/share/import remain explicit #38 review and device gates. This policy introduces no account sync, provider service, production callback registration or release authority.

## Verification and limits

Run `node scripts/check-workspace-storage.mjs` for migration, malformed/future state, delayed/uncertain acknowledgments, quota, stale writers, checksums, explicit bounded import, credential exclusion and rollback. It is discovered by `npm run check`. Existing canonical-owner checks retain their assertions and now await asynchronous command completion.

With the pinned development dependencies and Playwright Chromium/WebKit installed, run:

```sh
npm run test:workspace:browser
npm run test:workspace:application
```

The [transaction fixture](../scripts/fixtures/workspace-storage-browser.mjs) owns a loopback server and isolated contexts, races two real IndexedDB scenes, restarts the page and compares downloaded Unicode JSON bytes through import. The [application fixture](../scripts/fixtures/workspace-application-browser.mjs) runs actual authored owners and controls, checking hydration/IDs, delayed save and newer draft preservation, quota rollback/manual retry, Focus running/paused restart and single completion, Task Manager draft recovery and file round-trip, narrow data dialogs, corruption recovery and floating-owner reconciliation through the canonical task owner. Launcher controls in a floating frame were not qualified by that owner-level test. These use fixture data only; no account, native host, provider, capture or real user history is involved. Set `SESAME_STORAGE_OUTPUT` for a retained per-run receipt directory.

Run `npm run verify` on Mac and `npm run verify -- --portable` for the explicit portable scope, retaining original failures and source fingerprints. Local model/browser evidence, hosted CI, native compilation, simulator, installed iPhone/iPad lifecycle/accessibility/file round-trip and live providers are separate. #37 remains open until its full device criteria pass on #38's host; interface readiness is not issue completion.
