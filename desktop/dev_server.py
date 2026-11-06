#!/usr/bin/env python3
"""Local-only development server for exercising Open Sesame with a real PTY."""
import argparse
import base64
import hashlib
import http.server
import json
import os
import pathlib
import socketserver
import struct
import threading
from urllib.parse import urlsplit
from bridge import Bridge

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
            return self.websocket()
        if path in ('/', '/index.html'):
            source = (ROOT / 'index.html').read_text().replace('<head>', '<head><script>window.__OPEN_SESAME_DEV_BRIDGE__=true;</script>', 1).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(source)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(source)
        else:
            super().do_GET()
    def websocket(self):
        origins = {f'http://localhost:{self.server.server_port}', f'http://127.0.0.1:{self.server.server_port}', f'http://terminal.local:{self.server.server_port}'}
        origin = self.headers.get('Origin', '')
        # A local preview may be routed through the managed terminal.local port.
        preview_origin = os.environ.get('OPEN_SESAME_PREVIEW_ORIGIN')
        if preview_origin:
            origins.add(preview_origin)
        if origin not in origins or self.headers.get('Upgrade', '').lower() != 'websocket' or self.headers.get('Sec-WebSocket-Version') != '13':
            return self.send_error(403)
        key = self.headers.get('Sec-WebSocket-Key', '')
        try:
            if len(base64.b64decode(key, validate=True)) != 16:
                raise ValueError()
        except ValueError:
            return self.send_error(400)
        accept = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
        self.send_response(101)
        self.send_header('Upgrade', 'websocket')
        self.send_header('Connection', 'Upgrade')
        self.send_header('Sec-WebSocket-Accept', accept)
        self.end_headers()
        lock, closed = threading.Lock(), threading.Event()
        def send_payload(payload, opcode=1):
            if closed.is_set():
                return
            length = len(payload)
            header = bytes([0x80 | opcode]) + (bytes([length]) if length < 126 else b'\x7e' + struct.pack('!H', length) if length < 65536 else b'\x7f' + struct.pack('!Q', length))
            try:
                with lock:
                    self.wfile.write(header + payload)
                    self.wfile.flush()
            except (BrokenPipeError, OSError):
                closed.set()
        bridge = Bridge(lambda message: send_payload(json.dumps(message, separators=(',', ':')).encode()))
        def read_exact(size):
            data = self.rfile.read(size)
            if len(data) != size:
                raise EOFError()
            return data
        fragments = bytearray()
        try:
            while not closed.is_set():
                first, second = read_exact(2)
                opcode, final = first & 15, first & 128
                if not second & 128 or first & 0x70:
                    break
                length = second & 127
                if length == 126:
                    length = struct.unpack('!H', read_exact(2))[0]
                elif length == 127:
                    length = struct.unpack('!Q', read_exact(8))[0]
                if length > 1048576:
                    break
                mask = read_exact(4)
                payload = bytes(value ^ mask[index % 4] for index, value in enumerate(read_exact(length)))
                if opcode == 8:
                    break
                if opcode == 9:
                    send_payload(payload, 10)
                    continue
                if opcode not in (0, 1):
                    break
                fragments.extend(payload)
                if len(fragments) > 1048576:
                    break
                if final:
                    message = json.loads(fragments.decode('utf8'))
                    fragments.clear()
                    if isinstance(message, dict):
                        bridge.handle(message)
        except (EOFError, ValueError, OSError):
            pass
        finally:
            closed.set()
            bridge.close()
            self.close_connection = True

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
