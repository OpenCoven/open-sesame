import pathlib
import sys
import tempfile
import unittest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from process_workspace import History, classify
from agent_monitor import repository_context
import subprocess

class WorkspaceTests(unittest.TestCase):
    def test_observation_gaps_and_retention(self):
        with tempfile.TemporaryDirectory() as folder:
            h = History(pathlib.Path(folder)/'history.json')
            a = {'id':'one','name':'Agent','activity':{'state':'waiting'}}
            h.update([a], 100000)
            h.update([a], 105000)
            self.assertEqual(len(h.rows['one']['intervals']), 1)
            h.update([a], 130000)
            self.assertEqual(len(h.rows['one']['intervals']), 2)
            self.assertEqual(History(h.path).rows, h.rows)
            h.update([], 130000+8*86400000)
            self.assertEqual(h.rows, {})
            h.clear()
            self.assertFalse(h.path.exists())

    def test_strict_live_bottom_rules(self):
        self.assertEqual(classify('claude', 'Do you want to proceed?\n❯ 1. Yes\n  2. No')['state'], 'waiting')
        for text in ['The documentation says Do you want to proceed?', '> Do you want to proceed?', 'Do you want to proceed?\n'+'ordinary output\n'*15]:
            self.assertEqual(classify('claude',text)['state'], 'unknown')
        self.assertEqual(classify('aider','Do you want to proceed?')['state'], 'unknown')

    def test_repository_directory_spaces(self):
        with tempfile.TemporaryDirectory(prefix='repo with spaces ') as folder:
            subprocess.run(['git','init', '-q', folder],check=True)
            context = repository_context(folder)
            self.assertEqual(pathlib.Path(context['root']), pathlib.Path(folder).resolve())
            self.assertTrue(context['branch'])

    def test_corrupt_history_rows_are_ignored(self):
        import json
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder)/'history.json'
            path.write_text(json.dumps({'bad': {'lastSeen':'not a time','intervals':[]}, 'bad2': {'lastSeen':100000,'intervals':[None,{'start':1,'end':2,'state':'fake'}]}}))
            h=History(path)
            self.assertNotIn('bad',h.rows)
            self.assertEqual(h.rows['bad2']['intervals'],[])
            h.update([],100001)

    def test_history_disk_failure_preserves_live_discovery(self):
        from unittest.mock import patch
        from bridge import Bridge
        bridge=Bridge(lambda _:None)
        self.addCleanup(bridge.close)
        with patch('bridge.agent_snapshot',return_value={'agents':[]}), patch.object(bridge.process_history,'update',side_effect=OSError('fixture read-only')):
            result=bridge.call('agents.snapshot',{})
        self.assertEqual(result['agents'],[])
        self.assertIn('historyError',result)

    def test_identity_survives_reparenting(self):
        from agent_monitor import agent_identity
        self.assertEqual(agent_identity(42,(1,501,'start','codex')),agent_identity(42,(2,501,'start','codex')))
        self.assertNotEqual(agent_identity(42,(1,501,'start','codex')),agent_identity(42,(1,501,'later','codex')))
