#!/usr/bin/env python3
"""Validate installed bundle artwork, icon representations and identity."""
from pathlib import Path
import plistlib
import struct
import sys

app = Path(sys.argv[1])
info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
assert info['CFBundleIdentifier'] == 'com.perch.widgetstudio', 'Website data must retain its existing identity'
assert info['CFBundleIconFile'] == 'OpenSesame.icns'
resources = app / 'Contents/Resources'
assert (resources / 'web/assets/open-sesame-logo.png').read_bytes() == Path('dist/assets/open-sesame-logo.png').read_bytes()
icon = (resources / info['CFBundleIconFile']).read_bytes()
assert icon[:4] == b'icns' and struct.unpack('>I', icon[4:8])[0] == len(icon)
chunks = set(); offset = 8
while offset < len(icon):
    kind, length = struct.unpack('>4sI', icon[offset:offset+8])
    assert length > 8 and offset + length <= len(icon), 'Incomplete icon representation'
    chunks.add(kind); offset += length
assert offset == len(icon)
assert {b'ic04', b'ic05', b'ic07', b'ic08', b'ic09', b'ic10', b'ic11', b'ic12', b'ic13', b'ic14'} <= chunks
print('Packaged icon has all ten standard/Retina representations and exact supplied artwork; bundle identity preserved.')
