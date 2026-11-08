import http.client
import pathlib
import sys
import threading
import unittest
import subprocess

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from dev_server import Handler, Server


class LoginPreviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        subprocess.run(['node', str(pathlib.Path(__file__).resolve().parents[2] / 'scripts/build-auth-entrypoint.mjs')], check=True, stdout=subprocess.DEVNULL)
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

    def test_https_entry_can_be_previewed_without_exposing_credentials(self):
        for path in ('/auth/login?code=synthetic-private-value', '/auth/desktop-login.js', '/auth/desktop-login.css'):
            with self.subTest(path=path):
                connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
                connection.request('GET', path)
                response = connection.getresponse()
                content = response.read().decode()
                self.assertEqual(response.status, 200)
                self.assertEqual(response.getheader('Referrer-Policy'), 'no-referrer')
                self.assertEqual(response.getheader('Cache-Control'), 'no-store')
                self.assertNotIn('synthetic-private-value', content)
                connection.close()


if __name__ == '__main__':
    unittest.main()
