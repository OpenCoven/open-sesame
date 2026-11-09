# Development work and handoff

## Find current work

The authoritative local assignment is the task record under the common Git directory, not the first section of a source document. Run `git status -sb` and `npm run project:inventory` in the checkout you intend to use. Inspect its branch/worktree and the matching `tasks/<id>.json` record, including owner, dependencies, acceptance, evidence and next action. Use `git rev-parse --git-common-dir` to locate the shared `open-sesame/tasks/` register. An idle process, old timestamp or merged PR does not release ownership.

Run `npm run project:refresh` for current complete GitHub REST branch/open-PR evidence, then `npm run project:check` to expose inconsistencies. Preserve work on an unknown or conflicting branch. Read the [development workflow](development-workflow.md) before claiming a new isolated task or acting on cleanup. The [repository map](repository-map.md) and [docs index](README.md) locate implementation and feature contracts.

## Evidence and continuation

For any continuation, reconcile the recorded head/base with actual Git state and remote PR state. Inspect the exact verifier report and original failures. A merged source tree, source archive, installed bundle, browser fixture, live provider response and deployed URL answer different questions. Do not convert an old GUI blocker into a claim that today's host is blocked, or a synthetic result into device acceptance.

A handoff records task ID/owner, branch/worktree, scope/dependencies, exact head/base and dirty state, executed commands and receipt paths, acceptance achieved/open, cleanup disposition and one next action. Shared mutable records and machine-specific output stay outside the source package; stable implementation contracts belong in feature docs. Preserve existing owners and use explicit transfer rather than assuming another session has finished.

## Maintain navigation and handoffs

Use the [source/test map](repository-map.md) and [documentation index](README.md) when adding or moving a subsystem. Record an actual task's owner, worktree, exact source identity and next action in the shared task/receipt record. Keep this entry page as a stable lookup rather than a list of assignments that becomes stale after merge.

A copyable continuation can use this template after filling it from current evidence:

> Resume task `<task-id>` only after matching its shared claim to the actual worktree and owner. Refresh Git/REST state, read the indexed report and original failures, preserve existing work, and execute the recorded next action within the session's authority. Keep each unmet acceptance class explicit.

## Historical narratives

The [preserved November 8 narrative](archive/2026-11-08-work-tracking-history.md) retains earlier task owners, failures, acceptance limits and continuation text. It includes the reliability, capture, display, audio, Familiars, GitHub monitor and declarative-tool work. It remains evidence of what was observed then; read the current register and remote state before acting on it. Earlier [README snapshots](archive/) retain their own original context.
