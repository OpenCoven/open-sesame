#!/usr/bin/env python3
"""Owned loopback server for native renderer fixtures; prints the selected URL as JSON."""
import http.server
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)
    def do_GET(self):
        aliases = {'/ui/xterm.js': '/dist/vendor/xterm.js', '/ui/xterm.css': '/dist/vendor/xterm.css'}
        self.path = aliases.get(self.path, self.path)
        super().do_GET()
    def log_message(self, *_):
        pass
with http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler) as server:
    address = f'http://127.0.0.1:{server.server_port}/ui/index.html'
    Path(sys.argv[1]).write_text(json.dumps({'url': address})+'\n')
    print(address, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
