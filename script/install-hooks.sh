#!/usr/bin/env bash
# Install git hooks for open-sesame.
#
# Usage: script/install-hooks.sh
#
# What this does:
#   1. Checks gitleaks is available (installs via brew if missing on macOS)
#   2. Copies the pre-commit hook into .git/hooks/

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS_DIR="${ROOT}/.git/hooks"
HOOK_SRC="${ROOT}/script/hooks/pre-commit"
HOOK_DST="${HOOKS_DIR}/pre-commit"

say() { printf "\033[1;34m==> %s\033[0m\n" "$*"; }
ok()  { printf "\033[1;32m  ✓ %s\033[0m\n" "$*"; }
warn(){ printf "\033[1;33m  ⚠ %s\033[0m\n" "$*"; }

# --- gitleaks ---
say "Checking for gitleaks"
if command -v gitleaks &>/dev/null; then
    ok "gitleaks $(gitleaks version) already installed"
elif [[ "$(uname)" == "Darwin" ]] && command -v brew &>/dev/null; then
    say "Installing gitleaks via Homebrew"
    brew install gitleaks
    ok "gitleaks installed"
else
    warn "gitleaks not found. Install it manually: https://github.com/gitleaks/gitleaks#installing"
fi

# --- pre-commit hook ---
say "Installing pre-commit hook"
if [[ ! -d "${HOOKS_DIR}" ]]; then
    echo "Error: .git/hooks directory not found. Run this from the repo root."
    exit 1
fi

if [[ -f "${HOOK_DST}" ]] && [[ ! -L "${HOOK_DST}" ]]; then
    # Preserve an existing custom hook by chaining it.
    if grep -q "gitleaks" "${HOOK_DST}" 2>/dev/null; then
        ok "pre-commit hook already contains gitleaks — skipping"
    else
        warn "pre-commit hook already exists (not ours). Appending gitleaks call."
        cat "${HOOK_SRC}" >> "${HOOK_DST}"
    fi
else
    cp "${HOOK_SRC}" "${HOOK_DST}"
    chmod +x "${HOOK_DST}"
    ok "pre-commit hook installed"
fi

echo ""
ok "Hooks installed. Every commit will now be scanned for secrets."
echo "   To bypass (not recommended): git commit --no-verify"
