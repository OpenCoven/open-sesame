#!/usr/bin/env python3
"""Bound local checks and retire only their observed, identity-checked processes."""
import datetime
import json
import os
from pathlib import Path
import signal
import subprocess
import threading
import time


def processes():
    result = subprocess.run(['ps', '-axo', 'pid=,ppid=,pgid=,stat=,lstart='],
                            capture_output=True, text=True, timeout=5, check=True)
    rows = {}
    for line in result.stdout.splitlines():
        fields = line.split()
        if len(fields) >= 9:
            rows[int(fields[0])] = {'parent': int(fields[1]), 'group': int(fields[2]),
                                    'state': fields[3], 'birth': ' '.join(fields[4:])}
    return rows


def discover(rows, owned, root):
    if root in rows and root not in owned:
        owned[root] = rows[root]
    while True:
        added = False
        # start_new_session isolates the check's group. Its unreaped root and
        # identity-checked descendants anchor groups even after reparenting.
        groups = {row['group'] for pid, row in rows.items() if pid in owned
                  and row['birth'] == owned[pid]['birth'] and row['group'] > 0}
        for pid, row in rows.items():
            parent = row['parent']
            related = parent in owned and parent in rows and rows[parent]['birth'] == owned[parent]['birth']
            if pid not in owned and (related or row['group'] in groups):
                owned[pid] = row
                added = True
        if not added:
            return


def live_owned(owned):
    rows = processes()
    return {pid: row for pid, row in rows.items() if pid in owned
            and row['birth'] == owned[pid]['birth'] and not row['state'].startswith('Z')}


def run(command, *, cwd, log_path, timeout):
    started = time.monotonic()
    record = {'command': list(map(str, command)), 'cwd': str(cwd),
              'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'timeoutSeconds': timeout, 'timedOut': False, 'signals': []}
    log_path = Path(log_path)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    owned = {}
    process = None
    interrupted = None
    handlers = {}
    def stop(signum, _frame):
        raise SystemExit(128 + signum)
    if threading.current_thread() is threading.main_thread():
        for sig in (signal.SIGTERM, signal.SIGHUP):
            handlers[sig] = signal.signal(sig, stop)
    with log_path.open('w') as log:
        log.write(json.dumps(record) + '\n')
        log.flush()
        try:
            if not callable(getattr(os, 'waitid', None)) or not hasattr(os, 'WNOWAIT'):
                raise RuntimeError('Bounded checks require waitid/WNOWAIT (Python 3.13+ on macOS). No check was started.')
            processes()  # Fail before starting work if ownership cannot be inspected.
            process = subprocess.Popen(command, cwd=cwd, stdout=log, stderr=subprocess.STDOUT,
                                       start_new_session=True, env=dict(os.environ, PYTHONDONTWRITEBYTECODE='1'))
            record['rootPid'] = process.pid
            while True:
                discover(processes(), owned, process.pid)
                # Observe exit without reaping: retaining the root PID prevents
                # reuse of its group while we audit and retire orphaned helpers.
                if os.waitid(os.P_PID, process.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT) is not None:
                    break
                if time.monotonic() - started >= timeout:
                    record['timedOut'] = True
                    log.write('\nWATCHDOG TIMEOUT: check failed; retiring owned processes.\n')
                    log.flush()
                    break
                time.sleep(.1)
        except (KeyboardInterrupt, SystemExit) as error:
            interrupted = error
        except Exception as error:
            record['error'] = str(error)
        finally:
            for sig in handlers:
                signal.signal(sig, signal.SIG_IGN)
            # This includes PTY children that created a new session/process group.
            # Never match command strings or signal unrelated process groups.
            if process is not None:
                try:
                    discover(processes(), owned, process.pid)
                    for sig in (signal.SIGTERM, signal.SIGKILL):
                        discover(processes(), owned, process.pid)
                        for pid in sorted(live_owned(owned), key=lambda p: p == process.pid):
                            # Re-read identity immediately before each signal (PID reuse).
                            if pid not in live_owned(owned):
                                continue
                            try:
                                os.kill(pid, sig)
                                record['signals'].append({'pid': pid, 'signal': sig.name})
                            except ProcessLookupError:
                                pass
                        time.sleep(.1)
                    # All ownership checks/signals precede reaping the root.
                    try:
                        process.wait(timeout=.5)
                    except subprocess.TimeoutExpired:
                        pass
                    record['survivors'] = sorted(live_owned(owned))
                except Exception as error:
                    record.setdefault('error', str(error))
                    record.update(cleanupError=str(error), cleanupUncertain=True, survivors=None)
                    # The unreaped start_new_session root reserves its own group.
                    # If it was already reaped, never signal that numeric group.
                    if process.returncode is None:
                        for sig in (signal.SIGTERM, signal.SIGKILL):
                            try:
                                os.killpg(process.pid, sig)
                                record['signals'].append({'group': process.pid, 'signal': sig.name})
                            except ProcessLookupError:
                                pass
                            except OSError as signal_error:
                                record.setdefault('groupCleanupErrors', []).append(str(signal_error))
                            time.sleep(.1)
                        try:
                            process.wait(timeout=.5)
                        except subprocess.TimeoutExpired:
                            pass
                record['exitCode'] = process.poll()
            else:
                record.update(exitCode=None, survivors=[])
    record['ownedPids'] = sorted(owned)
    record['ownedProcesses'] = {str(pid): row for pid, row in owned.items()}
    record['seconds'] = round(time.monotonic() - started, 3)
    record['log'] = str(log_path)
    record['passed'] = (record['exitCode'] == 0 and not record['timedOut']
                        and not record['survivors'] and not record['signals']
                        and not record.get('cleanupUncertain')
                        and 'error' not in record and interrupted is None)
    log_path.with_suffix('.json').write_text(json.dumps(record, indent=2) + '\n')
    for sig, handler in handlers.items():
        signal.signal(sig, handler)
    if interrupted is not None:
        raise interrupted
    return record
