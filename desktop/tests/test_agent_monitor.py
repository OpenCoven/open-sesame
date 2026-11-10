import json
import pathlib
import subprocess
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from agent_monitor import elapsed_seconds, parse_processes, provider, snapshot
from bridge import Bridge


class AgentMonitorTests(unittest.TestCase):
    def test_recognizes_real_launch_forms(self):
        for command, expected in [('/opt/homebrew/bin/claude --resume', 'claude'),
                                  ('/usr/bin/node /usr/local/lib/node_modules/@openai/codex/bin/codex.js', 'codex'),
                                  ('node /Users/me/.npm/@anthropic-ai/claude-code/cli.js', 'claude'),
                                  ('node /usr/lib/@google/gemini-cli/dist/index.js', 'gemini'),
                                  ('python3.12 -m aider --model test', 'aider'),
                                  ('/home/me/bin/coven', 'coven'), ('opencode', 'opencode')]:
            with self.subTest(command=command): self.assertEqual(provider(command), expected)

    def test_unrelated_commands_and_prompts_are_not_agents(self):
        for command in ['bash -c "codex"', 'rg claude', 'node server.js codex',
                        'python -c "import aider"', 'cat /tmp/codex', 'codex-helper',
                        'node /tmp/cli.js --provider claude']:
            self.assertIsNone(provider(command))

    def test_scope_states_and_no_private_arguments(self):
        rows = '''
  21 1 501 R+ 12.5 204800 01:23 /usr/bin/codex --prompt secret-token
  22 1 501 S 0.0 1024 2-03:04:05 claude --api-key secret-value
  23 1 502 R 1.0 4096 00:10 coven
  24 1 501 T 0.0 512 00:10 aider
  25 1 501 D 0.1 512 00:10 gemini
  26 1 501 Z 0.0 0 00:10 opencode
  27 1 501 S nan 0 00:10 codex
  malformed row
'''
        agents = parse_processes(rows, 501)
        self.assertEqual(len(agents), 5)
        by_pid = {a['pid']: a for a in agents}
        self.assertEqual(by_pid[21]['memoryMB'], 200)
        self.assertEqual(by_pid[21]['uptimeSeconds'], 83)
        self.assertEqual(by_pid[22]['state'], 'sleeping')
        self.assertEqual(by_pid[24]['state'], 'stopped')
        self.assertEqual(by_pid[25]['state'], 'blocked')
        self.assertEqual(by_pid[26]['state'], 'exited')
        self.assertNotIn('secret', json.dumps(agents))
        self.assertNotIn('command', json.dumps(agents))

    def test_wrappers_deduplicated_but_independent_sessions_retained(self):
        rows = '''
  10 1 501 S 0.0 1000 01:00 node /usr/lib/@openai/codex/bin/codex.js
  11 10 501 R 3.0 2000 00:58 /opt/bin/codex
  12 1 501 S 0.0 3000 00:10 codex
  13 11 501 S 0.0 4000 00:05 claude
'''
        self.assertEqual({a['pid'] for a in parse_processes(rows, 501)}, {11,12,13})

    def test_native_same_provider_subagents_survive_wrapper_deduplication(self):
        rows = '10 1 501 S 0 100 01:00 codex\n11 10 501 S 0 100 00:50 bash\n12 11 501 R 1 100 00:40 codex\n13 12 501 S 0 100 00:30 claude\n14 1 502 R 0 100 00:10 codex'
        agents = {row['pid']: row for row in parse_processes(rows, 501)}
        self.assertEqual(set(agents), {10, 12, 13})
        self.assertIsNone(agents[10]['parentAgentPid'])
        self.assertEqual(agents[12]['parentAgentPid'], 10)
        self.assertEqual(agents[13]['parentAgentPid'], 12)
        self.assertEqual(agents[10]['childAgentCount'], 1)
        self.assertNotIn('bash', json.dumps(agents))

    def test_javascript_agent_children_are_not_treated_as_binary_wrappers(self):
        script = 'node /usr/lib/@google/gemini-cli/dist/index.js'
        rows = f'10 1 501 S 0 100 01:00 {script}\n11 10 501 S 0 100 00:10 {script}'
        agents = {row['pid']: row for row in parse_processes(rows, 501)}
        self.assertEqual(set(agents), {10, 11})
        self.assertEqual(agents[11]['parentAgentPid'], 10)

    def test_elapsed_formats(self):
        self.assertEqual(elapsed_seconds('2-03:04:05'), 183845)
        self.assertEqual(elapsed_seconds('12:10'), 730)
        self.assertEqual(elapsed_seconds('n/a'), 0)

    @patch('agent_monitor.subprocess.run')
    def test_snapshot_is_bounded_read_only_and_scoped(self, run):
        run.return_value = subprocess.CompletedProcess([], 0, '', '')
        result = snapshot()
        self.assertEqual(result['agents'], [])
        self.assertEqual(result['scope'], 'current-user')
        self.assertEqual(run.call_args.args[0][0], 'ps')
        self.assertIn('-u', run.call_args.args[0])
        self.assertEqual(run.call_args.kwargs['timeout'], 4)
        self.assertNotIn('shell', run.call_args.kwargs)

    @patch('agent_monitor.subprocess.run', side_effect=subprocess.TimeoutExpired('ps', 4))
    def test_scan_failures_are_actionable(self, run):
        with self.assertRaisesRegex(ValueError, 'Local process discovery is unavailable'):
            snapshot()

    @patch('bridge.agent_snapshot', return_value={'agents': [], 'scope': 'current-user'})
    def test_bridge_routes_without_a_pane(self, scan):
        bridge = Bridge(lambda value: None)
        import tempfile
        from process_workspace import History
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        bridge.process_history = History(pathlib.Path(folder.name)/'history.json')
        try: self.assertEqual(bridge.call('agents.snapshot', {})['agents'], [])
        finally: bridge.close()
