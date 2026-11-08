#!/bin/bash
set -euo pipefail
open_sesame_root="$(cd "$(dirname "$0")/.." && pwd)"
open_sesame_notes_check="$(mktemp -d "${TMPDIR:-/tmp}/open-sesame-screen-notes.XXXXXX")"
trap 'rm -rf "$open_sesame_notes_check"' EXIT
xcrun swiftc -o "$open_sesame_notes_check/screen-notes-tests" "$open_sesame_root/desktop/ScreenNotes.swift" "$open_sesame_root/desktop/tests/ScreenNotesTests.swift" -framework AppKit -framework ScreenCaptureKit -framework Vision -framework ImageIO -framework CoreText
"$open_sesame_notes_check/screen-notes-tests"
