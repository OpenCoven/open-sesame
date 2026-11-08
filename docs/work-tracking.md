# Development work and handoff

## Current task: reliable-development

- Owner/session: `codex:01a1b24d-21e5-7f51-a48f-e3885980f516`.
- Branch/worktree: `task/reliable-development`, `/Users/buns/Documents/GitHub/OpenCoven/open-sesame-reliable-development`.
- Original base: `ba07bb5f055c2d9292ab7fe30f059f549e2feae7`; tree `ee08cd7fc1176aba9f8fb007812f1f6e1c102066`. Earlier qualified bases remain in dated reports and refresh receipts. The current rebase base is `main` at `f46f7c2fffa586ff45c55a6db3217ee9cea4d8a6`, including the delivered login and flat UI changes. Exact task heads and fingerprints are indexed in the mutable task/audit records.
- Scope: reproducible verification, demonstrated PTY failures, native build/runtime qualification, local planning/ownership, and guarded local retirement.
- Dependencies: local Python/Node/Git, macOS and Xcode with Swift 6.2+ for native qualification; native GUI acceptance depends on a usable authenticated macOS user session. The user authorized committing, pushing and creating this PR on November 8; merge, release, deployment and remote deletion remain outside scope.
- Acceptance: widget and full Python checks execute with bounded failures; source archive is reproducible; Mac compilation/signature/plist are checked; GUI shell/collapse/reopen/quit is observed or explicitly remains unaccepted; hygiene guards are exercised in disposable repositories; every existing cleanup candidate has a recorded disposition.
- Status: rebased review candidate; watchdog and PTY close repairs are recorded below. Automated qualification and publication identity are indexed in mutable task/audit records. Native GUI acceptance remains unaccepted, so the original reliability goal is incomplete.
- Plan: reproduce the PTY stall first; implement the shared verification runner; implement and test minimal ownership/inventory/retirement tools; qualify Mac runtime and reconcile documentation; audit every acceptance criterion and leave a PR-ready diff.
- Next action: qualify the rebased baseline and publish the requested PR, with exact delivery status in the common-Git task record. Once delivered for review, use a working macOS session to perform authenticated local-shell, collapse/reopen, and quit/cleanup acceptance.

## Initial evidence, November 6, 2026

The original checkout is clean on `main`. GitHub REST confirms PR #1 was merged, no open issues or PRs, and no check runs or commit statuses exist for the base SHA. Local and remote feature commits differ but have the same source tree as main. The original checkout contains ignored build bundles, a source download, Python caches, and Finder metadata. No ownership release exists for these artifacts or the feature branch, so they are preserved pending an explicit disposition. Existing Python processes belong to other sessions and must not be stopped.

## Implementation and failure history

The original full suite stopped in `Session.close()` until a 40-second watchdog killed its owned tree. Faulthandler showed the reader blocked in `os.read` and the main thread blocked in `os.close(master)`. The original log is `<common Git directory>/open-sesame/receipts/baseline-python.log`. The initial repair moved termination ahead of descriptor closure; resumed stress later exposed a second dependency, where a killed child could not finish terminal exit until the master closed. The final repair uses nonblocking I/O serialized against descriptor closure, allowing master closure before bounded termination/reaping. Simultaneous close callers remain serialized, and an unreaped direct child remains safe to signal when its group is not yet present or is already exiting.

Once the deadlock was removed, three existing tests exposed macOS `/var` versus `/private/var` expectations. Fixtures now compare canonical project paths without dropping shell/TTY assertions. An intermediate 35-test run passed; the first unified run then exposed immediate-close group-startup timing. Its failed result is preserved in `build/verification/20261106T210806Z/report.json`. The follow-up regression explicitly exercises 20 immediate closes, concurrent close callers, a pending PTY read, interruption, timeout cleanup, and preservation of an unrelated process. All 18 tooling/guard tests passed after this repair. Final unified results supersede these intermediate observations without deleting them.

The implementation adds bounded verification, Linux/Mac CI configuration, shared local ownership, current REST snapshots, inventory and actionable checks, dry-run-first retirement, verified recovery bundles, and postcondition receipts. Destructive fixtures cover missing/stale ownership, moved heads, dirty/untracked/ignored data, active/locked/symlink/external worktrees, stale/wrong remote state, open PRs, unique work, tree-equivalent squash history, restoration, and changes during archival. The README and desktop setup now point to one current capability matrix; earlier detailed reports are archived with their original claims clearly dated.

Unified run `build/verification/20261106T211150Z/report.json` passed every stage: all 20 widget checks and syntax checks, 18 tooling tests, all 35 Python tests, two equal source archives, Mac compilation/signature/plist, and unchanged source fingerprint. A final CLI claim/checkpoint/exact-head-release regression and timezone validation were then added; the final source report and fingerprint are indexed in `<common Git directory>/open-sesame/receipts/final-audit.json` and the task's evidence list. These machine-specific reports remain outside committed source.

## Resumed watchdog audit

After the user's resume request, a new probe demonstrated that an immediately exiting check could leave a sleeping helper behind while the watchdog reported success. The parent PID was reaped before a later ownership scan could connect the helper, which had been reparented to PID 1. The original false-success receipt is preserved in `build/verification/resumed-orphan-probe/evidence.json`; only that probe's explicitly identified helper was cleaned up.

The watchdog now observes exit without reaping using `waitid(WNOWAIT)`, retains the root PID until cleanup finishes, and discovers members of process groups anchored by an identity-checked owned process. This preserves group attribution across reparenting without matching command text or signalling unrelated groups. Any helper requiring cleanup makes the check fail, even when the check itself exited zero. A behavioral regression verifies this normal-exit case, helper retirement, and the failing result; earlier timeout and unrelated-process preservation checks remain intact. Recorded process identities now accompany PID lists. The new source requires a fresh unified verification receipt; earlier green reports remain historical evidence.

Resumed run `build/verification/20261106T214021Z/report.json` passed all stages with 20 tooling regressions, all 35 Python tests, widget/syntax checks, reproducible archives, Mac compilation/signature/plist, and unchanged source during execution. The verifier's macOS Python 3.13 prerequisite is now explicit, and an unavailable non-reaping wait API fails before starting a check. The final report for the complete source is indexed by the mutable task/audit records alongside the superseded reports and original false-success receipt.

## Resumed PTY close audit

Subsequent unified run `build/verification/20261106T214251Z/report.json` failed the original real-bridge connection/cleanup test. Dedicated lifecycle stress reproduced it on iterations 4 and 13 without retrying a failed iteration or widening any deadline. Instrumentation showed successful HUP, TERM, and KILL calls while `waitpid(WNOHANG)` still returned zero. The child remained in the OS's exiting state before master closure and became reapable immediately after it closed. The trace and original failing runs remain under `build/verification/pty-startup-diagnosis/`.

PTY reads and writes now use nonblocking descriptors with readiness waits, and individual I/O calls share a lock with closure and resize. Shutdown can close the master first without the original blocking-read deadlock, allowing terminal exit to complete before reaping. Large writes handle partial progress and backpressure; closing a pane interrupts a pending write. All 30 diagnostic lifecycle iterations passed after this repair. Behavioral regressions cover 20 real bridge closes with an active reader, exact byte preservation for a 64 KiB binary payload, and concurrent close during backpressured input. The final unified result for this complete source is indexed by the task/audit records; earlier passing runs do not erase either demonstrated failure.

## Delivered-base refresh

While this task was running, another session delivered PR #3's keyboard, native-preview, and Live-capture changes to `main`. The earlier qualified local patch and overlapping roadmap were backed up under `<common Git directory>/open-sesame/receipts/pre-main-refresh/`. Only the owned task branch advanced; the primary checkout and other branches were not edited. The newer roadmap note was retained, and the current verifier also executes the delivered native URL tests. Device acceptance for those features remains separate in `widget-input-capture.md`. The latest report must identify the new base; earlier reports on `c3f7415` do not qualify it.

PR #4 subsequently moved main navigation to a left icon rail. The existing local patch and overlapping support document were saved under `<common Git directory>/open-sesame/receipts/pre-main-refresh-49ec3f9/` before the owned branch advanced. The delivered navigation note is retained, the smoke-pass instructions now identify the activity rail, and this updated baseline requires its own indexed verification report. The native launch/session limitation remains unchanged and unaccepted.

After another activation, PR #5's native Coven Familiars transport and PR #6's wider geometry were already delivered. Overlapping local files and a complete review patch were saved under `<common Git directory>/open-sesame/receipts/pre-main-refresh-18926f8/`; the PTY repair merged cleanly with the new bridge dispatch/lifecycle code. Current docs distinguish the installed CLI transport from fixture/provider acceptance, and source downloads retain the delivered runnable example. The new fixture tests use isolated state and a deterministic CLI; this task does not send messages to real familiars. A fresh computer-use client and direct app selection still failed at provider startup, independently of any app UI state.

The upstream ref advanced during preparation, so the guarded branch update stopped. Prepared inputs were checked against the saved immutable commit, then that pinned base was adopted. A pre-adoption verifier report remains historical evidence for the old head only. Further upstream work remains separate until explicitly reconciled; no uncommitted primary-checkout work was copied.

The delivered CLI fixture is executable in Git, but the previous ZIP builder normalized Python files to non-executable mode. The source download therefore lost a permission required by its own fixture checks. The original mode mismatch is retained in `<common Git directory>/open-sesame/receipts/source-archive-executable-failure.json`. The builder now preserves executable intent while keeping normalized modes and deterministic metadata. A regression builds twice, extracts an executable Python fixture with its stored permissions, and actually runs it; ordinary Python source stays non-executable.

## Native acceptance, November 6, 2026

The arm64 development bundle compiles on macOS 27.2 using Python 3.15.1 and Apple Swift 6.4.2. Signature and plist checks passed in the first unified run. The compiler retains two pre-existing `allowedFileTypes` deprecation warnings. Launch Services returns `-10827` while the executable exists; direct execution exits with `SIGABRT` and no diagnostic text. Native computer-use service startup fails and browser access is unavailable. The host also cannot resolve UID 501 through `pwd.getpwuid`, and `launchctl print gui/501` reports reentrancy avoidance. These are observations, not proof of a single root cause. No account/database/system-security setting was changed.

Opening a GUI shell, collapsing/reopening the native widget, and quitting it without orphaned processes remain unverified. Automated PTY cleanup evidence does not satisfy that GUI gate. At that checkpoint, hosted CI configuration had not been published or executed by this task. Linux, real providers, remote SSH, and physical-device behavior are not claimed.

## November 7 delivered-base refresh

After a new activation, GitHub REST confirmed delivered PR #7 collapse gestures and PR #8 Live Markdown/private plugin setup. The previous qualified patch, overlapping files, and handoffs were preserved under `<common Git directory>/open-sesame/receipts/pre-main-refresh-05f8e3a/` before the owned branch adopted immutable `05f8e3af850c8d102fb22e79c99e2a3a7989d26b`. No source from the concurrently edited primary checkout was copied. Delivered setup, collapse, Live preview, and provider/device limits remain documented.

PR #8 independently preserves executable bits in source ZIPs and adds distribution validation shared by source and native builds. The reliability patch now uses that delivered implementation and adds the workflow files to the source package. The executable-fixture regression remains; running it alone exposed a missing test import path for the new helper. Its original failure is retained in `build/verification/nov7-integration-source-fixture.log`; the test now explicitly loads the scripts directory and creates its shell fixture with executable permissions. It no longer relies on another test module's import side effect or filename-based executable normalization. This combined baseline requires its own full verification report; earlier green reports remain tied to their old source fingerprints.

Fresh native computer-use inventory and the macOS GUI domain both still fail before app behavior can be observed. This resumed activation starts a new blocked audit; native shell/collapse/reopen/quit acceptance remains unmet and no system account or security settings were changed.

## November 8 rebase and publication

The user requested rebasing onto current main, resolving conflicts and publishing a PR. The complete earlier candidate was committed and retained under `refs/open-sesame/publication/pre-rebase-20261108`, with a review patch and audit snapshot under `<common Git directory>/open-sesame/receipts/publication-20261108/`. Rebase conflicts were confined to README.md, desktop/README.md and docs/desktop-polish-plan.md; they retain concise workflow guidance alongside main's WorkOS login requirement, preview restrictions, flat palette and current UI notes. The PTY and hygiene implementation applied without conflicts, and the primary checkout was preserved.

The native verification entry point now includes main's offline authentication tests and records the Swift compiler version. Those tests use synthetic keys and intercepted responses; no real account or Keychain is modified. CI selects Xcode 26.3 on macos-15 for the delivered Swift SDK's Swift 6.2+ requirement instead of relying on that image's older default toolchain. The [official runner image inventory](https://github.com/actions/runner-images/blob/main/images/macos/macos-15-Readme.md) was checked on November 8. Existing login enforcement and provider behavior remain unchanged by this reliability patch; live login and native shell acceptance are still separate.

The first post-rebase unified run, `build/verification/20261108T060913Z/report.json`, retained one stale foreign-origin assertion: it expected HTTP 403, while main now returns HTTP 401 for the disabled preview bridge. The test now requires the unauthorized response, absence of a WebSocket upgrade, and the public native-sign-in message. Native URL/authentication tests, compilation, signature and plist checks passed in that run; the complete corrected candidate requires its own report.

## PR review before merge

Review reproduced a watchdog failure when process inspection became unavailable after a check started: cleanup raised again before stopping the check or writing a receipt. The original failure is retained in `build/verification/review-inspection-failure.log`. The runner now validates inspection before starting work, contains cleanup errors, stops only the still-reserved group of its unreaped root when inspection fails, and explicitly records uncertain descendant cleanup. It never signals the numeric group after the root is reaped. Three behavioral regressions cover preflight refusal, real owned-group cleanup with unrelated-process preservation, and failure after reaping. The verifier also labels native compilation as successful only after the build succeeds, so a failed build cannot inherit a misleading compiled status.

Main advanced through PR #12 before merge. The task branch rebased onto immutable `f46f7c2fffa586ff45c55a6db3217ee9cea4d8a6`; its source-package conflict retains both the workflow files and the delivered web authentication entrypoint, including the `.vercel` exclusion. Existing authentication behavior is preserved. The final reviewed source requires fresh local and hosted verification before the user-authorized squash merge. Native GUI acceptance remains a separate unmet gate.

## Cleanup dispositions

| Candidate | Evidence and disposition |
| --- | --- |
| `feat/open-sesame-desktop` | Local `f6516412f23532f068da26d1a8ed16213eb66e9e`, remote `770bc104fe62c197ac0f6852fa438c2562c72a66`; tree matches delivered PR #1. Preserve: no owner release. Remote deletion is outside authority. |
| `release/v0.0.0-preparation` | Local/remote `9b5a81b3c798fb5085bbf64b879cde4d9de02ef5`, delivered through PR #2. Preserve: separately owned release work with no release record for retirement. |
| Original `main` checkout | Preserve as primary, including `build/releases`, both named app bundles, source ZIP, caches, and Finder metadata. Unknown/other-owner ignored data is not disposable by inference. |
| `task/reliable-development` worktree | Preserve: active task, uncommitted source, verification receipts, and native acceptance still open. No ownership release. |
| Disposable test repositories | Apply-and-restore tests verified local retirement and bundle recovery; fixtures clean up only their own temporary directories. |
| This task's initial Python caches | Removed only `desktop/__pycache__` and `desktop/tests/__pycache__` after confirming their ownership, bytecode-only contents, and no active file use. File digests and postconditions are retained in `<common Git directory>/open-sesame/receipts/owned-cache-cleanup.json`. The watchdog now disables bytecode generation for verification children. |

## Acceptance audit

| Requirement | Evidence / remaining gate |
| --- | --- |
| Refresh, isolated ownership, plan, and checkpoints | This ledger plus common-Git task/REST/inventory records. |
| Full bounded verification and reproduced PTY repair | Unified run `20261106T211150Z` passed; final source report indexed by `final-audit.json`. Original/intermediate failures retained above. |
| Reproducible archive and source cleanliness | Unified verifier compares two archive digests and before/after source fingerprints; exact final evidence indexed outside source. |
| Native build/signature/plist | Unified run passed; final source compilation is covered by the indexed report. |
| Native GUI shell/collapse/reopen/quit | Unaccepted: host launch and GUI-service failures above. |
| CI | Workflow and pinned official actions configured; no hosted execution claim. |
| Planning, instructions, current docs, historical archive | `AGENTS.md`, `development-workflow.md`, current README/setup/matrix/roadmap, and dated archive. |
| Guarded hygiene and recovery | Behavioral tooling suite plus CLI lifecycle regression; inventory/check and both actual branch dry runs preserve candidates solely for missing owner release. |
| Check-process orphan recovery | Reproduced the old false success, retained its receipt, and added root/group identity retention plus a normal-exit orphan regression. Resumed unified verification passed; final source report indexed outside source. |
| PTY master/read/exit ordering | Reproduced both dependencies, changed I/O/closure coordination, retained deadlines and real-shell assertions, and added active-reader, binary-input, and backpressure regressions. |
| Reviewable diff and PR title/body | Rebased review candidate and `build/verification/pr-draft.md`; the user authorized this PR on November 8. Exact publication identity is indexed in mutable task records. |

The next prioritized goal is to restore a usable macOS account/GUI session and complete the native shell lifecycle acceptance on this exact candidate before adding providers or UI scope.

## Continuation

Resume `reliable-development` in `/Users/buns/Documents/GitHub/OpenCoven/open-sesame-reliable-development` on `task/reliable-development`, owned by `codex:01a1b24d-21e5-7f51-a48f-e3885980f516`. Read `AGENTS.md`, this ledger, and the common-Git task record. Refresh Git status, head/base, REST state, and saved verifier reports before running anything. Preserve all uncommitted implementation, the original checkout, release work, unreleased branches, and failure receipts. Finish the recorded next action if still pending; otherwise pursue the unmet native GUI lifecycle gate on a usable Mac session. Do not restart completed implementation or infer native/hosted acceptance from compilation or fixture checks. Keep the goal incomplete while the GUI gate remains unaccepted. The user authorized rebasing, committing, pushing and publishing this PR on November 8. The user subsequently authorized review and merge. Release, deployment and remote deletion are not authorized.

## Desktop UI and native Spotify task, November 8

`desktop-ui-spotify-20261108` owns `codex/projects-native-music-polish` in the primary checkout. Its scope is Projects collection tabs, quiet input focus and Console headers, compact shell project labels, native quick-search fit, native Spotify PKCE login and identity-bound process controls. The existing reliability task and worktree retain their separate ownership and unmet GUI gate.

PR #13 initially qualified tree `692990cb09ca7b4cb134864db868c876adbdce23`: 31 widget checks, 13 focused Python process tests, three login-preview tests, native URL and WorkOS checks, native Spotify PKCE/callback checks and an arm64 v0.0.10 build passed. The pre-integration full PTY attempt stalled and was stopped; that failure remains distinct from focused checks. Main then advanced to PR #11's signed `5a1341383c19e49e1caea4aad44f7fd75b6ef7e8`, so this task merges its PTY repair and bounded verifier before delivery. The common-Git task record will index the final exact tree and unified report.

A v0.0.10 candidate was staged in Applications and the prior installed bundle backed up under `build/installed-backups`. Normal AppleEvent quit returned without closing the v0.0.9 process; it remains running and is not force-terminated. A user-operated quit is required before the verified replacement can be activated. Spotify still needs a public client ID and its provider-side callback registration. Computer-use startup and browser services remain unavailable, so rendered fit and live Spotify login remain unaccepted. No real user agent was signaled or familiar messaged during tests. Waitlist enablement and the Vercel team/domain remain pending from the earlier setup.

Next action: run the unified verifier on the combined source, retain its receipt and original failures in common Git storage, update and qualify PR #13 on its exact new head, merge under the user's existing authority, and package the matching private v0.0.10 download. Update the installed bundle after the running app exits; otherwise leave the replacement and download ready with the precise blocker. Release and deployment status must remain separate from source merge and build evidence.
