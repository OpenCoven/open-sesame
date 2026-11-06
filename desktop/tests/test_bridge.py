import base64
import http.client
import json
import os
import pathlib
import queue
import subprocess
import sys
import tempfile
import threading
import time
import unittest

DESKTOP = pathlib.Path(__file__).resolve().parents[1]

class RealTerminalTests(unittest.TestCase):
    def setUp(self):
        self.process = subprocess.Popen([sys.executable, '-u', str(DESKTOP/'bridge.py'), '--stdio'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        self.messages = queue.Queue()
        threading.Thread(target=self.read, daemon=True).start()
        self.responses, self.output, self.counter = {}, {}, 0
        self.temp = tempfile.TemporaryDirectory(prefix='open-sesame-project-')
        self.one = pathlib.Path(self.temp.name)/'project one'; self.one.mkdir()
        self.two = pathlib.Path(self.temp.name)/'project two'; self.two.mkdir()
    def read(self):
        for line in self.process.stdout:
            self.messages.put(json.loads(line))
    def collect(self, timeout=.1):
        try:
            m = self.messages.get(timeout=timeout)
        except queue.Empty:
            return
        if m.get('requestId'):
            self.responses[m['requestId']] = m
        if m.get('event') == 'terminal.data':
            self.output[m['id']] = self.output.get(m['id'], '') + base64.b64decode(m['data']).decode('utf8', 'replace')
    def request(self, method, **params):
        self.counter += 1; rid = str(self.counter)
        self.process.stdin.write(json.dumps({'requestId':rid,'method':method,'params':params})+'\n'); self.process.stdin.flush()
        until = time.monotonic()+5
        while rid not in self.responses and time.monotonic()<until:
            self.collect()
        self.assertTrue(rid in self.responses, 'Desktop bridge did not reply')
        response = self.responses.pop(rid)
        if 'error' in response:
            raise ValueError(response['error'])
        return response['result']
    def wait_output(self, session, expected):
        until = time.monotonic()+5
        while expected not in self.output.get(session, '') and time.monotonic()<until:
            self.collect()
        self.assertTrue(expected in self.output.get(session,''), 'Expected terminal output was not received')
    def tearDown(self):
        self.process.stdin.close()
        try:self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:self.process.kill();self.process.wait()
        self.process.stdout.close();self.temp.cleanup()
    def test_project_shells_are_real_and_isolated(self):
        info = self.request('system.info'); self.assertTrue(info['available'])
        first = self.request('terminal.open',id='first',mode='local',cwd=str(self.one),cols=80,rows=24)
        second = self.request('terminal.open',id='second',mode='local',cwd=str(self.two),cols=80,rows=24)
        self.assertNotEqual(first['pid'],second['pid'])
        self.request('terminal.input',id='first',data='printf "__ONE__%s\\n" "$PWD"\r')
        self.request('terminal.input',id='second',data='printf "__TWO__%s\\n" "$PWD"\r')
        self.wait_output('first','__ONE__'+str(self.one));self.wait_output('second','__TWO__'+str(self.two))
        self.request('terminal.input',id='first',data='test -t 0 && printf "__CONTROLLING_TTY__\\n"\r')
        self.wait_output('first','__CONTROLLING_TTY__\r\n')
    def test_resize_completion_and_interrupt(self):
        (self.one/'alpha-project.txt').write_text('OPEN_SESAME_COMPLETION_OK\n')
        self.request('terminal.open',id='main',mode='local',cwd=str(self.one),cols=80,rows=24)
        self.request('terminal.resize',id='main',cols=117,rows=31)
        self.request('terminal.input',id='main',data='stty size\r')
        self.wait_output('main','31 117')
        self.request('terminal.input',id='main',data='cat alpha-pro\t\r')
        self.wait_output('main','OPEN_SESAME_COMPLETION_OK')
        self.request('terminal.input',id='main',data='sleep 20\r')
        time.sleep(.1)
        self.request('terminal.input',id='main',data='\x03')
        self.request('terminal.input',id='main',data='printf "__INTERRUPT_OK__\\n"\r')
        self.wait_output('main','__INTERRUPT_OK__\r\n')
    def test_connection_validation_and_cleanup(self):
        with self.assertRaises(ValueError):self.request('terminal.open',id='bad',mode='ssh',host='-oProxyCommand=anything')
        with self.assertRaises(ValueError):self.request('terminal.open',id='bad',mode='local',cwd=str(self.one/'missing'))
        result=self.request('terminal.open',id='close',mode='local',cwd=str(self.one),cols=80,rows=24)
        self.request('terminal.close',id='close')
        with self.assertRaises(ProcessLookupError):os.kill(result['pid'],0)
        with self.assertRaises(ValueError):self.request('terminal.input',id='close',data='echo no\r')

class DevelopmentOriginTests(unittest.TestCase):
    def test_foreign_origin_cannot_open_a_shell_bridge(self):
        process=subprocess.Popen([sys.executable,'-u',str(DESKTOP/'dev_server.py'),'--port','0'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)
        try:
            port=int(process.stdout.readline().strip().rsplit(':',1)[1])
            connection=http.client.HTTPConnection('127.0.0.1',port,timeout=3)
            connection.request('GET','/__openSesame/bridge',headers={'Origin':'https://foreign.example','Upgrade':'websocket','Connection':'Upgrade','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':base64.b64encode(os.urandom(16)).decode()})
            self.assertEqual(connection.getresponse().status,403)
            connection.close()
        finally:
            process.terminate();process.wait(timeout=5);process.stdout.close()

if __name__=='__main__':unittest.main()
