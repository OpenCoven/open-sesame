#!/bin/bash
set -euo pipefail
open_sesame_root="$(cd "$(dirname "$0")/.." && pwd)"
open_sesame_check="$(mktemp -d "${TMPDIR:-/tmp}/open-sesame-native-check.XXXXXX")"
trap 'rm -rf "$open_sesame_check"' EXIT
xcrun swiftc -o "$open_sesame_check/native-url-tests" "$open_sesame_root/desktop/EmbeddedWebSurface.swift" "$open_sesame_root/desktop/tests/NativeURLTests.swift" -framework AppKit -framework WebKit
"$open_sesame_check/native-url-tests"
