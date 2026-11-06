import http.client
import json
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from controller import Controller


class ControllerTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.path = pathlib.Path(self.folder.name) / 'controller.sqlite'
        self.controller = Controller('owner@example.com', 'chat-one', path=self.path, port=0)

    def tearDown(self):
        self.controller.close()
        self.folder.cleanup()

    def event(self, **changes):
        data = {'guid': 'message-one', 'isFromMe': False, 'handle': {'address': 'owner@example.com'}, 'chats': [{'guid': 'chat-one'}], 'text': 'feed add example.com/blog'}
        data.update(changes)
        return {'type': 'new-message', 'data': data}

    def post(self, event, path=None, **headers):
        connection = http.client.HTTPConnection('127.0.0.1', self.controller.server.server_port, timeout=3)
        connection.request('POST', path or '/bluebubbles/'+self.controller.token, json.dumps(event), {'Content-Type': 'application/json', **headers})
        response = connection.getresponse()
        result = response.status, json.loads(response.read())
        connection.close()
        return result

    def test_authorization_and_duplicate_delivery(self):
        self.assertEqual(self.post(self.event(), '/bluebubbles/wrong')[0], 403)
        self.assertEqual(self.post(self.event(), Origin='https://foreign.example')[0], 403)
        self.assertEqual(self.post(self.event(handle={'address': 'other@example.com'}))[0], 400)
        self.assertEqual(self.post(self.event(chats=[{'guid': 'other'}]))[0], 400)
        status, accepted = self.post(self.event())
        self.assertEqual(status, 200)
        self.assertEqual(self.post(self.event())[1]['duplicate'], True)
        job = self.controller.poll()
        self.assertEqual(job['id'], accepted['id'])
        self.assertIsNone(self.controller.poll())
        self.controller.ack(job['id'], 'Saved')
        self.assertEqual(self.post(self.event())[1]['result'], 'Saved')
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.controller.server.server_address[0], '127.0.0.1')

    def test_malformed_own_and_multichat_events(self):
        self.assertTrue(self.post(self.event(isFromMe=True))[1]['ignored'])
        self.assertTrue(self.post({'type': 'typing-indicator'})[1]['ignored'])
        for data in ['wrong', [1], {'isFromMe': False, 'chats': [1]}, {'isFromMe': False, 'chats': [{}, {}]}, {'isFromMe': False, 'chats': [{}], 'handle': 'wrong'}]:
            self.assertEqual(self.post({'type': 'new-message', 'data': data})[0], 400)
        self.assertEqual(self.post(self.event(text='x'*2001))[0], 400)
        self.controller.allow_self = True
        self.assertTrue(self.post(self.event(isFromMe=True, text='note my text'))[1]['ignored'])
        self.assertEqual(self.post(self.event(isFromMe=True, text='open sesame note my text'))[0], 200)
        self.assertEqual(self.post(self.event(isFromMe=True, text='open sesame note my text', chats=[{'guid': 'other'}]))[0], 400)

    def test_restart_does_not_replay_interrupted_command(self):
        self.post(self.event())
        self.controller.poll()
        self.controller.close()
        self.controller = Controller('owner@example.com', 'chat-one', path=self.path, port=0)
        self.assertIsNone(self.controller.poll())
        self.assertEqual(self.post(self.event())[1]['state'], 'interrupted')

    def test_rename_preserves_existing_controller_receipts(self):
        self.controller.close()
        legacy = pathlib.Path(self.folder.name) / '.local/share/Perch/controller.sqlite'
        self.controller = Controller('owner@example.com', 'chat-one', path=legacy, port=0)
        self.post(self.event())
        job = self.controller.poll()
        self.controller.ack(job['id'], 'Saved before rename')
        self.controller.close()
        with patch('controller.Path.home', return_value=pathlib.Path(self.folder.name)):
            self.controller = Controller('owner@example.com', 'chat-one', port=0)
        receipt = self.post(self.event())[1]
        self.assertTrue(receipt['duplicate'])
        self.assertEqual(receipt['result'], 'Saved before rename')
        self.assertIsNone(self.controller.poll())

    def test_new_controller_uses_open_sesame_data_directory(self):
        self.controller.close()
        with patch('controller.Path.home', return_value=pathlib.Path(self.folder.name)):
            self.controller = Controller('owner@example.com', 'chat-one', port=0)
        self.assertTrue((pathlib.Path(self.folder.name) / '.local/share/Open Sesame/controller.sqlite').is_file())
        self.controller.allow_self = True
        self.assertEqual(self.post(self.event(isFromMe=True, text='Open Sesame: status'))[0], 200)
        self.assertEqual(self.post(self.event(guid='legacy-command', isFromMe=True, text='perch: status'))[0], 200)

    def test_permission_change_cancels_queued_commands(self):
        self.post(self.event())
        self.controller.close()
        self.controller = Controller('other@example.com', 'chat-two', path=self.path, port=0)
        self.assertIsNone(self.controller.poll())

    def test_photon_bearer_and_result_endpoint(self):
        self.controller.close()
        self.controller = Controller('owner-id', 'space-one', provider='photon', path=self.path, port=0)
        event = {'id': 'photon-one', 'sender': 'owner-id', 'chat': 'space-one', 'text': 'status'}
        self.assertEqual(self.post(event, '/command')[0], 403)
        headers = {'Authorization': 'Bearer '+self.controller.token}
        code, job = self.post(event, '/command', **headers)
        self.assertEqual(code, 200)
        self.controller.poll()
        self.controller.ack(job['id'], '1 feed')
        connection = http.client.HTTPConnection('127.0.0.1', self.controller.server.server_port, timeout=3)
        connection.request('GET', '/result?id='+job['id'], headers=headers)
        response = connection.getresponse()
        self.assertEqual(json.loads(response.read()), {'state': 'done', 'result': '1 feed'})
        connection.close()
        self.assertEqual(self.post(self.event())[0], 400)

    def test_queue_is_bounded(self):
        for i in range(100):
            self.controller.accept({'id': str(i), 'sender': 'owner@example.com', 'chat': 'chat-one', 'text': 'status'}, 'bluebubbles')
        with self.assertRaisesRegex(ValueError, 'full'):
            self.controller.accept({'id': 'extra', 'sender': 'owner@example.com', 'chat': 'chat-one', 'text': 'status'}, 'bluebubbles')


if __name__ == '__main__':
    unittest.main()
