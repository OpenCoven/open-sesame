import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('embedded_engine_build', Path(__file__).resolve().parents[1] / 'build-coven-engine.py')
engine = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(engine)


class EmbeddedEngineBuildTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='sesame-engine-build-'); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name); (self.root / 'desktop/engine/src').mkdir(parents=True)
        (self.root / 'desktop/engine/Cargo.toml').write_text('fixture manifest')
        (self.root / 'desktop/engine/Cargo.lock').write_text('fixture lock')
        (self.root / 'desktop/engine/src/main.rs').write_text('fixture adapter')
        self.archive = self.root / 'source.tar.gz'
        self.write_archive([('pinned/src/lib.rs', b'original')])

    def write_archive(self, entries, link=False):
        with tarfile.open(self.archive, 'w:gz') as package:
            for name, value in entries:
                info = tarfile.TarInfo(name)
                if link:
                    info.type = tarfile.SYMTYPE; info.linkname = '/tmp/outside'
                else:
                    info.size = len(value)
                package.addfile(info, None if link else io.BytesIO(value))
        digest = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        (self.root / 'desktop/engine/source.json').write_text(json.dumps({'archive': 'source.tar.gz', 'sha256': digest, 'commit': 'fixture-pin'}))
        return digest

    def test_archive_integrity_and_unsafe_members(self):
        with self.assertRaisesRegex(ValueError, 'checksum'):
            engine.archive_files(self.archive, '0' * 64)
        for entries, link in [([('../outside', b'x')], False), ([('pinned/link', b'')], True), ([('pinned/a', b'a'), ('pinned/a', b'b')], False), ([('one/a', b'a'), ('two/b', b'b')], False)]:
            with self.subTest(entries=entries):
                digest = self.write_archive(entries, link)
                with self.assertRaises(ValueError): engine.archive_files(self.archive, digest)

    def test_mutated_source_is_preserved_and_refused(self):
        _, source = engine.prepare(self.root)
        (source / 'src/lib.rs').write_text('local changes to preserve')
        with self.assertRaisesRegex(ValueError, 'cache changed'): engine.prepare(self.root)
        self.assertEqual((source / 'src/lib.rs').read_text(), 'local changes to preserve')

    def test_cache_binds_adapter_lock_compiler_and_binary(self):
        calls = []
        def compile_engine(*args, **kwargs):
            flags = kwargs['env']['CARGO_ENCODED_RUSTFLAGS'].split('\x1f')
            self.assertIn(f'--remap-path-prefix={self.root.resolve()}=/open-sesame', flags)
            self.assertIn(f'--remap-path-prefix={Path.home().resolve()}=/build-home', flags)
            calls.append(args[0]); binary = self.root / 'build/coven-engine-target/release/open-sesame-computer-agent'
            binary.parent.mkdir(parents=True, exist_ok=True); binary.write_bytes(b'compiled fixture')
        with patch.object(engine.subprocess, 'check_output', return_value='rustc fixture'), patch.object(engine.subprocess, 'run', side_effect=compile_engine):
            engine.build(self.root); engine.build(self.root); self.assertEqual(len(calls), 1)
            (self.root / 'desktop/engine/Cargo.lock').write_text('changed locked dependencies')
            engine.build(self.root); self.assertEqual(len(calls), 2)
            (self.root / 'build/coven-engine/CovenComputerAgent').write_bytes(b'corrupt output')
            engine.build(self.root); self.assertEqual(len(calls), 3)
            self.assertEqual((self.root / 'build/coven-engine/CovenComputerAgent').read_bytes(), b'compiled fixture')
            self.assertIn('--locked', calls[0]); self.assertNotIn('--offline', calls[0])

    def test_source_change_during_compilation_never_promotes_binary(self):
        def mutate(*args, **kwargs):
            (self.root / 'build/coven-engine-source/src/lib.rs').write_text('changed during build')
        with patch.object(engine.subprocess, 'check_output', return_value='rustc fixture'), patch.object(engine.subprocess, 'run', side_effect=mutate):
            with self.assertRaisesRegex(ValueError, 'cache changed'): engine.build(self.root)
        self.assertFalse((self.root / 'build/coven-engine/CovenComputerAgent').exists())


if __name__ == '__main__': unittest.main()
