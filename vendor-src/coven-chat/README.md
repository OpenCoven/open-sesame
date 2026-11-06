# OpenCoven Chat runtime interface

Source: https://github.com/OpenCoven/chat/blob/a8c76390ff946389224b86e5ff91b8b6c11bf413/src/lib/coven-runtime.ts
Commit: a8c76390ff946389224b86e5ff91b8b6c11bf413
License: MIT (LICENSE copied from the same repository).

`coven-runtime.ts` is the unchanged upstream runtime interface. Build with Node 24: `node scripts/build-coven-runtime.mjs`. The build removes imports/types, exposes the factory as `OpenSesameCovenRuntime.create`, supplies a mock Channel object, and defaults native calls to unavailable. It does not install Tauri or provide its IPC transport.

`dist/coven-chat.js` uses this factory with an explicit local mock invoke adapter for streamed prototype replies and cancellation. No real SDK sending, authentication, inference, tools, or computer actions occur.

The separate OpenCoven SDK at commit 89685543a62008533237478c31ecce565798ddf6 documents a read-only initial API and deferred message sending. This bundle is the Chat runtime interface, not a published SDK package or a live connection.
