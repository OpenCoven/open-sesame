import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from computer_agent import ComputerAgent, action_request, native_reply

JPEG = base64.b64encode(b'\xff\xd8\xfffixture').decode()
REPLY = {'summary': 'Fixture observation', 'observation': {'id': 'frame-1', 'width': 640, 'height': 480, 'app': 'Fixture', 'display': 'Fixture display'}, 'image': JPEG}


class ComputerAgentTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='sesame-computer-'); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name); self.events = []; self.now = 1000; self.native_event = threading.Event()
        self.binary = self.root / 'engine'
        self.fixture('print(json.dumps({"type":"result","success":True}))')
        self.agent = ComputerAgent(self.emit, native=True, binary=self.binary, clock=lambda: self.now, trusted_fixture=True)
        self.addCleanup(self.agent.close)

    def emit(self, value):
        self.events.append(value)
        if value.get('event') == 'native.computer.action': self.native_event.set()

    def fixture(self, body):
        self.binary.write_text('#!' + sys.executable + '\nimport sys,json,time,os\nif sys.argv[1:]==["--status"]:\n print(json.dumps({"configured":True,"provider":"fixture","model":"fixture-model","route":"fixture-route"}));sys.exit(0)\nrequest=json.loads(sys.stdin.readline())\n' + body + '\n'); self.binary.chmod(0o755)

    def start(self):
        prepared = self.agent.prepare({'prompt': 'Inspect the synthetic fixture'})
        return self.agent.finish(prepared['token'], True, 's' * 64)

    def wait_done(self):
        self.agent.run['worker'].join(4); self.assertFalse(self.agent.run['worker'].is_alive())

    def test_action_fields_and_geometry_fail_closed(self):
        valid = action_request({'action': 'click', 'observation': 'frame', 'coordinate': [12, 23], 'text': None})
        self.assertNotIn('text', valid)
        bad = [
            {'action': 'shell', 'text': 'ignored'}, {'action': 'click', 'coordinate': [1, 2]},
            {'action': 'click', 'observation': 'frame', 'coordinate': [float('nan'), 0]},
            {'action': 'click', 'observation': 'frame', 'coordinate': [True, 0]},
            {'action': 'observe', 'text': 'unexpected'},
            {'action': 'scroll', 'observation': 'frame', 'direction': 'up', 'amount': True},
            {'action': 'scroll', 'observation': 'frame', 'direction': 'up', 'amount': 2, 'coordinate': [True, 0]},
            {'action': 'type', 'observation': 'frame', 'text': '\0'},
            {'action': 'drag', 'observation': 'frame', 'coordinate': [1, 2]},
        ]
        for value in bad:
            with self.subTest(value=value), self.assertRaises(ValueError): action_request(value)
        self.assertEqual(action_request({'action': 'observe'})['action'], 'observe')

    def test_images_require_paired_bounded_geometry(self):
        self.assertEqual(native_reply(REPLY)['observation']['width'], 640)
        for value in [{'summary': 'No geometry', 'image': JPEG}, {**REPLY, 'image': 'bad image'}, {**REPLY, 'observation': {**REPLY['observation'], 'width': 0}}, {'summary': 'x', 'error': 'true'}]:
            with self.assertRaises(ValueError): native_reply(value)

    def test_approval_is_native_expiring_and_single_use(self):
        self.agent.native = False
        with self.assertRaisesRegex(ValueError, 'Mac app'): self.agent.prepare({'prompt': 'Fixture'})
        self.agent.native = True; proposal = self.agent.prepare({'prompt': 'Fixture'})
        self.assertEqual(self.agent.finish(proposal['token'], False), {'cancelled': True})
        with self.assertRaises(ValueError): self.agent.finish(proposal['token'], True, 's' * 64)
        proposal = self.agent.prepare({'prompt': 'Fixture'}); self.now += 91
        with self.assertRaisesRegex(ValueError, 'expired'): self.agent.finish(proposal['token'], True, 's' * 64)
        self.assertIsNone(self.agent.run)

    def test_unstarted_server_is_closed_when_engine_cannot_spawn(self):
        proposal = self.agent.prepare({'prompt': 'Fixture'})
        with patch('computer_agent.subprocess.Popen', side_effect=OSError('private diagnostic')):
            with self.assertRaisesRegex(ValueError, 'could not start'): self.agent.finish(proposal['token'], True, 's' * 64)
        self.assertEqual(self.agent.run['state'], 'error'); self.assertIsNone(self.agent.run['server'])

    def test_private_http_roundtrip_and_one_time_native_reply(self):
        self.fixture('''import urllib.request
url=os.environ['OPEN_SESAME_COMPUTER_ENDPOINT'];token=os.environ['OPEN_SESAME_COMPUTER_TOKEN']
for headers in [{}, {'Authorization':'Bearer '+token,'Origin':'https://fixture.test'}]:
 try:urllib.request.urlopen(urllib.request.Request(url,data=b'{"action":"observe"}',headers={**headers,'Content-Type':'application/json'}));raise AssertionError('Untrusted channel accepted')
 except urllib.error.HTTPError as error:assert error.code==403
response=json.load(urllib.request.urlopen(urllib.request.Request(url,data=b'{"action":"observe"}',headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})))
assert response['image'] and response['observation']['width']==640
print(json.dumps({'type':'delta','text':'Observed the fixture.'}),flush=True)
print(json.dumps({'type':'result','success':True}),flush=True)''')
        run = self.start(); self.assertTrue(self.native_event.wait(3)); event = next(e for e in self.events if e['event'] == 'native.computer.action')
        params = {'id': event['id'], 'runId': run['runId'], 'session': 's' * 64, 'reply': REPLY}
        with self.assertRaises(ValueError): self.agent.reply({**params, 'session': 'wrong'})
        self.assertTrue(self.agent.reply(params))
        with self.assertRaises(ValueError): self.agent.reply(params)
        self.wait_done(); self.assertEqual(self.agent.run['state'], 'done')
        public = [e for e in self.events if e['event'] == 'computer.progress']; self.assertTrue(any(e.get('text') == 'Observed the fixture.' for e in public)); self.assertNotIn(JPEG, json.dumps(public)); self.assertNotIn('OPEN_SESAME_COMPUTER_TOKEN', json.dumps(self.events))

    def test_cancel_reaps_only_owned_engine_and_retains_cancelled_state(self):
        self.fixture("print(json.dumps({'type':'status'}),flush=True);time.sleep(60)")
        unrelated = subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(60)'])
        try:
            run = self.start(); owned = self.agent.run['process']; self.assertTrue(self.agent.cancel(run['runId'])['cancelled']); self.wait_done()
            self.assertIsNotNone(owned.returncode); self.assertIsNone(unrelated.poll()); self.assertEqual(self.agent.run['state'], 'cancelled')
            self.assertFalse(any(e.get('type') == 'error' for e in self.events)); self.assertFalse(self.agent.cancel('stale')['cancelled'])
        finally: unrelated.terminate(); unrelated.wait(timeout=3)


if __name__ == '__main__': unittest.main()


class ComputerBridgeBoundaryTests(unittest.TestCase):
    def bridge(self, native):
        from bridge import Bridge
        events = []; bridge = Bridge(events.append, native_permissions=native)
        self.addCleanup(bridge.close)
        return bridge, events

    def wait(self, events):
        deadline = time.monotonic() + 3
        while not events and time.monotonic() < deadline: time.sleep(.01)
        self.assertTrue(events, 'Bridge response missing')
        return events[-1]

    def test_renderer_only_bridge_cannot_prepare_approve_or_complete(self):
        bridge, events = self.bridge(False)
        for method in ['native.computer.prepare', 'native.computer.finish', 'native.computer.reply', 'native.computer.configure']:
            events.clear(); bridge.handle({'requestId': 'fixture', 'method': method, 'params': {}})
            self.assertIn('error', self.wait(events))
        self.assertFalse(bridge.computer.proposals)

    def test_status_semaphore_cannot_block_native_reply_or_stop(self):
        bridge, events = self.bridge(True)
        bridge.computer_slot.acquire()
        try:
            bridge.handle({'requestId': 'stop', 'method': 'computer.cancel', 'params': {}})
            result = self.wait(events); self.assertEqual(result['requestId'], 'stop'); self.assertIn('result', result)
            events.clear(); bridge.handle({'requestId': 'reply', 'method': 'native.computer.reply', 'params': {}})
            result = self.wait(events); self.assertEqual(result['requestId'], 'reply'); self.assertIn('error', result)
        finally: bridge.computer_slot.release()

    def test_closed_parameters_and_account_secrets_are_not_returned(self):
        bridge, events = self.bridge(True)
        for params in [{'provider':'shell'},{'provider':'coven','arbitrary':'refused'}]:
            events.clear(); bridge.handle({'requestId':'status','method':'computer.status','params':params}); self.assertIn('error', self.wait(events))
        events.clear(); key = 'fixture-native-account-value-0000000000'
        bridge.handle({'requestId':'setup','method':'native.computer.configure','params':{'apiKey':key}})
        result = self.wait(events); self.assertEqual(result['result'], {'configured':True}); self.assertNotIn(key,json.dumps(events))
        bridge.computer.proposals['old'] = {'expires':100}
        bridge.computer.configure({'apiKey':''}); self.assertEqual(bridge.computer.proposals,{})
