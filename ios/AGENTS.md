# iOS and iPadOS host

Reuse the canonical renderer and shared authentication verifier; keep native credentials and provider authority out of JavaScript. Every receiving operation must validate the owned local main frame, active scene, unexpired verified account and bounded exact request shape. Unknown methods fail closed. No remote execution or arbitrary file/SQL paths belong in this host.

Workspace persistence uses the generated canonical key contract and atomic revision/content comparison. Preserve current/previous/recovery generations and migration originals. Acknowledgments follow transaction completion; uncertain outcomes require reconciliation. Test real SQLite files and interrupted transactions, not only mocks. Complete file protection and backup policy need physical-device qualification.

Keep Mac regression, native core tests, iOS compilation, simulator observations and installed-device/authentication evidence separate. Build artifacts stay under root build/. Never change production callback registration, device pairing, signing accounts or installed unrelated applications as a side effect of tests.
