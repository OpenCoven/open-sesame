"""Discovery and explicit process controls for recognized agent CLIs owned by this user.

OS scheduling states are not agent task/approval states. Arguments are used only
for executable identification and are never returned to the interface.
"""
import math
import os
import pathlib
import re
import shlex
import socket
import subprocess
import sys
import time

PROVIDERS = {'codex': 'Codex', 'claude': 'Claude Code', 'coven': 'Coven',
             'gemini': 'Gemini CLI', 'aider': 'Aider', 'opencode': 'OpenCode'}
SCRIPTS = {'@openai/codex/bin/codex.js': 'codex',
           '@anthropic-ai/claude-code/cli.js': 'claude',
           '@google/gemini-cli/dist/index.js': 'gemini'}


def provider(command):
    try:
        parts = shlex.split(command)
    except ValueError:
        # ps does not escape arbitrary prompt text; only inspect the executable.
        parts = command.split(maxsplit=2)
    if not parts:
        return None
    executable = pathlib.PurePath(parts[0]).name
    if executable in PROVIDERS:
        return executable
    if re.fullmatch(r'python(?:\d+(?:\.\d+)*)?', executable):
        if len(parts) > 2 and parts[1:3] == ['-m', 'aider']:
            return 'aider'
        if len(parts) > 1 and pathlib.PurePath(parts[1]).name == 'aider':
            return 'aider'
    if executable in ('node', 'nodejs', 'bun') and len(parts) > 1:
        script = parts[1]
        for suffix, name in SCRIPTS.items():
            if script.endswith('/' + suffix):
                return name
        if pathlib.PurePath(script).name in PROVIDERS:
            return pathlib.PurePath(script).name
    return None


def elapsed_seconds(value):
    try:
        days, clock = value.split('-', 1) if '-' in value else ('0', value)
        values = [int(v) for v in clock.split(':')]
        seconds = 0
        for value in values:
            seconds = seconds * 60 + value
        return max(0, int(days) * 86400 + seconds)
    except ValueError:
        return 0


def parse_processes(output, uid):
    processes, found = {}, {}
    for line in output.splitlines():
        fields = line.strip().split(None, 7)
        if len(fields) != 8:
            continue
        pid, ppid, owner, stat, cpu, rss, elapsed, command = fields
        try:
            pid, ppid, owner = int(pid), int(ppid), int(owner)
            cpu, rss = float(cpu), int(rss)
        except ValueError:
            continue
        if owner != uid or pid <= 0 or not math.isfinite(cpu):
            continue
        processes[pid] = ppid
        name = provider(command)
        if not name:
            continue
        state = {'R': 'running', 'S': 'sleeping', 'I': 'sleeping',
                 'T': 'stopped', 'D': 'blocked', 'U': 'blocked',
                 'Z': 'exited'}.get(stat[:1].upper(), 'unknown')
        found[pid] = {'pid': pid, 'provider': name, 'name': PROVIDERS[name],
                      'state': state, 'cpuPercent': max(0, round(cpu, 1)),
                      'memoryMB': round(max(0, rss) / 1024, 1),
                      'uptimeSeconds': elapsed_seconds(elapsed)}
    # npm launchers can wrap a second instance of the same provider. Report the
    # deepest agent executable, once, while retaining independent sessions.
    wrappers = set()
    for pid, entry in found.items():
        parent, visited = processes.get(pid), {pid}
        while parent and parent not in visited:
            visited.add(parent)
            if parent in found and found[parent]['provider'] == entry['provider']:
                wrappers.add(parent)
            parent = processes.get(parent)
    return sorted((v for k, v in found.items() if k not in wrappers),
                  key=lambda v: (v['name'], v['pid']))


def snapshot():
    if sys.platform not in ('darwin', 'linux'):
        raise ValueError('Agent discovery is available in the macOS desktop companion.')
    try:
        result = subprocess.run(
            ['ps', '-ww', '-u', str(os.getuid()), '-o',
             'pid=,ppid=,uid=,stat=,pcpu=,rss=,etime=,args='],
            capture_output=True, text=True, timeout=4, check=True,
            env={**os.environ, 'LC_ALL': 'C'})
    except (OSError, subprocess.SubprocessError):
        raise ValueError('Local process discovery is unavailable. Try refreshing in the desktop companion.') from None
    return {'agents': authorize_controls(parse_processes(result.stdout, os.getuid())),
            'machine': socket.gethostname(), 'scope': 'current-user',
            'updatedAt': int(time.time() * 1000), 'providers': list(PROVIDERS.values())}

# Short-lived capabilities bind dashboard actions to the exact discovered process.
# Commands are kept only in memory for identity checks and never leave this module.
import secrets
import signal
import threading

_control_lock = threading.Lock()
_controls = {}


def process_identities(pid=None):
    args = ['ps', '-ww', '-p', str(pid)] if pid is not None else ['ps', '-ww', '-u', str(os.getuid())]
    try:
        result = subprocess.run(args + ['-o', 'pid=,ppid=,uid=,lstart=,args='], capture_output=True, text=True, timeout=4, check=True, env={**os.environ, 'LC_ALL': 'C'})
    except (OSError, subprocess.SubprocessError):
        raise ValueError('Process changed or exited. Refresh before trying again.') from None
    identities = {}
    for line in result.stdout.splitlines():
        fields = line.strip().split(None, 8)
        if len(fields) != 9:
            continue
        try:
            number, parent, owner = map(int, fields[:3])
        except ValueError:
            continue
        if owner != os.getuid() or number <= 1 or not provider(fields[8]):
            continue
        identities[number] = (parent, owner, ' '.join(fields[3:8]), fields[8])
    return identities


def authorize_controls(agents):
    identities = process_identities() if agents else {}
    now = time.monotonic()
    with _control_lock:
        for token in list(_controls):
            if _controls[token]['expires'] < now:
                del _controls[token]
        for agent in agents:
            identity = identities.get(agent['pid'])
            if identity and provider(identity[3]) == agent['provider'] and len(_controls) < 1024:
                token = next((key for key, value in _controls.items() if value['pid'] == agent['pid'] and value['identity'] == identity), None) or secrets.token_urlsafe(32)
                _controls.setdefault(token, {'pid': agent['pid'], 'identity': identity, 'expires': now + 120})
                agent['controlToken'] = token
    return agents


def control_process(params):
    pid, token, action = params.get('pid'), params.get('token'), params.get('action')
    if type(pid) is not int or pid <= 1 or not isinstance(token, str) or len(token) > 128:
        raise ValueError('Refresh and select a current agent process.')
    signals = {'pause': signal.SIGSTOP, 'resume': signal.SIGCONT, 'stop': signal.SIGTERM}
    if action not in signals:
        raise ValueError('Choose Pause, Resume or Stop.')
    with _control_lock:
        entry = _controls.get(token)
        if not entry or entry['pid'] != pid or entry['expires'] < time.monotonic():
            raise ValueError('This process snapshot expired. Refresh before trying again.')
        current = process_identities(pid).get(pid)
        if current != entry['identity']:
            _controls.pop(token, None)
            raise ValueError('Process changed or exited. Refresh before trying again.')
        try:
            os.kill(pid, signals[action])
        except (ProcessLookupError, PermissionError, OSError):
            raise ValueError('The process could not be changed. Refresh to check its state.') from None
        _controls.pop(token, None)
    return {'pid': pid, 'action': action, 'signalSent': True}
