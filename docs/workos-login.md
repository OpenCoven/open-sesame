# OpenSesame login

The Mac app requires a WorkOS session before loading the widget or starting its local host. The native gateway also checks authentication on every tool request. A saved credential is refreshed with WorkOS and its signed user token is verified before the app unlocks. Expiry or sign-out closes embedded pages, stops capture and disconnects local host jobs. Sessions live in the macOS Keychain; access tokens, refresh tokens and PKCE verifiers never enter the widget DOM, browser storage, bundled configuration, logs or source downloads.

The integration uses the official [WorkOS Swift SDK](https://github.com/workos/workos-ios), pinned in `vendor-src/workos-ios`. Native public-client PKCE requires only a public client ID. Do not add an API key, client secret, cookie password or claim token to the app bundle. The SDK source archive contains upstream source and synthetic examples only; the build verifies its SHA-256 and every upstream file hash before compiling it offline.

| Setting | Value | Verification |
| --- | --- | --- |
| WorkOS project | OpenSesame | Existing project read from authenticated CLI |
| Environment | Production | `environment_01M6WS831Z8FH6EWY17XVY0FM3`, confirmed with `whoami` |
| Public client ID | `client_01M6WS836GMGC87S8SVBR6X35A` | Matches the production environment |
| Default redirect URI | `opensesame://auth/callback` | Saved and read back through the CLI |
| Default Sign-out URI | `opensesame://auth/signed-out` | Saved and read back through the CLI |
| Initiate login URI | `opensesame://auth/login` | Native route implemented; dashboard setting still needs saving and read-back |
| Allowed CORS origins | No addition | Native URLSession requests do not use browser CORS |

The current CLI has no Initiate login URI command, and its REST catalog does not expose that setting. Set the production application's Initiate login URI to `opensesame://auth/login` in the WorkOS dashboard's Redirects settings, following [WorkOS's application setup guidance](https://workos.com/docs/authkit/vanilla/nodejs#configure-initiate-login-uri). Dashboard automation was unavailable in this environment. Preserve the callback and sign-out values above; the initiate-login route is a separate entry point.

After installing the app, click **Sign in**, complete AuthKit in the system browser, and return to the widget. Option–Space opens the signed-out screen when login is needed. **Cancel** dismisses a pending sign-in. Use **Sign out** in widget options or the menu bar menu to clear this Mac's session and start WorkOS sign-out. Local lockout happens immediately, including when the network is unavailable; remote browser session termination still requires a working connection.

The local HTTP server now serves the sign-in screen and downloadable builds. Its old unauthenticated WebSocket host is disabled. **Open Open Sesame** hands off to the installed Mac app. Run `OPEN_SESAME_VERSION=0.0.8 bash desktop/build-macos.sh` for the authenticated native development build. There is no environment-variable login bypass in the packaged app.

Verification commands are `npm run check`, `bash scripts/check-native.sh`, `bash scripts/check-authentication.sh`, and `python3 -B -m unittest discover -s desktop/tests -p test_login_preview.py -v`. Native authentication tests use ephemeral synthetic keys and intercepted JWKS responses; they do not sign in a real user or write to the Keychain. A build and offline tests do not establish live login acceptance. Normal sign-in, restored sign-in after relaunch, browser sign-out, cancellation, and invitation/reset entry still require a user-operated pass on the installed app; the Initiate login setting above also remains outstanding.
