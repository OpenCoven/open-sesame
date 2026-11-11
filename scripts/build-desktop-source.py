#!/usr/bin/env python3
"""Build the reproducible source download used by the widget's setup links."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo
from distribution_safety import private_path, validate_dist

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'dist/downloads/open-sesame-desktop-source.zip'
SOURCES = ('README.md', 'AGENTS.md', '.github', '.githooks', '.gitignore', 'package.json', 'package-lock.json', 'run-macos.sh', 'desktop', 'ios', 'dist', 'docs', 'scripts', 'vendor-src', 'examples', 'web')


def build():
    validate_dist(ROOT / 'dist')
    files = []
    for name in SOURCES:
        path = ROOT / name
        candidates = path.rglob('*') if path.is_dir() else [path]
        for candidate in candidates:
            relative = candidate.relative_to(ROOT)
            if not candidate.is_file() or candidate.is_symlink() or candidate.name == '.DS_Store' or private_path(relative):
                continue
            if any(part in ('__pycache__', 'node_modules', 'downloads', '.openai', '.vercel', 'OpenSesameMobile.xcodeproj') for part in relative.parts):
                continue
            if candidate.suffix in ('.pyc', '.pyo'):
                continue
            files.append((relative.as_posix(), candidate))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(OUTPUT, 'w', compression=ZIP_DEFLATED) as archive:
        for relative, path in sorted(files):
            entry = ZipInfo('open-sesame-desktop/' + relative, date_time=(2026, 1, 1, 0, 0, 0))
            entry.compress_type = ZIP_DEFLATED
            entry.external_attr = (0o100755 if path.stat().st_mode & 0o111 else 0o100644) << 16
            archive.writestr(entry, path.read_bytes())
    print(f'Built {OUTPUT.relative_to(ROOT)} ({len(files)} source files)')


if __name__ == '__main__':
    build()
