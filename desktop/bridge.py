#!/usr/bin/env python3
"""Open Sesame's stdio PTY/SSH bridge, with an optional loopback iMessage receiver."""
from controller import Controller
from computer_controls import control as computer_control
from live_agents import LiveAgents, agent_status
from agent_monitor import snapshot as agent_snapshot, control_process as agent_control
from coven_runtime import CovenRuntime
import argparse
import base64
import errno
import fcntl
import json
import os
import pathlib
import pty
import re
import select
import shlex
import shutil
import signal
import socket
import struct
import sys
import termios
import threading
import time
from feeds import fetch_feed
from reader import fetch_document, fetch_pdf


class Session:
    def __init__(self, session_id, params, emit):
        self.id = session_id
        self.emit = emit
        self.closed = False
        self.lock = threading.Lock()
        self.close_lock = threading.Lock()
        mode = params.get('mode', 'local')
        launcher = params.get('launcher', 'shell')
        if launcher not in ('shell', 'coven', 'bash'):
            raise ValueError('Choose Shell, Coven agent, or Bash command.')
        prompt = params.get('prompt', '')
        if not isinstance(prompt, str) or '\0' in prompt or len(prompt) > 2000:
            raise ValueError('Use a request under 2000 characters.')
        if launcher == 'bash' and not prompt.strip():
            raise ValueError('Enter a Bash command before launching.')
        task = 'Task: ' + prompt if prompt else ''
        cwd = params.get('cwd') or str(pathlib.Path.home())
        if not isinstance(cwd, str) or '\0' in cwd or len(cwd) > 4096:
            raise ValueError('Choose a valid project folder.')
        if mode == 'local':
            try:
                folder = pathlib.Path(cwd).expanduser().resolve(strict=True)
            except (FileNotFoundError, NotADirectoryError):
                raise ValueError('Project folder not found on this machine. Choose an existing folder.') from None
            if not folder.is_dir():
                raise ValueError('The project folder must be a directory.')
            shell = os.environ.get('SHELL') or ('/bin/zsh' if sys.platform == 'darwin' else '/bin/bash')
            if not os.path.isfile(shell) or not os.access(shell, os.X_OK):
                shell = '/bin/sh'
            args = ([shell, '-l', '-i', '-c', 'exec coven "$1"', 'open-sesame-agent', task] if task else [shell, '-l', '-i', '-c', 'exec coven']) if launcher == 'coven' else [shell, '-l']
            if launcher == 'bash':
                args = [shutil.which('bash') or '/bin/bash', '-l', '-c', prompt]
        elif mode == 'ssh':
            host, user = params.get('host', ''), params.get('user', '')
            if not isinstance(host, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.:[\]_-]{0,252}', host):
                raise ValueError('Enter an SSH hostname, tailnet name, or IP address.')
            if user and (not isinstance(user, str) or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_.-]{0,63}', user)):
                raise ValueError('Enter a valid SSH user.')
            executable = shutil.which('ssh')
            if not executable:
                raise ValueError('OpenSSH is not installed on this machine.')
            destination = (user + '@' if user else '') + host
            remote = ('cd -- ' + shlex.quote(cwd) + ' && ' if params.get('cwd') else '') + 'exec "${SHELL:-/bin/sh}" -l'
            if launcher == 'coven':
                remote += ' -i -c ' + shlex.quote('exec coven "$1"' if task else 'exec coven')
                if task:
                    remote += ' open-sesame-agent ' + shlex.quote(task)
            if launcher == 'bash':
                remote = ('cd -- ' + shlex.quote(cwd) + ' && ' if params.get('cwd') else '') + 'exec bash -l -c ' + shlex.quote(prompt)
            args = [executable, '-tt', destination, remote]
            folder = pathlib.Path.home()
        else:
            raise ValueError('Choose local machine or SSH.')
        env = dict(os.environ, TERM='xterm-256color', COLORTERM='truecolor')
        # forkpty supplies a controlling terminal, preserving readline and job control.
        pid, master = pty.fork()
        if pid == 0:
            try:
                os.chdir(folder)
                os.execvpe(args[0], args, env)
            except Exception:
                os.write(2, b'Open Sesame could not start the shell.\r\n')
                os._exit(127)
        self.pid, self.master = pid, master
        try:
            os.set_blocking(self.master, False)
            self.resize(params.get('cols', 80), params.get('rows', 24))
        except Exception:
            self.close()
            raise
        self.reader = threading.Thread(target=self._read, daemon=True)

    def start(self):
        self.reader.start()

    def _read(self):
        try:
            while not self.closed:
                if not select.select([self.master], [], [], .1)[0]:
                    continue
                with self.lock:
                    if self.closed:
                        break
                    try:
                        data = os.read(self.master, 16384)
                    except BlockingIOError:
                        continue
                if not data:
                    break
                self.emit({'event': 'terminal.data', 'id': self.id, 'data': base64.b64encode(data).decode('ascii')})
        except OSError as error:
            if error.errno not in (errno.EIO, errno.EBADF):
                self.emit({'event': 'terminal.error', 'id': self.id, 'message': 'Terminal stream ended.'})
        finally:
            self.close()
            self.emit({'event': 'terminal.exit', 'id': self.id})

    def write(self, data, binary=False):
        if self.closed:
            raise ValueError('This shell has ended. Reopen the pane to reconnect.')
        if not isinstance(data, str) or len(data) > 131072:
            raise ValueError('Terminal input is too large.')
        encoded = base64.b64decode(data, validate=True) if binary else data.encode('utf8')
        offset = 0
        try:
            while offset < len(encoded):
                with self.lock:
                    if self.closed:
                        raise ValueError('This shell has ended. Reopen the pane to reconnect.')
                    try:
                        written = os.write(self.master, encoded[offset:])
                    except BlockingIOError:
                        written = 0
                offset += written
                if not written:
                    select.select([], [self.master], [], .1)
        except OSError:
            if self.closed:
                raise ValueError('This shell has ended. Reopen the pane to reconnect.') from None
            raise

    def resize(self, cols, rows):
        with self.lock:
            if self.closed:
                return
            cols, rows = max(10, min(400, int(cols))), max(3, min(200, int(rows)))
            fcntl.ioctl(self.master, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))

    def close(self):
        # Every caller waits for cleanup, including a concurrent reader exit.
        with self.close_lock:
            self._close()

    def _close(self):
        if self.closed:
            return
        self.closed = True
        # Blocking reads can deadlock close(master) on macOS; reads/writes are
        # nonblocking and serialized with descriptor closure. Close the master
        # before waiting: a killed child can remain in tty exit until this close.
        with self.lock:
            try:
                os.close(self.master)
            except OSError:
                pass
        for sig in (signal.SIGHUP, signal.SIGTERM, signal.SIGKILL):
            # A fast command may already have exited (killpg on its empty
            # group can return EPERM on macOS). Reap before signalling.
            try:
                pid, _ = os.waitpid(self.pid, os.WNOHANG)
                if pid:
                    return
            except ChildProcessError:
                return
            try:
                os.killpg(self.pid, sig)
            except (ProcessLookupError, PermissionError):
                # forkpty's parent can return before the child creates its
                # group; an exiting macOS group can also reject killpg.
                # Our unreaped direct child is safe to signal in both cases.
                try:
                    os.kill(self.pid, sig)
                except ProcessLookupError:
                    pass
            for _ in range(8):
                try:
                    pid, _ = os.waitpid(self.pid, os.WNOHANG)
                    if pid:
                        return
                except ChildProcessError:
                    return
                time.sleep(.015)
        raise RuntimeError('The terminal child did not exit after termination.')


class Bridge:
    def __init__(self, emit):
        self.emit = emit
        self.sessions = {}
        self.feed_slots = threading.BoundedSemaphore(3)
        self.controller = None
        self.live = LiveAgents()
        self.live_slot = threading.BoundedSemaphore(1)
        self.agent_scan_slot = threading.BoundedSemaphore(1)
        self.coven = CovenRuntime(emit)
        self.coven_slots = threading.BoundedSemaphore(6)
        self.coven_threads = set()
        self.coven_threads_lock = threading.Lock()

    def handle(self, message):
        request_id = message.get('requestId')
        if message.get('method') in ('coven.status', 'coven.familiars', 'coven.open', 'coven.new', 'coven.send', 'coven.cancel'):
            method, params = message['method'], message.get('params') or {}
            if not isinstance(params, dict):
                self.emit({'requestId': request_id, 'error': 'Invalid Coven request.'}); return
            if method == 'coven.cancel':
                try: self.emit({'requestId': request_id, 'result': self.coven.cancel(params.get('runId'))})
                except Exception as error: self.emit({'requestId': request_id, 'error': str(error)[:2048]})
                return
            if not self.coven_slots.acquire(blocking=False):
                self.emit({'requestId': request_id, 'error': 'Coven is busy. Try again shortly.'}); return
            def coven_request():
                try:
                    if method == 'coven.status': result = self.coven.status()
                    elif method == 'coven.familiars': result = self.coven.familiars()
                    elif method == 'coven.open': result = self.coven.open(params.get('familiarId'))
                    elif method == 'coven.new': result = self.coven.open(params.get('familiarId'), new=True, expected=params.get('conversationId'))
                    else: result = self.coven.send(params)
                    self.emit({'requestId': request_id, 'result': result})
                except Exception as error:
                    self.emit({'requestId': request_id, 'error': str(error)[:2048]})
                finally:
                    self.coven_slots.release()
                    with self.coven_threads_lock: self.coven_threads.discard(threading.current_thread())
            thread = threading.Thread(target=coven_request, daemon=True)
            with self.coven_threads_lock: self.coven_threads.add(thread)
            thread.start(); return
        if message.get('method') in ('agents.snapshot', 'agents.control'):
            if not self.agent_scan_slot.acquire(blocking=False):
                self.emit({'requestId': request_id, 'error': 'An agent scan is already running.'})
                return
            def scan_agents():
                try:
                    self.emit({'requestId': request_id, 'result': agent_snapshot() if message['method'] == 'agents.snapshot' else agent_control(message.get('params') or {})})
                except Exception as error:
                    self.emit({'requestId': request_id, 'error': str(error)[:300]})
                finally:
                    self.agent_scan_slot.release()
            threading.Thread(target=scan_agents, daemon=True).start()
            return
        if message.get('method') == 'live.ask':
            if not self.live_slot.acquire(blocking=False):
                self.emit({'requestId': request_id, 'error': 'An answer is already running.'})
                return
            def answer():
                try:
                    result = self.live.answer(message.get('params') or {})
                    self.emit({'requestId': request_id, 'result': result})
                except Exception as error:
                    self.emit({'requestId': request_id, 'error': str(error)[:300]})
                finally:
                    self.live_slot.release()
            threading.Thread(target=answer, daemon=True).start()
            return
        if message.get('method') in ('feeds.fetch', 'reading.fetch', 'reading.pdf'):
            if not self.feed_slots.acquire(blocking=False):
                self.emit({'requestId': request_id, 'error': 'Three feeds are already loading. Try again shortly.'})
                return
            def fetch():
                try:
                    params = message.get('params') or {}
                    self.emit({'requestId': request_id, 'result': {'feeds.fetch':fetch_feed,'reading.fetch':fetch_document,'reading.pdf':fetch_pdf}[message['method']](params.get('url', ''))})
                except Exception as error:
                    self.emit({'requestId': request_id, 'error': str(error)[:300]})
                finally:
                    self.feed_slots.release()
            threading.Thread(target=fetch, daemon=True).start()
            return
        try:
            method, params = message.get('method'), message.get('params') or {}
            if not isinstance(params, dict):
                raise ValueError('Invalid request.')
            result = self.call(method, params)
            self.emit({'requestId': request_id, 'result': result})
            if method == 'terminal.open':
                self.sessions[params['id']].start()
        except Exception as error:
            self.emit({'requestId': request_id, 'error': str(error)[:300]})

    def call(self, method, params):
        if method == 'computer.control':
            return computer_control(params)
        if method.startswith('controller.'):
            if method == 'controller.start':
                if self.controller: self.controller.close(); self.controller = None
                self.controller = Controller(params.get('sender'), params.get('chat'), params.get('provider','bluebubbles'), allow_self=params.get('allowSelf',False))
                return self.controller.info()
            if method == 'controller.stop':
                if self.controller: self.controller.close(); self.controller = None
                return {'running': False}
            if method == 'controller.status': return self.controller.info() if self.controller else {'running': False}
            if not self.controller: raise ValueError('Start the iMessage controller first.')
            if method == 'controller.poll': return self.controller.poll()
            if method == 'controller.ack': return self.controller.ack(params.get('id'), params.get('result'))
            raise ValueError('Unsupported controller action.')
        if method == 'live.agents':
            return agent_status()
        if method == 'agents.snapshot':
            return agent_snapshot()
        if method == 'agents.control':
            return agent_control(params)
        if method == 'system.info':
            return {'available': True, 'platform': sys.platform, 'machine': socket.gethostname(), 'home': str(pathlib.Path.home()), 'shell': os.environ.get('SHELL') or '/bin/sh'}
        if method == 'project.chooseFolder':
            raise ValueError('Choose Folder is available in the macOS app. Enter a folder path here.')
        if method == 'window.size':
            return True
        session_id = params.get('id', '')
        if not isinstance(session_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', session_id):
            raise ValueError('Invalid pane ID.')
        if method == 'terminal.open':
            previous = self.sessions.pop(session_id, None)
            if previous:
                previous.close()
            if sum(not s.closed for s in self.sessions.values()) >= 16:
                raise ValueError('Close a shell before opening more than 16 active sessions.')
            session = Session(session_id, params, self.emit)
            self.sessions[session_id] = session
            return {'id': session_id, 'pid': session.pid, 'machine': socket.gethostname() if params.get('mode') != 'ssh' else params.get('host')}
        session = self.sessions.get(session_id)
        if not session:
            raise ValueError('Open this shell before sending input.')
        if method == 'terminal.input':
            session.write(params.get('data', ''), params.get('binary') is True)
        elif method == 'terminal.resize':
            session.resize(params.get('cols', 80), params.get('rows', 24))
        elif method == 'terminal.close':
            session.close()
            self.sessions.pop(session_id, None)
        else:
            raise ValueError('Unsupported desktop action.')
        return True

    def close(self):
        self.coven.close()
        with self.coven_threads_lock: threads = list(self.coven_threads)
        deadline = time.monotonic() + 6
        for thread in threads: thread.join(max(0, deadline - time.monotonic()))
        self.live.close()
        if self.controller: self.controller.close(); self.controller = None
        for session in list(self.sessions.values()):
            session.close()
        self.sessions.clear()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stdio', action='store_true')
    parser.parse_args()
    lock = threading.Lock()
    def emit(message):
        with lock:
            sys.stdout.write(json.dumps(message, separators=(',', ':')) + '\n')
            sys.stdout.flush()
    bridge = Bridge(emit)
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    signal.signal(signal.SIGHUP, lambda *_: sys.exit(0))
    try:
        for line in sys.stdin:
            if len(line) > 1048576:
                break
            try:
                message = json.loads(line)
                if isinstance(message, dict):
                    bridge.handle(message)
            except (ValueError, TypeError):
                emit({'error': 'Invalid desktop request.'})
    finally:
        bridge.close()

if __name__ == '__main__':
    main()
