# OpenSesame login

This guide records the source configuration and setup-time observations. Its provider/dashboard rows are not a live account audit. Inspect [the native constants](../desktop/Authentication.swift) for bundled values and [the public handoff](../web/auth-entrypoint/README.md) for route behavior; verify saved provider settings and deployed URLs in the current authorized session before changing them.

The Mac app requires a WorkOS session before loading the widget or starting its local host. The native gateway also checks authentication on every tool request. A saved credential is refreshed with WorkOS and its signed user token is verified before the app unlocks. Expiry or sign-out closes embedded pages, stops capture and disconnects local host jobs. Sessions live in the macOS Keychain; access tokens, refresh tokens and PKCE verifiers never enter the widget DOM, browser storage, bundled configuration, logs or source downloads.

The integration uses the official [WorkOS Swift SDK](https://github.com/workos/workos-ios), pinned in `vendor-src/workos-ios`. Native public-client PKCE requires only a public client ID. Do not add an API key, client secret, cookie password or claim token to the app bundle. The SDK source archive contains upstream source and synthetic examples only; the build verifies its SHA-256 and every upstream file hash before compiling it offline.

| Setting | Value | Verification |
| --- | --- | --- |
| WorkOS project | OpenSesame | Existing project read from authenticated CLI |
| Environment | Production | `environment_01M6WS831Z8FH6EWY17XVY0FM3`, confirmed with `whoami` |
| Public client ID | `client_01M6WS836GMGC87S8SVBR6X35A` | Matches the production environment |
| Default redirect URI | `opensesame://auth/callback` | Saved and read back through the CLI |
| Default Sign-out URI | `opensesame://auth/signed-out` | Saved and read back through the CLI |
| Initiate login URI | `https://opensesame.computer/auth/login` | HTTP(S) web entry; Vercel deployment and saved WorkOS setting still need live verification |
| Native app handoff | `opensesame://auth/login` | Opens the app's SDK sign-in; this custom URI is not valid for the WorkOS Initiate login field |
| Allowed CORS origins | No addition | Native URLSession requests do not use browser CORS |

The previous custom-scheme Initiate login instruction was incorrect: that WorkOS field accepts HTTP(S) application URLs. Its value is `https://opensesame.computer/auth/login`, which serves the handoff in [`web/auth-entrypoint`](../web/auth-entrypoint/README.md). The page opens `opensesame://auth/login`, and the app starts a fresh SDK-owned PKCE transaction. The app also handles external entry during session restore and with an existing authenticated session. No verifier or session token crosses the web handoff, and query/fragment data is not forwarded into the custom scheme.

During the recorded setup, the inspected WorkOS CLI and REST catalog did not expose an Initiate login URI setting. Recheck current provider tooling before choosing how to update that field. After verifying the Vercel route, save `https://opensesame.computer/auth/login` as the production application's Initiate login URI, following [WorkOS's application setup guidance](https://workos.com/docs/authkit/vanilla/nodejs#configure-initiate-login-uri). Dashboard automation was unavailable in this environment. The native callback and Sign-out URI above remain separate destinations. Do not use the hosted AuthKit page as the Initiate login URI; the entry must start the application's sign-in flow.

## Waitlist admission

OpenSesame Production should use WorkOS Waitlist for self-service signup. The feature must be enabled in that environment's **Authentication → Features → Waitlist** setting. Existing users can sign in; new signup attempts use WorkOS's email waitlist form and require review. Invited users and qualifying verified-domain JIT users follow WorkOS's documented exceptions. See [WorkOS Waitlist](https://workos.com/docs/authkit/waitlist). The native app continues to require a verified authenticated user token; visiting the HTTPS entry, opening the app, or joining the waitlist does not unlock local tools.

Waitlist enablement is pending dashboard confirmation. The installed CLI exposes entry-management REST operations but no feature-enable command, and browser control is unavailable here. This patch does not approve entries, create users, send invitations or embed an administrative API key. Native sign-in uses AuthKit's hosted form, and closing that window after requesting access shows a neutral return-after-approval message.

## Native use and verification

After installing the app, click **Sign in**, complete AuthKit in the system browser, and return to the widget. Option–Space opens the signed-out screen when login is needed. **Cancel** dismisses a pending sign-in. Use **Sign out** in widget options or the menu bar menu to clear this Mac's session and start WorkOS sign-out. Local lockout happens immediately, including when the network is unavailable; remote browser session termination still requires a working connection.

The local HTTP server serves the sign-in screen and downloadable builds. Its old unauthenticated WebSocket host is disabled. **Open Open Sesame** hands off to the installed Mac app. Run `node scripts/build-auth-entrypoint.mjs` to preview the new `/auth/login` entry locally, and `OPEN_SESAME_VERSION=0.0.9 bash desktop/build-macos.sh` for the authenticated native development build. There is no environment-variable login bypass in the packaged app.

Verification commands are `npm run check`, `bash scripts/check-native.sh`, `bash scripts/check-authentication.sh`, and `python3 -B -m unittest discover -s desktop/tests -p test_login_preview.py -v`. Native authentication tests use ephemeral synthetic keys and intercepted JWKS responses; they do not sign in a real user or write to the Keychain. A build and offline tests do not establish live login acceptance. Normal sign-in, restored sign-in after relaunch, browser sign-out, cancellation, and invitation/reset entry still require a user-operated pass on the installed app; the Initiate login setting above also remains outstanding.
