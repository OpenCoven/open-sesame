#!/usr/bin/env python3
"""Build the reproducible source download used by the widget's setup links."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'dist/downloads/open-sesame-desktop-source.zip'
SOURCES = ('README.md', '.gitignore', 'package.json', 'run-macos.sh', 'desktop', 'dist', 'docs', 'scripts', 'vendor-src', 'examples')


def build():
    files = []
    for name in SOURCES:
        path = ROOT / name
        candidates = path.rglob('*') if path.is_dir() else [path]
        for candidate in candidates:
            relative = candidate.relative_to(ROOT)
            if not candidate.is_file() or candidate.name == '.DS_Store':
                continue
            if any(part in ('__pycache__', 'node_modules', 'downloads', '.openai') for part in relative.parts):
                continue
            if candidate.suffix in ('.pyc', '.pyo'):
                continue
            files.append((relative.as_posix(), candidate))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(OUTPUT, 'w', compression=ZIP_DEFLATED) as archive:
        for relative, path in sorted(files):
            entry = ZipInfo('open-sesame-desktop/' + relative, date_time=(2026, 1, 1, 0, 0, 0))
            entry.compress_type = ZIP_DEFLATED
            entry.external_attr = (0o100755 if path.suffix == '.sh' else 0o100644) << 16
            archive.writestr(entry, path.read_bytes())
    print(f'Built {OUTPUT.relative_to(ROOT)} ({len(files)} source files)')


if __name__ == '__main__':
    build()
