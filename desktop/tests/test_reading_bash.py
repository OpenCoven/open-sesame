import base64
import pathlib
import queue
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from bridge import Session, Bridge
from reader import fetch_document, MAX_BYTES

class ReadingAndBashTests(unittest.TestCase):
    def test_bash_runs_only_explicit_command_in_project(self):
        events=queue.Queue()
        with tempfile.TemporaryDirectory(prefix='open-sesame-bash-') as folder:
            session=Session('bash-test',{'launcher':'bash','prompt':'printf "__BASH__%s|" "$PWD"; test -t 0 && printf "TTY"','cwd':folder},events.put)
            output=''
            try:
                session.start();until=time.monotonic()+5
                while 'TTY' not in output and time.monotonic()<until:
                    try:e=events.get(timeout=.1)
                    except queue.Empty:continue
                    if e.get('event')=='terminal.data':output+=base64.b64decode(e['data']).decode()
                self.assertIn('__BASH__'+str(pathlib.Path(folder).resolve())+'|TTY',output)
            finally:session.close();session.reader.join(timeout=5)
        with mock.patch('bridge.pty.fork') as fork:
            with self.assertRaises(ValueError):Session('empty',{'launcher':'bash','prompt':''},events.put)
            fork.assert_not_called()

    def test_article_limits_types_redirect_and_no_credentials(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path=='/redirect':self.send_response(302);self.send_header('Location','/article');self.end_headers();return
                self.send_response(200);self.send_header('Content-Type','application/pdf' if self.path=='/pdf' else 'application/rss+xml' if self.path=='/rss' else 'text/html; charset=utf-8');self.end_headers()
                self.wfile.write(b'x'*(MAX_BYTES+1) if self.path=='/big' else b'<article><h1>Full article</h1><img src="/image.png"><p>Actual text</p></article>')
            def log_message(self,*args):pass
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start();url='http://127.0.0.1:'+str(server.server_port)
        try:
            r=fetch_document(url+'/redirect');self.assertIn('<img',r['text']);self.assertEqual(r['url'],url+'/article')
            self.assertEqual(fetch_document(url+'/rss')['type'],'application/rss+xml')
            with self.assertRaisesRegex(ValueError,'2 MB'):fetch_document(url+'/big')
            with self.assertRaisesRegex(ValueError,'PDF'):fetch_document(url+'/pdf')
            with self.assertRaises(ValueError):fetch_document('http://user:secret@localhost/')
            with self.assertRaises(ValueError):fetch_document('file:///etc/passwd')
        finally:server.shutdown();server.server_close()

    def test_article_fetch_remains_async(self):
        emitted=queue.Queue();started=threading.Event();release=threading.Event()
        def fetch(url):started.set();release.wait(3);return {'text':'<article>fixture</article>','url':url}
        bridge=Bridge(emitted.put)
        with mock.patch('bridge.fetch_document',side_effect=fetch):
            bridge.handle({'requestId':'article','method':'reading.fetch','params':{'url':'https://example.com'}});self.assertTrue(started.wait(1))
            bridge.handle({'requestId':'info','method':'system.info'});self.assertEqual(emitted.get(timeout=1)['requestId'],'info');release.set();self.assertEqual(emitted.get(timeout=1)['requestId'],'article')
