# Processes workspace

Processes adds repository/worktree context, existing Shells navigation, external tmux attachment, native Terminal/iTerm2 lookup, five layouts, and seven days of local activity metadata. Agent activity and OS process state remain separate. Missing evidence remains Unknown. Native lookup occurs only on Open terminal and may require macOS Automation permission; a PID alone does not grant access to another application's terminal stream.

## Lifecycle events

For Claude Code, opt in by adding command hooks for UserPromptSubmit, PreToolUse, PostToolUse, PermissionRequest, Stop, and Notification using the command `python3 /absolute/path/to/desktop/agent_activity.py --claude`. Use Claude's `/hooks` interface and preserve existing hooks. The helper reads the hook's JSON stdin but stores only state and timestamp, bound to the live recognized ancestor's PID and start identity. It returns no permission decision. Other provider integrations can invoke the same helper with `--state working`, `--state waiting`, `--state ready`, or `--state completed` from their supported lifecycle hooks.

The current screen rules apply to live Open Sesame and tmux output for Codex and Claude, are labeled inferred, and intentionally leave unmatched screens Unknown. Automatic hook installation and exhaustive provider-version screen coverage are not implemented. No screen contents are stored in activity history. Generic shell readiness and low CPU do not establish completion or a need for input.

## Acceptance limits

Native terminal lookup and tmux attachment require direct acceptance on a usable desktop. Automated fixtures, portable checks, native compilation, and installed app acceptance must be recorded separately. Current Table is a sortable row layout; Gantt displays observed intervals without planned task dates. Project and provider filters, folder reveal, and path copying are available. Linked-terminal filtering, completion acknowledgement, and historical interval inspection are available.
