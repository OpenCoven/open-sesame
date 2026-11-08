import pathlib
import signal
import subprocess
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import agent_monitor as monitor

class AgentControlTests(unittest.TestCase):
    def setUp(self):
        monitor._controls.clear()
        self.identity = (1, 501, 'Sun Nov 8 01:00:00 2026', '/usr/bin/codex --prompt private-fixture')
        self.agent = {'pid': 4242, 'provider': 'codex'}

    def capability(self):
        with patch.object(monitor, 'process_identities', return_value={4242: self.identity}):
            monitor.authorize_controls([self.agent])
        return {'pid': 4242, 'token': self.agent['controlToken']}

    @patch.object(monitor.os, 'kill')
    def test_explicit_actions_signal_only_the_selected_identity(self, kill):
        for action, expected in [('pause', signal.SIGSTOP), ('resume', signal.SIGCONT), ('stop', signal.SIGTERM)]:
            params = self.capability()
            with patch.object(monitor, 'process_identities', return_value={4242: self.identity}):
                self.assertTrue(monitor.control_process({**params, 'action': action})['signalSent'])
                kill.assert_called_with(4242, expected)
                with self.assertRaisesRegex(ValueError, 'expired'):
                    monitor.control_process({**params, 'action': action})
        self.assertEqual(kill.call_count, 3)

    @patch.object(monitor.os, 'kill')
    def test_reused_pid_cannot_receive_a_stale_action(self, kill):
        params = self.capability()
        replacement = (*self.identity[:2], 'Sun Nov 8 02:00:00 2026', self.identity[3])
        with patch.object(monitor, 'process_identities', return_value={4242: replacement}):
            with self.assertRaisesRegex(ValueError, 'changed or exited'):
                monitor.control_process({**params, 'action': 'stop'})
        kill.assert_not_called()

    @patch.object(monitor.os, 'kill')
    def test_expired_missing_and_malformed_controls_fail_closed(self, kill):
        params = self.capability()
        monitor._controls[params['token']]['expires'] = -1
        for value in [params, {**params, 'pid': -4242}, {**params, 'pid': True}, {**params, 'token': 'wrong'}, {**params, 'action': 'kill-all'}]:
            with self.assertRaises(ValueError): monitor.control_process({'action': 'stop', **value})
        kill.assert_not_called()

    @patch.object(monitor.os, 'getuid', return_value=501)
    @patch.object(monitor.subprocess, 'run')
    def test_identity_discovery_excludes_other_users_and_unknown_programs(self, run, uid):
        run.return_value = subprocess.CompletedProcess([], 0, '4242 1 501 Sun Nov 8 01:00:00 2026 codex --prompt private-fixture\n4243 1 502 Sun Nov 8 01:00:00 2026 codex\n4244 1 501 Sun Nov 8 01:00:00 2026 bash -c codex\n', '')
        self.assertEqual(list(monitor.process_identities()), [4242])
        self.assertNotIn('shell', run.call_args.kwargs)

    def test_polling_preserves_confirmation_identity_without_exposing_arguments(self):
        first = self.capability()['token']
        self.assertEqual(self.capability()['token'], first)
        self.assertNotIn('private-fixture', str(self.agent))
