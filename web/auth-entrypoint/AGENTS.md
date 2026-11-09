# Public login handoff only

Read [the route/deployment contract](README.md), [native authentication](../../docs/workos-login.md) and [the repository map](../../docs/repository-map.md). This directory is the dedicated public deployment root; it must not expose the desktop source, downloads, repository root, machine bridge or private configuration.

[worker.mjs](worker.mjs) defines the page, script, styles and request policy. [build.mjs](build.mjs) clears only this directory's generated `dist/` and emits the four public assets; [vercel.json](vercel.json) selects that output and the exact login rewrite. Run `node scripts/build-auth-entrypoint.mjs` and `node scripts/check-auth-entrypoint.mjs` from the repository root. There is no package install or secret required to build these public files.

Keep the native handoff fixed. Do not forward query/fragment data or user-supplied return URLs, exchange codes in this page, add credentials, or bypass the native SDK's state/PKCE/session verification. Public HTTP availability, browser/OS custom-scheme handling, provider dashboard settings and actual login are separate checks. Build/fixture success does not grant deployment, domain, saved setting or access-protection authority; follow the session's explicit scope.
