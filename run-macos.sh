#!/bin/bash
set -euo pipefail
open_sesame_root="$(cd "$(dirname "$0")" && pwd)"
bash "$open_sesame_root/desktop/build-macos.sh"
open "$open_sesame_root/build/Open Sesame.app"
