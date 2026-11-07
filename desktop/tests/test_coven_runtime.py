import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from coven_runtime import CovenRuntime, replay, resolve_cli

FIXTURE = Path(__file__).parent / 'fixtures/coven_cli.py'

class CovenRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='open-sesame-coven-')
        self.root = Path(self.temp.name)
        self.env = patch.dict(os.environ, {'OPEN_SESAME_TEST_COVEN_ROOT': str(self.root)})
        self.env.start()
        self.events = []
        self.roster = []
        for fid in ['nova', 'sage']:
            workspace = self.root / ('workspace with spaces ' + fid); workspace.mkdir()
            self.roster.append({'id': fid, 'name': fid, 'display_name': fid.title(), 'workspace': str(workspace), 'description': 'Fixture familiar', 'emoji': None})
        self.write_roster()
        self.runtime = CovenRuntime(self.events.append, self.root / 'state', lambda: str(FIXTURE))
        self.addCleanup(self.temp.cleanup); self.addCleanup(self.env.stop); self.addCleanup(self.runtime.close)

    def write_roster(self):
        (self.root / 'roster.json').write_text(json.dumps(self.roster))

    def input(self, fid='nova', prompt='hello', **changes):
        state = self.runtime.open(fid)
        return {'runId': 'run-' + os.urandom(8).hex(), 'familiarId': fid, 'prompt': prompt, 'sessionId': state['sessionId'], 'conversationId': state['conversationId'], 'revision': state['revision'], 'harness': state['harness'], **changes}

    def calls(self):
        path = self.root / 'calls.jsonl'
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def test_discovery_and_open_never_run_a_message(self):
        self.assertTrue(self.runtime.status()['available'])
        self.assertEqual([f['id'] for f in self.runtime.familiars()], ['nova', 'sage'])
        state = self.runtime.open('nova')
        self.assertEqual(state['messages'], [])
        self.assertEqual(self.calls(), [])
        self.assertNotIn('emoji', self.runtime.familiars()[0])

    def test_send_stream_resume_and_durable_identity(self):
        result = self.runtime.send(self.input())
        state = self.runtime.open('nova')
        self.assertEqual(state['sessionId'], result['sessionId'])
        self.assertEqual(state['messages'][-1]['text'], 'Hello from nova')
        self.assertEqual([e['payload']['type'] for e in self.events], ['system', 'assistant', 'assistant', 'result'])
        self.runtime.send(self.input(prompt='what did I say?'))
        argv = self.calls()[-1]['argv']
        self.assertIn(result['sessionId'], argv)
        self.assertIn('Previous conversation messages', argv[-1])
        self.assertIn('Hello from nova', argv[-1])
        reloaded = CovenRuntime(directory=self.root / 'state', resolver=lambda: str(FIXTURE))
        self.assertEqual(reloaded.open('nova')['messages'][-1]['text'], 'Hello from nova')
        self.assertEqual(reloaded.open('sage')['messages'], [])

    def test_prompt_is_literal_and_renderer_cannot_supply_authority(self):
        prompt = '--permission full; $(touch /tmp/never-created-by-coven-fixture)'
        self.runtime.send(self.input(prompt=prompt, harness='codex'))
        argv = self.calls()[0]['argv']
        self.assertEqual(argv[-2:], ['--', prompt])
        self.assertEqual(argv[argv.index('--permission') + 1], 'read-only')
        for extra in [{'cwd': '/'}, {'permission': 'full'}, {'args': ['--anything']}, {'familiarId': '../outside'}]:
            with self.assertRaises(ValueError): self.runtime.send(self.input(**extra))
        self.assertEqual(len(self.calls()), 1)

    def test_native_harness_continuation_does_not_replay(self):
        self.runtime.send(self.input(harness='codex'))
        self.runtime.send(self.input(prompt='literal next turn'))
        self.assertEqual(self.calls()[-1]['argv'][-1], 'literal next turn')
        self.assertIn('--continue', self.calls()[-1]['argv'])
        with self.assertRaisesRegex(ValueError, 'original harness'):
            self.runtime.send(self.input(harness='claude'))

    def test_stale_revision_and_familiar_session_rebinding_stop_before_run(self):
        stale = self.input()
        self.runtime.send(self.input())
        with self.assertRaisesRegex(ValueError, 'conversation changed'): self.runtime.send(stale)
        state = self.runtime.open('nova')
        path = self.root / 'sessions' / (state['sessionId'] + '.json')
        session = json.loads(path.read_text()); session['familiar_id'] = 'sage'; path.write_text(json.dumps(session))
        with self.assertRaisesRegex(ValueError, 'identity no longer matches'): self.runtime.send(self.input())
        self.assertEqual(len(self.calls()), 1)

    def test_workspace_change_and_unregistered_familiar_stop_before_run(self):
        self.runtime.open('nova')
        self.roster[0]['workspace'] = self.roster[1]['workspace']; self.write_roster()
        with self.assertRaisesRegex(ValueError, 'workspace changed'): self.runtime.send(self.input())
        with self.assertRaisesRegex(ValueError, 'no longer in Coven'): self.runtime.open('unknown')
        self.assertEqual(self.calls(), [])

    def test_wrong_policy_and_session_fail_closed(self):
        for prompt, message in [('wrong-policy', 'read-only policy'), ('wrong-session', 'another session')]:
            fid = 'nova' if prompt == 'wrong-policy' else 'sage'
            with self.assertRaisesRegex(ValueError, message): self.runtime.send(self.input(fid, prompt))
            state = self.runtime.open(fid)
            self.assertEqual(state['status'], 'error')
            self.assertEqual(state['messages'][-1]['text'], '')

    def test_malformed_truncated_missing_result_and_oversized_output(self):
        for prompt, message in [('bad-json', 'invalid stream JSON'), ('incomplete', 'incomplete stream'), ('no-result', 'before completing'), ('too-much', 'oversized stream')]:
            state = self.runtime.open('nova')
            if state['messages']: self.runtime.open('nova', new=True, expected=state['conversationId'])
            with self.assertRaisesRegex(ValueError, message): self.runtime.send(self.input(prompt=prompt))
            self.assertEqual(self.runtime.open('nova')['status'], 'error')

    def test_provider_error_is_actionable_without_echoing_diagnostics(self):
        with self.assertRaisesRegex(ValueError, 'Sign in to this familiar'):
            self.runtime.send(self.input(prompt='provider-denied'))
        self.assertNotIn('(fixture)', self.runtime.open('nova')['error'])

    def test_cancel_reaps_run_preserves_partial_and_releases_lock(self):
        ready, done = threading.Event(), threading.Event()
        errors = []
        self.runtime.emit = lambda e: ready.set() if e['payload']['type'] == 'assistant' else None
        params = self.input(prompt='slow')
        def send():
            try: self.runtime.send(params)
            except Exception as error: errors.append(error)
            finally: done.set()
        worker = threading.Thread(target=send); worker.start(); self.assertTrue(ready.wait(10))
        second = CovenRuntime(directory=self.root / 'state', resolver=lambda: str(FIXTURE))
        with self.assertRaisesRegex(ValueError, 'busy in another'): second.send(self.input())
        self.runtime.cancel(params['runId']); self.assertTrue(done.wait(6)); worker.join()
        self.assertRegex(str(errors[0]), 'Reply stopped')
        self.assertEqual(self.runtime.open('nova')['messages'][-1]['text'], 'Ready to wait')
        self.assertEqual(self.runtime.open('nova')['status'], 'stopped')
        pid = self.calls()[0]['pid']
        with self.assertRaises(ProcessLookupError): os.kill(pid, 0)
        self.runtime.send(self.input(prompt='after stop'))
        self.assertEqual(self.runtime.open('nova')['status'], 'ready')
        self.assertNotIn('error', self.runtime.open('nova'))

    def test_cancel_before_registration_starts_no_process(self):
        params = self.input(); self.runtime.cancel(params['runId'])
        with self.assertRaisesRegex(ValueError, 'before it started'): self.runtime.send(params)
        self.assertEqual(self.calls(), [])

    def test_new_chat_preserves_archive_and_rejects_stale_reset(self):
        self.runtime.send(self.input()); previous = self.runtime.open('nova')
        fresh = self.runtime.open('nova', new=True, expected=previous['conversationId'])
        self.assertIsNone(fresh['sessionId']); self.assertNotEqual(fresh['conversationId'], previous['conversationId'])
        self.assertTrue((self.root / 'state/nova' / (previous['conversationId'] + '.json')).is_file())
        with self.assertRaisesRegex(ValueError, 'chat changed'):
            self.runtime.open('nova', new=True, expected=previous['conversationId'])

    def test_setup_and_roster_failures(self):
        (self.root / 'engine-missing').touch()
        self.assertEqual(self.runtime.status()['setup'], 'install-engine')
        self.roster.append(self.roster[0]); self.write_roster()
        with self.assertRaisesRegex(ValueError, 'duplicate'): self.runtime.familiars()
        self.roster = [{'id': '../escape'}]; self.write_roster()
        with self.assertRaises(ValueError): self.runtime.familiars()

    def test_replay_budget_and_recent_turn_order(self):
        history = [{'role': 'user' if i % 2 == 0 else 'assistant', 'text': str(i) + '界' * 3000} for i in range(30)]
        text, truncated = replay(history, 'New prompt')
        self.assertTrue(truncated); self.assertTrue(text.endswith('Current user message:\nNew prompt'))
        self.assertIn('29界', text); self.assertNotIn('"text": "0界', text)
        self.assertLess(len(text.encode()), 26 * 1024)
        self.assertLessEqual(len(text.split('\n')[1].encode()), 24 * 1024)

    def test_interrupted_reply_cannot_silently_resume(self):
        state = self.runtime.open('nova'); state['status'] = 'responding'; self.runtime._save(state)
        with self.assertRaisesRegex(ValueError, 'did not finalize'): self.runtime.send(self.input())
        self.assertEqual(self.calls(), [])
        fresh = self.runtime.open('nova', new=True, expected=state['conversationId'])
        self.assertEqual(fresh['messages'], [])

    def test_timeout_preserves_partial_reply_and_reaps(self):
        clock = [0]
        def observed(event):
            if event['payload']['type'] == 'assistant': clock[0] = 181
        self.runtime.emit = observed
        with patch('coven_runtime.time', SimpleNamespace(monotonic=lambda: clock[0], sleep=time.sleep)):
            with self.assertRaisesRegex(ValueError, 'too long'): self.runtime.send(self.input(prompt='slow'))
        self.assertEqual(self.runtime.open('nova')['messages'][-1]['text'], 'Ready to wait')
        with self.assertRaises(ProcessLookupError): os.kill(self.calls()[0]['pid'], 0)

    def test_real_delta_and_full_message_shapes_preserve_prose(self):
        for prompt, text in [('delta-final', 'Hello from nova'), ('multiple-messages', 'Hello\n\nHello again'), ('tools-between', 'First thought\n\nSecond thought')]:
            state = self.runtime.open('nova')
            if state['messages']: self.runtime.open('nova', new=True, expected=state['conversationId'])
            self.runtime.send(self.input(prompt=prompt))
            self.assertEqual(self.runtime.open('nova')['messages'][-1]['text'], text)
        self.assertNotIn('fixture-sensitive-tool-argument', json.dumps(self.events))

    def test_gui_resolution_finds_current_nvm_install_before_stale_fallback(self):
        home = self.root / 'home'
        candidates = [home / '.nvm/versions/node/v9.0.0/bin/coven', home / '.nvm/versions/node/v24.2.0/bin/coven', home / '.coven/bin/coven']
        for candidate in candidates:
            candidate.parent.mkdir(parents=True, exist_ok=True); candidate.write_text('#!/bin/sh\n'); candidate.chmod(0o700)
        with patch('coven_runtime.shutil.which', return_value=None), patch('coven_runtime.Path.home', return_value=home):
            self.assertEqual(resolve_cli(), str(candidates[1]))

    def test_cli_and_harness_frames_share_one_confirmed_identity(self):
        self.runtime.send(self.input(prompt='nested-protocol'))
        self.assertEqual([e['payload']['type'] for e in self.events], ['system', 'assistant', 'assistant', 'result'])
        self.assertEqual(self.runtime.open('nova')['messages'][-1]['text'], 'Hello from nova')
        with self.assertRaisesRegex(ValueError, 'another session identity'):
            self.runtime.send(self.input('sage', 'foreign-init'))

    def test_oversized_reply_keeps_text_and_reports_the_limit(self):
        with self.assertRaisesRegex(ValueError, 'exceeded 64 KiB'):
            self.runtime.send(self.input(prompt='long-reply'))
        state = self.runtime.open('nova')
        self.assertEqual(len(state['messages'][-1]['text'].encode()), 65536)
        self.assertEqual(state['status'], 'error')

if __name__ == '__main__': unittest.main()
