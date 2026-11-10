"""Discovery and explicit process controls for recognized agent CLIs owned by this user.

OS scheduling states are not agent task/approval states. Arguments are used only
for executable identification and are never returned to the interface.
"""
import hashlib
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
    if executable == 'coven-code': return 'coven'
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
    processes, found, launchers, native_agents = {}, {}, set(), set()
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
        try: executable = pathlib.PurePath(shlex.split(command)[0]).name
        except (ValueError, IndexError): executable = ''
        if executable in ('node', 'nodejs', 'bun', 'coven'): launchers.add(pid)
        if executable in (*PROVIDERS, 'coven-code'): native_agents.add(pid)
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
            if pid in native_agents and parent in launchers and parent in found and found[parent]['provider'] == entry['provider']:
                wrappers.add(parent)
            parent = processes.get(parent)
    retained = {pid: row for pid, row in found.items() if pid not in wrappers}
    for pid, row in retained.items():
        parent, visited = processes.get(pid), {pid}
        while parent and parent not in visited and parent not in retained:
            visited.add(parent); parent = processes.get(parent)
        row['parentAgentPid'] = parent if parent in retained and parent not in visited else None
        row['relationshipSource'] = 'process-ancestry'
    for pid, row in retained.items():
        row['childAgentCount'] = sum(child['parentAgentPid'] == pid for child in retained.values())
    return sorted(retained.values(), key=lambda v: (v['name'], v['pid']))


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


def agent_identity(pid, identity):
    return hashlib.sha256((socket.gethostname() + str(pid) + str(identity[1:3])).encode()).hexdigest()[:24]


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
                agent['id'] = agent_identity(agent['pid'], identity)
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


def process_context(pid):
    """Read cwd without exposing arguments or inspecting arbitrary file contents."""
    try:
        if sys.platform == 'linux':
            return os.readlink('/proc/%s/cwd' % pid)
        result = subprocess.run(['lsof', '-a', '-p', str(pid), '-d', 'cwd', '-Fn'],
                                capture_output=True, text=True, timeout=.5)
        return next((line[1:] for line in result.stdout.splitlines() if line.startswith('n/')), '')
    except (OSError, subprocess.SubprocessError):
        return ''


def process_directories(pids):
    if sys.platform == 'linux': return {pid: process_context(pid) for pid in pids}
    try:
        result = subprocess.run(['lsof', '-a', '-p', ','.join(map(str, pids)), '-d', 'cwd', '-Fpn'], capture_output=True, text=True, timeout=1)
        current, paths = None, {}
        for line in result.stdout.splitlines():
            if line.startswith('p') and line[1:].isdigit(): current = int(line[1:])
            elif line.startswith('n/') and current in pids: paths[current] = line[1:]
        return paths
    except (OSError, subprocess.SubprocessError): return {}


def repository_context(cwd):
    if not cwd:
        return {}
    try:
        result = subprocess.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel',
                                 '--git-common-dir'],
                                capture_output=True, text=True, timeout=.5,
                                env={**os.environ, 'GIT_OPTIONAL_LOCKS': '0'})
        values = result.stdout.splitlines()
        if result.returncode or len(values) != 2:
            return {}
        root, common = values
        branch_result = subprocess.run(['git', '-C', cwd, 'symbolic-ref', '--quiet', '--short', 'HEAD'], capture_output=True, text=True, timeout=.5)
        branch = branch_result.stdout.strip() if branch_result.returncode == 0 else 'Detached HEAD'
        return {'root': root, 'name': pathlib.Path(root).name, 'branch': branch,
                'commonDirectory': str((pathlib.Path(cwd) / common).resolve())}
    except (OSError, subprocess.SubprocessError):
        return {}


def enrich_snapshot(result, sessions, screens=None, *, lookup_only=False):
    # One bounded ancestry query per scan, never return command arguments.
    try:
        rows = subprocess.run(['ps', '-u', str(os.getuid()), '-o', 'pid=,ppid='],
                              capture_output=True, text=True, timeout=1, check=True)
        parents = dict(tuple(map(int, line.split())) for line in rows.stdout.splitlines() if len(line.split()) == 2)
    except (OSError, ValueError, subprocess.SubprocessError):
        parents = {}
    if not isinstance(screens, dict): screens = {}
    from process_workspace import tmux_panes, classify, foreground
    panes = tmux_panes()
    deadline = time.monotonic() + 3
    directories = process_directories([a['pid'] for a in result['agents']]) if result['agents'] and not lookup_only else {}
    repos = {}
    for agent in result['agents']:
        agent['activity'] = {'state': 'unknown', 'source': 'none', 'reason': 'No activity integration'}
        agent['terminal'] = {'kind': 'unavailable', 'reason': 'No verified terminal association'}
        pid, visited = agent['pid'], set()
        while pid and pid not in visited:
            visited.add(pid)
            match = next((s for s in list(sessions.values()) if not s.closed and s.pid == pid), None)
            if match:
                agent['terminal'] = {'kind': 'owned', 'id': match.id}
                break
            pid = parents.get(pid)
        if agent['terminal']['kind'] == 'unavailable':
            pid, visited = agent['pid'], set()
            while pid and pid not in visited:
                visited.add(pid)
                pane = next((p for p in panes if p['pid'] == str(pid)), None)
                if pane:
                    agent['terminal'] = {'kind': 'tmux', **pane}
                    try:
                        if lookup_only or time.monotonic() >= deadline: break
                        screen = subprocess.run(['tmux', '-S', pane['socket'], 'capture-pane', '-p', '-t', pane['pane']], capture_output=True, text=True, timeout=.5, check=True).stdout
                        if foreground(agent['pid'], agent['terminal'], sessions):
                            agent['activity'] = classify(agent['provider'], screen)
                    except (OSError, subprocess.SubprocessError): pass
                    break
                pid = parents.get(pid)
        if lookup_only: continue
        if agent['terminal']['kind'] == 'owned':
            screen = (screens or {}).get(agent['terminal']['id'], '')
            if time.monotonic() < deadline and isinstance(screen, str) and len(screen) <= 8192 and foreground(agent['pid'], agent['terminal'], sessions):
                agent['activity'] = classify(agent['provider'], screen)
        from agent_activity import activity
        event = activity(agent.get('id'))
        if event: agent['activity'] = event
        cwd = directories.get(agent['pid'], '')
        agent['cwd'] = cwd
        if cwd and time.monotonic() < deadline:
            if cwd not in repos:
                repos[cwd] = repository_context(cwd)
            agent['repository'] = repos[cwd]
    return result


def terminal_target(params):
    import shlex
    with _control_lock:
        entry = _controls.get(params.get('token'))
        if not entry or entry['pid'] != params.get('pid') or entry['expires'] < time.monotonic() or process_identities(entry['pid']).get(entry['pid']) != entry['identity']:
            raise ValueError('Session changed. Refresh before opening.')
    agent = {'pid': entry['pid'], 'provider': provider(entry['identity'][3])}
    target = enrich_snapshot({'agents':[agent]}, {}, lookup_only=True)['agents'][0]['terminal']
    if target['kind'] == 'tmux':
        return {'kind':'tmux', 'command':shlex.join(['tmux','-S',target['socket'],'attach-session','-t',target['session'],';','select-window','-t',target['window'],';','select-pane','-t',target['pane']])}
    return focus_native_terminal(entry['pid'])


def focus_native_terminal(pid):
    tty = subprocess.run(['ps', '-p', str(pid), '-o', 'tty='], capture_output=True, text=True, timeout=1, check=True).stdout.strip()
    if not re.fullmatch(r'ttys[0-9]+', tty):
        raise ValueError('This process has no supported native terminal.')
    script = '''on run argv
set targetTTY to "/dev/" & item 1 of argv
if application "Terminal" is running then
 tell application "Terminal"
  repeat with w in windows
   repeat with t in tabs of w
    if tty of t is targetTTY then
     set selected tab of w to t
     set index of w to 1
     activate
     return "focused"
    end if
   end repeat
  end repeat
 end tell
end if
if application "iTerm2" is running then
 tell application "iTerm2"
  repeat with w in windows
   repeat with t in tabs of w
    repeat with s in sessions of t
     if tty of s is targetTTY then
      select s
      select t
      select w
      activate
      return "focused"
     end if
    end repeat
   end repeat
  end repeat
 end tell
end if
error "No matching Terminal or iTerm2 session."
end run'''
    if not any(p.exists() for base in (pathlib.Path('/Applications'), pathlib.Path.home()/'Applications') for p in (base/'iTerm.app', base/'iTerm2.app')):
        script = script[:script.index('if application \"iTerm2\"')] + 'error \"No matching Terminal session.\"\nend run'
    try:
        subprocess.run(['osascript', '-e', script, tty], capture_output=True, text=True, timeout=6, check=True)
    except (OSError, subprocess.SubprocessError):
        raise ValueError('Terminal unavailable. Enable Automation access for Terminal/iTerm2 and verify the session is still open.') from None
    return {'kind':'native', 'focused':True}
