# Documentation index

Start with the [repository map](repository-map.md) to locate code and checks. The [capability matrix](capabilities.md) describes implemented behavior and acceptance limits. The [development workflow](development-workflow.md) describes ownership, verification and delivery. The [work ledger](work-tracking.md) explains how to obtain current task state; its older narratives are historical evidence, not current assignments.

## Feature contracts and change guides

| Area | Read first | Related implementation notes |
| --- | --- | --- |
| Tools and integrations | [Tool creation and submissions](tools.md), [GitHub monitor](github-monitor-widget.md) | [Optional widgets and lifecycle controls](widget-lifecycle.md), [Page tabs and application workspace](widget-pages-and-application.md), [connection setup](desktop-polish-plan.md#plugin-setup-and-private-configuration) |
| Image generation | [Image Studio](image-generation.md) | ChatGPT sign-in, explicit generation, previews and native PNG export |
| To-do tasks | [Task Manager](task-manager.md) | Shared Projects lists, priorities, due dates and recoverable completion |
| Capture and launcher | [Command palette](command-palette.md), [widget/launcher lifecycle](widget-launcher-fit.md) | [Desktop interaction polish](desktop-interaction-polish.md) covers shell routing, playlists and Escape |
| Embedded computer agent | [Task, account and permission setup](embedded-computer-agent.md) | Bundled Coven engine, native action boundary and separate device/provider gates |
| Familiars | [CLI integration contract](coven-familiars-integration.md), [persistent chat and commands](familiar-chat-commands.md) | [Permissions and layout](familiar-permissions-and-layout.md) |
| Window and display | [Display following](notch-display-follow.md), [display pinning and shared Spotify](display-pinning-and-spotify.md) | [Desktop setup and smoke pass](../desktop/README.md) |
| Screen, voice and audio | [Screen notes and capture](screen-notes-and-capture.md), [Protected Share](protected-share.md) | [System audio and media](system-audio-and-media.md), [transcription startup repair](system-audio-transcription.md) |
| Authentication | [Native login contract](workos-login.md), [public HTTPS login handoff](../web/auth-entrypoint/README.md) | Public deployment and saved provider settings require their own live evidence |
| Remote desktops | [VNC connection types, lifecycle and checks](vnc-desktops.md) | [Controller setup](../desktop/controller-setup.md) covers a separate optional message receiver |
| Message controllers | [Controller setup](../desktop/controller-setup.md) | [Capability boundaries](capabilities.md) distinguish optional adapters from qualified providers |

## History, priorities and evidence

[Desktop priorities](desktop-polish-plan.md) includes implementation follow-ups; it does not assign the next task or override an active claim. [The v0.0.10 interface note](desktop-polish-v0.0.10.md) and [early widget input/Live notes](widget-input-capture.md) record versioned behavior. For current routing, supported operations and capture choices, inspect the corresponding source and feature contract above. Version pins in old verification examples reproduce that historical candidate; they are not the current release number.

[Archived documents](archive/) preserve original conclusions and failures. In particular, [the November 8 work narrative](archive/2026-11-08-work-tracking-history.md) contains old branch/owner/status snapshots. Mutable task claims, remote snapshots and machine-specific receipts live under the common Git directory, outside the source package. Use the [current-state lookup](work-tracking.md#find-current-work) before acting on any historical continuation.

Local tests, hosted checks, rendered browser observations, installed native operation, real providers, merge, release and deployment are distinct evidence. A historical host blocker can explain an old gap; it cannot prove that the current machine is still blocked. Verify the required prerequisite in the current session.
