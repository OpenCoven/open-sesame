# Reusable tools

Tools are versioned JSON definitions rendered by Open Sesame. Open Widgets → Tools, choose a starter or import tool.json, review fixture output and requested access, then install a local instance. Each installation has separate configuration. Pin a card or use /tools and the launcher’s Tools group. Expand a tool for forms and actions. No installation or preview contacts a provider, sends a model prompt, or captures data.

## Create and generate

Run `npm run tools -- create /path/to/new-package`, edit tool.json, then run `npm run tools -- validate /path/to/new-package` and `npm run tools -- preview /path/to/new-package`. The create command uses the new directory name as the package ID and writes tool.json plus a README. Replace the author and confirm the license before sharing. CLI preview prints fixture content; use the app for rendered previews. The three starter packages under dist/tools are executable examples of the format. Add a README with purpose, setup, author, license, expected fixture output and connection requirements.

Generation prompt: “Produce an Open Sesame schemaVersion 1 tool.json using the meeting-notes, repository-summary or feed-headlines example as the contract. Use only text, metric, list and input components. Declare every operation in capabilities. Use source null or github.summary or feeds.headlines. Actions may use navigate, link.open or note.save. Include sample title, count and entries in fixtures. Do not include code, HTML, credentials, real user data or new fields. Return JSON only.” Validate the generated file before importing it.

## Contract and connections

Required fields are schemaVersion, id (lowercase slug), version (three numbers), name, description, author, license, config, capabilities, source, components, actions, presentations and fixtures. Configuration maps slugs to label/default text objects. Components have type and label, optional literal text, field binding or literal items. Metric and text fields bind to fixture or source properties; input fields bind to configuration. Lists display literal items when supplied, otherwise source entries. Inputs require a declared configuration field; text and metrics require literal text or a data field. Presentations declare launcher, card and/or panel; launcher discovery honors that declaration. Tools currently share the host’s Tools collection rather than adding navigation tabs.

Sources name a registered read operation. github.summary uses a repository configuration value and requires an existing connected, saved repository in Widgets → GitHub. feeds.headlines uses a feed configuration value matching a saved Reader URL or ID and reads already downloaded headlines without refreshing the feed. Load live data (GitHub) and Load saved headlines (Reader) are explicit; no background polling is enabled. Set up or refresh connections in the existing built-in screens.

Actions have label, operation and value. navigate accepts items, reading, plugins, focus or familiars. link.open accepts HTTP(S) links without embedded credentials. note.save uses value as a configuration field name or literal text and writes only when its button is pressed. Native bridge methods are never accepted from packages. Packages have a 100,000-byte UTF-8 limit; unknown fields and unsupported capabilities are rejected. The editor schema is dist/tools-schema.json; operation declarations, destination restrictions and input bindings also receive semantic checks. The shared runtime validator in dist/tools-model.js is authoritative for both CLI and app.

## Sharing, updates and acceptance

Submit a package folder through a GitHub PR with tool.json, README and screenshots of the fixture preview at small and expanded sizes. npm run check validates starter definitions and behavioral contract regressions; the existing verification workflow runs it on pull requests. Review requested capabilities, fixture output, provenance and rendered layout before accepting a submission. Never include credentials, saved configuration, personal repositories or user notes. Local export contains only the reusable definition, including its author-supplied default configuration and fixture data. Keep those defaults and fixtures public and synthetic; saved instance values and in-memory drafts are excluded.

Import an updated definition and choose Replace to retain matching saved configuration fields and the prior definition. New fields receive their declared defaults. Replacement and rollback show requested access and discard unsaved edits for that instance after confirmation. Roll back restores the prior definition. Remove deletes only that instance. Configuration edits, replacement, removal, dialog closure and handoff retire pending reads; stale results never replace the current view. Closing before GitHub status completes prevents a subsequent snapshot request. Configuration is device-local in open-sesame-tools-v1 storage; the app bundle is not modified. Draft inputs remain in memory while opening and closing the Tools dialog; Save configuration persists them. Workspace window handoffs include in-memory drafts; application restart preserves saved configuration, not unsaved drafts.

Custom code, new providers, general workflows, a public catalog, automatic updates and built-in AI generation require separate work. Existing terminals, media and capture tools remain built-ins. Local validation does not establish hosted CI, rendered native acceptance, live provider acceptance, merge or deployment.

## Agent navigation and extension points

| Concern | Source of truth |
| --- | --- |
| Package shape and semantic validation | dist/tools-model.js and dist/tools-schema.json |
| Built-in examples and package discovery | `dist/tools/<slug>/tool.json` and scripts/check-tools.mjs |
| Host renderer, operations, storage and lifecycle | dist/tools.js |
| Launcher dispatch and workspace handoffs | dist/capture.js and dist/window.js |
| Generation/validation CLI | scripts/tools.mjs |
| Fixture, persistence, privacy and stale-read regressions | scripts/check-tools-ui.mjs |

A package uses existing operations; it never supplies a handler. The renderer constructs DOM nodes and text only. GitHub reads use the existing github.status and github.snapshot bridge methods with a saved repository; feed headlines read the existing Reader handoff without a network refresh. note.save uses the existing item limits and save path and retains input if persistence fails. The host operation list and these adapters are deliberately closed in v1.

The local storage key open-sesame-tools-v1 contains an array of instances with separate identities, validated definitions, saved configuration, pin state and an optional prior definition. Unknown or corrupt storage is preserved and writes fail closed until it is recovered; never clear user storage to make a test pass. Workspace handoffs transfer drafts in memory and filter them against installed definitions. Nothing is synchronized to an account.

The Tools collection provides expandable panels and pinned-open cards inside the existing workspace. Launcher entries open those panels and never execute package actions directly. This initial presentation avoids an independent window/lifecycle for each tool. A future dashboard or custom-code runtime should build on observed use cases rather than weakening the declarative contract.
