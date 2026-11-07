"""Keep private configuration out of source downloads and desktop web assets."""
from pathlib import Path
import re
import sys


def private_path(path):
    parts = [part.lower() for part in Path(path).parts]
    if any(part in ('.git', '.ssh', '.aws', 'secrets', 'credentials') or part == '.env' or part.startswith('.env.') for part in parts):
        return True
    name = parts[-1] if parts else ''
    return (Path(name).suffix in ('.p8', '.pem', '.key', '.p12', '.pfx', '.keychain', '.keychain-db') or
            name in ('auth.json', 'credentials.json', 'token.json', 'tokens.json', 'music-auth-config.local.js') or
            name.startswith(('client_secret', 'service-account', '.credentials')))


def validate_dist(folder):
    folder = Path(folder)
    for path in folder.rglob('*'):
        relative = path.relative_to(folder)
        if any(part in ('downloads', '.openai') for part in relative.parts):
            continue
        if path.is_symlink() or private_path(relative):
            raise ValueError('Private configuration or an external symlink is present in web assets. Keep it outside dist.')
        if path.is_file() and re.search(rb'-----BEGIN [A-Z ]*PRIVATE KEY-----', path.read_bytes()):
            raise ValueError('Private key material is present in web assets. Remove it before packaging.')
    config = folder / 'music-auth-config.js'
    if config.is_file():
        source = re.sub(r'//[^\n]*', '', config.read_text())
        match = re.fullmatch(r"\s*'use strict';\s*window\.OpenSesameMusicAuthConfig\s*=\s*Object\.freeze\(\{(.*?)\}\);\s*", source, re.S)
        if not match:
            raise ValueError('Use the public-ID-only music configuration template. Never bundle tokens or signing keys.')
        fields = re.findall(r"(\w+)\s*:\s*'([^']*)'", match.group(1))
        remainder = re.sub(r"\w+\s*:\s*'[^']*'", '', match.group(1))
        values = dict(fields)
        if re.sub(r'[\s,]', '', remainder) or len(fields) != 2 or set(values) != {'spotifyClientId', 'googleClientId'}:
            raise ValueError('Music configuration may contain only public Spotify and Google client IDs.')
        if values['spotifyClientId'] and not re.fullmatch(r'[a-fA-F0-9]{32}', values['spotifyClientId']):
            raise ValueError('The bundled Spotify setting must be a public client ID.')
        if values['googleClientId'] and not re.fullmatch(r'\d+-[a-zA-Z0-9-]+\.apps\.googleusercontent\.com', values['googleClientId']):
            raise ValueError('The bundled Google setting must be a public client ID.')


if __name__ == '__main__':
    try:
        validate_dist(sys.argv[1])
    except ValueError as error:
        raise SystemExit(str(error)) from None
