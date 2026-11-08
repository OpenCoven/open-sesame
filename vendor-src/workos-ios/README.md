# WorkOS native authentication SDK

`sources.tar.gz` contains the unmodified official WorkOS Swift SDK source files, package metadata, README and MIT license from revision `4eb6a8decd76c056f167b9d92dfd9df0aff96a2e` of [workos/workos-ios](https://github.com/workos/workos-ios/tree/4eb6a8decd76c056f167b9d92dfd9df0aff96a2e). `SOURCE.json` pins the archive SHA-256 and every upstream Git blob hash. Keeping the small source archive here makes private desktop builds reproducible without downloading dependencies or credentials.

`python3 -B scripts/build-workos-sdk.py` verifies the archive and each source before compiling the WorkOS module into the ignored build directory. No source is rewritten. The desktop app uses `PublicClient` for PKCE and refresh, and the SDK's verified session helpers to check signatures and user binding before unlocking. Only OpenSesame's public production client ID is embedded in the app.
