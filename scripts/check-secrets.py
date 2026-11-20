#!/usr/bin/env python3
"""Check staged paths and run Gitleaks against the staged diff without printing secrets."""
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile


IP_LITERAL = re.compile(
    rb'(?<![\w.:])(?:[0-9a-fA-F]{0,4}:){2,}[0-9a-fA-F:.]*(?![\w.:])'
    rb'|(?<![\w.])(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?!\w|\.\d)'
)
INTERNAL_HOST = re.compile(
    rb'(?i)(?<![\w.-])(?:[a-z0-9][a-z0-9-]*\.)+(?:ts\.net|local|internal|lan)(?![\w-]|\.[\w-])'
)
LOCAL_HOME = re.compile(rb'/(?:Users|home)/([a-zA-Z0-9_.-]+)(?=/|\s|["\x27`]|$)')
DOCUMENTATION_NETS = tuple(map(ipaddress.ip_network, (
    '192.0.2.0/24', '198.51.100.0/24', '203.0.113.0/24', '2001:db8::/32', '3fff::/20',
)))
EXAMPLE_ACCOUNTS = {b'alice', b'example', b'runner', b'test', b'user', b'username'}


def sensitive_address(literal):
    try:
        address = ipaddress.ip_address(literal.decode('ascii').rstrip('.'))
    except ValueError:
        return False
    address = getattr(address, 'ipv4_mapped', None) or address
    return not (
        address.is_loopback or address.is_unspecified or
        any(address in network for network in DOCUMENTATION_NETS)
    )


def added_lines(path):
    diff = subprocess.check_output([
        'git', 'diff', '--cached', '--unified=0', '--no-ext-diff', '--no-textconv',
        '--no-renames', '--no-color', '--text', '--', ':(literal)' + path,
    ])
    in_hunk = False
    for line in diff.split(b'\n'):
        if line.startswith(b'@@ '):
            in_hunk = True
        elif in_hunk and line.startswith(b'+'):
            yield line[1:]


def privacy_finding(line):
    if any(sensitive_address(match.group()) for match in IP_LITERAL.finditer(line)):
        return 'network address'
    for match in INTERNAL_HOST.finditer(line):
        host = match.group().lower()
        if host.split(b'.')[0] in {b'example', b'localhost'}:
            continue
        previous = line[match.start()-1:match.start()]
        following = line[match.end():match.end()+1]
        if host.endswith(b'.ts.net') or previous in (b'/', b'=', b'"', b"'", b'`') or following == b':':
            return 'internal hostname'
    if any(match.group(1).lower() not in EXAMPLE_ACCOUNTS for match in LOCAL_HOME.finditer(line)):
        return 'local home path'
    return None


def main():
    scanner = shutil.which('gitleaks')
    if not scanner:
        print('Secret check blocked: install Gitleaks (brew install gitleaks) and retry.', file=sys.stderr)
        return 1
    changed = set(subprocess.check_output(['git', 'diff', '--cached', '--name-only', '--diff-filter=ACMRT', '-z']).split(b'\0'))
    entries = subprocess.check_output(['git', 'ls-files', '--stage', '-z']).split(b'\0')
    with tempfile.TemporaryDirectory(prefix='open-sesame-index-') as folder:
        root = Path(folder)
        for entry in filter(None, entries):
            metadata, raw_name = entry.split(b'\t', 1)
            mode, oid, stage = metadata.split()
            name = os.fsdecode(raw_name)
            path = Path(name)
            parts = {p.lower() for p in path.parts}
            filename = path.name.lower()
            private = any(p in {'.ssh', '.aws', 'secrets', 'credentials'} for p in parts)
            private |= filename != '.env.example' and (filename == '.env' or filename.startswith('.env.'))
            private |= filename in {'auth.json', 'credentials.json', 'token.json', 'tokens.json'} or filename.startswith(('client_secret', 'service-account'))
            private |= path.suffix.lower() in {'.p8', '.pem', '.key', '.p12', '.pfx', '.keychain', '.keychain-db'}
            if private or mode not in {b'100644', b'100755'} or stage != b'0' or path.is_absolute() or '..' in path.parts:
                print('Secret check blocked: private path, unresolved entry, or unsupported file type in index: ' + repr(name), file=sys.stderr)
                return 1
            if raw_name not in changed:
                continue
            data = subprocess.check_output(['git', 'cat-file', 'blob', oid.decode()])
            if re.search(rb'-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]{64,}-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----', data):
                print('Secret check blocked: private key material in ' + repr(name), file=sys.stderr)
                return 1
            # Force Git to emit text even if attributes suppress its diff. Leave
            # binary data to the existing scanner and the distribution audit.
            if b'\0' in data:
                continue
            for line in added_lines(name):
                finding = privacy_finding(line)
                if finding:
                    print('Privacy check blocked: ' + finding + ' in ' + repr(name), file=sys.stderr)
                    return 1
        config = root / 'gitleaks.toml'
        config.write_text('[extend]\nuseDefault = true\n')
        ignore = root / 'empty-ignore'
        ignore.write_text('')
        env = {k: v for k, v in os.environ.items() if not k.startswith('GITLEAKS_')}
        result = subprocess.run([scanner, 'git', '--staged', '--config', str(config), '--gitleaks-ignore-path', str(ignore), '--ignore-gitleaks-allow', '--redact', '--no-banner', '--log-level', 'warn', '--timeout', '60', '--report-format', 'json', '--report-path', str(root / 'findings.json')], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        if result.returncode:
            # Gitleaks may include source snippets even when values are redacted. Keep output private.
            print('Secret check blocked: staged content failed Gitleaks scanning. Run Gitleaks locally with --redact to investigate; no source snippets are printed by this hook.', file=sys.stderr)
            report = root / 'findings.json'
            if report.exists():
                for finding in json.loads(report.read_text()):
                    print('Finding: ' + repr(finding.get('File')) + ' rule=' + str(finding.get('RuleID')) + ' line=' + str(finding.get('StartLine')), file=sys.stderr)
            return 1
    print('PASS staged-index secret scan (Gitleaks and private-file checks).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
