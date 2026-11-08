#!/usr/bin/env python3
"""Compile the pinned, unmodified official Swift SDK without network access."""
import hashlib
import json
import pathlib
import shutil
import subprocess
import tarfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'vendor-src/workos-ios'
BUILD = ROOT / 'build/workos-sdk'
manifest = json.loads((SOURCE / 'SOURCE.json').read_text())
archive = SOURCE / 'sources.tar.gz'
assert hashlib.sha256(archive.read_bytes()).hexdigest() == manifest['archiveSHA256'], 'WorkOS source archive changed'
BUILD.mkdir(parents=True, exist_ok=True)
receipt = BUILD / 'source-sha256'
compiler = subprocess.check_output(['xcrun', 'swiftc', '--version'], text=True)
identity = manifest['archiveSHA256'] + '\n' + compiler
if not (receipt.exists() and receipt.read_text() == identity and (BUILD / 'libWorkOS.a').exists() and (BUILD / 'WorkOS.swiftmodule').exists()):
    source = BUILD / 'source'
    if source.exists():
        shutil.rmtree(source)
    source.mkdir()
    with tarfile.open(archive, 'r:gz') as package:
        members = package.getmembers()
        assert len(members) == len(manifest['files']) and all(m.isfile() for m in members)
        assert {m.name for m in members} == set(manifest['files']), 'Unexpected WorkOS archive entry'
        for member in members:
            name = member.name
            path = pathlib.PurePosixPath(name)
            assert not path.is_absolute() and '..' not in path.parts
            data = package.extractfile(member).read()
            sha = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
            assert sha == manifest['files'][name], 'WorkOS source integrity mismatch'
            target = source / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
    paths = sorted((source / 'Sources/WorkOS').rglob('*.swift'))
    args = BUILD / 'sources.rsp'
    args.write_text('\n'.join('"' + str(p) + '"' for p in paths) + '\n')
    arch = subprocess.check_output(['uname', '-m'], text=True).strip()
    subprocess.run(['xcrun', 'swiftc', '-O', '-whole-module-optimization', '-parse-as-library', '-emit-module', '-emit-library', '-static', '-module-name', 'WorkOS', '-target', arch + '-apple-macosx13.0', '-emit-module-path', str(BUILD / 'WorkOS.swiftmodule'), '-o', str(BUILD / 'libWorkOS.a'), '@' + str(args)], check=True)
    receipt.write_text(identity)
print('Verified pinned WorkOS Swift SDK: ' + manifest['revision'])
