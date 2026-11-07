#!/bin/bash
set -euo pipefail
open_sesame_root="$(cd "$(dirname "$0")/.." && pwd)"
open_sesame_app="$open_sesame_root/build/Open Sesame.app"
open_sesame_version="${OPEN_SESAME_VERSION:-0.0.0}"
[[ "$open_sesame_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Use a numeric release version such as 0.0.0.'; exit 1; }
command -v xcrun >/dev/null || { echo 'Install Xcode Command Line Tools first: xcode-select --install'; exit 1; }
open_sesame_python="$(command -v python3 || true)"
[[ -n "$open_sesame_python" ]] || { echo 'Install Python 3 before building Open Sesame.'; exit 1; }
rm -rf "$open_sesame_app"
mkdir -p "$open_sesame_app/Contents/MacOS" "$open_sesame_app/Contents/Resources/web"
xcrun swiftc -O -target "$(uname -m)-apple-macosx13.0" -o "$open_sesame_app/Contents/MacOS/OpenSesame" "$open_sesame_root/desktop/OpenSesame.swift" "$open_sesame_root/desktop/VoiceInput.swift" "$open_sesame_root/desktop/AudioRecorder.swift" "$open_sesame_root/desktop/GlobalShortcut.swift" "$open_sesame_root/desktop/EmbeddedWebSurface.swift" -framework Carbon -framework AppKit -framework WebKit -framework Speech -framework AVFoundation
cp -R "$open_sesame_root/dist/." "$open_sesame_app/Contents/Resources/web/"
rm -rf "$open_sesame_app/Contents/Resources/web/downloads" "$open_sesame_app/Contents/Resources/web/.openai"
cp "$open_sesame_root/desktop/coven_runtime.py" "$open_sesame_root/desktop/agent_monitor.py" "$open_sesame_root/desktop/live_agents.py" "$open_sesame_root/desktop/bridge.py" "$open_sesame_root/desktop/feeds.py" "$open_sesame_root/desktop/reader.py" "$open_sesame_root/desktop/controller.py" "$open_sesame_root/desktop/computer_controls.py" "$open_sesame_app/Contents/Resources/"
printf '%s\n' "$open_sesame_python" > "$open_sesame_app/Contents/Resources/python-path.txt"
# Keep the installed bundle identity stable so existing website data and permissions survive.
cat > "$open_sesame_app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>OpenSesame</string><key>CFBundleDisplayName</key><string>Open Sesame</string><key>CFBundleIdentifier</key><string>com.perch.widgetstudio</string><key>CFBundleName</key><string>Open Sesame</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>LSUIElement</key><true/><key>LSMinimumSystemVersion</key><string>13.0</string><key>NSHighResolutionCapable</key><true/><key>NSSpeechRecognitionUsageDescription</key><string>Open Sesame transcribes speech only when you click a voice control or hold the widget to speak.</string><key>NSMicrophoneUsageDescription</key><string>Open Sesame uses your microphone only when you start dictation, transcription, or audio recording.</string></dict></plist>
PLIST
"$open_sesame_python" - "$open_sesame_app/Contents/Info.plist" "$open_sesame_version" <<'PY'
import pathlib, plistlib, sys
path = pathlib.Path(sys.argv[1])
info = plistlib.loads(path.read_bytes())
info['CFBundleShortVersionString'] = sys.argv[2]
info['CFBundleVersion'] = sys.argv[2]
path.write_bytes(plistlib.dumps(info))
PY
codesign --force --deep --sign - "$open_sesame_app"
printf 'Built %s\n' "$open_sesame_app"
