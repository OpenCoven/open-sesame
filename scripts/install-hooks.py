#!/usr/bin/env python3
"""Install this repository's hooks only for the current worktree."""
import subprocess
import sys
existing = subprocess.run(['git', 'config', '--get', 'core.hooksPath'], capture_output=True, text=True).stdout.strip()
if existing and existing != '.githooks':
    sys.exit('Existing custom hooksPath preserved. Integrate the secret check into that hook before committing.')
subprocess.run(['git', 'config', 'extensions.worktreeConfig', 'true'], check=True)
subprocess.run(['git', 'config', '--worktree', 'core.hooksPath', '.githooks'], check=True)
print('Installed worktree-local pre-commit secret check. Gitleaks is required; missing scanners block commits.')
