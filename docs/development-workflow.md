# Planning, evidence, and local retirement

## Inspect → claim → plan

Use the [current-state lookup](work-tracking.md#find-current-work), inspect Git state, and run `npm run project:inventory`. The report includes all linked worktrees, local branches and delivery proof, tracked/untracked/ignored data, generated candidates, owners, and relevant process IDs. It never returns process command arguments. `npm run project:check` reports unknown ownership, stale releases, conflicting owners, incomplete records, missing checkouts, and unavailable remote evidence. A warning is a reason to preserve the affected work, not to invent a claim or block unrelated implementation.

Use an isolated task branch/worktree. Claim from inside it; choose a unique task ID and your actual session owner. The mutable record lives at `<common Git directory>/open-sesame/tasks/<id>.json`, shared by all worktrees. Writes are atomic and mutations use a shared advisory lock. Expired time and process inactivity do not release ownership. External tools that mutate Git without this lock still require coordination; no filesystem lock can make arbitrary concurrent Git operations safe.

```sh
npm run project:task -- --id example-task --owner 'agent:session-id' --scope 'One bounded outcome' --acceptance 'Observable finish line' --next 'First executable action'
```

Keep scope, dependencies (empty when none), acceptance, branch/worktree, status, evidence, and next action in the task record and durable work ledger. Plan the shortest dependency-ordered path to acceptance. Append concrete evidence and update the next action at each checkpoint. Another session must receive an explicit handoff; the CLI will not overwrite an existing owner's claim. Reuse the existing task instead of opening duplicate work.

```sh
npm run project:task -- --id example-task --owner 'agent:session-id' --status active --next 'Next executable action' --evidence 'Exact command and receipt path'
```

## Implement → verify → review

The unified verifier and project commands require a Git checkout/worktree. A downloaded source ZIP intentionally has no Git metadata; extract with stored executable modes preserved, then use `npm run check:docs`, `npm run check` and build-only commands there. The Coven CLI fixture is executable in the source ZIP; an extractor that drops Unix modes can make discovery tests fail even when the archive is correct. Obtain a real owned checkout for task claims, source fingerprints and publication rather than fabricating shared records in an extracted package.

For navigation and documentation changes, start with `npm run check:docs`; it checks first-party local Markdown targets and anchors without external service calls, including in an extracted source package. The [repository map](repository-map.md#change-navigation) routes feature work to focused checks. Run `npm run verify` on Mac. The same entry point runs on Linux CI with `--portable`, which explicitly omits native compilation. Each stage records its command, timeout, exit, source state, elapsed time, and observed owned processes. The watchdog handles interruption and bounds checks without killing unrelated shells. It observes exit with `waitid(WNOWAIT)` and retains the check's unreaped root through cleanup, keeping its process-group identity available when a helper is reparented. Cleanup includes identity-checked descendants and members of their anchored process groups. An otherwise successful check fails if it leaves a helper requiring cleanup. Process inspection must succeed before a check starts. If inspection fails later, cleanup stops the check's own group only while its unreaped root still reserves that group; detached descendant status is reported as unknown, the receipt records the inspection failure, and the check cannot pass. Once the root is reaped, cleanup never signals its old numeric group. No claim is made for unobserved daemons that escape those groups; checks must retain ownership of their children.

The full Python suite exercises actual PTYs, project directories, controlling terminals, completion, resize, interrupts, connection validation, cleanup, and foreign-origin rejection. Fixture CLI responses remain fixtures. Source ZIPs are generated twice and compared byte-for-byte by digest. The final fingerprint checks source contents and modes, including existing dirty/untracked source, so verification cannot silently rewrite them. Logs and bundles remain ignored under `build/`; the source ZIP is ignored under `dist/downloads/`.

CI has Linux portable and Mac native-check/compilation jobs with finite job/stage limits and retained execution reports. The Mac scope also runs the delivered `scripts/check-native.sh` URL/geometry checks and `scripts/check-authentication.sh` synthetic authentication tests without a real sign-in. CI selects Xcode 26.3 on macos-15 to satisfy the delivered Swift SDK's Swift 6.2+ requirement; the report records the compiler version. The configured actions are pinned to official GitHub REST tag resolutions recorded November 6, 2026. A workflow file is configuration evidence until a hosted run executes. Mac native URL/compilation/signature/plist success does not establish application launch or the GUI shell/collapse/reopen/quit smoke pass in `desktop/README.md`.

Review the actual diff, runtime behavior relevant to the change, check output, source fingerprint, and unresolved acceptance criteria. Archive completed evidence into a dated document under `docs/archive/`; keep mutable machine-specific receipts in common Git storage. Update current docs rather than leaving contradictory support claims. A blocked acceptance criterion stays open even when all independent work is finished.

## Refresh remote evidence

`npm run project:refresh` reads every branch and open-PR page through `gh api --paginate --slurp` and writes `<common Git directory>/open-sesame/remote.json`. No GraphQL is used. If shell networking fails, use the connected GitHub REST tool for the same endpoints and write the following normalized operator-attested snapshot only after all pages have been read. Do not claim completeness from a first page or omit open PRs. Preserve the raw responses and observed time alongside the receipt. Pruning rejects snapshots older than five minutes, wrong repositories, missing fields, and a base that differs from the current remote head.

```json
{
  "repository": "OpenCoven/open-sesame",
  "source": "github-rest",
  "complete": true,
  "observedAt": "2026-11-06T00:00:00+00:00",
  "branches": {"main": "FULL_40_CHARACTER_SHA"},
  "openPulls": [{"number": 123, "headRef": "example-branch", "headSha": "FULL_40_CHARACTER_SHA"}]
}
```

These files are local operator evidence, not cryptographic GitHub attestations. Never edit one to bypass a failed read or fabricate a release. Remote failures preserve candidates; they do not authorize a stale cleanup. Use `--remote-evidence /absolute/snapshot.json` to select an explicitly captured snapshot.

## Retire

Only the existing owner may release a task, with `--status released --expected-head <full SHA>`. Release is immutable and bound to that exact head; further work needs a new task ID. A released task retains its scope and evidence. Before release, retain needed build logs and inspect generated files. Move valuable receipts into common Git storage, and remove only explicitly reviewed, owner-created disposable outputs. Unknown caches, build bundles, credentials, and ignored files are preserved. The pruning tool does not delete generated artifacts for you.

Run retirement from outside the target worktree. Both the branch and its checked-out worktree must be explicit. Omit `--worktree` only when the branch has no linked checkout. Primary/current/locked/missing, externally managed, active, dirty, untracked, and ignored-data worktrees are protected. Unknown ownership or worktree management blocks removal. Normal claims made by this tool are project-managed; work under `.codex/worktrees` and records explicitly marked external must use their owning lifecycle.

```sh
npm run project:prune -- --branch example-branch --expected-head FULL_SHA --worktree /absolute/task-worktree --dry-run
npm run project:prune -- --branch example-branch --expected-head FULL_SHA --worktree /absolute/task-worktree --apply
```

Application requires owner release, current remote evidence, no open PR, and delivered work. Delivery can be commit ancestry or an identical tree at a commit reachable from the base, allowing squash history and later main changes. Tree equivalence alone never releases ownership. Unique or uncertain work stays in place.

Before removal, the tool creates an archive ref and bundle, verifies the bundle, and writes a recovery receipt with a digest and quoted restore commands. It repeats all guards under the lock, removes a worktree without force, deletes only the expected local ref atomically, and records remaining branches/worktrees. State changes abort removal and preserve the archive. Partial failures retain recovery evidence; inspect them before retrying. Remote refs are never deleted. Restore instructions recover committed work; dirty and ignored data were required to be absent and are not silently archived.

## Interruptions and completion

Before stopping, checkpoint exact head/base, dirty source fingerprint, commands and receipts, original failures, current owners, cleanup dispositions, unmet criteria, and one next action. Leave a copyable continuation prompt in the shared task/receipt record and use [work-tracking.md](work-tracking.md) as the stable lookup. Completion requires evidence for every acceptance criterion; a host blocker must remain explicit. Do not turn unavailable GUI/device/provider/hosted evidence into a successful check.

## Pre-commit secret checks

Install Gitleaks (`brew install gitleaks` on Mac), then run `npm run hooks:install` in each working checkout. This installs the versioned pre-commit hook using worktree-local Git configuration and preserves existing custom hook paths. Run `npm run check:secrets` for the same explicit check before committing.

The hook checks all staged paths and private-key blocks in changed files, and scans the staged diff with Gitleaks default rules, including the staged versions of partially staged files. Unchanged historical findings are outside the staged-diff scan; it is not a repository history audit. Missing scanners, unresolved files and findings block the commit. Scanner configuration, ignore files and inline allow comments cannot disable this scan. Hook output never includes matching source snippets. Git hooks are local safeguards that can be bypassed; a passing scan reduces risk and does not prove that a file contains no secret. Install this hook in new clones before committing.

## Tool contributions and host changes

Use docs/tools.md as the contract and submission guide. Prefer a declarative package under `dist/tools/<slug>/` when the current components and approved operations can express the feature. A new provider, operation or component is a host change: update the shared validator, editor schema, renderer/adapter and focused regressions together. Package definitions cannot introduce native bridge methods, arbitrary requests, code or credentials. Keep actual account setup in the existing provider UI.

Validate every submitted tool.json through npm run tools -- validate and inspect fixture output through npm run tools -- preview. npm run check automatically discovers package definitions and runs model/UI regressions. Review the final definition, requested access, sample content, author/license and README; inspect rendered fixture previews when a GUI is available and record any unavailable rendered gate explicitly. For release/delivery, run the normal unified verifier and require hosted checks on the exact PR head. Run one verifier at a time per worktree: native stages share generated build inputs. Retain the first failure and source fingerprint before fixing or rerunning.

## Keeping agent guidance current

Update the [source/test map](repository-map.md), [documentation index](README.md) and the affected scoped AGENTS.md when moving an entrypoint, adding a subsystem, changing a command or altering a trust/data boundary. Prefer links to source and runnable checks over copied inventories or fixed test counts. Keep source navigation distinct from task status: current claims/receipts are shared Git state, and dated task narratives belong in the archive with their original failures intact. `npm run check:docs` is also discovered by `npm run check` and hosted verification. It checks inline/reference Markdown navigation and heading/source-line anchors, not external URL availability or runtime correctness.
