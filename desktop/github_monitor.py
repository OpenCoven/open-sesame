"""A bounded GET-only GitHub monitor. Credentials stay with the local gh CLI."""
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import stat
import subprocess
import threading
import time
import uuid
from urllib.parse import urlsplit
from coven_runtime import environment, state_directory, terminate

REPOSITORY = re.compile(r'[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_.-]{1,100}\Z')
FILTERS = {
    'user': '{login}',
    'repo': '{full_name,description:(.description // "" | .[0:280]),private,default_branch,archived}',
    'pulls': '[.[] | {number,title:(.title[0:256]),draft,updated_at,user:{login:.user.login}}]',
    'issues': '[.[] | select(.pull_request == null) | {number,title:(.title[0:256]),updated_at,user:{login:.user.login}}] | .[0:8]',
    'runs': '{workflow_runs:[.workflow_runs[] | {id,name:(.name // "Workflow" | .[0:128]),display_title:(.display_title // "" | .[0:256]),status,conclusion,head_branch,updated_at}]}',
}


class GitHubError(ValueError):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def repository(value):
    if not isinstance(value, str): raise ValueError('Enter owner/repository or its GitHub URL.')
    value = value.strip()
    if value.startswith('https://'):
        url = urlsplit(value)
        if url.netloc != 'github.com' or url.query or url.fragment or url.username or url.password:
            raise ValueError('Use a credential-free github.com repository URL.')
        value = url.path.strip('/')
    if value.endswith('.git'): value = value[:-4]
    if not REPOSITORY.fullmatch(value) or value.split('/')[1] in ('.', '..'):
        raise ValueError('Enter owner/repository, without a branch, query or credentials.')
    return value


def resolve_gh():
    for candidate in (shutil.which('gh'), '/opt/homebrew/bin/gh', '/usr/local/bin/gh'):
        if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK): return str(candidate)
    raise GitHubError('install', 'Install GitHub CLI, sign in in Terminal, then choose Connect again.')


def get_json(binary, endpoint, kind, cancel):
    # Endpoints and jq filters are host-owned constants. Never accept a URL,
    # method, headers, fields, token, query or jq program from the renderer.
    env = environment(binary)
    env.update(GH_HOST='github.com', GH_PROMPT_DISABLED='1', GH_PAGER='cat')
    args = [binary, 'api', '--hostname', 'github.com', '--method', 'GET', endpoint, '--jq', FILTERS[kind]]
    with subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          env=env, start_new_session=True) as process:
        out, err, total, start = bytearray(), bytearray(), 0, time.monotonic()
        try:
            with selectors.DefaultSelector() as selector:
                for pipe, target in ((process.stdout, out), (process.stderr, err)):
                    os.set_blocking(pipe.fileno(), False); selector.register(pipe, selectors.EVENT_READ, target)
                while selector.get_map():
                    if cancel.is_set(): raise GitHubError('closed', 'GitHub monitoring stopped.')
                    if time.monotonic() - start > 12: raise GitHubError('network', 'GitHub did not respond. Check your connection and retry.')
                    for key, _ in selector.select(.1):
                        data = os.read(key.fileobj.fileno(), 65536)
                        if not data: selector.unregister(key.fileobj); continue
                        total += len(data)
                        if total > 2 * 1024 * 1024: raise GitHubError('response', 'GitHub returned too much data. Try again later.')
                        key.data.extend(data)
                while process.poll() is None:
                    if cancel.is_set() or time.monotonic() - start > 12: raise GitHubError('network', 'GitHub did not finish. Try again later.')
                    time.sleep(.02)
            if process.returncode:
                diagnostic = bytes(err).decode(errors='replace').lower()
                if any(text in diagnostic for text in ('rate limit', 'http 429', 'abuse detection')):
                    raise GitHubError('rate-limit', 'GitHub is limiting requests. Monitoring will retry in five minutes.')
                if any(text in diagnostic for text in ('http 401', 'gh auth login', 'authentication', 'bad credentials')):
                    raise GitHubError('auth', 'Sign in to GitHub CLI in Terminal, then choose Connect again.')
                if any(text in diagnostic for text in ('http 403', 'http 404', 'not found')):
                    raise GitHubError('access', 'This account cannot read the repository or this section. Check its access on GitHub.')
                raise GitHubError('network', 'GitHub is unavailable. Check your connection and retry.')
            try: return json.loads(out)
            except (ValueError, UnicodeDecodeError): raise GitHubError('response', 'GitHub returned an invalid response. Update GitHub CLI and retry.') from None
        finally:
            terminate(process)


def text(value, limit=256):
    return re.sub(r'[\x00-\x08\x0b-\x1f\x7f]', '', value)[:limit] if isinstance(value, str) else ''


class GitHubMonitor:
    def __init__(self, directory=None, resolver=resolve_gh, fetch=get_json, clock=time.monotonic):
        self.directory = Path(directory) if directory else state_directory().parent / 'github-monitor'
        self.resolver, self.fetch, self.clock = resolver, fetch, clock
        self.cancel = threading.Event(); self.lock = threading.RLock()
        self.account = None; self.account_at = 0; self.cache = {}; self.retry_at = 0

    @contextmanager
    def _store(self):
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        info = self.directory.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise ValueError('The local GitHub settings folder must be private and owned by you.')
        fd = os.open(self.directory / 'settings.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'r+') as handle:
            info = os.fstat(handle.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077: raise ValueError('Local GitHub settings are not private.')
            # Nonblocking acquisition keeps a competing app from hanging the UI.
            try: fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError: raise ValueError('Local GitHub settings are busy. Try again.') from None
            try: yield
            finally: fcntl.flock(handle, fcntl.LOCK_UN)

    def _load(self):
        path = self.directory / 'settings.json'
        try: fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        except FileNotFoundError: return []
        with os.fdopen(fd) as handle:
            info = os.fstat(handle.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_size > 16384: raise ValueError('Local GitHub settings are invalid or not private.')
            value = json.load(handle)
        if not isinstance(value, dict) or set(value) != {'schema', 'repositories'} or value['schema'] != 1 or not isinstance(value['repositories'], list) or len(value['repositories']) > 12: raise ValueError('Local GitHub settings are invalid.')
        repos = [repository(r) for r in value['repositories']]
        if len({r.lower() for r in repos}) != len(repos): raise ValueError('Local GitHub settings contain duplicate repositories.')
        return repos

    def _save(self, repos):
        temporary = self.directory / ('.settings-' + uuid.uuid4().hex)
        try:
            with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), 'w') as handle:
                json.dump({'schema': 1, 'repositories': repos}, handle); handle.flush(); os.fsync(handle.fileno())
            os.replace(temporary, self.directory / 'settings.json')
        finally:
            if temporary.exists(): temporary.unlink()

    def _api(self, endpoint, kind):
        if self.cancel.is_set(): raise GitHubError('closed', 'GitHub monitoring stopped.')
        if self.clock() < self.retry_at: raise GitHubError('rate-limit', 'GitHub is limiting requests. Monitoring will retry in five minutes.')
        try: return self.fetch(self.resolver(), endpoint, kind, self.cancel)
        except GitHubError as error:
            if error.code == 'rate-limit': self.retry_at = self.clock() + 300
            if error.code == 'auth': self.account = None; self.cache.clear()
            raise

    def status(self, force=False):
        with self.lock:
            with self._store(): repos = self._load()
            try:
                self.resolver()
                if force or not self.account or self.clock() - self.account_at >= 60:
                    user = self._api('user', 'user')
                    login = user.get('login') if isinstance(user, dict) else None
                    if not isinstance(login, str) or not re.fullmatch(r'[A-Za-z0-9-]{1,39}', login): raise GitHubError('response', 'GitHub returned an invalid account.')
                    if self.account != login: self.cache.clear()
                    self.account, self.account_at = login, self.clock()
                return {'installed': True, 'authenticated': True, 'account': self.account, 'repositories': repos}
            except GitHubError as error:
                return {'installed': error.code != 'install', 'authenticated': False, 'account': self.account if error.code in ('network', 'rate-limit') else None, 'repositories': repos, 'error': str(error), 'code': error.code}

    def add(self, value):
        repo = repository(value)
        with self.lock:
            metadata = self._api('repos/' + repo, 'repo')
            if not isinstance(metadata, dict): raise GitHubError('response', 'GitHub returned invalid repository data.')
            canonical = repository(metadata.get('full_name'))
            with self._store():
                repos = self._load()
                if canonical.lower() not in {r.lower() for r in repos}:
                    if len(repos) >= 12: raise ValueError('Monitor up to 12 repositories. Remove one before adding another.')
                    repos.append(canonical); self._save(repos)
            return {'repository': canonical, 'repositories': repos}

    def remove(self, value):
        repo = repository(value)
        with self.lock:
            with self._store():
                repos = [r for r in self._load() if r.lower() != repo.lower()]; self._save(repos)
            self.cache.pop(repo.lower(), None)
            return {'repositories': repos}

    def snapshot(self, value, force=False):
        repo = repository(value); key = repo.lower()
        with self.lock:
            with self._store(): repos = self._load()
            if key not in {r.lower() for r in repos}: raise ValueError('Add this repository to your monitor first.')
            cached = self.cache.get(key)
            if cached and self.clock() - cached['at'] < (15 if force else 60): return cached['value']
            try:
                status = self.status()
                if not status['authenticated']: raise GitHubError(status.get('code', 'auth'), status.get('error', 'Connect your GitHub CLI account before monitoring.'))
                if cached and cached['account'] != status['account']: cached = None
                metadata = self._api('repos/' + repo, 'repo')
                if not isinstance(metadata, dict): raise GitHubError('response', 'GitHub returned invalid repository data.')
                canonical = repository(metadata.get('full_name')); base = 'https://github.com/' + canonical
                value = {'repository': canonical, 'description': text(metadata.get('description'), 280), 'private': metadata.get('private') is True,
                         'branch': text(metadata.get('default_branch'), 128), 'archived': metadata.get('archived') is True, 'url': base,
                         'updatedAt': time.time(), 'stale': False, 'sections': {}}
                for section, endpoint, kind in [('pulls', '/pulls?state=open&sort=updated&direction=desc&per_page=8', 'pulls'), ('issues', '/issues?state=open&sort=updated&direction=desc&per_page=30', 'issues'), ('runs', '/actions/runs?per_page=6', 'runs')]:
                    try:
                        response = self._api('repos/' + canonical + endpoint, kind)
                        rows = response.get('workflow_runs') if kind == 'runs' and isinstance(response, dict) else response
                        if not isinstance(rows, list): raise GitHubError('response', 'This section returned invalid data.')
                        entries = []
                        for row in rows[:6 if kind == 'runs' else 8]:
                            if not isinstance(row, dict): continue
                            if kind == 'issues' and row.get('pull_request') is not None: continue
                            number = row.get('id' if kind == 'runs' else 'number')
                            if type(number) is not int or number <= 0: continue
                            entries.append({'id': number, 'title': text(row.get('display_title') or row.get('name') if kind == 'runs' else row.get('title')),
                                            'subtitle': text(row.get('head_branch') if kind == 'runs' else row['user'].get('login') if isinstance(row.get('user'), dict) else '', 128),
                                            'state': text(row.get('conclusion') or row.get('status') if kind == 'runs' else 'draft' if row.get('draft') else 'open', 40),
                                            'url': base + ('/actions/runs/' if kind == 'runs' else '/pull/' if kind == 'pulls' else '/issues/') + str(number)})
                        value['sections'][section] = {'entries': entries}
                    except GitHubError as error:
                        if error.code == 'auth': raise
                        value['sections'][section] = {'entries': [], 'error': str(error)}
                self.cache[key] = {'at': self.clock(), 'account': status['account'], 'value': value}
                return value
            except GitHubError as error:
                if cached and error.code != 'auth': return {**cached['value'], 'stale': True, 'error': str(error)}
                raise

    def close(self):
        self.cancel.set()
        self.account = None; self.cache.clear()
