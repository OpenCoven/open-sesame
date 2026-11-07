# OpenCoven Chat runtime interface

Source: https://github.com/OpenCoven/chat/blob/a8c76390ff946389224b86e5ff91b8b6c11bf413/src/lib/coven-runtime.ts
Commit: a8c76390ff946389224b86e5ff91b8b6c11bf413
License: MIT (LICENSE copied from the same repository).

`coven-runtime.ts` is the unchanged upstream runtime interface. Build with Node 24: `node scripts/build-coven-runtime.mjs`. The build removes imports/types, exposes the factory as `OpenSesameCovenRuntime.create`, supplies a small Channel-compatible callback object, and defaults native calls to unavailable. It does not install Tauri or provide its IPC transport.

`dist/coven-chat.js` now connects this unchanged factory to Open Sesame’s native allowlisted Python bridge for live Coven CLI status, familiar discovery, streaming sends, and cancellation. Open Sesame adds its own conversation id and revision to the host send envelope. It stores its own conversation heads and does not edit OpenCoven Chat’s canonical pointers. See [the integration guide](../../docs/coven-familiars-integration.md).

The separate OpenCoven SDK at commit 89685543a62008533237478c31ecce565798ddf6 documents a read-only initial API and deferred message sending. This bundle is the Chat runtime interface, not a published SDK messaging package. Live execution uses Coven’s installed CLI contracts.
