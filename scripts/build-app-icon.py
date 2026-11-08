#!/usr/bin/env python3
"""Package the user-supplied artwork into standard macOS icon representations."""
from pathlib import Path
import struct
import subprocess
import sys
import tempfile


def build(source, output):
    source, output = Path(source).resolve(), Path(output).resolve()
    data = source.read_bytes()
    if data[:8] != b'\x89PNG\r\n\x1a\n' or len(data) < 33:
        raise ValueError('The application logo must be a PNG.')
    width, height = struct.unpack('>II', data[16:24])
    if width != height or width < 1024:
        raise ValueError('The application logo must be square and at least 1024 px.')
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='open-sesame-icon-') as directory:
        iconset = Path(directory) / 'OpenSesame.iconset'; iconset.mkdir()
        for logical in (16, 32, 128, 256, 512):
            for scale in (1, 2):
                pixels = logical * scale
                name = f'icon_{logical}x{logical}' + ('@2x' if scale == 2 else '') + '.png'
                subprocess.run(['/usr/bin/sips', '-z', str(pixels), str(pixels), str(source), '--out', str(iconset / name)], check=True, stdout=subprocess.DEVNULL)
        subprocess.run(['/usr/bin/iconutil', '-c', 'icns', str(iconset), '-o', str(output)], check=True)
    icon = output.read_bytes()
    if icon[:4] != b'icns' or struct.unpack('>I', icon[4:8])[0] != len(icon):
        raise ValueError('The application icon was not packaged correctly.')


if __name__ == '__main__':
    build(*sys.argv[1:])
