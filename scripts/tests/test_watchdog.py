from pathlib import Path
import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from run_bounded import run, processes


class WatchdogTests(unittest.TestCase):
    def test_inspection_failure_after_reap_never_signals_old_process_group(self):
        with tempfile.TemporaryDirectory() as folder:
            real_popen = subprocess.Popen
            started = []
            def spawn(*args, **kwargs):
                process = real_popen(*args, **kwargs)
                if args[0][0] == sys.executable:
                    started.append(process)
                return process
            def inspect():
                if started and started[0].returncode is not None:
                    raise RuntimeError('inspection failed after reap')
                return processes()
            with mock.patch('run_bounded.processes', side_effect=inspect), mock.patch('run_bounded.subprocess.Popen', side_effect=spawn), mock.patch('run_bounded.os.killpg') as signal_group:
                result = run([sys.executable, '-c', 'pass'], cwd=folder,
                             log_path=Path(folder) / 'reaped.log', timeout=5)
            signal_group.assert_not_called()
            self.assertFalse(result['passed'])
            self.assertEqual(result['exitCode'], 0)
            self.assertTrue(result['cleanupUncertain'])

    def test_unavailable_process_inspection_starts_no_check(self):
        with tempfile.TemporaryDirectory() as folder:
            log = Path(folder) / 'preflight.log'
            with mock.patch('run_bounded.processes', side_effect=RuntimeError('inspection unavailable')), mock.patch('run_bounded.subprocess.Popen') as spawn:
                result = run([sys.executable, '-c', 'pass'], cwd=folder, log_path=log, timeout=5)
            spawn.assert_not_called()
            self.assertFalse(result['passed'])
            self.assertEqual(result['survivors'], [])
            self.assertTrue(log.with_suffix('.json').exists())

    def test_process_inspection_failure_stops_own_group_and_records_uncertainty(self):
        with tempfile.TemporaryDirectory() as folder:
            pid_file = Path(folder) / 'helper.pid'
            log = Path(folder) / 'inspection.log'
            other = subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(30)'], start_new_session=True)
            real_popen = subprocess.Popen
            started = []
            def spawn(*args, **kwargs):
                process = real_popen(*args, **kwargs)
                if args[0][0] == sys.executable:
                    started.append(process)
                return process
            def inspect():
                if not started:
                    return processes()
                deadline = time.monotonic() + 3
                while (not pid_file.exists() or not pid_file.read_text().strip()) and time.monotonic() < deadline:
                    time.sleep(.01)
                raise RuntimeError('process inspection unavailable')
            code = "import pathlib,subprocess,sys,time;child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)']);pathlib.Path(sys.argv[1]).write_text(str(child.pid));time.sleep(30)"
            try:
                with mock.patch('run_bounded.processes', side_effect=inspect), mock.patch('run_bounded.subprocess.Popen', side_effect=spawn):
                    result = run([sys.executable, '-c', code, str(pid_file)], cwd=folder, log_path=log, timeout=5)
                self.assertFalse(result['passed'])
                self.assertTrue(result['cleanupUncertain'])
                self.assertIsNone(result['survivors'])
                self.assertIn('process inspection unavailable', result['error'])
                self.assertTrue(log.with_suffix('.json').exists())
                self.assertIsNotNone(started[0].poll())
                helper = processes().get(int(pid_file.read_text()))
                self.assertTrue(helper is None or helper['state'].startswith('Z'), helper)
                self.assertIsNone(other.poll())
            finally:
                for process in started:
                    if process.poll() is None:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait(timeout=5)
                other.terminate()
                other.wait(timeout=5)

    def assert_bridge_worker(self, name, code, timeout=15):
        root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as folder:
            result = run([sys.executable, '-B', '-u', '-c', code], cwd=root,
                         log_path=Path(folder) / (name + '.log'), timeout=timeout)
            self.assertTrue(result['passed'], Path(result['log']).read_text() + repr(result))

    def test_immediate_bridge_close_with_active_reader_is_reaped(self):
        self.assert_bridge_worker('bridge-close', """import sys,unittest
sys.path.insert(0,'desktop/tests')
from test_bridge import RealTerminalTests
for iteration in range(20):
 result=unittest.TestResult()
 RealTerminalTests('test_connection_validation_and_cleanup').run(result)
 assert result.wasSuccessful(),(iteration,result.errors,result.failures)
""")

    def test_nonblocking_terminal_preserves_large_input(self):
        self.assert_bridge_worker('large-input', """import base64,hashlib,queue,shlex,sys,time
sys.path.insert(0,'desktop')
from bridge import Session
events=queue.Queue()
client="import hashlib,sys;print('__READY__',flush=True);data=sys.stdin.buffer.read(65536);print('__SHA__'+hashlib.sha256(data).hexdigest(),flush=True)"
command='stty raw -echo; exec '+shlex.join([sys.executable,'-c',client])
s=Session('large',{'launcher':'bash','prompt':command},events.put)
output=''
def wait_for(marker):
 global output
 until=time.monotonic()+5
 while marker not in output and time.monotonic()<until:
  try:event=events.get(timeout=.1)
  except queue.Empty:continue
  if event.get('event')=='terminal.data':output+=base64.b64decode(event['data']).decode()
 assert marker in output,output
try:
 s.start();wait_for('__READY__')
 payload=bytes(range(256))*256
 s.write(base64.b64encode(payload).decode(),binary=True)
 wait_for('__SHA__'+hashlib.sha256(payload).hexdigest())
finally:
 s.close();s.reader.join(timeout=2)
 assert not s.reader.is_alive()
""")

    def test_close_interrupts_backpressured_terminal_input(self):
        self.assert_bridge_worker('backpressure', """import base64,os,queue,sys,threading,time
sys.path.insert(0,'desktop')
from bridge import Session
events=queue.Queue()
s=Session('blocked-input',{'launcher':'bash','prompt':'stty raw -echo; printf __READY__; exec sleep 60'},events.put)
output='';outcome=[];writer=None
def send():
 try:s.write('x'*131072)
 except ValueError:outcome.append('closed')
 except Exception as error:outcome.append(repr(error))
 else:outcome.append('sent')
try:
 s.start();until=time.monotonic()+5
 while '__READY__' not in output and time.monotonic()<until:
  try:event=events.get(timeout=.1)
  except queue.Empty:continue
  if event.get('event')=='terminal.data':output+=base64.b64decode(event['data']).decode()
 assert '__READY__' in output,output
 writer=threading.Thread(target=send);writer.start();time.sleep(.05)
 assert writer.is_alive(),outcome
 s.close();writer.join(timeout=2);s.reader.join(timeout=2)
 assert not writer.is_alive() and not s.reader.is_alive()
 assert outcome==['closed'],outcome
 try:os.kill(s.pid,0)
 except ProcessLookupError:pass
 else:raise AssertionError('terminal child was not reaped')
finally:
 s.close()
 if writer is not None:writer.join(timeout=2)
 s.reader.join(timeout=2)
""")

    def test_normal_exit_retires_orphan_helper_and_cannot_report_success(self):
        with tempfile.TemporaryDirectory() as folder:
            pid_file = Path(folder) / 'helper.pid'
            code = "import pathlib,subprocess,sys;child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)']);pathlib.Path(sys.argv[1]).write_text(str(child.pid))"
            result = run([sys.executable, '-B', '-c', code, str(pid_file)], cwd=folder,
                         log_path=Path(folder) / 'orphan.log', timeout=5)
            pid = int(pid_file.read_text())
            state = processes().get(pid)
            try:
                self.assertFalse(result['passed'], result)
                self.assertEqual(result['exitCode'], 0)
                self.assertIn(pid, result['ownedPids'])
                self.assertTrue(any(s['pid'] == pid for s in result['signals']))
                self.assertEqual(result['survivors'], [])
                self.assertTrue(state is None or state['state'].startswith('Z'), state)
            finally:
                # Keep the regression safe when run against the broken runner.
                current = processes().get(pid)
                if state and current and current['birth'] == state['birth'] and not current['state'].startswith('Z'):
                    os.kill(pid, signal.SIGKILL)

    def test_timeout_retires_own_new_session_child_and_preserves_unrelated_process(self):
        with tempfile.TemporaryDirectory() as folder:
            other = subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(30)'], start_new_session=True)
            try:
                code = "import subprocess,sys,time;subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)'],start_new_session=True);time.sleep(30)"
                result = run([sys.executable, '-c', code], cwd=folder, log_path=Path(folder) / 'timeout.log', timeout=1)
                self.assertFalse(result['passed'])
                self.assertTrue(result['timedOut'])
                self.assertGreaterEqual(len(result['ownedPids']), 2)
                self.assertEqual(result['survivors'], [])
                self.assertIsNone(other.poll())
                self.assertIn('WATCHDOG TIMEOUT', Path(result['log']).read_text())
            finally:
                other.terminate()
                other.wait(timeout=5)

    def test_nonzero_exit_is_not_passing(self):
        with tempfile.TemporaryDirectory() as folder:
            result = run([sys.executable, '-c', 'raise SystemExit(7)'], cwd=folder, log_path=Path(folder) / 'failed.log', timeout=5)
            self.assertFalse(result['passed'])
            self.assertEqual(result['exitCode'], 7)

    def test_close_unblocks_a_pending_real_pty_read(self):
        root = Path(__file__).resolve().parents[2]
        code = """import queue,sys,time
sys.path.insert(0,'desktop')
from bridge import Session
events=queue.Queue()
s=Session('idle',{'launcher':'bash','prompt':'printf READY; exec sleep 60'},events.put)
s.start()
assert events.get(timeout=3)['event']=='terminal.data'
time.sleep(.1)
started=time.monotonic()
import threading
closers=[threading.Thread(target=s.close) for _ in range(2)]
for closer in closers: closer.start()
for closer in closers: closer.join(timeout=3)
assert not any(closer.is_alive() for closer in closers)
s.reader.join(timeout=2)
assert time.monotonic()-started < 3
assert not s.reader.is_alive()
import os
try: os.kill(s.pid,0)
except ProcessLookupError: pass
else: raise AssertionError('shell was not reaped')
"""
        with tempfile.TemporaryDirectory() as folder:
            result = run([sys.executable, '-B', '-c', code], cwd=root, log_path=Path(folder) / 'pty.log', timeout=8)
            self.assertTrue(result['passed'], Path(result['log']).read_text() + repr(result))

    def test_immediate_close_reaps_children_before_group_setup(self):
        root = Path(__file__).resolve().parents[2]
        code = """import os,sys
sys.path.insert(0,'desktop')
from bridge import Session
for i in range(20):
 s=Session('startup',{'launcher':'bash','prompt':'exec sleep 60'},lambda e:None)
 s.close()
 try: os.kill(s.pid,0)
 except ProcessLookupError: pass
 else: raise AssertionError('startup child was not reaped')
"""
        with tempfile.TemporaryDirectory() as folder:
            result = run([sys.executable, '-B', '-c', code], cwd=root, log_path=Path(folder) / 'startup.log', timeout=15)
            self.assertTrue(result['passed'], Path(result['log']).read_text() + repr(result))

    def test_sigterm_runs_cleanup_and_writes_failure_receipt(self):
        root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as folder:
            log = Path(folder) / 'cancel.log'
            code = "import sys;sys.path.insert(0,'scripts');from run_bounded import run;run([sys.executable,'-c','import time;time.sleep(30)'],cwd='.',log_path=sys.argv[1],timeout=20)"
            watcher = subprocess.Popen([sys.executable, '-B', '-c', code, str(log)], cwd=root)
            try:
                deadline = time.monotonic() + 5
                while not log.exists() and time.monotonic() < deadline:
                    time.sleep(.05)
                self.assertTrue(log.exists())
                time.sleep(.3)
                watcher.terminate()
                self.assertEqual(watcher.wait(timeout=5), 143)
                import json
                receipt = json.loads(log.with_suffix('.json').read_text())
                self.assertFalse(receipt['passed'])
                self.assertEqual(receipt['survivors'], [])
            finally:
                if watcher.poll() is None:
                    watcher.kill()
                    watcher.wait(timeout=5)


if __name__ == '__main__':
    unittest.main()
