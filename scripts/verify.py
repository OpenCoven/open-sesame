#!/usr/bin/env python3
"""The same bounded verification entry point is used locally and by CI."""
# Explicit stage orchestration; check.mjs separately discovers JavaScript checks.
# run_bounded.py owns timeout/process cleanup, and source_fingerprint must match after all stages. See scripts/AGENTS.md.
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time

from run_bounded import run

ROOT = Path(__file__).resolve().parents[1]


def source_fingerprint():
    paths = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=ROOT).split(b'\0')
    digest = hashlib.sha256()
    for name in sorted(set(paths) - {b''}):
        path = ROOT / os.fsdecode(name)
        digest.update(name + b'\0')
        digest.update(str(path.lstat().st_mode).encode() if path.exists() or path.is_symlink() else b'missing')
        digest.update(os.fsencode(os.readlink(path)) if path.is_symlink() else path.read_bytes() if path.is_file() else b'')
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--portable', action='store_true', help='Explicitly omit macOS compilation (used on Linux CI).')
    args = parser.parse_args()
    output = ROOT / 'build/verification' / time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
    output.mkdir(parents=True, exist_ok=False)
    before = subprocess.check_output(['git', 'status', '--porcelain=v1', '-uall'], cwd=ROOT)
    fingerprint = source_fingerprint()
    results = []

    def check(name, command, timeout=120):
        result = run(command, cwd=ROOT, log_path=output / (name + '.log'), timeout=timeout)
        results.append({'name': name, **result})
        print(('PASS ' if result['passed'] else 'FAIL ') + name, flush=True)
        if not result['passed']:
            print(Path(result['log']).read_text()[-18000:], flush=True)
        return result['passed']

    check('widget', ['node', 'scripts/check.mjs'])
    check('tooling', [sys.executable, '-B', '-m', 'unittest', 'discover', '-s', 'scripts/tests', '-v'])
    # Faulthandler supplies the blocking stack before the outer watchdog expires.
    code = "import faulthandler,unittest;faulthandler.dump_traceback_later(30,repeat=True);s=unittest.defaultTestLoader.discover('desktop/tests');r=unittest.TextTestRunner(verbosity=2).run(s);raise SystemExit(not r.wasSuccessful())"
    check('python', [sys.executable, '-B', '-u', '-c', code], 120)
    archives = []
    for index in (1, 2):
        if check('archive-' + str(index), [sys.executable, '-B', 'scripts/build-desktop-source.py']):
            archives.append(hashlib.sha256((ROOT / 'dist/downloads/open-sesame-desktop-source.zip').read_bytes()).hexdigest())
    archive_equal = len(archives) == 2 and archives[0] == archives[1]
    results.append({'name': 'archive-reproducibility', 'passed': archive_equal, 'sha256': archives})
    print(('PASS ' if archive_equal else 'FAIL ') + 'archive-reproducibility', flush=True)
    native = 'explicitly omitted (--portable)' if args.portable else 'unavailable on ' + sys.platform
    if sys.platform == 'darwin' and not args.portable:
        native = 'macOS compilation failed; see macos-build result'
        check('embedded-engine-build', [sys.executable, '-B', 'scripts/build-coven-engine.py'], 600)
        check('embedded-engine-tests', ['cargo', 'test', '--release', '--locked', '--target-dir', str(ROOT / 'build/coven-engine-target'), '--manifest-path', 'desktop/engine/Cargo.toml'], 120)
        check('native-url', ['bash', 'scripts/check-native.sh'])
        check('native-authentication', ['bash', 'scripts/check-authentication.sh'], 180)
        check('native-screen-notes', ['bash', 'scripts/check-screen-notes.sh'], 120)
        if check('macos-build', ['bash', 'desktop/build-macos.sh'], 180):
            native = 'compiled; GUI acceptance is separate'
            app = str(ROOT / 'build/Open Sesame.app')
            check('signature', ['codesign', '--verify', '--deep', '--strict', '--verbose=2', app])
            check('plist', ['plutil', '-lint', app + '/Contents/Info.plist'])
            check('process-package', [sys.executable, '-B', 'scripts/check-process-package.py', app])
            check('app-icon', [sys.executable, '-B', 'scripts/check-app-icon.py', app])
    elif not args.portable:
        results.append({'name': 'native-build', 'passed': False, 'error': native + '; use --portable explicitly'})
    after = subprocess.check_output(['git', 'status', '--porcelain=v1', '-uall'], cwd=ROOT)
    results.append({'name': 'source-cleanliness', 'passed': before == after and fingerprint == source_fingerprint(), 'sha256': fingerprint})
    report = {'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
              'sourceStatus': before.decode(), 'platform': platform.platform(), 'architecture': platform.machine(),
              'python': sys.version, 'node': subprocess.check_output(['node', '--version'], text=True).strip(),
              'native': native, 'results': results}
    if sys.platform == 'darwin' and not args.portable:
        report['swift'] = subprocess.check_output(['xcrun', 'swiftc', '--version'], text=True).strip()
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print('Receipt: ' + str(output / 'report.json'))
    return 0 if all(result['passed'] for result in results) else 1


if __name__ == '__main__':
    raise SystemExit(main())
