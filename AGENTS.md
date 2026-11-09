# Working in Open Sesame

Read `docs/work-tracking.md`, `docs/development-workflow.md`, and the current task claim before editing. Start with `git status` and `npm run project:inventory`; refresh remote state through GitHub REST. Preserve existing owners, worktrees, dirty files, ignored data, and original failures. Use one task branch/worktree and checkpoint its scope, dependencies, acceptance, evidence, and next action. Do not infer owner release from age or an idle process.

Use `npm run verify` on Mac and `npm run verify -- --portable` for explicit portable scope. Keep real PTY and origin/cleanup assertions. Timeouts, unavailable prerequisites, skipped execution, and leftover owned processes cannot count as passing evidence. Record local tests, hosted CI, compilation, GUI/device acceptance, live providers, merge, and deployment separately. Follow the session's publication authority; local implementation does not grant commit, push, merge, release, or deployment authority.

`dist/` contains authored source despite its name. Preserve it and the licenses/provenance in `vendor-src/` and `dist/vendor/`. Generated bundles, downloads, caches, and logs are separate. Do not move source or replace provider previews as part of hygiene work. Shared ownership and recovery records belong under the common Git directory, outside the source package.

Use `project:prune` only for explicit local targets. It defaults to a dry run and requires the exact head, explicit owner release, current complete REST evidence, delivered source proof, no open PR, and no active/dirty/ignored/unknown/external work. Never use blanket `git clean`, forced worktree removal, age-based retirement, or a forged release. Keep recovery bundles and receipts. Do not delete remote refs under local cleanup authority.

Write each prose paragraph as one logical source line in chat and rendered Markdown, including issue/PR bodies and comments. Keep blank lines and semantic Markdown blocks. Before publishing, inspect the exact serialized payload, join unintended mid-paragraph newlines with spaces, and check the rendered preview when available. Do not use fixed-column wrapping, trailing double spaces, HTML breaks, or code blocks for ordinary prose.

## Read and navigate

Start with the [README](README.md), [repository map](docs/repository-map.md), [documentation index](docs/README.md) and [capability boundaries](docs/capabilities.md). The [current-state lookup](docs/work-tracking.md#find-current-work) explains how to find the authoritative claim; archived task narratives are historical evidence. Source files and current command help take precedence over old release notes.

Read the scoped instructions for the area being changed: [browser source](dist/AGENTS.md), [native/Python host](desktop/AGENTS.md), [checks and task tooling](scripts/AGENTS.md), and [public login entry](web/auth-entrypoint/AGENTS.md). These supplement the ownership, evidence, publication and prose rules above. Prefer the [declarative tool contract](docs/tools.md) when existing components/capabilities can express a new tool; a new native capability requires a reviewed host change.

New declarative definitions use schemaVersion 2 with a required page; preserve legacy v1 definitions in Widgets. [Page adapters](dist/page-widgets.js) mount installed instances into existing page tab strips without replacing native panes.
