#!/usr/bin/env python3
"""Build the embedded engine from an immutable Coven pin and locked crates."""
from pathlib import Path, PurePosixPath
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def archive_files(archive, expected):
    if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
        raise ValueError('Coven source checksum mismatch')
    files, roots, total = {}, set(), 0
    with tarfile.open(archive) as package:
        members = package.getmembers()
        if not members or len(members) > 5000:
            raise ValueError('Invalid Coven source archive')
        for member in members:
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or not path.parts or not (member.isdir() or member.isfile()):
                raise ValueError('Unsafe Coven archive entry')
            roots.add(path.parts[0])
            if not member.isfile():
                continue
            relative = PurePosixPath(*path.parts[1:]).as_posix()
            total += member.size
            if not relative or relative == '.' or relative in files or member.size > 10_000_000 or total > 100_000_000:
                raise ValueError('Invalid Coven source entry')
            data = package.extractfile(member).read()
            files[relative] = hashlib.sha256(data).hexdigest()
    if len(roots) != 1 or not files:
        raise ValueError('Invalid Coven archive root')
    return files, roots.pop()


def verify_source(source, expected):
    if source.is_symlink() or not source.is_dir():
        raise ValueError('Coven source cache must be a real directory')
    actual = {}
    for path in source.rglob('*'):
        if path.is_symlink():
            raise ValueError('Coven source cache contains a symlink; preserve it and use a fresh build directory')
        if path.is_file():
            actual[path.relative_to(source).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != expected:
        raise ValueError('Coven source cache changed; preserve it and use a fresh build directory')


def prepare(root):
    pin = json.loads((root / 'desktop/engine/source.json').read_text())
    archive = root / pin['archive']
    expected, prefix = archive_files(archive, pin['sha256'])
    source = root / 'build/coven-engine-source'
    if not source.exists() and not source.is_symlink():
        source.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='coven-extract-', dir=source.parent) as temporary:
            with tarfile.open(archive) as package:
                package.extractall(temporary, filter='data')
            extracted = Path(temporary) / prefix
            verify_source(extracted, expected)
            extracted.rename(source)
    verify_source(source, expected)
    return pin, source


def build(root=ROOT, verify_only=False):
    pin, source = prepare(root)
    if verify_only:
        print('Verified immutable Coven source: ' + pin['commit'])
        return
    compiler = subprocess.check_output(['rustc', '--version'], text=True).strip()
    engine = root / 'desktop/engine'
    inputs = {p.relative_to(engine).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in [engine / 'Cargo.toml', engine / 'Cargo.lock', *sorted((engine / 'src').rglob('*'))] if p.is_file()}
    environment = dict(os.environ, CARGO_TARGET_DIR=str(root / 'build/coven-engine-target'))
    separator = '\x1f'
    existing_flags = environment.get('CARGO_ENCODED_RUSTFLAGS')
    flags = existing_flags.split(separator) if existing_flags is not None else environment.get('RUSTFLAGS', '').split()
    home = Path.home().resolve()
    cargo_home = Path(environment.get('CARGO_HOME') or home / '.cargo').expanduser().resolve()
    for source_path, mapped_path in ((home, '/build-home'), (cargo_home, '/cargo'), (root.resolve(), '/open-sesame')):
        if source_path != Path(source_path.anchor):
            flags.append(f'--remap-path-prefix={source_path}={mapped_path}')
    environment['CARGO_ENCODED_RUSTFLAGS'] = separator.join(filter(None, flags))
    environment_hash = hashlib.sha256(json.dumps({k: environment.get(k, '') for k in ['CARGO_ENCODED_RUSTFLAGS', 'CARGO_BUILD_TARGET']}, sort_keys=True).encode()).hexdigest()
    fingerprint = hashlib.sha256(json.dumps({'pin': pin, 'compiler': compiler, 'inputs': inputs, 'environment': environment_hash}, sort_keys=True).encode()).hexdigest()
    out = root / 'build/coven-engine'; out.mkdir(exist_ok=True)
    if out.is_symlink():
        raise ValueError('Engine output must be a real directory')
    binary, receipt = out / 'CovenComputerAgent', out / 'BUILD-INFO.json'
    if binary.is_symlink() or receipt.is_symlink():
        raise ValueError('Engine output contains a symlink')
    try:
        saved = json.loads(receipt.read_text())
        cached = saved['fingerprint'] == fingerprint and saved['binary_sha256'] == hashlib.sha256(binary.read_bytes()).hexdigest()
    except (OSError, ValueError, KeyError):
        cached = False
    if not cached:
        subprocess.run(['cargo', 'build', '--release', '--locked', '--manifest-path', str(engine / 'Cargo.toml')], cwd=root, env=environment, check=True)
        verify_source(source, archive_files(root / pin['archive'], pin['sha256'])[0])
        built = root / 'build/coven-engine-target/release/open-sesame-computer-agent'
        if built.is_symlink():
            raise ValueError('Unexpected engine build output')
        temporary = out / 'CovenComputerAgent.new'
        if temporary.exists() or temporary.is_symlink():
            raise ValueError('Preserve the previous incomplete engine output before rebuilding')
        shutil.copy2(built, temporary); temporary.chmod(0o755); temporary.replace(binary)
        receipt.write_text(json.dumps({'source': pin['commit'], 'compiler': compiler, 'fingerprint': fingerprint, 'binary_sha256': hashlib.sha256(binary.read_bytes()).hexdigest()}, indent=2) + '\n')
    print('Built verified embedded Coven engine: ' + pin['commit'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--verify-only', action='store_true')
    build(verify_only=parser.parse_args().verify_only)
