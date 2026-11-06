"""Small, explicit macOS controls. No shell or user-supplied scripts."""
import subprocess
import sys

APPS = {'finder': 'com.apple.finder', 'safari': 'com.apple.Safari',
        'notes': 'com.apple.Notes', 'calendar': 'com.apple.iCal',
        'music': 'com.apple.Music', 'terminal': 'com.apple.Terminal',
        'calculator': 'com.apple.calculator', 'system settings': 'com.apple.systempreferences'}

def control(params):
    if sys.platform != 'darwin':
        raise ValueError('Computer controls are available in the macOS companion.')
    action, value = params.get('action'), params.get('value')
    if action == 'volume' and type(value) is int and 0 <= value <= 100:
        command = ['/usr/bin/osascript', '-e', 'set volume output volume ' + str(value)]
    elif action == 'mute' and type(value) is bool:
        command = ['/usr/bin/osascript', '-e', 'set volume output muted ' + ('true' if value else 'false')]
    elif action == 'open' and isinstance(value, str) and value in APPS:
        command = ['/usr/bin/open', '-b', APPS[value]]
    else:
        raise ValueError('Unsupported computer control.')
    result = subprocess.run(command, capture_output=True, text=True, timeout=8)
    if result.returncode:
        raise ValueError('macOS could not complete this control. Check that the app is installed and allow any requested permission.')
    return {'completed': True, 'action': action}
