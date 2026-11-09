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
            # rev-parse HEAD fails before a first commit, so directory remains known independently.
            self.assertEqual(repository_context(folder), {})
