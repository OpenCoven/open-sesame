"""Private, per-task channel for the bundled Coven engine. No input is dispatched here."""
import base64
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import math
import os
from pathlib import Path
import secrets
import signal
import subprocess
import threading
import time

KINDS = {'observe', 'click', 'double_click', 'right_click', 'move', 'drag', 'type', 'key', 'scroll', 'wait', 'ask_user'}
FIELDS = {'action', 'observation', 'coordinate', 'end_coordinate', 'text', 'direction', 'amount', 'milliseconds'}
INPUTS = {'click', 'double_click', 'right_click', 'move', 'drag', 'type', 'key', 'scroll', 'wait'}


def bounded_text(value, limit, *, empty=False):
    if not isinstance(value, str) or len(value.encode('utf-8')) > limit or '\0' in value or not empty and not value.strip():
        raise ValueError('Invalid computer task text.')
    return value


def action_request(value):
    if not isinstance(value, dict) or set(value) - FIELDS or value.get('action') not in KINDS:
        raise ValueError('Unsupported computer action.')
    value = {k: v for k, v in value.items() if v is not None}
    kind = value['action']; allowed = {'action'}
    if kind in INPUTS:
        bounded_text(value.get('observation'), 100); allowed.add('observation')
    if kind in {'click', 'double_click', 'right_click', 'move', 'drag'}:
        allowed.add('coordinate')
        if kind == 'drag': allowed.add('end_coordinate')
        for field in allowed & {'coordinate', 'end_coordinate'}:
            point = value.get(field)
            if not isinstance(point, list) or len(point) != 2 or any(type(n) not in (int, float) or not math.isfinite(n) or n < 0 or n > 16384 for n in point):
                raise ValueError('Invalid computer coordinate.')
    if kind in {'type', 'key', 'ask_user'}:
        bounded_text(value.get('text'), 16000 if kind == 'type' else 4000 if kind == 'ask_user' else 100); allowed.add('text')
    if kind == 'scroll':
        allowed |= {'direction', 'amount', 'coordinate'}
        if 'coordinate' in value:
            point = value['coordinate']
            if not isinstance(point, list) or len(point) != 2 or any(type(n) not in (int,float) or not math.isfinite(n) or not 0 <= n <= 16384 for n in point): raise ValueError('Invalid scroll coordinate.')
        if value.get('direction') not in {'up', 'down', 'left', 'right'} or type(value.get('amount')) is not int or not 1 <= value['amount'] <= 20:
            raise ValueError('Invalid scroll action.')
    if kind == 'wait':
        allowed.add('milliseconds')
        if type(value.get('milliseconds')) is not int or not 0 <= value['milliseconds'] <= 2000: raise ValueError('Invalid wait action.')
    if set(value) - allowed: raise ValueError('Unexpected computer action fields.')
    return value


def native_reply(value):
    if not isinstance(value, dict) or set(value) - {'summary', 'error', 'observation', 'image', 'paused'}: raise ValueError('Invalid native reply.')
    bounded_text(value.get('summary'), 16000)
    if any(k in value and type(value[k]) is not bool for k in ['error', 'paused']): raise ValueError('Invalid native reply state.')
    image, observation = value.get('image'), value.get('observation')
    if (image is None) != (observation is None): raise ValueError('Image and geometry must share one observation.')
    if observation is not None:
        if not isinstance(observation, dict) or set(observation) != {'id', 'width', 'height', 'app', 'display'}: raise ValueError('Invalid observation.')
        for field, limit in [('id', 100), ('app', 200), ('display', 200)]: bounded_text(observation.get(field), limit)
        if any(type(observation.get(k)) is not int or not 1 <= observation[k] <= 4096 for k in ['width', 'height']): raise ValueError('Invalid image geometry.')
        if not isinstance(image, str) or len(image) > 5_500_000: raise ValueError('Image exceeds the task limit.')
        try: data = base64.b64decode(image, validate=True)
        except (ValueError, TypeError): raise ValueError('Invalid image encoding.') from None
        if not data.startswith(b'\xff\xd8\xff') or len(data) > 4_000_000: raise ValueError('Expected a bounded JPEG image.')
    return value


class ComputerAgent:
    def __init__(self, emit, *, native=False, binary=None, clock=time.monotonic, trusted_fixture=False):
        self.emit, self.native, self.clock = emit, native, clock
        self.binary = Path(binary) if binary else self.default_binary()
        self.trusted_fixture = trusted_fixture
        self.lock = threading.RLock(); self.process_lock = threading.Lock()
        self.proposals = {}; self.run = None; self.pending = None; self.closed = False
        self.api_key = os.environ.pop('OPEN_SESAME_COMPUTER_STORED_API_KEY', '') if native else ''

    @staticmethod
    def default_binary():
        bundled = Path(__file__).resolve().parent / 'CovenComputerAgent'
        return bundled if bundled.exists() else Path(__file__).resolve().parent.parent / 'build/coven-engine/CovenComputerAgent'

    def verify_binary(self):
        if not self.binary.is_file() or self.binary.is_symlink() or not os.access(self.binary, os.X_OK): raise ValueError('Build or update the embedded Coven engine first.')
        if not self.trusted_fixture:
            try:
                receipt_name = 'CovenEngine-BUILD-INFO.json' if self.binary.parent == Path(__file__).resolve().parent else 'BUILD-INFO.json'
                receipt = json.loads((self.binary.parent / receipt_name).read_text())
                if receipt.get('binary_sha256') != hashlib.sha256(self.binary.read_bytes()).hexdigest(): raise ValueError('Embedded engine integrity check failed.')
            except (OSError, ValueError, KeyError): raise ValueError('Embedded engine integrity check failed. Rebuild or update Open Sesame.') from None

    def configure(self, params):
        if not self.native or not isinstance(params, dict) or set(params) != {'apiKey'}: raise ValueError('Native account setup is required.')
        key = bounded_text(params['apiKey'], 4096, empty=True)
        if key and (not key.isascii() or any(c.isspace() for c in key)): raise ValueError('Enter a valid API key.')
        with self.lock:
            if self.run and self.run['state'] == 'running': raise ValueError('Stop the computer task before changing its account.')
            self.proposals.clear(); self.api_key = key
        return {'configured': bool(key)}

    def environment(self, provider='coven'):
        if provider not in {'coven', 'codex', 'anthropic'}: raise ValueError('Choose a supported computer provider.')
        environment = {k: v for k, v in os.environ.items() if not k.startswith('OPEN_SESAME_COMPUTER_')}
        environment['OPEN_SESAME_COMPUTER_PROVIDER'] = provider
        if self.api_key and provider == 'anthropic': environment['OPEN_SESAME_COMPUTER_API_KEY'] = self.api_key
        return environment

    def status(self, provider='coven', *, private=False):
        self.verify_binary()
        try:
            completed = subprocess.run([str(self.binary), '--status'], capture_output=True, timeout=20, check=True, env=self.environment(provider))
            if len(completed.stdout) > 8192: raise ValueError()
            value = json.loads(completed.stdout)
            if not isinstance(value, dict) or type(value.get('configured')) is not bool: raise ValueError()
            result = {'available': True, 'configured': value['configured'], 'native': self.native}
            if value['configured']:
                if private: result['route'] = bounded_text(value.get('route'), 100)
                result.update(provider=bounded_text(value.get('provider'), 100), model=bounded_text(value.get('model'), 200), destination=bounded_text(value.get('destination', value.get('provider')), 400))
            else:
                result['message'] = 'Connect an image-capable Coven provider before starting a computer task.'
            return result
        except (OSError, subprocess.SubprocessError, ValueError):
            return {'available': True, 'configured': False, 'native': self.native, 'message': 'The embedded engine could not read its provider configuration.'}

    def prepare(self, params):
        if not self.native: raise ValueError('Computer tasks require the authenticated Mac app.')
        if not isinstance(params, dict) or set(params) - {'prompt', 'history', 'provider'}: raise ValueError('Unsupported computer task parameters.')
        prompt = bounded_text(params.get('prompt'), 32768); history = params.get('history', [])
        if not isinstance(history, list) or len(history) > 30: raise ValueError('Task history is too large.')
        for entry in history:
            if not isinstance(entry, dict) or set(entry) != {'role', 'text'} or entry['role'] not in {'user', 'assistant'}: raise ValueError('Invalid task history.')
            bounded_text(entry['text'], 16000)
        if len(json.dumps({'prompt': prompt, 'history': history}).encode()) > 400000: raise ValueError('Task history is too large.')
        provider = params.get('provider', 'coven')
        if provider not in {'coven', 'codex', 'anthropic'}: raise ValueError('Choose a supported computer provider.')
        status = self.status(provider, private=True)
        if not status['configured']: raise ValueError(status['message'])
        token = secrets.token_urlsafe(32)
        with self.lock:
            if self.closed or self.run and self.run['state'] == 'running': raise ValueError('Stop the current computer task first.')
            self.proposals = {token: {'prompt': prompt, 'history': history, 'status': status, 'provider': provider, 'expires': self.clock() + 90}}
        return {'token': token, 'prompt': prompt, 'provider': status['provider'], 'model': status['model'], 'destination': status['destination']}

    def finish(self, token, approved, session=None):
        with self.lock:
            proposal = self.proposals.pop(token, None)
            if not proposal or self.closed or proposal['expires'] < self.clock(): raise ValueError('The computer task approval expired.')
            if approved is not True: return {'cancelled': True}
            if not isinstance(session, str) or not 32 <= len(session) <= 128 or not session.isascii() or not all(c.isalnum() or c in '-_' for c in session): raise ValueError('Native task approval is required.')
            if self.run and self.run['state'] == 'running': raise ValueError('Stop the current computer task first.')
            self.verify_binary()
            run = {'id': secrets.token_hex(16), 'session': session, 'state': 'running', 'process': None, 'server': None, 'server_started': False, 'worker': None, 'deadline': None, 'steps': 0, 'characters': 0}
            self.run = run
            owner = self
            channel_token = secrets.token_urlsafe(48)
            class Handler(BaseHTTPRequestHandler):
                def log_message(self, *_): pass
                def do_POST(self):
                    self.connection.settimeout(5)
                    try:
                        length = int(self.headers.get('Content-Length', '0'))
                        if self.client_address[0] != '127.0.0.1' or self.path != '/computer' or self.headers.get('Origin') or self.headers.get('Transfer-Encoding') or not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + channel_token):
                            self.send_error(403); return
                        if self.headers.get('Host') != '127.0.0.1:' + str(self.server.server_port) or self.headers.get_content_type() != 'application/json' or not 0 < length <= 32768:
                            self.send_error(400); return
                        body = self.rfile.read(length)
                        if len(body) != length: self.send_error(400); return
                        action = action_request(json.loads(body))
                        result = owner.request_native(run, action)
                        data = json.dumps(result, separators=(',', ':')).encode(); self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
                    except (OSError, ValueError, TypeError):
                        try: self.send_error(400)
                        except OSError: pass
            server = HTTPServer(('127.0.0.1', 0), Handler); server.timeout = 1; run['server'] = server
            environment = dict(self.environment(proposal['provider']), OPEN_SESAME_COMPUTER_ENDPOINT='http://127.0.0.1:' + str(server.server_port) + '/computer', OPEN_SESAME_COMPUTER_TOKEN=channel_token, OPEN_SESAME_COMPUTER_EXPECTED_PROVIDER=proposal['status']['provider'], OPEN_SESAME_COMPUTER_EXPECTED_MODEL=proposal['status']['model'], OPEN_SESAME_COMPUTER_EXPECTED_ROUTE=proposal['status']['route'])
            try:
                process = subprocess.Popen([str(self.binary)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=environment, start_new_session=True)
                run['process'] = process
                threading.Thread(target=server.serve_forever, kwargs={'poll_interval': .1}, daemon=True).start(); run['server_started'] = True
                worker = threading.Thread(target=self.read_engine, args=(run,), daemon=True); run['worker'] = worker; worker.start()
                threading.Thread(target=self.drain_diagnostics, args=(process,), daemon=True).start()
                startup_error = False
            except (OSError, ValueError, RuntimeError):
                startup_error = True
            if not startup_error:
                deadline = threading.Timer(605, lambda: self.cancel(run['id'])); deadline.daemon = True; run['deadline'] = deadline; deadline.start()
        # Never block on pipes, shutdown or process reaping while holding the run lock.
        if startup_error:
            self.stop(run, 'error'); raise ValueError('The embedded engine could not start.') from None
        try:
            process.stdin.write(json.dumps({'prompt': proposal['prompt'], 'history': proposal['history']}).encode() + b'\n'); process.stdin.close()
        except (OSError, ValueError):
            self.stop(run, 'cancelled' if run['state'] == 'cancelled' else 'error')
            raise ValueError('The embedded task was interrupted before it could start.') from None
        return {'runId': run['id'], 'provider': proposal['status']['provider'], 'model': proposal['status']['model']}

    def request_native(self, run, action):
        pending = {'id': secrets.token_hex(16), 'run': run, 'ready': threading.Event(), 'reply': None, 'expires': self.clock() + 170}
        with self.lock:
            if self.run is not run or run['state'] != 'running' or self.pending is not None: return {'summary': 'Task is no longer active.', 'error': True, 'paused': True}
            run['steps'] += 1
            if run['steps'] > 40: return {'summary': 'Action limit reached.', 'error': True, 'paused': True}
            self.pending = pending
        self.emit({'event': 'native.computer.action', 'runId': run['id'], 'id': pending['id'], 'session': run['session'], 'action': action})
        pending['ready'].wait(170)
        with self.lock:
            if self.pending is pending: self.pending = None
            reply = pending['reply']
            if reply is None or self.run is not run or run['state'] != 'running': return {'summary': 'Task stopped or native action expired.', 'error': True, 'paused': True}
            return reply

    def reply(self, params):
        if not isinstance(params, dict) or set(params) != {'id', 'runId', 'session', 'reply'}: raise ValueError('Invalid native completion.')
        reply = native_reply(params['reply'])
        with self.lock:
            pending = self.pending
            if not pending or pending['reply'] is not None or pending['expires'] < self.clock() or pending['id'] != params['id'] or pending['run']['id'] != params['runId'] or pending['run']['state'] != 'running' or not hmac.compare_digest(pending['run']['session'], params['session']): raise ValueError('Native action is no longer current.')
            pending['reply'] = reply; pending['ready'].set()
        return True

    @staticmethod
    def drain_diagnostics(process):
        try:
            while process.stderr.read(8192): pass
        except (OSError, ValueError): pass
        finally: process.stderr.close()

    def read_engine(self, run):
        process = run['process']; ended = False
        try:
            while True:
                line = process.stdout.readline(262145)
                if not line: break
                if len(line) > 262144: raise ValueError('Engine output limit')
                value = json.loads(line)
                with self.lock:
                    if self.run is not run or run['state'] != 'running': break
                    kind = value.get('type')
                    event = {'event': 'computer.progress', 'runId': run['id'], 'type': kind}
                    if kind == 'delta':
                        text = bounded_text(value.get('text'), 131072, empty=True); run['characters'] += len(text)
                        if run['characters'] > 500000: raise ValueError('Output limit')
                        event['text'] = text
                    elif kind in {'ready', 'status', 'action'}:
                        event['text'] = 'Connected' if kind == 'ready' else 'Thinking' if kind == 'status' else 'Using computer'
                        if kind == 'action': event['action'] = value.get('action') if value.get('action') in KINDS else 'observe'
                    elif kind in {'result', 'paused', 'error'}:
                        ended = True; run['state'] = 'done' if kind == 'result' and value.get('success') is True else 'paused' if kind == 'paused' else 'error'
                        event['text'] = 'Task complete' if run['state'] == 'done' else 'Review the screen and continue when ready.' if run['state'] == 'paused' else 'The embedded task stopped. Check the provider or native permissions before retrying.'
                    else: raise ValueError('Unsupported engine event')
                self.emit(event)
                if ended: break
        except (OSError, ValueError, TypeError): pass
        finally:
            final_state = run['state'] if run['state'] != 'running' else 'error'
            self.stop(run, final_state)
            process.stdout.close()
            if not ended and final_state != 'cancelled': self.emit({'event': 'computer.progress', 'runId': run['id'], 'type': 'error', 'text': 'The embedded task ended unexpectedly. Your request is kept.'})

    def stop(self, run, state):
        with self.lock:
            if self.run is run: run['state'] = state
            if self.pending and self.pending['run'] is run: self.pending['ready'].set(); self.pending = None
            process = run.get('process'); server = run.get('server'); run['server'] = None
            if run.get('deadline'): run['deadline'].cancel(); run['deadline'] = None
        if process is not None:
            with self.process_lock:
                if process.returncode is None:
                    try: os.killpg(process.pid, signal.SIGTERM)
                    except ProcessLookupError: pass
                    try: process.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        try: os.killpg(process.pid, signal.SIGKILL)
                        except ProcessLookupError: pass
                        process.wait(timeout=3)
        if server is not None:
            if run['server_started']: server.shutdown()
            server.server_close()

    def cancel(self, run_id):
        with self.lock:
            run = self.run
            if run is None or run['id'] != run_id: return {'cancelled': False}
            self.proposals.clear()
        self.stop(run, 'cancelled')
        return {'cancelled': True}

    def close(self):
        with self.lock:
            self.closed = True; self.proposals.clear(); self.api_key = ''; run = self.run
        if run: self.stop(run, 'cancelled')
        if run and run.get('worker') and run['worker'] is not threading.current_thread(): run['worker'].join(timeout=4)
