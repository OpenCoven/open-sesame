import base64
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import computer_accounts as accounts

class AccountsTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='sesame-account-metadata-'); self.addCleanup(temporary.cleanup)
        self.auth = Path(temporary.name) / 'auth.json'; self.auth.write_text('fixture account file')
        env = patch.dict(os.environ, {'CODEX_HOME':temporary.name}); env.start(); self.addCleanup(env.stop)

    def test_approval_route_changes_when_cli_account_metadata_changes(self):
        import subprocess
        with patch.object(accounts,'executable',return_value=sys.executable), patch.object(accounts.subprocess,'run') as run:
            run.return_value = subprocess.CompletedProcess([],0,b'',b'Logged in using ChatGPT')
            first = accounts.account('codex')['route']
            replacement = self.auth.with_suffix('.new'); replacement.write_text('different fixture account'); replacement.replace(self.auth)
            self.assertNotEqual(first, accounts.account('codex')['route'])
            def claude(email):
                run.return_value = subprocess.CompletedProcess([],0,json.dumps({'loggedIn':True,'authMethod':'claude.ai','email':email,'orgId':'fixture-org'}).encode(),b'')
                return accounts.account('claude')
            first = claude('one@example.test'); second = claude('two@example.test')
            self.assertNotEqual(first['route'], second['route'])
            self.assertNotIn('one@example.test', json.dumps(first))

    def test_unavailable_account_identity_cannot_report_configured(self):
        import subprocess
        self.auth.unlink()
        with patch.object(accounts,'executable',return_value=sys.executable), patch.object(accounts.subprocess,'run') as run:
            run.return_value=subprocess.CompletedProcess([],0,b'',b'Logged in using ChatGPT')
            self.assertFalse(accounts.account('codex')['configured'])
            run.return_value=subprocess.CompletedProcess([],0,b'{"loggedIn":true,"authMethod":"claude.ai"}',b'')
            self.assertFalse(accounts.account('claude')['configured'])

    def test_cancel_retires_cli_child_after_leader_exits(self):
        import signal,subprocess
        with tempfile.TemporaryDirectory(prefix='sesame-orphan-fixture-') as temporary:
            root=Path(temporary); child_file=root/'owned-child'
            script="import os,time;pid=os.fork();open('owned-child','w').write(str(os.getpid())) if pid==0 else None;time.sleep(60) if pid==0 else None"
            started=time.monotonic(); child=None
            try:
                with self.assertRaisesRegex(ValueError,'stopped'):
                    accounts.invoke([sys.executable,'-c',script],b'fixture',root,{},lambda:child_file.exists() and time.monotonic()-started>.2)
                child=int(child_file.read_text())
                state=subprocess.run(['ps','-o','stat=','-p',str(child)],capture_output=True,text=True).stdout.strip()
                self.assertTrue(not state or state.startswith('Z'),'Owned child survived after its CLI parent exited')
            finally:
                if child is None and child_file.exists(): child=int(child_file.read_text())
                if child:
                    try:os.kill(child,signal.SIGKILL)
                    except ProcessLookupError:pass

    def test_only_subscription_cli_signin_is_accepted(self):
        def reply(stdout=b'',stderr=b'',code=0):
            import subprocess
            return subprocess.CompletedProcess([],code,stdout,stderr)
        with patch.object(accounts,'executable',return_value=sys.executable), patch.object(accounts.subprocess,'run') as run:
            run.return_value=reply(stderr=b'Logged in using ChatGPT\n');self.assertTrue(accounts.account('codex')['configured'])
            run.return_value=reply(stderr=b'Logged in using an API key');self.assertFalse(accounts.account('codex')['configured'])
            for method,allowed in [('claude.ai',True),('api_key',False),('api_key_helper',False),('oauth_token',False),('third_party',False)]:
                run.return_value=reply(json.dumps({'loggedIn':True,'authMethod':method,'email':'private@example.test'}).encode())
                result=accounts.account('claude');self.assertEqual(result['configured'],allowed);self.assertNotIn('private@example',json.dumps(result))
            run.return_value=reply(b'invalid');self.assertFalse(accounts.account('claude')['configured'])
        for provider in ['anthropic','coven','shell']:
            with self.assertRaises(ValueError):accounts.account(provider)

    def test_environment_and_login_have_no_api_key_fallback(self):
        with patch.dict(os.environ,{key:'fixture-secret' for key in accounts.SECRET_ENV}):
            env=accounts.environment('/fixture/bin/codex');self.assertTrue(all(key not in env for key in accounts.SECRET_ENV))
        with patch.object(accounts,'executable',return_value='/fixture/path with spaces/codex'):
            target=accounts.login_target('codex');self.assertIn("'",target['command']);self.assertTrue(target['command'].endswith(' login'));self.assertNotIn('api-key',target['command'])
            self.assertTrue(accounts.login_target('claude')['command'].endswith(' auth login'));self.assertNotIn('--console',accounts.login_target('claude')['command'])

    def test_codex_planner_typed_images_closed_output_and_tool_refusal(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);binary=root/'codex';binary.write_text('#!'+sys.executable+'\n'+'''import json,os,pathlib,sys
args=sys.argv[1:]
assert '--ignore-user-config' in args and '--ignore-rules' in args and '--ephemeral' in args
assert args[args.index('--sandbox')+1]=='read-only'
assert 'shell_tool' in args and 'hooks' in args and 'apps' in args
for capability in ['computer_use','browser_use','browser_use_external','browser_use_full_cdp_access','in_app_browser','in_app_local_automation','code_mode_host','code_mode','plugins','skill_search','skill_mcp_dependency_install','unified_exec','unified_exec_tty']:
 assert any(args[i:i+2]==['--disable',capability] for i in range(len(args)-1)), capability
assert not os.environ.get('ANTHROPIC_API_KEY') and not os.environ.get('OPENAI_API_KEY')
prompt=sys.stdin.read();assert 'Open Sesame' in prompt
if 'TOOL_FIXTURE' in prompt:print(json.dumps({'type':'item.completed','item':{'type':'command_execution'}}))
else:print(json.dumps({'type':'item.completed','item':{'type':'agent_message'}}))
pathlib.Path(args[args.index('--output-last-message')+1]).write_text(json.dumps({'message':'Inspect the generated fixture.','action':{'action':'observe','observation':None,'coordinate':None,'end_coordinate':None,'text':None,'direction':None,'amount':None,'milliseconds':None}}))
print(json.dumps({'type':'turn.completed'}))
''');binary.chmod(0o755)
            status={'configured':True,'route':'fixture-route','_binary':str(binary)}
            request={'system':'Open Sesame fixture.','messages':[{'role':'user','content':[{'type':'text','text':'Inspect the fixture.'},{'type':'image','source':{'type':'base64','media_type':'image/jpeg','data':base64.b64encode(b'\xff\xd8\xfffixture').decode()}}]}]}
            with patch.object(accounts,'account',return_value=status):
                result=accounts.plan('codex','fixture-route',request,lambda:False);self.assertEqual(result['action']['action'],'observe')
                request['system']='Open Sesame TOOL_FIXTURE'
                with self.assertRaisesRegex(ValueError,'unsupported tool'):accounts.plan('codex','fixture-route',request,lambda:False)
                with self.assertRaisesRegex(ValueError,'changed'):accounts.plan('codex','other-route',request,lambda:False)
            self.assertFalse(list(root.glob('screen-*')),'Temporary screen files are retired with the private turn directory')

    def test_connected_account_does_not_launch_redundant_login(self):
        from computer_agent import ComputerAgent
        agent=ComputerAgent(lambda _:None,native=True)
        self.addCleanup(agent.close)
        with patch.object(accounts,'account',return_value={'configured':True}), patch.object(accounts,'login_target') as target:
            self.assertEqual(agent.login('codex'),{'kind':'account-ready','provider':'codex'})
            target.assert_not_called()
        with patch.object(accounts,'account',return_value={'configured':False}), patch.object(accounts,'login_target',return_value={'kind':'login','provider':'codex'}) as target:
            self.assertEqual(agent.login('codex')['kind'],'login');target.assert_called_once_with('codex')

    def test_claude_planner_uses_subscription_cli_without_tools(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);binary=root/'claude';binary.write_text('#!'+sys.executable+'\n'+'''import json,sys
args=sys.argv[1:]
assert args[args.index('--tools')+1]=='' and '--safe-mode' in args and '--restricted' in args
assert '--strict-mcp-config' in args and '--no-session-persistence' in args
assert '--bare' not in args and '--console' not in args
request=json.loads(sys.stdin.read());assert request['type']=='user';assert any(b['type']=='image' for b in request['message']['content'])
assert '[Attached screenshot 1;' in request['message']['content'][0]['text']
print(json.dumps({'type':'result','subtype':'success','is_error':False,'structured_output':{'message':'Fixture complete.','action':None}}))
''');binary.chmod(0o755)
            request={'system':'Open Sesame fixture','messages':[{'role':'user','content':[{'type':'image','source':{'type':'base64','media_type':'image/jpeg','data':base64.b64encode(b'\xff\xd8\xfffixture').decode()}}]}]}
            with patch.object(accounts,'account',return_value={'configured':True,'route':'fixture','_binary':str(binary)}):
                self.assertIsNone(accounts.plan('claude','fixture',request,lambda:False)['action'])

    def test_cancelled_plan_never_checks_account_or_starts_cli(self):
        with patch.object(accounts, 'account') as account, patch.object(accounts.subprocess, 'Popen') as spawn:
            with self.assertRaisesRegex(ValueError, 'stopped'):
                accounts.plan('codex','fixture',{},lambda:True)
            account.assert_not_called(); spawn.assert_not_called()

    def test_cancellation_reaps_owned_cli(self):
        start=time.monotonic()
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(ValueError,'stopped'):
                accounts.invoke([sys.executable,'-c','import time;time.sleep(60)'],b'fixture',temporary,{},lambda:time.monotonic()-start>.1)
        self.assertLess(time.monotonic()-start,4)

    def test_familiar_identity_is_bound_to_native_approval(self):
        from computer_agent import ComputerAgent
        with tempfile.TemporaryDirectory() as temporary:
            binary=Path(temporary)/'engine';binary.write_text('#!/bin/sh\nexit 0\n');binary.chmod(0o755)
            roster=[{'id':'nova','displayName':'Nova','description':'Builder','workspace':'/fixture/nova'}]
            agent=ComputerAgent(lambda _:None,native=True,binary=binary,trusted_fixture=True,familiars=lambda **_:roster)
            self.addCleanup(agent.close)
            def status(_):return {'available':True,'configured':True,'provider':'Codex','model':'ChatGPT account','destination':'https://chatgpt.com','route':'fixed'}
            with patch.object(accounts,'account',side_effect=status):
                proposal=agent.prepare({'prompt':'Inspect fixture','provider':'familiar','driver':'codex','familiarId':'nova'})
                self.assertIn('Nova',proposal['provider']);self.assertEqual(proposal['familiar']['workspace'],'/fixture/nova')
                roster[0]['displayName']='Changed identity'
                with self.assertRaisesRegex(ValueError,'changed'):agent.finish(proposal['token'],True,'s'*64)
                self.assertIsNone(agent.run)
