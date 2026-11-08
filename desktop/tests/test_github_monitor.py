import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from github_monitor import GitHubMonitor, GitHubError, get_json, repository


class GitHubMonitorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='open-sesame-github-')
        self.root = Path(self.temp.name); self.calls = []; self.now = 1000; self.login = 'fixture-user'; self.errors = {}
        self.monitor = GitHubMonitor(self.root / 'settings', resolver=lambda: '/fixture/gh', fetch=self.fetch, clock=lambda: self.now)
        self.addCleanup(self.temp.cleanup); self.addCleanup(self.monitor.close)

    def fetch(self, binary, endpoint, kind, cancel):
        self.calls.append((endpoint, kind))
        if kind in self.errors: raise self.errors[kind]
        if kind == 'user': return {'login': self.login, 'secret': 'fixture-private-token'}
        if kind == 'repo': return {'full_name': 'Owner/Project', 'description': '<script>title only</script>', 'private': True, 'default_branch': 'main'}
        if kind == 'runs': return {'workflow_runs': [{'id': 99, 'name': 'Build', 'head_branch': 'main', 'status': 'completed', 'conclusion': 'success'}]}
        return [{'number': 4, 'title': 'A title', 'user': {'login': 'author'}, 'draft': kind == 'pulls'}, {'number': 5, 'title': 'Not an issue', 'pull_request': {}}, {'number': -1, 'title': 'Invalid'}]

    def test_repositories_reject_urls_credentials_paths_and_cli_options(self):
        self.assertEqual(repository('https://github.com/Owner/Project.git'), 'Owner/Project')
        for value in ['../secret', '--hostname/evil', 'owner/..', 'owner/repo/issues', 'https://token@github.com/o/r', 'https://github.com.evil/o/r', 'https://github.com/o/r?token=secret', 'https://github.com:443/o/r', 'file:///tmp/gh', 'o/r\n--method POST', 'https://github.com/o/%2e%2e']:
            with self.assertRaises(ValueError, msg=value): repository(value)
        self.assertEqual(self.calls, [])

    def test_private_preferences_deduplication_and_local_removal(self):
        self.monitor.add('owner/project'); self.monitor.add('https://github.com/OWNER/PROJECT')
        state = self.monitor.status(); self.assertEqual(state['repositories'], ['Owner/Project'])
        self.assertTrue(state['authenticated']); self.assertNotIn('fixture-private-token', json.dumps(state))
        self.assertEqual((self.root / 'settings').stat().st_mode & 0o777, 0o700)
        self.assertEqual((self.root / 'settings/settings.json').stat().st_mode & 0o777, 0o600)
        before = len(self.calls); self.monitor.remove('OWNER/PROJECT'); self.assertEqual(len(self.calls), before)
        self.assertEqual(self.monitor.status()['repositories'], [])

    def test_settings_symlinks_and_public_modes_fail_without_touching_target(self):
        self.monitor.add('owner/project'); path = self.root / 'settings/settings.json'; saved = path.read_bytes()
        outside = self.root / 'outside.json'; outside.write_bytes(saved); path.unlink(); path.symlink_to(outside)
        with self.assertRaises(OSError): self.monitor.status()
        self.assertEqual(outside.read_bytes(), saved); path.unlink(); path.write_bytes(saved); path.chmod(0o644)
        with self.assertRaises(ValueError): self.monitor.status()

    def test_recent_sections_links_and_no_fabricated_totals(self):
        self.monitor.add('owner/project'); result = self.monitor.snapshot('owner/project')
        self.assertEqual(result['repository'], 'Owner/Project'); self.assertTrue(result['private'])
        self.assertEqual([r['id'] for r in result['sections']['issues']['entries']], [4])
        self.assertEqual(result['sections']['runs']['entries'][0]['url'], 'https://github.com/Owner/Project/actions/runs/99')
        self.assertEqual(result['sections']['runs']['entries'][0]['state'], 'success')
        self.assertNotIn('total', json.dumps(result)); self.assertNotIn('fixture-private-token', json.dumps(result))
        with self.assertRaisesRegex(ValueError, 'Add this repository'): self.monitor.snapshot('other/repo')

    def test_cache_refresh_floor_offline_and_rate_limit_backoff(self):
        self.monitor.add('owner/project'); first = self.monitor.snapshot('owner/project'); count = len(self.calls)
        self.monitor.snapshot('owner/project', True); self.assertEqual(len(self.calls), count)
        self.now += 61; self.errors['repo'] = GitHubError('network', 'Offline fixture')
        stale = self.monitor.snapshot('owner/project'); self.assertTrue(stale['stale']); self.assertEqual(stale['updatedAt'], first['updatedAt'])
        self.errors['repo'] = GitHubError('rate-limit', 'Rate limited fixture'); self.monitor.snapshot('owner/project'); count = len(self.calls)
        self.now += 60; self.monitor.snapshot('owner/project', True); self.assertEqual(len(self.calls), count)
        self.now += 301; self.errors.clear(); self.assertFalse(self.monitor.snapshot('owner/project')['stale'])

    def test_partial_access_is_labeled_and_account_change_cannot_reveal_old_snapshot(self):
        self.monitor.add('owner/project'); self.errors['runs'] = GitHubError('access', 'Workflow access unavailable')
        result = self.monitor.snapshot('owner/project'); self.assertEqual(result['sections']['runs']['error'], 'Workflow access unavailable')
        self.now += 61; self.login = 'another-account'; self.errors['repo'] = GitHubError('access', 'No access')
        with self.assertRaisesRegex(GitHubError, 'No access'): self.monitor.snapshot('owner/project')
        self.assertEqual(self.monitor.cache, {})

    def test_auth_loss_and_shutdown_clear_private_cache(self):
        self.monitor.add('owner/project'); self.monitor.snapshot('owner/project'); self.now += 61
        self.errors['user'] = GitHubError('auth', 'Sign in again')
        with self.assertRaisesRegex(GitHubError, 'Sign in again'): self.monitor.snapshot('owner/project')
        self.assertFalse(self.monitor.cache); self.monitor.close()
        self.assertFalse(self.monitor.status()['authenticated'])

    def fixture(self, body):
        binary = self.root / 'gh-fixture'
        binary.write_text('#!' + sys.executable + '\n' + body); binary.chmod(0o755)
        return str(binary)

    def test_actual_cli_transport_is_get_only_and_redacts_credentials(self):
        args = self.root / 'args.json'
        binary = self.fixture('import json,sys\nfrom pathlib import Path\nPath(' + repr(str(args)) + ').write_text(json.dumps(sys.argv[1:]))\nprint(json.dumps({"login":"fixture"}))\n')
        self.assertEqual(get_json(binary, 'user', 'user', threading.Event()), {'login': 'fixture'})
        argv = json.loads(args.read_text()); self.assertEqual(argv[:6], ['api', '--hostname', 'github.com', '--method', 'GET', 'user'])
        binary = self.fixture('import sys\nprint("HTTP 401 fixture-private-token https://token@example.test",file=sys.stderr)\nsys.exit(1)\n')
        with self.assertRaises(GitHubError) as error: get_json(binary, 'user', 'user', threading.Event())
        self.assertEqual(error.exception.code, 'auth'); self.assertNotIn('private-token', str(error.exception)); self.assertNotIn('example.test', str(error.exception))

    def test_cancel_and_oversized_cli_output_are_bounded_and_reaped(self):
        binary = self.fixture('import time\ntime.sleep(60)\n')
        cancel = threading.Event(); timer = threading.Timer(.2, cancel.set); timer.start()
        self.addCleanup(timer.cancel)
        with self.assertRaisesRegex(GitHubError, 'stopped'): get_json(binary, 'user', 'user', cancel)
        timer.join(1)
        binary = self.fixture('import sys\nsys.stdout.write("x"*3000000)\n')
        with self.assertRaisesRegex(GitHubError, 'too much'): get_json(binary, 'user', 'user', threading.Event())


if __name__ == '__main__': unittest.main()
