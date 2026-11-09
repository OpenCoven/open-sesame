# Remote desktops and VNC

Console → Desktops supports three profile types. Network labels such as Tailnet and Local are organizational labels; they do not discover machines, configure a VPN or establish connectivity. Connections start only through explicit user actions. The [capability matrix](capabilities.md) separates fixture evidence from installed-app and real-server acceptance.

| Profile | Configuration | Execution boundary |
| --- | --- | --- |
| Direct VNC | Host and port, normally 5900 | Authenticated Mac host opens an outbound TCP connection; no local network listener is created. Ordinary TCP does not encrypt the stream; use a trusted or independently secured transport |
| Secure gateway | Credential-free `wss://` RFB gateway URL | Bundled noVNC runs in the app/browser and connects through the supplied secure gateway; this is not an arbitrary HTTPS viewer URL |
| Existing web viewer | Credential-free HTTPS viewer URL on another origin | Separate embedded web content; it does not inherit application RPC |

The built-in viewer supports explicit authentication, session identity verification where requested by the server, reconnect/disconnect, fit/actual size, view-only control and explicit clipboard actions. The Mac authentication form offers optional Remember in Keychain. Saved profiles contain connection metadata, not plaintext passwords; transient credentials and dialogs are cleared on disconnect. Verify a server fingerprint through an independent trusted channel before choosing Trust for this session.

## Source and lifecycle

[remote.js](../dist/remote.js) owns profiles, connection settings, selection and mounted viewers. [vnc-client.js](../dist/vnc-client.js) owns noVNC sessions, event handlers, credentials and transport adaptation. [VNCTransport.swift](../desktop/VNCTransport.swift) owns native sockets, Keychain operations, token-bound sessions, read credit and bounded writes. [OpenSesame.swift](../desktop/OpenSesame.swift) routes approved methods from the authenticated bundled main document. This path does not go through the Python PTY bridge.

Preserve session/token identity across asynchronous socket opens, early bytes, disconnect and profile replacement. A token arriving after cancellation must still be closed; retired events and credential responses must not update a new session. Keep queue limits, read acknowledgements, failure states and sign-out cleanup intact. Preserve [vendored noVNC source/provenance](../vendor-src/novnc/README.md) and [bundled licenses](../dist/vendor/novnc/LICENSE.txt).

## Checks

`node scripts/check-vnc.mjs` exercises renderer/profile and late-result behavior with synthetic transports. `bash scripts/check-vnc-native.sh` exercises the native transport with local fixtures and is included by [check-native.sh](../scripts/check-native.sh). No external desktop or actual Keychain prompt is required for these checks.

The optional browser probe is `npm run test:vnc:browser`. Install the lockfile-pinned development dependencies with `npm ci` and the matching browser with `npx playwright install chromium` before running it. The pinned CLI's `install --help` describes browser options. [The browser fixture](../scripts/fixtures/vnc-browser.mjs) binds to loopback, uses a synthetic RFB server and writes a framebuffer artifact under `build/`; it is separate from the dependency-free core checks. A real server, gateway TLS, installed native app and actual Keychain prompts require separate authorized acceptance.
