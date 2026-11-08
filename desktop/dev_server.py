#!/usr/bin/env python3
"""Local preview and downloads. Machine operations require the authenticated Mac app."""
import argparse
import http.server
import os
import pathlib
import socketserver
from urllib.parse import urlsplit

ROOT = pathlib.Path(__file__).resolve().parent.parent / 'dist'

class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)
    def log_message(self, *_):
        pass
    def list_directory(self, path):
        self.send_error(404)
    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/__openSesame/bridge':
            return self.send_error(401, 'Sign in through Open Sesame Desktop to use local tools.')
        if path in ('/', '/index.html'):
            source = (ROOT / 'sign-in.html').read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(source)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(source)
        else:
            super().do_GET()
if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=int(os.environ.get('PORT', '4173')))
    parser.add_argument('--strictPort', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    server = Server((args.host, args.port), Handler)
    print(f'Open Sesame local development: http://{args.host}:{server.server_port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
