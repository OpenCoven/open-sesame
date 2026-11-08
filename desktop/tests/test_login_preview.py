import http.client
import pathlib
import sys
import threading
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from dev_server import Handler, Server


class LoginPreviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = Server(('127.0.0.1', 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def test_preview_is_login_only(self):
        for path in ('/', '/index.html?preview=1'):
            with self.subTest(path=path):
                connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
                connection.request('GET', path)
                response = connection.getresponse()
                content = response.read().decode()
                self.assertEqual(response.status, 200)
                self.assertIn('sign-in.js', content)
                self.assertNotIn('src="app.js', content)
                self.assertNotIn('__OPEN_SESAME_DEV_BRIDGE__', content)
                connection.close()

    def test_machine_bridge_fails_closed(self):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
        connection.request('GET', '/__openSesame/bridge', headers={'Upgrade': 'websocket', 'Origin': f'http://127.0.0.1:{self.server.server_port}'})
        response = connection.getresponse()
        self.assertEqual(response.status, 401)
        response.read()
        connection.close()


if __name__ == '__main__':
    unittest.main()
