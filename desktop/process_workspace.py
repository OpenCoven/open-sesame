"""Bounded session associations and metadata-only activity history."""
import json
import os
import pathlib
import re
import subprocess
import threading
import time
import math
import sys
import tempfile


def run(args, timeout=1):
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=True).stdout


def tmux_panes():
    try:
        rows = run(['tmux', 'list-panes', '-a', '-F', '#{socket_path}\t#{session_id}\t#{window_id}\t#{pane_id}\t#{pane_pid}\t#{pane_tty}'])
        return [dict(zip(('socket', 'session', 'window', 'pane', 'pid', 'tty'), row.split('\t'))) for row in rows.splitlines() if len(row.split('\t')) == 6]
    except (OSError, subprocess.SubprocessError):
        return []


# Only match the live bottom UI, never generic prose mentioning approval.
def classify(provider, screen):
    if provider not in ('codex', 'claude'):
        return {'state': 'unknown', 'source': 'none', 'reason': 'No screen rules for provider'}
    bottom = '\n'.join(screen.splitlines()[-12:]).strip()
    rules = [('waiting', r'(?m)^\s*(?:Would you like to (?:run|make).*|Do you want to proceed\?|Claude needs your permission.*)\s*$'),
             ('working', r'(?m)^\s*(?:[✻✽✶✳✢] .*…|.*[•·] esc to interrupt)\s*$')]
    for state, pattern in rules:
        if state == 'waiting' and not re.search(r'(?m)^\s*[❯>]?\s*[12][.)]\s+(?:Yes|No|Allow|Approve)', bottom): continue
        if re.search(pattern, bottom):
            return {'state': state, 'source': 'screen-v1-inferred', 'reason': 'Known live terminal UI'}
    return {'state': 'unknown', 'source': 'screen-v1-inferred', 'reason': 'No known live terminal UI'}


class History:
    def __init__(self, path=None):
        base = pathlib.Path.home() / ('Library/Application Support/Open Sesame' if sys.platform == 'darwin' else '.local/state/open-sesame')
        self.path = pathlib.Path(path or base / 'process-history.json')
        self.lock = threading.Lock()
        self.rows = {}
        try:
            if self.path.stat().st_size > 8_000_000: raise ValueError('History exceeds local metadata limit')
            value = json.loads(self.path.read_text())
            if isinstance(value, dict): self.rows = value
        except (OSError, ValueError): pass
        self.rows = self.valid_rows(self.rows)

    @staticmethod
    def valid_rows(rows):
        valid = {}
        states = {'working', 'waiting', 'ready', 'completed', 'unknown', 'exited'}
        for key, row in list(rows.items())[:256]:
            if not isinstance(key, str) or not isinstance(row, dict) or not isinstance(row.get('lastSeen'), (int, float)) or not math.isfinite(row['lastSeen']) or not isinstance(row.get('intervals'), list): continue
            intervals = [i for i in row['intervals'][-256:] if isinstance(i, dict) and i.get('state') in states and all(isinstance(i.get(k), (int, float)) and math.isfinite(i[k]) for k in ('start', 'end')) and i['end'] >= i['start']]
            valid[key] = {**row, 'id':key, 'name':str(row.get('name','Agent'))[:128], 'repository':row.get('repository') if isinstance(row.get('repository'),dict) else {}, 'cwd':row.get('cwd') if isinstance(row.get('cwd'),str) else '', 'provider':row.get('provider') if isinstance(row.get('provider'),str) else '', 'intervals': intervals}
        return valid

    def update(self, agents, now=None):
        now = int(time.time()*1000) if now is None else now
        cutoff = now - 7*86400000
        with self.lock:
            self.rows = {key: row for key, row in self.rows.items() if isinstance(row, dict) and isinstance(row.get('lastSeen'), (int,float)) and row['lastSeen'] > cutoff and isinstance(row.get('intervals'), list)}
            for a in agents:
                if not a.get('id'): continue
                row = self.rows.setdefault(a['id'], {'id':a['id'], 'name':a['name'], 'intervals':[], 'lastSeen':now})
                intervals = row['intervals']
                state = a['activity']['state']
                row['repository'] = a.get('repository', {})
                row['pid'] = a['pid'] if 'pid' in a else None
                row['provider'] = a.get('provider', '')
                row['cwd'] = a.get('cwd', '')
                if intervals and intervals[-1]['state'] == state and now-row['lastSeen'] <= 15000:
                    intervals[-1]['end'] = now
                else:
                    intervals.append({'start':now, 'end':now, 'state':state})
                if state == 'waiting': a['activity'].setdefault('since', intervals[-1]['start'])
                row['lastSeen'] = now
                row['intervals'] = [i for i in intervals if i['end'] >= cutoff][-256:]
            self.rows = dict(sorted(self.rows.items(), key=lambda pair:pair[1]['lastSeen'], reverse=True)[:256])
            self.path.parent.mkdir(parents=True, exist_ok=True)
            fd, temp = tempfile.mkstemp(prefix='.process-history-', dir=self.path.parent)
            try:
                with os.fdopen(fd, 'w') as stream: json.dump(self.rows, stream)
                os.replace(temp, self.path)
            finally:
                pathlib.Path(temp).unlink(missing_ok=True)
            return list(self.rows.values())

    def clear(self):
        with self.lock:
            self.rows = {}
            self.path.unlink(missing_ok=True)


def foreground(pid, terminal, sessions):
    """Compare job and terminal foreground groups without opening another tty."""
    try:
        values = run(['ps', '-p', str(pid), '-o', 'pgid=,tpgid='], timeout=.3).split()
        return len(values) == 2 and int(values[0]) > 0 and int(values[0]) == int(values[1])
    except (OSError, ValueError, subprocess.SubprocessError):
        return False
