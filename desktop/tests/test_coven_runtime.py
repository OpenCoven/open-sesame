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

    def fresh_fixture_runtime(self, name):
        self.runtime = CovenRuntime(self.events.append, self.root / ('isolated-' + name), lambda: str(FIXTURE))
        self.addCleanup(self.runtime.close)

    def test_discovery_and_open_never_run_a_message(self):
        self.assertTrue(self.runtime.status()['available'])
        self.assertEqual([f['id'] for f in self.runtime.familiars()], ['nova', 'sage'])
        state = self.runtime.open('nova')
        self.assertEqual(state['messages'], [])
        self.assertEqual(self.calls(), [])
        self.assertNotIn('emoji', self.runtime.familiars()[0])

    def proposal(self, **changes):
        return self.runtime.prepare_permission('send', self.input(permission='full', **changes))

    def test_permission_cancel_expiry_restart_and_replay_never_launch(self):
        proposal = self.proposal()
        with self.assertRaisesRegex(ValueError, 'cancelled'): self.runtime.finish_permission(proposal['token'], False)
        with self.assertRaisesRegex(ValueError, 'already used'): self.runtime.finish_permission(proposal['token'], True)
        proposal = self.proposal()
        self.runtime.permission_proposals[proposal['token']]['expires'] = 0
        with self.assertRaisesRegex(ValueError, 'expired'): self.runtime.finish_permission(proposal['token'], True)
        proposal = self.proposal()
        other = CovenRuntime(directory=self.root / 'state', resolver=lambda: str(FIXTURE))
        self.addCleanup(other.close)
        with self.assertRaisesRegex(ValueError, 'already used'): other.finish_permission(proposal['token'], True)
        self.runtime.close()
        with self.assertRaisesRegex(ValueError, 'already used'): self.runtime.finish_permission(proposal['token'], True)
        self.assertEqual(self.calls(), [])

    def test_approved_reply_is_single_use_and_next_reply_is_read_only(self):
        proposal = self.proposal(harness='codex')
        self.assertEqual(proposal['familiar'], 'Nova')
        self.assertEqual(proposal['harness'], 'codex')
        self.runtime.finish_permission(proposal['token'], True)
        with self.assertRaisesRegex(ValueError, 'already used'): self.runtime.finish_permission(proposal['token'], True)
        self.runtime.send(self.input(prompt='ordinary continuation'))
        policies = [c['argv'][c['argv'].index('--permission') + 1] for c in self.calls()]
        self.assertEqual(policies, ['full', 'read-only'])

    def test_approval_binds_conversation_roster_workspace_and_original_message(self):
        for change in ('revision', 'workspace', 'name', 'inode'):
            self.fresh_fixture_runtime(change)
            self.roster[0]['workspace'] = str(self.root / 'workspace with spaces nova'); self.roster[0]['display_name'] = 'Nova'; self.write_roster()
            request = self.input(permission='full')
            proposal = self.runtime.prepare_permission('send', request)
            request['prompt'] = 'changed after request'  # the proposal owns a deep copy
            if change == 'revision':
                state = self.runtime.open('nova'); state['revision'] += 1; self.runtime._save(state)
            elif change == 'workspace':
                self.roster[0]['workspace'] = self.roster[1]['workspace']; self.write_roster()
            elif change == 'name':
                self.roster[0]['display_name'] = 'Changed familiar'; self.write_roster()
            else:
                folder = Path(self.roster[0]['workspace']); folder.rename(folder.with_name('retained-original-workspace')); folder.mkdir()
            with self.assertRaises(ValueError): self.runtime.finish_permission(proposal['token'], True)
            if change == 'inode':
                folder.rmdir(); folder.with_name('retained-original-workspace').rename(folder)
        self.assertEqual(self.calls(), [])

    def test_duplicate_approval_consumption_and_overlapping_prompt_fail_closed(self):
        proposal = self.proposal()
        with self.assertRaisesRegex(ValueError, 'current permission'): self.proposal()
        barrier = threading.Barrier(3); outcomes = []
        def consume():
            barrier.wait()
            try: self.runtime.finish_permission(proposal['token'], True); outcomes.append('grant')
            except ValueError: outcomes.append('refused')
        threads = [threading.Thread(target=consume) for _ in range(2)]
        for thread in threads: thread.start()
        barrier.wait()
        for thread in threads: thread.join(10); self.assertFalse(thread.is_alive())
        self.assertCountEqual(outcomes, ['grant', 'refused']); self.assertEqual(len(self.calls()), 1)

    def test_approved_policy_still_requires_matching_outer_attestation(self):
        proposal = self.proposal(prompt='wrong-readonly')
        with self.assertRaisesRegex(ValueError, 'full policy'): self.runtime.finish_permission(proposal['token'], True)
        self.assertEqual(self.runtime.open('nova')['status'], 'error')

    def test_avatar_requires_separate_specific_native_confirmation(self):
        png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP43+DwHwAHAAK/K9fH4gAAAABJRU5ErkJggg=='
        proposal = self.runtime.prepare_permission('avatar', {'familiarId': 'nova', 'png': png})
        destination = Path(self.roster[0]['workspace']) / 'avatars/nova.png'
        self.assertFalse(destination.exists())
        with self.assertRaisesRegex(ValueError, 'cancelled'): self.runtime.finish_permission(proposal['token'], False)
        self.assertFalse(destination.exists())
        proposal = self.runtime.prepare_permission('avatar', {'familiarId': 'nova', 'png': png})
        self.assertEqual(self.runtime.finish_permission(proposal['token'], True)['location'], 'avatars/nova.png')
        self.assertTrue(destination.exists()); self.assertEqual(self.calls(), [])

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
        self.assertEqual(argv[-2], '--'); self.assertTrue(argv[-1].endswith(prompt))
        self.assertTrue(argv[-1].startswith('Open Sesame application session\n'))
        self.assertEqual(argv[argv.index('--permission') + 1], 'read-only')
        for extra in [{'cwd': '/'}, {'permission': 'full'}, {'args': ['--anything']}, {'familiarId': '../outside'}]:
            with self.assertRaises(ValueError): self.runtime.send(self.input(**extra))
        self.assertEqual(len(self.calls()), 1)

    def test_native_harness_continuation_does_not_replay(self):
        self.runtime.send(self.input(harness='codex'))
        self.runtime.send(self.input(prompt='literal next turn'))
        self.assertTrue(self.calls()[-1]['argv'][-1].endswith('literal next turn'))
        self.assertNotIn('Previous conversation messages', self.calls()[-1]['argv'][-1])
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
            self.fresh_fixture_runtime(prompt)
            with self.assertRaisesRegex(ValueError, message): self.runtime.send(self.input(prompt=prompt))
            self.assertEqual(self.runtime.open('nova')['status'], 'error')

    def test_doctor_only_returns_allowlisted_readiness_and_never_runs_a_prompt(self):
        result = self.runtime.command({'name': 'doctor', 'familiarId': 'nova'})
        self.assertIn(['Coven Code sign-in', 'Needs attention'], result['rows'])
        self.assertEqual(result['recovery'], 'coven-auth')
        self.assertNotIn('fixture-private-token', json.dumps(result))
        self.assertEqual(self.calls(), [])

    def test_generic_engine_failure_uses_safe_read_only_provider_diagnosis(self):
        with self.assertRaisesRegex(ValueError, 'coven auth login'):
            self.runtime.send(self.input(prompt='provider-not-configured'))
        state = self.runtime.open('nova')
        self.assertEqual(state['status'], 'error')
        self.assertIsNotNone(state['sessionId'])
        self.assertEqual(state['messages'][0]['text'], 'provider-not-configured')
        self.assertNotIn('fixture-private-token', state['error'])
        self.assertEqual(len(self.calls()), 1, 'Diagnosis must never retry a provider turn')

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

    def test_reopen_keeps_persistent_identity_and_reset_is_unavailable(self):
        self.runtime.send(self.input()); previous = self.runtime.open('nova')
        for _ in range(3): self.assertEqual(self.runtime.open('nova'), previous)
        with self.assertRaises(TypeError):
            self.runtime.open('nova', new=True, expected=previous['conversationId'])
        self.assertEqual(self.runtime.open('nova'), previous)

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
        self.assertEqual(self.runtime.open('nova')['conversationId'], state['conversationId'])

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
            self.fresh_fixture_runtime(prompt)
            self.runtime.send(self.input(prompt=prompt))
            self.assertEqual(self.runtime.open('nova')['messages'][-1]['text'], text)
        self.assertNotIn('fixture-sensitive-tool-argument', json.dumps(self.events))

    def test_application_context_survives_continuation_without_polluting_saved_messages(self):
        before = self.runtime.open('nova'); self.runtime.send(self.input(prompt='first', harness='codex')); self.runtime.send(self.input(prompt='second'))
        after = self.runtime.open('nova'); self.assertEqual(after['conversationId'], before['conversationId']); self.assertEqual(after['application'], 'Open Sesame')
        for call in self.calls():
            self.assertIn('"application":"Open Sesame"', call['argv'][-1]); self.assertIn(before['conversationId'], call['argv'][-1]); self.assertEqual(call['argv'][call['argv'].index('--labels')+1], 'open-sesame')
        self.assertEqual([m['text'] for m in after['messages'] if m['role']=='user'], ['first','second'])

    def test_legacy_inner_result_waits_for_authoritative_completion(self):
        self.runtime.send(self.input(prompt='legacy-result')); self.assertEqual(self.runtime.open('nova')['status'], 'ready')
        self.assertEqual(len([e for e in self.events if e['payload']['type']=='result']), 1)
        for prompt, error in [('legacy-no-outer','before completing'),('foreign-legacy','another session'),('bad-result-bool','invalid completion')]:
            self.fresh_fixture_runtime(prompt)
            with self.assertRaisesRegex(ValueError,error): self.runtime.send(self.input(prompt=prompt))

    def test_coven_commands_project_safe_metadata_without_sending_or_changing_chat(self):
        before=self.runtime.open('nova'); disk=self.runtime._path('nova').read_bytes()
        for name in ['status','sessions','familiars','skills']:
            result=self.runtime.command({'name':name,'familiarId':'nova'}); self.assertEqual(result['familiarId'],'nova');self.assertNotIn('fixture-private-token',json.dumps(result))
        self.assertEqual(self.calls(),[]);self.assertEqual(self.runtime.open('nova'),before);self.assertEqual(self.runtime._path('nova').read_bytes(),disk)
        for params in [{'name':'status; rm','familiarId':'nova'},{'name':'status','familiarId':'../escape'},{'name':'status','familiarId':'nova','args':['--anything']}]:
            with self.assertRaises(ValueError):self.runtime.command(params)

    def test_persistent_history_is_preserved_outside_bounded_context(self):
        value=self.runtime.open('nova');identity=value['conversationId'];messages=[{'role':'user' if i%2==0 else 'assistant','text':str(i)} for i in range(130)];value['messages']=messages.copy();self.runtime._save(value)
        saved=self.runtime.open('nova');self.assertEqual(saved['conversationId'],identity);self.assertEqual(len(saved['messages']),120)
        segments=list((self.runtime._path('nova').parent/'history').glob('*.json'));self.assertEqual(len(segments),1);old=json.loads(segments[0].read_text());self.assertEqual(old['messages']+saved['messages'],messages);self.assertEqual(segments[0].stat().st_mode&0o777,0o600)

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
