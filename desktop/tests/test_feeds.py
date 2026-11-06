import http.server
import pathlib
import sys
import threading
import time
import unittest

sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from feeds import fetch_feed, MAX_FEED_BYTES
from bridge import Bridge

class FeedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_GET(self):
                if self.path=='/redirect':
                    self.send_response(302);self.send_header('Location','/rss');self.end_headers();return
                if self.path=='/bad-redirect':
                    self.send_response(302);self.send_header('Location','file:///etc/passwd');self.end_headers();return
                if self.path=='/slow':time.sleep(.25)
                data=(b'x'*(MAX_FEED_BYTES+1)) if self.path=='/large' else b'<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title><item><title>Actual response</title></item></channel></rss>'
                self.send_response(200);self.send_header('Content-Type','application/rss+xml; charset=utf-8');self.end_headers();self.wfile.write(data)
        cls.server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
        cls.base='http://127.0.0.1:'+str(cls.server.server_port)
        threading.Thread(target=cls.server.serve_forever,daemon=True).start()
    @classmethod
    def tearDownClass(cls):cls.server.shutdown();cls.server.server_close()
    def test_real_response_and_redirect(self):
        result=fetch_feed(self.base+'/redirect')
        self.assertEqual(result['url'],self.base+'/rss');self.assertIn('Actual response',result['text'])
    def test_rejects_unsafe_urls_and_oversize(self):
        for url in ['file:///etc/passwd','https://user:secret@example.com/rss',self.base+'/bad-redirect',self.base+'/large']:
            with self.assertRaises(ValueError):fetch_feed(url)
    def test_feed_fetch_does_not_block_terminal_rpc(self):
        messages=[];bridge=Bridge(messages.append)
        bridge.handle({'requestId':'feed','method':'feeds.fetch','params':{'url':self.base+'/slow'}})
        bridge.handle({'requestId':'info','method':'system.info'})
        self.assertEqual(messages[0]['requestId'],'info')
        until=time.monotonic()+3
        while len(messages)<2 and time.monotonic()<until:time.sleep(.01)
        self.assertTrue(any(m.get('requestId')=='feed' and 'result' in m for m in messages));bridge.close()
