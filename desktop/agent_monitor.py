"""Read-only discovery of recognized local agent CLIs, scoped to this user.

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
    return {'agents': parse_processes(result.stdout, os.getuid()),
            'machine': socket.gethostname(), 'scope': 'current-user',
            'updatedAt': int(time.time() * 1000), 'providers': list(PROVIDERS.values())}
