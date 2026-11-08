import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawn} from 'node:child_process';
import readline from 'node:readline';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'open-sesame-client-'));
for(const id of ['nova','sage'])fs.mkdirSync(path.join(root,id));
fs.writeFileSync(path.join(root,'roster.json'),JSON.stringify(['nova','sage'].map(id=>({id,name:id,display_name:id,workspace:path.join(root,id)}))));
const code=`import json,sys,threading
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from bridge import Bridge
from coven_runtime import CovenRuntime
lock=threading.Lock()
def emit(value):
    with lock:
        print(json.dumps(value),flush=True)
bridge=Bridge(emit)
bridge.coven=CovenRuntime(emit,Path(sys.argv[2])/'state',lambda:sys.argv[3])
try:
    for line in sys.stdin: bridge.handle(json.loads(line))
finally: bridge.close()
`;
const child=spawn('python3',['-B','-u','-c',code,path.resolve('desktop'),root,path.resolve('desktop/tests/fixtures/coven_cli.py')],{env:{...process.env,OPEN_SESAME_TEST_COVEN_ROOT:root}});
let stderr='';child.stderr.on('data',b=>stderr+=b);
const pending=new Map(),listeners=new Set();let sequence=0;
const lines=readline.createInterface({input:child.stdout});
lines.on('line',line=>{const message=JSON.parse(line),task=pending.get(message.requestId);if(task){pending.delete(message.requestId);clearTimeout(task.timer);message.error?task.reject(Error(message.error)):task.resolve(message.result)}else for(const listener of listeners)listener(message)});
const bridge={available:true,request(method,params={}){return new Promise((resolve,reject)=>{const requestId='test-'+(++sequence),timer=setTimeout(()=>{pending.delete(requestId);reject(Error('Bridge request timed out: '+method))},12000);pending.set(requestId,{resolve,reject,timer});child.stdin.write(JSON.stringify({requestId,method,params})+'\n')})}};
const window=new EventTarget();window.openSesameBridge=bridge;
const context=vm.createContext({window,openSesameBridge:bridge,console});
vm.runInContext(fs.readFileSync('dist/vendor/coven-runtime.js','utf8'),context);context.OpenSesameCovenRuntime=window.OpenSesameCovenRuntime;
vm.runInContext(fs.readFileSync('dist/coven-chat.js','utf8'),context);
const factoryWindow=new EventTarget();vm.runInNewContext(fs.readFileSync('dist/coven-chat.js','utf8'),{window:factoryWindow});assert.equal(typeof factoryWindow.OpenSesameCreateCovenClient,'function','Integrators can load the factory without an Open Sesame app bridge');
const client=window.OpenSesameCreateCovenClient(bridge,listener=>{listeners.add(listener);return()=>listeners.delete(listener)});
try{
  assert.equal((await client.status()).available,true);
  const roster=await client.listFamiliars();assert.deepEqual(Array.from(roster,f=>f.id),['nova','sage']);
  const nova=await client.openConversation('nova'),sage=await client.openConversation('sage');
  assert.equal(fs.existsSync(path.join(root,'calls.jsonl')),false,'Discovery and opening must not send a prompt');
  const input=(state,runId,prompt)=>({runId,prompt,familiarId:state.familiarId,conversationId:state.conversationId,revision:state.revision,sessionId:state.sessionId,harness:state.harness});
  const events=[];const reply=await client.sendMessage(input(nova,'first-run','hello'),e=>events.push(e));
  assert.ok(reply.sessionId);assert.deepEqual(events.map(e=>e.type),['system','assistant','assistant','result']);
  const saved=await client.openConversation('nova');assert.equal(saved.messages.at(-1).text,'Hello from nova');
  assert.equal((await client.openConversation('sage')).messages.length,0);
  let ready;const waiting=new Promise(resolve=>ready=resolve),received=[];
  const slow=client.sendMessage(input(sage,'slow-run','slow'),event=>{received.push(event);if(event.type==='assistant')ready()});
  const rejection=assert.rejects(slow,/Reply stopped/);
  await waiting;
  for(const listener of listeners)listener({event:'coven.event',runId:'slow-run',familiarId:'nova',conversationId:sage.conversationId,payload:{type:'assistant'}});
  assert.equal(received.filter(e=>e.type==='assistant').length,1,'Cross-familiar stream events must not reach this conversation');
  await client.sendMessage(input(saved,'other-run','parallel reply'));
  await client.cancel('slow-run');await rejection;
  const stopped=await client.openConversation('sage');assert.equal(stopped.status,'stopped');assert.equal(stopped.messages.at(-1).text,'Ready to wait');
  await assert.rejects(client.sendMessage(input(nova,'stale-run','stale')),/conversation changed/);
  assert.equal(client.busy,false);
  console.log('Real JS client → Python bridge → Coven CLI fixture: connect, full roster, no automatic send, streaming, durable per-familiar history, parallel familiar isolation, cancellation, and stale-view rejection passed. No live familiar was messaged.');
}finally{
  client.close();window.OpenSesameCovenClient.close();child.stdin.end();
  const exit=child.exitCode!==null?child.exitCode:await new Promise(resolve=>{const timer=setTimeout(()=>child.kill('SIGKILL'),7000);child.once('exit',code=>{clearTimeout(timer);resolve(code)})});
  lines.close();for(const task of pending.values())clearTimeout(task.timer);fs.rmSync(root,{recursive:true,force:true});assert.equal(exit,0,stderr);
}
