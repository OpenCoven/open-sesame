"""Exercise the real PTY launcher with a labeled CLI fixture, not model replies."""
import base64
import os
import pathlib
import queue
import shlex
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from bridge import Session


class CovenLauncherTests(unittest.TestCase):
    def test_agent_uses_login_shell_project_tty_and_live_input(self):
        events = queue.Queue()
        with tempfile.TemporaryDirectory(prefix='open-sesame-agent-') as tmp:
            folder = pathlib.Path(tmp)/'project with spaces'; folder.mkdir()
            binary = pathlib.Path(tmp)/'bin'; binary.mkdir()
            cli = binary/'coven'
            cli.write_text('#!'+sys.executable+'\nimport os,sys\nprint("__COVEN_FIXTURE__"+os.getcwd()+"|"+str(os.isatty(0)),flush=True)\nprint("__INPUT__"+input(),flush=True)\n')
            cli.chmod(0o700)
            shell = pathlib.Path(tmp)/'login-shell'
            shell.write_text('#!'+sys.executable+'\nimport os,sys\nassert sys.argv[1:]==["-l","-i","-c","exec coven"],sys.argv\nos.environ["PATH"]='+repr(str(binary))+'+os.pathsep+os.environ["PATH"]\nos.execvpe("coven",["coven"],os.environ)\n')
            shell.chmod(0o700)
            with mock.patch.dict(os.environ, {'SHELL':str(shell)}):
                session = Session('agent', {'mode':'local','launcher':'coven','cwd':str(folder)}, events.put)
            output = ''
            def wait_for(marker):
                nonlocal output
                until = time.monotonic()+5
                while marker not in output and time.monotonic()<until:
                    try:event = events.get(timeout=.1)
                    except queue.Empty:continue
                    if event.get('event')=='terminal.data':output += base64.b64decode(event['data']).decode()
                self.assertIn(marker, output)
            try:
                session.start()
                wait_for('__COVEN_FIXTURE__'+str(folder)+'|True')
                session.write('agent input fixture\r')
                wait_for('__INPUT__agent input fixture')
            finally:
                session.close();session.reader.join(timeout=5)
            with self.assertRaises(ProcessLookupError):os.kill(session.pid,0)

    def test_request_is_one_literal_argument(self):
        events=queue.Queue()
        with tempfile.TemporaryDirectory(prefix='open-sesame-request-') as tmp:
            folder=pathlib.Path(tmp); sentinel=folder/'must-not-exist'; binary=folder/'bin';binary.mkdir()
            task='Open Safari; $(touch '+str(sentinel)+'); `touch '+str(sentinel)+'`'
            cli=binary/'coven';cli.write_text('#!'+sys.executable+'\nimport sys\nprint("__TASK__"+repr(sys.argv[1:]),flush=True)\n');cli.chmod(0o700)
            shell=folder/'login-shell';shell.write_text('#!'+sys.executable+'\nimport os,sys\nassert sys.argv[1:4]==["-l","-i","-c"]\nos.environ["PATH"]='+repr(str(binary))+'+os.pathsep+os.environ["PATH"]\nos.execvpe("/bin/bash",["/bin/bash","-i","-c",*sys.argv[4:]],os.environ)\n');shell.chmod(0o700)
            with mock.patch.dict(os.environ,{'SHELL':str(shell)}):session=Session('request',{'mode':'local','launcher':'coven','prompt':task,'cwd':str(folder)},events.put)
            output=''
            try:
                session.start();until=time.monotonic()+5
                expected='__TASK__'+repr(['Task: '+task])
                while expected not in output and time.monotonic()<until:
                    try:event=events.get(timeout=.1)
                    except queue.Empty:continue
                    if event.get('event')=='terminal.data':output+=base64.b64decode(event['data']).decode()
                self.assertIn(expected,output);self.assertFalse(sentinel.exists())
            finally:session.close();session.reader.join(timeout=5)

    def test_ssh_agent_preserves_quoted_remote_folder(self):
        # Inspect the spawn boundary without contacting an SSH server.
        captured = []
        class ChildExit(Exception):pass
        def exec_capture(program,args,env):
            captured.append(args)
            raise ChildExit()
        # Stop before fork so this test cannot create or signal a process.
        with mock.patch('bridge.shutil.which',return_value='/usr/bin/ssh'), mock.patch('bridge.pty.fork',return_value=(0,4)), mock.patch('bridge.os.chdir'), mock.patch('bridge.os.execvpe',side_effect=exec_capture), mock.patch('bridge.os.write'), mock.patch('bridge.os._exit',side_effect=ChildExit):
            with self.assertRaises(ChildExit):Session('remote',{'mode':'ssh','launcher':'coven','host':'mac-mini','user':'val','cwd':"/projects/one's work"},lambda e:None)
        expected='cd -- '+shlex.quote("/projects/one's work")+' && exec "${SHELL:-/bin/sh}" -l -i -c '+shlex.quote('exec coven')
        self.assertEqual(captured[0],['/usr/bin/ssh','-tt','val@mac-mini',expected])

    def test_invalid_launcher_never_forks(self):
        with mock.patch('bridge.pty.fork') as fork:
            with self.assertRaises(ValueError):Session('bad',{'launcher':'coven; touch unwanted'},lambda e:None)
            with self.assertRaises(ValueError):Session('bad',{'launcher':'coven','prompt':'x'*2001},lambda e:None)
            fork.assert_not_called()


if __name__=='__main__':unittest.main()
