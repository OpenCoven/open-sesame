import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class SourceArchiveTests(unittest.TestCase):
    def test_executable_fixture_survives_reproducible_source_archive(self):
        script = Path(__file__).resolve().parents[1] / 'build-desktop-source.py'
        spec = importlib.util.spec_from_file_location('source_download', script)
        builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(builder)
        with tempfile.TemporaryDirectory(prefix='sesame-archive-') as folder:
            root = Path(folder)
            fixture = root / 'desktop/tests/fixtures/cli.py'
            fixture.parent.mkdir(parents=True)
            fixture.write_text('#!/usr/bin/env python3\nprint("ARCHIVE_FIXTURE_READY")\n')
            fixture.chmod(0o755)
            plain = root / 'desktop/helper.py'
            plain.write_text('print("source only")\n')
            plain.chmod(0o644)
            launcher = root / 'run-macos.sh'
            launcher.write_text('#!/bin/sh\nexit 0\n')
            launcher.chmod(0o755)
            hook = root / '.githooks/pre-commit'
            hook.parent.mkdir()
            hook.write_text('#!/bin/sh\nexit 0\n')
            hook.chmod(0o755)
            lock = root / 'package-lock.json'
            lock.write_text('{"lockfileVersion":3}\n')
            builder.ROOT = root
            builder.OUTPUT = root / 'dist/downloads/source.zip'
            builder.build()
            first = builder.OUTPUT.read_bytes()
            builder.build()
            self.assertEqual(first, builder.OUTPUT.read_bytes())
            with ZipFile(builder.OUTPUT) as archive:
                prefix = 'open-sesame-desktop/'
                item = archive.getinfo(prefix + 'desktop/tests/fixtures/cli.py')
                self.assertTrue((item.external_attr >> 16) & 0o111)
                self.assertFalse((archive.getinfo(prefix + 'desktop/helper.py').external_attr >> 16) & 0o111)
                self.assertTrue((archive.getinfo(prefix + 'run-macos.sh').external_attr >> 16) & 0o111)
                self.assertEqual(archive.read(prefix + 'package-lock.json'), lock.read_bytes())
                self.assertTrue((archive.getinfo(prefix + '.githooks/pre-commit').external_attr >> 16) & 0o111)
                extracted = root / 'unpacked-fixture'
                extracted.write_bytes(archive.read(item))
                extracted.chmod((item.external_attr >> 16) & 0o777)
            result = subprocess.run([str(extracted)], capture_output=True, text=True, timeout=5, check=True)
            self.assertEqual(result.stdout.strip(), 'ARCHIVE_FIXTURE_READY')


if __name__ == '__main__':
    unittest.main()
