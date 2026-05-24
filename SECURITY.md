# Security Policy

## Reporting a Vulnerability

Please **do not** open a public issue for security vulnerabilities.

Email **security@opencoven.ai** with:
- A description of the issue
- Steps to reproduce
- Potential impact

We'll respond within 72 hours and coordinate a fix + disclosure timeline with you.

## Secret Scanning

This repo uses [gitleaks](https://github.com/gitleaks/gitleaks) to prevent
accidental secret commits.

**For contributors:** run `script/install-hooks.sh` once after cloning. It
installs a `pre-commit` hook that scans staged changes before every commit.

**What's checked:**
- Generic high-entropy strings, API keys, tokens (gitleaks default ruleset)
- Apple Developer Team IDs and codesign certificate fingerprints

## Release Credentials

The release script (`script/release.sh`) requires two environment variables
that **must never be committed**:

| Variable | Description |
|---|---|
| `SIGNING_IDENTITY` | Developer ID Application certificate fingerprint or full identity string |
| `TEAM_ID` | Apple Developer Team ID |

Store these in your shell profile, macOS Keychain, or CI secrets — never in
source files.
