#!/usr/bin/env python3
"""Local task ownership, read-only inventory, and guarded branch/worktree retirement."""
import argparse
from contextlib import contextmanager
import datetime as dt
import fcntl
import hashlib
import json
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import uuid


def command(args, cwd=None, allowed=(0,)):
    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=15)
    if result.returncode not in allowed:
        raise ValueError(f'{args[0]} failed: {result.stderr.strip() or result.stdout.strip()}')
    return result.stdout.strip()


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


class Project:
    def __init__(self, cwd=None):
        self.root = Path(command(['git', 'rev-parse', '--show-toplevel'], cwd)).resolve()
        self.common = Path(command(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], self.root))
        self.state = self.common / 'open-sesame'

    def git(self, *args, cwd=None, allowed=(0,)):
        return command(['git', *args], cwd or self.root, allowed)

    @contextmanager
    def lock(self):
        self.state.mkdir(parents=True, exist_ok=True)
        with (self.state / 'lock').open('a') as handle:
            fcntl.flock(handle, fcntl.LOCK_EX)
            yield

    def tasks(self):
        return [json.loads(p.read_text()) for p in sorted((self.state / 'tasks').glob('*.json'))]

    def worktrees(self):
        trees = []
        for block in self.git('worktree', 'list', '--porcelain', '-z').split('\0\0'):
            fields = {}
            for entry in block.split('\0'):
                if entry:
                    key, _, value = entry.partition(' ')
                    fields[key] = value or True
            if 'worktree' in fields:
                trees.append(fields)
        return trees

    def status(self, path):
        return self.git('status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching', cwd=path).split('\0')

    def repository(self):
        origin = self.git('remote', 'get-url', 'origin')
        match = re.fullmatch(r'(?:https://github.com/|git@github.com:)([^/]+/[^/]+?)(?:\.git)?', origin)
        if not match:
            raise ValueError('Only an explicit github.com origin is supported for remote evidence.')
        return match[1]

    def remote(self, path=None):
        path = Path(path) if path else self.state / 'remote.json'
        data = json.loads(path.read_text())
        observed = dt.datetime.fromisoformat(data['observedAt'])
        if observed.tzinfo is None:
            raise ValueError('Remote evidence needs a timezone-qualified observedAt timestamp.')
        age = (dt.datetime.now(dt.timezone.utc) - observed).total_seconds()
        if data.get('source') != 'github-rest' or data.get('complete') is not True or data.get('repository') != self.repository():
            raise ValueError('Remote evidence must be a complete GitHub REST snapshot for this origin.')
        if age < 0 or age > 300:
            raise ValueError('Remote evidence is stale: refresh all branch/open-PR pages within five minutes.')
        if not isinstance(data.get('branches'), dict) or not isinstance(data.get('openPulls'), list):
            raise ValueError('Remote evidence is missing branches/openPulls.')
        for sha in data['branches'].values():
            if not re.fullmatch('[0-9a-f]{40}', sha):
                raise ValueError('Invalid remote branch SHA.')
        return data

    def refresh(self):
        repo = self.repository()
        branches = json.loads(command(['gh', 'api', '--paginate', '--slurp', f'repos/{repo}/branches?per_page=100']))
        pulls = json.loads(command(['gh', 'api', '--paginate', '--slurp', f'repos/{repo}/pulls?state=open&per_page=100']))
        data = {'repository': repo, 'source': 'github-rest', 'complete': True, 'observedAt': now(),
                'branches': {r['name']: r['commit']['sha'] for page in branches for r in page},
                'openPulls': [{'number': r['number'], 'headRef': r['head']['ref'], 'headSha': r['head']['sha']} for page in pulls for r in page]}
        save(self.state / 'remote.json', data)
        return data

    def inventory(self, base='main'):
        tasks = self.tasks()
        base_sha = self.git('rev-parse', '--verify', 'refs/heads/' + base)
        branches = []
        for line in self.git('for-each-ref', '--format=%(refname:short) %(objectname) %(tree)', 'refs/heads').splitlines():
            branch, head, tree = line.split()
            branches.append({'branch': branch, 'head': head, 'delivery': self.delivery(head, base_sha),
                             'owners': [t for t in tasks if t['branch'] == branch]})
        trees = []
        for tree in self.worktrees():
            path = Path(tree['worktree'])
            try:
                state = [s for s in self.status(path) if s]
            except (ValueError, OSError) as error:
                state = ['UNAVAILABLE ' + str(error)]
            generated = [str(p.relative_to(path)) for pattern in ('build/*', 'dist/downloads/*', '**/__pycache__', '**/.DS_Store') for p in path.glob(pattern)] if path.exists() else []
            try:
                process_state = {'activeProcessIds': self.active_processes(path)} if path.exists() else {'unavailable': 'missing worktree'}
            except (ValueError, subprocess.TimeoutExpired) as error:
                process_state = {'unavailable': str(error)}
            trees.append({**tree, 'state': state, 'generatedCandidates': generated,
                          'processes': process_state,
                          'owners': [t for t in tasks if Path(t['worktree']) == path]})
        try:
            remote = self.remote()
        except (ValueError, OSError, KeyError) as error:
            remote = {'unavailable': str(error)}
        return {'root': str(self.root), 'commonState': str(self.state), 'base': base_sha,
                'branches': branches, 'worktrees': trees, 'tasks': tasks, 'remote': remote,
                'artifactPolicy': 'Generated candidates are preserved; inventory is not deletion authority.'}

    def delivery(self, head, base):
        if subprocess.run(['git', 'merge-base', '--is-ancestor', head, base], cwd=self.root).returncode == 0:
            return 'ancestor'
        tree = self.git('rev-parse', head + '^{tree}')
        for entry in self.git('log', '--format=%H %T', base).splitlines():
            commit, integrated_tree = entry.split()
            if integrated_tree == tree:
                return 'tree-equivalent:' + commit
        return 'unproven'

    def task(self, args):
        if not re.fullmatch('[a-z0-9][a-z0-9-]{0,79}', args.id):
            raise ValueError('Use a lowercase task slug.')
        path = self.state / 'tasks' / (args.id + '.json')
        old = json.loads(path.read_text()) if path.exists() else None
        branch = self.git('symbolic-ref', '--short', 'HEAD')
        if old and (old['owner'] != args.owner or old['branch'] != branch or Path(old['worktree']) != self.root):
            raise ValueError('Task belongs to another owner/branch/worktree; explicit handoff required.')
        if old and old['status'] == 'released':
            raise ValueError('Released claims are immutable; create a new task ID.')
        if not old:
            if not args.scope or not args.acceptance or not args.next:
                raise ValueError('New tasks require scope, acceptance, and next action.')
            if any(t['branch'] == branch and t['status'] != 'released' for t in self.tasks()):
                raise ValueError('This branch already has an owner; resume the existing task.')
        data = {**(old or {}), 'id': args.id, 'owner': args.owner, 'branch': branch,
                'worktree': str(self.root), 'status': args.status, 'updatedAt': now()}
        data.setdefault('managedBy', 'external' if '/.codex/worktrees/' in str(self.root) else 'project')
        data.setdefault('dependencies', [])
        data.setdefault('base', self.git('rev-parse', 'HEAD'))
        data['head'] = self.git('rev-parse', 'HEAD')
        for key, value in [('scope', args.scope), ('acceptance', args.acceptance), ('dependencies', args.depends_on), ('nextAction', args.next)]:
            if value is not None:
                data[key] = value
        data['evidence'] = data.get('evidence', []) + (args.evidence or [])
        if args.status == 'released':
            head = self.git('rev-parse', 'HEAD')
            if args.expected_head != head:
                raise ValueError('Owner release requires --expected-head matching HEAD exactly.')
            data.update(releasedHead=head, releasedAt=now())
        save(path, data)
        return data

    def active_processes(self, path):
        # lsof reports file paths, not command arguments/prompts. Any uncertainty blocks retirement.
        if not shutil.which('lsof'):
            raise ValueError('lsof unavailable; cannot establish process inactivity.')
        result = subprocess.run(['lsof', '-nP', '+D', str(path), '-F', 'pn'], capture_output=True, text=True, timeout=15)
        if result.returncode not in (0, 1) or result.stderr.strip():
            raise ValueError('Process/file-use scan unavailable: ' + result.stderr.strip())
        return [int(line[1:]) for line in result.stdout.splitlines() if line.startswith('p')]

    def prune_plan(self, args):
        reasons = []
        if args.branch in ('main', 'master', 'trunk', args.base) or not re.fullmatch('[0-9a-f]{40}', args.expected_head or ''):
            raise ValueError('An unprotected explicit branch and full --expected-head are required.')
        self.git('check-ref-format', 'refs/heads/' + args.branch)
        head = self.git('rev-parse', '--verify', 'refs/heads/' + args.branch)
        base = self.git('rev-parse', '--verify', 'refs/heads/' + args.base)
        if head != args.expected_head:
            reasons.append('head-moved')
        tasks = [t for t in self.tasks() if t['branch'] == args.branch]
        if any(t.get('managedBy') == 'external' or t.get('externallyManaged') for t in tasks):
            reasons.append('externally-managed-work')
        if not tasks or any(t['status'] != 'released' or t.get('releasedHead') != head for t in tasks):
            reasons.append('owner-release-missing-or-stale')
        delivery = self.delivery(head, base)
        if delivery == 'unproven':
            reasons.append('delivery-unproven')
        try:
            remote = self.remote(args.remote_evidence)
            if remote['branches'].get(args.base) != base:
                reasons.append('base-not-current-remote')
            if any(p['headRef'] == args.branch or p['headSha'] == head for p in remote['openPulls']):
                reasons.append('open-pr')
        except (ValueError, OSError, KeyError, TypeError) as error:
            reasons.append('remote-unavailable: ' + str(error))
        trees = self.worktrees()
        linked = [t for t in trees if t.get('branch') == 'refs/heads/' + args.branch]
        target = Path(args.worktree).absolute() if args.worktree else None
        if target is not None and (target.is_symlink() or target != target.resolve()):
            reasons.append('noncanonical-or-symlink-worktree')
        if linked and (target is None or len(linked) != 1 or linked[0]['worktree'] != str(target)):
            reasons.append('explicit-worktree-target-required')
        if target is not None:
            if '/.codex/worktrees/' in str(target) or any(t.get('managedBy') != 'project' for t in tasks):
                reasons.append('external-or-unknown-worktree-manager')
            if not linked or str(target) != linked[0]['worktree']:
                reasons.append('worktree-branch-mismatch')
            elif target == self.root or str(target) == trees[0]['worktree'] or 'locked' in linked[0] or 'prunable' in linked[0]:
                reasons.append('current-primary-locked-or-missing-worktree')
            else:
                if not tasks or any(Path(t['worktree']) != target for t in tasks):
                    reasons.append('worktree-owner-mismatch')
                state = [s for s in self.status(target) if s]
                if state:
                    reasons.append('dirty-untracked-or-ignored-data')
                try:
                    if self.active_processes(target):
                        reasons.append('active-process')
                except (ValueError, subprocess.TimeoutExpired) as error:
                    reasons.append('process-state-unavailable: ' + str(error))
        return {'branch': args.branch, 'expectedHead': args.expected_head, 'head': head, 'base': base,
                'worktree': str(target) if target else None, 'delivery': delivery,
                'owners': tasks, 'blockers': reasons, 'eligible': not reasons}

    def prune(self, args):
        plan = self.prune_plan(args)
        if not args.apply or not plan['eligible']:
            return {**plan, 'applied': False, 'dryRun': not args.apply}
        token = uuid.uuid4().hex
        receipt = self.state / 'receipts' / ('retire-' + token + '.json')
        receipt.parent.mkdir(parents=True, exist_ok=True)
        bundle = receipt.with_suffix('.bundle')
        backup = 'refs/open-sesame/archive/' + token
        self.git('update-ref', backup, plan['head'], '0' * 40)
        self.git('bundle', 'create', str(bundle), backup)
        self.git('bundle', 'verify', str(bundle))
        record = {**plan, 'createdAt': now(), 'status': 'archived', 'archiveRef': backup,
                  'bundle': str(bundle), 'bundleSha256': hashlib.sha256(bundle.read_bytes()).hexdigest(),
                  'restore': [shlex.join(['git', 'fetch', str(bundle), backup]),
                              shlex.join(['git', 'branch', args.branch, plan['head']])]}
        if args.worktree:
            record['restore'].append(shlex.join(['git', 'worktree', 'add', str(Path(args.worktree).resolve()), args.branch]))
        save(receipt, record)
        # Repeat all checks under the shared lock after the recovery archive exists.
        fresh = self.prune_plan(args)
        if fresh != plan:
            record.update(status='aborted-state-changed', revalidation=fresh)
            save(receipt, record)
            raise ValueError('State changed during archival; nothing retired. Receipt: ' + str(receipt))
        try:
            if args.worktree:
                self.git('worktree', 'remove', str(Path(args.worktree).resolve()))
            self.git('update-ref', '-d', 'refs/heads/' + args.branch, args.expected_head)
            if subprocess.run(['git', 'show-ref', '--verify', '--quiet', 'refs/heads/' + args.branch], cwd=self.root).returncode == 0:
                raise ValueError('Branch unexpectedly remains.')
            if any(t.get('branch') == 'refs/heads/' + args.branch for t in self.worktrees()):
                raise ValueError('Worktree unexpectedly remains.')
            record.update(status='retired', applied=True, afterWorktrees=self.worktrees(),
                          afterBranches=self.git('for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads').splitlines())
        except Exception as error:
            record.update(status='partial-failure', error=str(error))
            save(receipt, record)
            raise
        save(receipt, record)
        return {**record, 'receipt': str(receipt)}


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='action', required=True)
    for name in ('inventory', 'check'):
        q = sub.add_parser(name)
        q.add_argument('--base', default='main')
    sub.add_parser('refresh')
    q = sub.add_parser('task')
    q.add_argument('--id', required=True)
    q.add_argument('--owner', required=True)
    q.add_argument('--scope')
    q.add_argument('--acceptance', action='append')
    q.add_argument('--depends-on', action='append')
    q.add_argument('--next')
    q.add_argument('--evidence', action='append')
    q.add_argument('--status', choices=['active', 'blocked', 'review', 'released'], default='active')
    q.add_argument('--expected-head')
    q = sub.add_parser('prune')
    q.add_argument('--branch', required=True)
    q.add_argument('--expected-head', required=True)
    q.add_argument('--base', default='main')
    q.add_argument('--worktree')
    q.add_argument('--remote-evidence')
    mode = q.add_mutually_exclusive_group()
    mode.add_argument('--apply', action='store_true')
    mode.add_argument('--dry-run', action='store_true')
    return p


def main():
    args = parser().parse_args()
    try:
        project = Project()
        if args.action in ('inventory', 'check'):
            result = project.inventory(args.base)
            problems = []
            if args.action == 'check':
                for tree in result['worktrees']:
                    branch = str(tree.get('branch', '')).removeprefix('refs/heads/')
                    if branch != args.base and not tree['owners']:
                        problems.append('Unclaimed worktree: ' + tree['worktree'])
                for branch in result['branches']:
                    if branch['branch'] != args.base and not branch['owners']:
                        problems.append('Unknown owner; preserve branch: ' + branch['branch'])
                    if len([t for t in branch['owners'] if t['status'] != 'released']) > 1:
                        problems.append('Conflicting owners; resolve handoff: ' + branch['branch'])
                    for task in branch['owners']:
                        if task['status'] == 'released' and task.get('releasedHead') != branch['head']:
                            problems.append('Stale owner release; preserve branch: ' + branch['branch'])
                for task in result['tasks']:
                    missing = [key for key in ('owner', 'scope', 'acceptance', 'status', 'nextAction', 'evidence') if not task.get(key)]
                    if missing:
                        problems.append('Incomplete task ' + task['id'] + ': ' + ', '.join(missing))
                    if task['status'] != 'released' and not any(tree.get('branch') == 'refs/heads/' + task['branch'] and tree['worktree'] == task['worktree'] for tree in result['worktrees']):
                        problems.append('Active task has no matching checkout: ' + task['id'])
                if 'unavailable' in result['remote']:
                    problems.append('Refresh remote evidence before retirement: ' + result['remote']['unavailable'])
                result['problems'] = problems
            print(json.dumps(result, indent=2))
            return int(bool(problems))
        with project.lock():
            result = getattr(project, args.action)(args) if args.action != 'refresh' else project.refresh()
        print(json.dumps(result, indent=2))
        return int(args.action == 'prune' and not result['eligible'])
    except (ValueError, OSError, KeyError, subprocess.TimeoutExpired) as error:
        print('BLOCKED: ' + str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
