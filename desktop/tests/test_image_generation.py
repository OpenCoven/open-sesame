import base64
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import image_generation as images

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII=')
REQUEST = {'id': 'image-test-request-12345', 'prompt': 'A quiet blue square', 'shape': 'square'}
THREAD = 'image-test-thread-12345'


class ImageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.binary = self.root / 'codex'
        # Exercise the actual bounded subprocess transport without a provider.
        self.binary.write_text('''#!/usr/bin/env python3
import sys,pathlib,json,os,base64
assert '--ignore-user-config' in sys.argv and '--ignore-rules' in sys.argv
assert 'default_permissions="image-widget"' in sys.argv
assert any('"/"="deny"' in a for a in sys.argv)
assert 'image_generation' in sys.argv
assert not any(k in os.environ for k in ['OPENAI_API_KEY','CODEX_API_KEY','OPENAI_BASE_URL'])
brief=sys.stdin.read()
assert 'quiet blue square' in brief
root=pathlib.Path(os.environ['CODEX_HOME'])/'generated_images'/'image-test-thread-12345'
root.mkdir(parents=True)
target=root/'result.png'
target.write_bytes(base64.b64decode(''' + repr(base64.b64encode(PNG).decode()) + '''))
pathlib.Path(sys.argv[sys.argv.index('--output-last-message')+1]).write_text(json.dumps({'path':str(target)}))
print(json.dumps({'type':'thread.started','thread_id':'image-test-thread-12345'}))
print(json.dumps({'type':'turn.completed'}))
''')
        self.binary.chmod(0o755)
        self.env = patch.dict(os.environ, {'CODEX_HOME': str(self.root), 'OPENAI_API_KEY': 'fixture-not-a-secret', 'CODEX_API_KEY': 'fixture-not-a-secret', 'OPENAI_BASE_URL': 'https://invalid.example'})
        self.env.start()
        self.account = {'available': True, 'configured': True, 'message': 'Ready', 'route': 'fixture-route', '_binary': str(self.binary)}
        self.mock = patch('computer_accounts.account', return_value=self.account)
        self.mock.start()
        self.client = images.ImageGeneration()

    def tearDown(self):
        self.client.close(); self.mock.stop(); self.env.stop(); self.temp.cleanup()

    def test_real_fixture_process_and_exact_thread_png(self):
        result = self.client.generate(REQUEST)
        self.assertEqual(result['id'], REQUEST['id'])
        self.assertEqual(base64.b64decode(result['image'].split(',')[1]), PNG)
        self.assertIsNone(self.client.active)

    def test_status_does_not_generate_or_expose_credentials(self):
        with patch('computer_accounts.invoke') as invoke:
            result = self.client.status()
            invoke.assert_not_called()
        self.assertTrue(result['configured'])
        self.assertNotIn('_binary', result); self.assertNotIn('route', result)

    def test_prestart_cancel_and_close_do_not_invoke(self):
        self.client.cancel(REQUEST['id'])
        with patch('computer_accounts.invoke') as invoke:
            with self.assertRaisesRegex(ValueError, 'stopped'): self.client.generate(REQUEST)
            invoke.assert_not_called()
        self.client.close()
        with self.assertRaises(ValueError): self.client.generate(dict(REQUEST, id='different-request-1234'))

    def test_wrong_cancel_id_does_not_cancel_current_request(self):
        flag=threading.Event();self.client.active=('current-request-1234',flag)
        self.client.cancel('previous-request-1234');self.assertFalse(flag.is_set())
        self.client.cancel('current-request-1234');self.assertTrue(flag.is_set())

    def test_account_change_rejects_completed_result(self):
        with patch('computer_accounts.account', side_effect=[self.account, dict(self.account, route='other')]):
            with self.assertRaisesRegex(ValueError, 'account changed'): self.client.generate(REQUEST)

    def test_external_symlink_truncated_and_large_images_rejected(self):
        root=self.root/'images';root.mkdir();valid=root/'valid.png';valid.write_bytes(PNG)
        self.assertEqual(images.image_bytes(valid,root),PNG)
        outside=self.root/'private.png';outside.write_bytes(PNG)
        with self.assertRaises(ValueError):images.image_bytes(outside,root)
        link=root/'linked.png';link.symlink_to(outside)
        with self.assertRaises(ValueError):images.image_bytes(link,root)
        valid.write_bytes(b'not a png')
        with self.assertRaises(ValueError):images.image_bytes(valid,root)
        with valid.open('wb') as f:f.truncate(images.MAX_IMAGE+1)
        with self.assertRaises(ValueError):images.image_bytes(valid,root)

    def test_parameter_validation_never_invokes(self):
        with patch('computer_accounts.invoke') as invoke:
            for value in [None,{},dict(REQUEST,prompt=''),dict(REQUEST,shape='url'),dict(REQUEST,id='../private'),dict(REQUEST,url='https://invalid.example')]:
                with self.assertRaises(ValueError):self.client.generate(value)
            invoke.assert_not_called()

    def test_running_cancellation_reaps_owned_process(self):
        self.binary.write_text('#!/usr/bin/env python3\nimport sys,time\nsys.stdin.read()\ntime.sleep(20)\n')
        errors=[]
        def run():
            try:self.client.generate(REQUEST)
            except ValueError as e:errors.append(str(e))
        t=threading.Thread(target=run);t.start()
        deadline=time.monotonic()+3
        while self.client.active is None and time.monotonic()<deadline:time.sleep(.01)
        self.client.cancel(REQUEST['id']);t.join(5)
        self.assertFalse(t.is_alive());self.assertTrue(errors);self.assertIsNone(self.client.active)


if __name__ == '__main__':unittest.main()
