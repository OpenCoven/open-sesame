#!/usr/bin/env python3
"""Native WebKitGTK renderer with an injected synthetic host; no Tauri/provider acceptance."""
import functools
import http.server
import json
from pathlib import Path
import sys
import threading
import gi

gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import Gtk, GLib, WebKit2

ROOT = Path(__file__).resolve().parents[2]
output = Path(sys.argv[1])
requests = []

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)
    def do_GET(self):
        requests.append(self.path)
        aliases = {'/ui/xterm.js': '/dist/vendor/xterm.js', '/ui/xterm.css': '/dist/vendor/xterm.css'}
        self.path = aliases.get(self.path, self.path)
        super().do_GET()
    def log_message(self, *_):
        pass

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
manager = WebKit2.UserContentManager()
manager.register_script_message_handler('report')
manager.add_script(WebKit2.UserScript.new((ROOT/'scripts/fixtures/ui-shell-host.js').read_text(), WebKit2.UserContentInjectedFrames.TOP_FRAME, WebKit2.UserScriptInjectionTime.START, None, None))
view = WebKit2.WebView.new_with_user_content_manager(manager)
window = Gtk.Window()
window.set_default_size(1090, 700)
window.add(view)
result = None

def finish(value):
    global result
    if result is not None:
        return
    result = value
    value.update(renderer='WebKitGTK', version=f'{WebKit2.get_major_version()}.{WebKit2.get_minor_version()}.{WebKit2.get_micro_version()}', requests=requests)
    output.write_text(json.dumps(value, indent=2)+'\n')
    Gtk.main_quit()

manager.connect('script-message-received::report', lambda _, msg: finish(json.loads(msg.get_js_value().to_string())))
started = False

def loaded(_, event):
    global started
    if event == WebKit2.LoadEvent.FINISHED and not started:
        started = True
        view.evaluate_javascript((ROOT/'scripts/fixtures/ui-shell-probe.js').read_text(), -1, None, None, None, None, None)

view.connect('load-changed', loaded)
GLib.timeout_add_seconds(90, lambda: finish({'passed': False, 'error': 'Native renderer timed out.'}))
window.show_all()
view.load_uri(f'http://127.0.0.1:{server.server_port}/ui/index.html')
try:
    Gtk.main()
finally:
    window.destroy()
    server.shutdown()
    server.server_close()
raise SystemExit(0 if result and result.get('passed') else 1)
