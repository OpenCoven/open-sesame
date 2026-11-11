import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

SCANNER = Path(__file__).resolve().parents[1] / 'check-secrets.py'

@unittest.skipUnless(shutil.which('gitleaks'), 'Gitleaks integration requires the local scanner')
class SecretHookTests(unittest.TestCase):
    def test_staged_secret_cannot_be_hidden_by_working_tree_or_inline_allow(self):
        with tempfile.TemporaryDirectory() as folder:
            def git(*args):
                return subprocess.run(['git', *args], cwd=folder, check=True, capture_output=True)
            def scan():
                return subprocess.run([sys.executable, str(SCANNER)], cwd=folder, capture_output=True, text=True)
            git('init', '-q')
            target = Path(folder) / 'example.txt'
            target.write_text('ordinary text\n')
            git('add', '.')
            self.assertEqual(scan().returncode, 0)
            token = 'ghp_' + 'aB3cD5eF7gH9iJ1kL2mN4pQ6rS8tU0vWxYzA'
            target.write_text(token + ' # gitleaks:allow\n')
            git('add', '.')
            target.write_text('ordinary text\n')
            result = scan()
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn(token, result.stdout + result.stderr)
            git('add', '.')
            self.assertEqual(scan().returncode, 0)
            private = Path(folder) / '.env'
            private.write_text('safe looking text\n')
            git('add', '.')
            self.assertNotEqual(scan().returncode, 0)


    def test_staged_privacy_checks_block_addresses_hosts_and_home_paths(self):
        with tempfile.TemporaryDirectory() as folder:
            subprocess.run(['git', 'init', '-q'], cwd=folder, check=True, capture_output=True)
            target = Path(folder) / 'notes.txt'
            (Path(folder) / '.gitattributes').write_text('notes.txt -diff\n')
            subprocess.run(['git', 'add', '.gitattributes'], cwd=folder, check=True)
            candidates = [
                ('network address', '.'.join(('10', '23', '45', '67'))),
                ('network address', '.'.join(('93', '184', '216', '34'))),
                ('network address', ':'.join(('fd12', '', 'a'))),
                ('network address', ':'.join(('fd12', '', ''))),
                ('internal hostname', '.'.join(('dev-box', 'sample-tailnet', 'ts', 'net'))),
                ('internal hostname', 'https://' + '.'.join(('dev-box', 'internal'))),
                ('local home path', '/'.join(('', 'Users', 'fixture-owner', 'private'))),
            ]
            for category, value in candidates:
                with self.subTest(category=category):
                    target.write_text('Address: ' + value + '.\n')
                    subprocess.run(['git', 'add', 'notes.txt'], cwd=folder, check=True)
                    target.write_text('Unstaged replacement\n')
                    result = subprocess.run([sys.executable, str(SCANNER)], cwd=folder, capture_output=True, text=True)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn(category, result.stderr)
                    self.assertNotIn(value, result.stdout + result.stderr)

            target.write_text('http://127.0.0.1:3000 https://192.0.2.42 https://[2001:db8::42] https://example.ts.net /home/user/demo\n')
            subprocess.run(['git', 'add', 'notes.txt'], cwd=folder, check=True)
            result = subprocess.run([sys.executable, str(SCANNER)], cwd=folder, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)

class MissingScannerTests(unittest.TestCase):
    def test_missing_scanner_fails_closed(self):
        env = dict(os.environ, PATH='')
        result = subprocess.run([sys.executable, str(SCANNER)], env=env, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('install Gitleaks', result.stderr)
