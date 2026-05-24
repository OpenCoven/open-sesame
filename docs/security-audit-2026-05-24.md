# Security Audit Report
_Generated: 2026-05-24_

## Scope

Full audit of `OpenCoven/open-sesame` git history (46 commits), all three
GitHub release assets (v0.1.0, v0.1.1, v0.1.2), and current working tree
prior to making the repository public.

---

## Git History

### Findings

| Commit | Rule | File | Match | Risk | Action |
|--------|------|------|-------|------|--------|
| `73eaa324` | `codesign-fingerprint` | `script/release.sh` | `<cert-fingerprint>` | **Low** | No rotation needed (public cert fingerprint) |
| `73eaa324` | `apple-team-id` | `script/release.sh` | `<team-id>` | **Low** | No rotation needed (visible in bundle IDs / notarization) |
| `49bc6145` | `generic-api-key` | `OpenSesameApp.swift` | `didMigrateCovenV2` | **None** | False positive — UserDefaults migration sentinel |
| `753579db` | `generic-api-key` | `OpenSesameApp.swift` | `didMigrateCovenV1` | **None** | False positive — UserDefaults migration sentinel |

### Assessment

- **No private keys, passwords, auth tokens, or real API keys** were found in any commit.
- `SIGNING_IDENTITY` (`<cert-fingerprint>`) is the SHA-1 of a *public* Developer ID
  Application certificate — not a private key. No rotation required.
- `TEAM_ID` (`<team-id>`) appears in the public bundle ID
  (`ai.opencoven.OpenSesame`) already embedded in every release. Not secret.
- The two UserDefaults keys are standard migration sentinels and not
  credentials of any kind.
- **History rewrite is not required.**

---

## Release Assets

All three releases (v0.1.0, v0.1.1, v0.1.2) were downloaded and inspected.

Each zip contains only:
```
OpenSesame.app/
  Contents/
    Info.plist            ← only CFBundle metadata, no secrets
    MacOS/OpenSesame      ← compiled binary
    Resources/
      open-sesame_OpenSesameApp.bundle/
        Contents/
          Info.plist
          Resources/      ← bundled .png icons only
    _CodeSignature/       ← code signature material
```

**No source files, scripts, credentials, config files, or environment
variables are embedded in any release artifact.** ✅

---

## Current Working Tree

- No secrets in any tracked file.
- `.gitignore` updated to block `*.p12`, `*.p8`, `*.pem`, `*.key`, `*.cer`,
  `*.provisionprofile`, `ExportOptions.plist`, and local release env files.
- `script/release.sh` no longer contains any hardcoded values — all signing
  credentials are required env vars.

---

## Controls Now In Place

| Control | Status |
|---------|--------|
| `SIGNING_IDENTITY` / `TEAM_ID` removed from source | ✅ |
| `.gitignore` covers cert/key file types | ✅ |
| `gitleaks` pre-commit hook installed | ✅ |
| `script/install-hooks.sh` for contributor onboarding | ✅ |
| `.gitleaks.toml` with Apple-specific rules | ✅ |
| `.gitleaks-baseline.json` suppresses known false positives | ✅ (gitignored) |
| `SECURITY.md` with vuln reporting + hygiene guidance | ✅ |

---

## Verdict

**The repository is safe to make public.** No credentials requiring rotation
were found. Release artifacts contain only the compiled binary and bundled
image assets. Pre-commit scanning is now active for all future commits.
