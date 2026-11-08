"""Workspace avatars compatible with Cave: avatars/<familiar-id>.png wins.

Only explicit avatar updates write files. No remote URLs, arbitrary paths, or
conversation/identity files are accepted. Thumbnail cache is process memory.
"""
import base64
import binascii
import contextlib
import functools
import os
from pathlib import Path
import re
import stat
import struct
import subprocess
import tempfile
import uuid
import zlib

EXTENSIONS = ['.png', '.webp', '.jpg', '.jpeg', '.avif', '.gif']
MAX_INPUT = 2 * 1024 * 1024


def valid_id(fid):
    if not isinstance(fid, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}', fid):
        raise ValueError('Invalid familiar identity.')
    return fid


def pick_avatar(names, fid):
    valid_id(fid)
    images = [n for n in names if Path(n).suffix.lower() in EXTENSIONS and '/' not in n and '\\' not in n]
    matching = [n for n in images if Path(n).stem.casefold() == fid.casefold()]
    return min(matching, key=lambda n: (EXTENSIONS.index(Path(n).suffix.lower()), n)) if matching else min(images, key=lambda n: (n.casefold(), EXTENSIONS.index(Path(n).suffix.lower()), n), default=None)


@contextlib.contextmanager
def directory(workspace, create=False):
    root = os.open(workspace, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    folder = None
    try:
        if create:
            try: os.mkdir('avatars', mode=0o700, dir_fd=root)
            except FileExistsError: pass
        folder = os.open('avatars', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root)
        yield folder
    finally:
        if folder is not None: os.close(folder)
        os.close(root)


def png_bytes(encoded):
    if not isinstance(encoded, str) or not encoded.startswith('data:image/png;base64,') or len(encoded) > MAX_INPUT * 1.4:
        raise ValueError('Choose a PNG avatar smaller than 2 MB.')
    try: data = base64.b64decode(encoded.split(',', 1)[1], validate=True)
    except (ValueError, binascii.Error): raise ValueError('Invalid PNG avatar.') from None
    if len(data) > MAX_INPUT or not data.startswith(b'\x89PNG\r\n\x1a\n'): raise ValueError('Invalid PNG avatar.')
    offset, dimensions, compressed, ended = 8, None, bytearray(), False
    while offset + 12 <= len(data):
        size = int.from_bytes(data[offset:offset+4], 'big'); kind = data[offset+4:offset+8]; end = offset + 12 + size
        if end > len(data) or zlib.crc32(data[offset+4:end-4]) & 0xffffffff != int.from_bytes(data[end-4:end], 'big'): raise ValueError('Invalid PNG avatar.')
        payload = data[offset+8:end-4]
        if kind == b'IHDR':
            if dimensions is not None or offset != 8 or size != 13: raise ValueError('Invalid PNG avatar.')
            w, h, bits, color, compression, filtering, interlace = struct.unpack('>IIBBBBB', payload)
            if not (0 < w <= 1024 and 0 < h <= 1024 and bits == 8 and color in (2, 6) and compression == filtering == interlace == 0): raise ValueError('Use an avatar no larger than 1024 × 1024 pixels.')
            dimensions = (w, h, 3 if color == 2 else 4)
        elif kind == b'IDAT': compressed.extend(payload)
        elif kind == b'IEND':
            ended = size == 0 and end == len(data); break
        offset = end
    if not ended or not dimensions or not compressed: raise ValueError('Invalid PNG avatar.')
    w, h, channels = dimensions; expected = (w * channels + 1) * h
    try:
        decoder = zlib.decompressobj(); pixels = decoder.decompress(compressed, expected + 1)
        if len(pixels) != expected or not decoder.eof or decoder.unused_data or any(pixels[row * (w * channels + 1)] > 4 for row in range(h)): raise ValueError()
    except (ValueError, zlib.error): raise ValueError('Invalid PNG image data.') from None
    return data


def write_avatar(workspace, fid, encoded):
    fid = valid_id(fid); data = png_bytes(encoded); target = fid + '.png'; temporary = '.' + fid + '-' + uuid.uuid4().hex + '.tmp'
    try:
        with directory(workspace, create=True) as folder:
            try:
                existing = os.stat(target, dir_fd=folder, follow_symlinks=False)
                if not stat.S_ISREG(existing.st_mode): raise ValueError('The avatar destination is not a regular image file.')
            except FileNotFoundError: pass
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=folder)
            try:
                with os.fdopen(fd, 'wb') as image: image.write(data); image.flush(); os.fsync(image.fileno())
                os.replace(temporary, target, src_dir_fd=folder, dst_dir_fd=folder); os.fsync(folder)
            finally:
                try: os.unlink(temporary, dir_fd=folder)
                except FileNotFoundError: pass
    except OSError: raise ValueError('The workspace avatar folder is unavailable or unsafe. Check its permissions and avoid symbolic links.') from None
    _thumbnail.cache_clear()
    return load_avatar(workspace, fid)


@functools.lru_cache(maxsize=128)
def _thumbnail(workspace, fid, name, inode, modified, size):
    with directory(workspace) as folder:
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=folder)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or (info.st_ino, info.st_mtime_ns, info.st_size) != (inode, modified, size) or size > 64 * 1024 * 1024: return ''
            with tempfile.TemporaryDirectory(prefix='open-sesame-avatar-') as temporary:
                source = Path(temporary) / ('source' + Path(name).suffix.lower()); output = Path(temporary) / 'thumb.png'
                with source.open('wb') as copied:
                    total = 0
                    while block := os.read(fd, 65536):
                        total += len(block)
                        if total > 64 * 1024 * 1024: return ''
                        copied.write(block)
                if Path('/usr/bin/sips').exists():
                    subprocess.run(['/usr/bin/sips', '-Z', '128', '-s', 'format', 'png', str(source), '--out', str(output)], timeout=8, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                elif source.suffix.lower() == '.png' and size < 180000: output = source
                else: return ''
                if output.stat().st_size > 180000: return ''
                data = output.read_bytes()
                if not data.startswith(b'\x89PNG\r\n\x1a\n'): return ''
                return 'data:image/png;base64,' + base64.b64encode(data).decode('ascii')
        finally: os.close(fd)


def load_avatar(workspace, fid):
    valid_id(fid)
    try:
        with directory(workspace) as folder:
            names = [name for name in os.listdir(folder) if stat.S_ISREG(os.stat(name, dir_fd=folder, follow_symlinks=False).st_mode)]
            name = pick_avatar(names, fid)
            if not name: return ''
            info = os.stat(name, dir_fd=folder, follow_symlinks=False)
        return _thumbnail(str(workspace), fid, name, info.st_ino, info.st_mtime_ns, info.st_size)
    except (OSError, subprocess.SubprocessError): return ''
