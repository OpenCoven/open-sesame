#!/bin/bash
set -euo pipefail
open_sesame_root="$(cd "$(dirname "$0")/.." && pwd)"
open_sesame_check="$(mktemp -d "${TMPDIR:-/tmp}/open-sesame-native-check.XXXXXX")"
trap 'rm -rf "$open_sesame_check"' EXIT
xcrun swiftc -o "$open_sesame_check/screen-placement-tests" "$open_sesame_root/desktop/ScreenPlacement.swift" "$open_sesame_root/desktop/tests/ScreenPlacementTests.swift"
"$open_sesame_check/screen-placement-tests"

xcrun swiftc -o "$open_sesame_check/protected-share-tests" "$open_sesame_root/desktop/ProtectedShare.swift" "$open_sesame_root/desktop/tests/ProtectedShareTests.swift" -framework AppKit -framework AVFoundation -framework ScreenCaptureKit -framework CoreMedia
"$open_sesame_check/protected-share-tests"

xcrun swiftc -o "$open_sesame_check/native-url-tests" "$open_sesame_root/desktop/EmbeddedWebSurface.swift" "$open_sesame_root/desktop/tests/NativeURLTests.swift" -framework AppKit -framework WebKit
"$open_sesame_check/native-url-tests"

xcrun swiftc -o "$open_sesame_check/spotify-tests" "$open_sesame_root/desktop/SpotifyAuthentication.swift" "$open_sesame_root/desktop/tests/SpotifyAuthenticationTests.swift" -framework AppKit -framework AuthenticationServices -framework Security
"$open_sesame_check/spotify-tests"

xcrun swiftc -o "$open_sesame_check/system-audio-tests" "$open_sesame_root/desktop/SystemAudio.swift" "$open_sesame_root/desktop/tests/SystemAudioTests.swift" -framework AppKit -framework AVFoundation -framework ScreenCaptureKit -framework CoreMedia
"$open_sesame_check/system-audio-tests"

bash scripts/check-vnc-native.sh

xcrun swiftc -o "$open_sesame_check/computer-model-tests" "$open_sesame_root/desktop/ComputerAgentModel.swift" "$open_sesame_root/desktop/tests/ComputerAgentModelTests.swift"
"$open_sesame_check/computer-model-tests"
xcrun swiftc -o "$open_sesame_check/computer-controller-tests" "$open_sesame_root/desktop/ComputerAgentModel.swift" "$open_sesame_root/desktop/ComputerPointer.swift" "$open_sesame_root/desktop/ComputerAgent.swift" "$open_sesame_root/desktop/tests/ComputerAgentTests.swift" -framework AppKit -framework ScreenCaptureKit -framework ImageIO -framework Security
"$open_sesame_check/computer-controller-tests"

xcrun swiftc -o "$open_sesame_check/computer-pointer-tests" "$open_sesame_root/desktop/ComputerPointer.swift" "$open_sesame_root/desktop/tests/ComputerPointerTests.swift" -framework AppKit
"$open_sesame_check/computer-pointer-tests"

xcrun swiftc -o "$open_sesame_check/speech-transcript-tests" "$open_sesame_root/desktop/SpeechTranscript.swift" "$open_sesame_root/desktop/tests/SpeechTranscriptTests.swift"
"$open_sesame_check/speech-transcript-tests"

xcrun swiftc -o "$open_sesame_check/terminal-clipboard-tests" "$open_sesame_root/desktop/TerminalClipboard.swift" "$open_sesame_root/desktop/tests/TerminalClipboardTests.swift" -framework AppKit
"$open_sesame_check/terminal-clipboard-tests"

xcrun swiftc -o "$open_sesame_check/image-export-tests" "$open_sesame_root/desktop/ImageExport.swift" "$open_sesame_root/desktop/tests/ImageExportTests.swift" -framework AppKit
"$open_sesame_check/image-export-tests"

xcrun swiftc -o "$open_sesame_check/speaker-diarization-tests" "$open_sesame_root/desktop/SpeakerDiarization.swift" "$open_sesame_root/desktop/tests/SpeakerDiarizationTests.swift" -framework AppKit -framework AVFoundation
"$open_sesame_check/speaker-diarization-tests" "$(command -v python3)"

xcrun swiftc -o "$open_sesame_check/local-media-player-tests" "$open_sesame_root/desktop/EmbeddedWebSurface.swift" "$open_sesame_root/desktop/LocalMediaPlayers.swift" "$open_sesame_root/desktop/tests/LocalMediaPlayersTests.swift" -framework AppKit -framework WebKit
"$open_sesame_check/local-media-player-tests"

xcrun swiftc -o "$open_sesame_check/transcript-export-tests" "$open_sesame_root/desktop/TranscriptExport.swift" "$open_sesame_root/desktop/tests/TranscriptExportTests.swift"
"$open_sesame_check/transcript-export-tests"

xcrun swiftc -o "$open_sesame_check/window-sizing-tests" "$open_sesame_root/desktop/WindowSizing.swift" "$open_sesame_root/desktop/tests/WindowSizingTests.swift" -framework AppKit
"$open_sesame_check/window-sizing-tests"
