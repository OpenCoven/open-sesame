import argparse
import datetime as dt
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from project import Project, save


class RetirementTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='sesame-retirement-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve() / 'repo with spaces'
        self.root.mkdir()
        self.git('init', '-b', 'main')
        self.git('config', 'user.name', 'Disposable fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        self.git('config', 'commit.gpgsign', 'false')
        (self.root / 'source.txt').write_text('original source\n')
        (self.root / '.gitignore').write_text('cache/\n')
        self.git('add', '.')
        self.git('commit', '-m', 'fixture base')
        self.git('remote', 'add', 'origin', 'https://github.com/fixture/repo.git')
        self.target = self.root.parent / 'retired worktree'
        self.git('worktree', 'add', '-b', 'candidate', str(self.target))
        self.head = self.git('rev-parse', 'HEAD')
        self.project = Project(self.root)
        self.args = argparse.Namespace(branch='candidate', expected_head=self.head, base='main',
                                       worktree=str(self.target), remote_evidence=None, apply=False)
        self.claim = {'id': 'fixture', 'owner': 'fixture-owner', 'branch': 'candidate',
                      'worktree': str(self.target), 'managedBy': 'project', 'status': 'released', 'releasedHead': self.head}
        self.claim_path = self.project.state / 'tasks/fixture.json'
        self.remote = {'repository': 'fixture/repo', 'source': 'github-rest', 'complete': True,
                       'observedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                       'branches': {'main': self.head, 'candidate': self.head}, 'openPulls': []}
        save(self.claim_path, self.claim)
        self.save_remote()

    def git(self, *args, cwd=None):
        result = subprocess.run(['git', *args], cwd=cwd or self.root, text=True, capture_output=True, check=True)
        return result.stdout.strip()

    def save_remote(self):
        save(self.project.state / 'remote.json', self.remote)

    def blocked(self, reason):
        plan = self.project.prune(self.args)
        self.assertFalse(plan['eligible'], plan)
        self.assertTrue(any(reason in r for r in plan['blockers']), plan)
        self.assertTrue(self.target.exists())
        self.assertEqual(self.git('rev-parse', 'candidate'), self.args.expected_head if reason != 'head-moved' else self.head)

    def test_default_dry_run_does_not_archive_or_remove(self):
        result = self.project.prune(self.args)
        self.assertTrue(result['eligible'], result)
        self.assertTrue(result['dryRun'])
        self.assertFalse(result['applied'])
        self.assertTrue(self.target.exists())
        self.assertFalse((self.project.state / 'receipts').exists())

    def test_expected_head_is_mandatory_and_must_match(self):
        self.args.expected_head = '0' * 40
        self.blocked('head-moved')
        self.args.expected_head = 'short'
        with self.assertRaises(ValueError):
            self.project.prune(self.args)

    def test_release_is_required_and_bound_to_head(self):
        for change in ({'status': 'active'}, {'releasedHead': '0' * 40}):
            save(self.claim_path, {**self.claim, **change})
            self.blocked('owner-release-missing-or-stale')
        self.claim_path.unlink()
        self.blocked('owner-release-missing-or-stale')

    def test_remote_evidence_fails_closed(self):
        for change in ({'complete': False}, {'repository': 'other/repo'},
                       {'observedAt': '2026-11-06T00:00:00'},
                       {'observedAt': '2000-01-01T00:00:00+00:00'}, {'branches': {'main': '0' * 40}}):
            save(self.project.state / 'remote.json', {**self.remote, **change})
            plan = self.project.prune(self.args)
            self.assertFalse(plan['eligible'], plan)
        (self.project.state / 'remote.json').unlink()
        self.blocked('remote-unavailable')

    def test_open_pr_preserves_even_tree_equivalent_branch(self):
        self.remote['openPulls'] = [{'headRef': 'candidate', 'headSha': self.head, 'number': 2}]
        self.save_remote()
        self.blocked('open-pr')

    def test_tracked_untracked_and_ignored_data_each_block(self):
        for name in ('source.txt', 'untracked.txt', 'cache/ignored.txt'):
            file = self.target / name
            file.parent.mkdir(exist_ok=True)
            original = file.read_bytes() if file.exists() else None
            file.write_text('must survive\n')
            self.blocked('dirty-untracked-or-ignored-data')
            if original is not None:
                file.write_bytes(original)
            else:
                file.unlink()

    def test_worktree_target_lock_and_symlink_guards(self):
        self.args.worktree = None
        self.blocked('explicit-worktree-target-required')
        self.args.worktree = str(self.target)
        self.git('worktree', 'lock', str(self.target))
        self.blocked('current-primary-locked-or-missing-worktree')
        self.git('worktree', 'unlock', str(self.target))
        link = self.target.parent / 'alias'
        link.symlink_to(self.target, target_is_directory=True)
        self.args.worktree = str(link)
        self.blocked('noncanonical-or-symlink-worktree')

    def test_active_process_and_unavailable_scan_block(self):
        child = subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(30)'], cwd=self.target)
        try:
            self.blocked('active-process')
        finally:
            child.terminate()
            child.wait(timeout=5)
        with mock.patch.object(self.project, 'active_processes', side_effect=ValueError('scan failed')):
            self.blocked('process-state-unavailable')

    def test_unique_work_is_preserved(self):
        (self.target / 'unique.txt').write_text('unique\n')
        self.git('add', '.', cwd=self.target)
        self.git('commit', '-m', 'unique work', cwd=self.target)
        self.args.expected_head = self.git('rev-parse', 'candidate')
        save(self.claim_path, {**self.claim, 'releasedHead': self.args.expected_head})
        self.blocked('delivery-unproven')

    def test_equivalent_squash_tree_is_archived_retired_and_restorable(self):
        # This commit is not an ancestor of main, but its exact tree was delivered.
        self.git('commit', '--allow-empty', '-m', 'different history', cwd=self.target)
        self.args.expected_head = self.git('rev-parse', 'candidate')
        save(self.claim_path, {**self.claim, 'releasedHead': self.args.expected_head})
        self.args.apply = True
        with self.project.lock():
            result = self.project.prune(self.args)
        self.assertTrue(result['applied'])
        self.assertTrue(result['delivery'].startswith('tree-equivalent:'))
        self.assertFalse(self.target.exists())
        self.assertEqual(json.loads(Path(result['receipt']).read_text())['status'], 'retired')
        # Restore using only the verified bundle; remove the local safety ref first.
        self.git('update-ref', '-d', result['archiveRef'])
        self.git('fetch', result['bundle'], result['archiveRef'])
        self.git('branch', 'candidate', self.args.expected_head)
        self.git('worktree', 'add', str(self.target), 'candidate')
        self.assertEqual((self.target / 'source.txt').read_text(), 'original source\n')

    def test_state_change_after_archive_aborts_before_retirement(self):
        self.args.apply = True
        original = self.project.prune_plan
        calls = []
        def changing(args):
            if calls:
                (self.target / 'late-work.txt').write_text('arrived during archival\n')
            calls.append(True)
            return original(args)
        with mock.patch.object(self.project, 'prune_plan', side_effect=changing):
            with self.assertRaisesRegex(ValueError, 'State changed'):
                self.project.prune(self.args)
        self.assertTrue((self.target / 'late-work.txt').exists())
        self.assertEqual(self.git('rev-parse', 'candidate'), self.head)
        receipts = list((self.project.state / 'receipts').glob('*.json'))
        self.assertEqual(json.loads(receipts[0].read_text())['status'], 'aborted-state-changed')

    def test_another_owner_cannot_take_or_release_task(self):
        project = Project(self.target)
        args = argparse.Namespace(id='fixture', owner='another-owner', status='released',
                                  expected_head=self.head, scope=None, acceptance=None,
                                  depends_on=None, next=None, evidence=None)
        with self.assertRaisesRegex(ValueError, 'another owner'):
            project.task(args)

    def test_external_manager_blocks_retirement_despite_owner_release(self):
        save(self.claim_path, {**self.claim, 'managedBy': 'external'})
        self.blocked('externally-managed-work')

    def test_cli_claim_checkpoint_and_exact_head_release(self):
        self.claim_path.unlink()
        script = str(Path(__file__).resolve().parents[1] / 'project.py')
        prefix = [sys.executable, '-B', script, 'task', '--id', 'lifecycle', '--owner', 'fixture-session']
        def invoke(*args):
            return subprocess.run([*prefix, *args], cwd=self.target, capture_output=True, text=True, timeout=10)
        claim = invoke('--scope', 'Fixture lifecycle', '--acceptance', 'Safe explicit release', '--next', 'Verify')
        self.assertEqual(claim.returncode, 0, claim.stderr)
        record = json.loads(claim.stdout)
        self.assertEqual(record['dependencies'], [])
        checkpoint = invoke('--next', 'Review', '--evidence', 'fixture receipt')
        self.assertEqual(checkpoint.returncode, 0, checkpoint.stderr)
        self.assertIn('fixture receipt', json.loads(checkpoint.stdout)['evidence'])
        rejected = invoke('--status', 'released', '--expected-head', '0' * 40)
        self.assertNotEqual(rejected.returncode, 0)
        path = self.project.state / 'tasks/lifecycle.json'
        self.assertEqual(json.loads(path.read_text())['status'], 'active')
        released = invoke('--status', 'released', '--expected-head', self.head)
        self.assertEqual(released.returncode, 0, released.stderr)
        self.assertEqual(json.loads(released.stdout)['releasedHead'], self.head)
        self.assertNotEqual(invoke('--next', 'Unexpected new work').returncode, 0)


if __name__ == '__main__':
    unittest.main()
