#!/usr/bin/env python3
"""Verify the built app can import the exact packaged process bridge."""
import pathlib
import plistlib
import subprocess
import sys

app = pathlib.Path(sys.argv[1]).resolve()
resources = app / 'Contents/Resources'
for module in ('bridge.py', 'agent_monitor.py', 'process_workspace.py', 'agent_activity.py', 'computer_agent.py', 'computer_accounts.py'):
    if not (resources / module).is_file(): raise SystemExit('Missing bundled process module: ' + module)
subprocess.run([sys.executable, '-B', '-I', '-c', 'import sys;sys.path.insert(0,sys.argv[1]);import bridge,agent_monitor,process_workspace,agent_activity,computer_agent,computer_accounts', str(resources)], check=True, timeout=10)
info = plistlib.loads((app/'Contents/Info.plist').read_bytes())
if not info.get('NSAppleEventsUsageDescription'): raise SystemExit('Missing terminal Automation usage description')
print('PASS built app process imports and Automation usage description')
