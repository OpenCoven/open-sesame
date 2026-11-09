#!/bin/bash
set -euo pipefail
vnc_test_dir="$(mktemp -d)"
trap 'rm -rf "$vnc_test_dir"' EXIT
xcrun swiftc desktop/VNCTransport.swift scripts/fixtures/vnc-transport.swift -o "$vnc_test_dir/test"
"$vnc_test_dir/test"
