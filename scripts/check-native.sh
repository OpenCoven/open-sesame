#!/bin/bash
set -euo pipefail
open_sesame_root="$(cd "$(dirname "$0")/.." && pwd)"
open_sesame_check="$(mktemp -d "${TMPDIR:-/tmp}/open-sesame-native-check.XXXXXX")"
trap 'rm -rf "$open_sesame_check"' EXIT
xcrun swiftc -o "$open_sesame_check/native-url-tests" "$open_sesame_root/desktop/EmbeddedWebSurface.swift" "$open_sesame_root/desktop/tests/NativeURLTests.swift" -framework AppKit -framework WebKit
"$open_sesame_check/native-url-tests"

xcrun swiftc -o "$open_sesame_check/spotify-tests" "$open_sesame_root/desktop/SpotifyAuthentication.swift" "$open_sesame_root/desktop/tests/SpotifyAuthenticationTests.swift" -framework AppKit -framework AuthenticationServices -framework Security
"$open_sesame_check/spotify-tests"

xcrun swiftc -o "$open_sesame_check/system-audio-tests" "$open_sesame_root/desktop/SystemAudio.swift" "$open_sesame_root/desktop/tests/SystemAudioTests.swift" -framework AppKit -framework AVFoundation -framework ScreenCaptureKit -framework CoreMedia
"$open_sesame_check/system-audio-tests"
