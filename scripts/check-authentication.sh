#!/bin/bash
set -euo pipefail
open_sesame_root="$(cd "$(dirname "$0")/.." && pwd)"
python3 -B "$open_sesame_root/scripts/build-workos-sdk.py"
open_sesame_check="$(mktemp -d "${TMPDIR:-/tmp}/open-sesame-auth-check.XXXXXX")"
trap 'rm -rf "$open_sesame_check"' EXIT
xcrun swiftc -I "$open_sesame_root/build/workos-sdk" -L "$open_sesame_root/build/workos-sdk" -lWorkOS -o "$open_sesame_check/auth-tests" "$open_sesame_root/desktop/Authentication.swift" "$open_sesame_root/desktop/tests/AuthenticationTests.swift" -framework AppKit -framework AuthenticationServices -framework Security
"$open_sesame_check/auth-tests"
