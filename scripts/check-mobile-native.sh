#!/bin/bash
set -euo pipefail
open_sesame_root="$(cd "$(dirname "$0")/.." && pwd)"
open_sesame_check="$(mktemp -d "${TMPDIR:-/tmp}/open-sesame-mobile-check.XXXXXX")"
trap 'rm -rf "$open_sesame_check"' EXIT
node --input-type=module - > "$open_sesame_check/vectors.json" <<'JS'
import {createHash} from 'node:crypto';const rows=['Café 🪷\n第二行','e\u0301 / é \u2028 \u2029 \b \t " \\','<script>\u0000'];console.log(JSON.stringify(rows.map(text=>{const values={'open-sesame-items-v1':JSON.stringify([{id:'same-id',text}])};return {values,digest:createHash('sha256').update(JSON.stringify(values)).digest('hex')}})))
JS
xcrun swiftc "$open_sesame_root/ios/Sources/WorkspaceStore.swift" "$open_sesame_root/ios/Sources/MobileBoundary.swift" "$open_sesame_root/ios/Sources/MobileFiles.swift" "$open_sesame_root/ios/Sources/MobileSessionClock.swift" "$open_sesame_root/ios/Tests/WorkspaceStoreTests.swift" -lsqlite3 -o "$open_sesame_check/native-tests"
"$open_sesame_check/native-tests" "$open_sesame_check/vectors.json"
