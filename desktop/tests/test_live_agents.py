import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bridge import Bridge


class LiveAgentTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.path = Path(self.folder.name)
        self.commands = self.path / 'commands'
        self.commands.mkdir()
        self.done = threading.Event()
        self.messages = []
        self.bridge = Bridge(self.emit)
        self.environment = patch.dict(os.environ, {'PATH': str(self.commands)+os.pathsep+os.defpath,
                                                    'OPEN_SESAME_TEST_REPORT': str(self.path/'report')})
        self.environment.start()

    def tearDown(self):
        self.bridge.close()
        self.environment.stop()
        self.folder.cleanup()

    def emit(self, message):
        self.messages.append(message)
        self.done.set()

    def install_cli(self, name, script):
        executable = self.commands/name
        executable.write_text(f'#!{sys.executable}\n'+script)
        executable.chmod(0o755)

    def ask(self, name, question='When is the beta?'):
        self.done.clear()
        self.bridge.handle({'method':'live.ask','requestId':'test','params':{
            'agent':name, 'transcript':'Maya: Thursday. $(never-run)',
            'question':question, 'history':'Earlier question'
        }})
        self.assertTrue(self.done.wait(5), 'bridge did not answer')
        return self.messages[-1]

    def test_real_process_contract_for_both_clis(self):
        for name in ('claude','codex'):
            self.install_cli(name, '''
import sys, os, json, pathlib
data = sys.stdin.read()
args = sys.argv[1:]
pathlib.Path(os.environ['OPEN_SESAME_TEST_REPORT']).write_text(json.dumps([args,data,os.getcwd()]))
if '--output-last-message' in args:
    pathlib.Path(args[args.index('--output-last-message')+1]).write_text('Thursday')
else:
    print('Thursday')
''')
            self.assertTrue(self.bridge.call('live.agents',{})[name])
            reply = self.ask(name)
            self.assertEqual(reply['result'], {'answer':'Thursday','agent':name})
            args, content, cwd = json.loads((self.path/'report').read_text())
            self.assertFalse(Path(cwd).exists())
            self.assertNotIn('When is the beta?', args)
            self.assertIn('$(never-run)', content)
            self.assertIn('Earlier question', content)
            if name == 'claude':
                self.assertEqual(args[args.index('--tools')+1], '')
            else:
                self.assertEqual(args[args.index('--sandbox')+1], 'read-only')
                self.assertIn('--ephemeral',args)

    def test_failed_sign_in_and_disallowed_provider_return_errors(self):
        self.install_cli('claude', 'import sys\nprint("not logged in",file=sys.stderr)\nsys.exit(1)\n')
        self.assertIn('Sign in', self.ask('claude')['error'])
        self.assertIn('Install', self.ask('/usr/bin/sh')['error'])
        self.assertIn('limit', self.ask('claude','a'*2001)['error'])
