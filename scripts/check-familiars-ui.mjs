import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('dist/familiars.js','utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function environment(storage=new Map()){
  const nodes=[];let document;
  class Element extends EventTarget{
    constructor(tag='div'){super();nodes.push(this);this.tag=tag;this.id='';this.children=[];this.dataset={};this.attrs={};this.value='';this.hidden=false;this.disabled=false;this.textContent='';this.scrollHeight=0;this.scrollTop=0;this.clientHeight=100;this.style={};this.classList={toggle(){}}}
    prepend(...items){this.children.unshift(...items)}append(...items){this.children.push(...items)}replaceChildren(...items){this.children=[...items];this.scrollTop=0}
    insertBefore(node,before){const index=this.children.indexOf(before);this.children.splice(index<0?this.children.length:index,0,node)}contains(node){return node===this||this.children.some(child=>child.contains(node))}
    setAttribute(key,value){this.attrs[key]=String(value)}removeAttribute(key){delete this.attrs[key]}
    focus(){document.activeElement=this}querySelector(tag){return this.children.find(n=>n.tag===tag)}click(){if(!this.disabled)this.dispatchEvent(new Event('click'))}
  }
  const get=id=>nodes.findLast(n=>n.id===id)||Object.assign(new Element(),{id});
  document=new EventTarget();document.getElementById=get;document.createElement=tag=>new Element(tag);
  get('familiar-welcome').append(new Element('strong'));
  get('familiar-chat-empty').append(new Element('strong'),new Element('p'));
  const window=new EventTarget(),calls=[],pending=new Map(),conversations=new Map(['nova','sage'].map(id=>[id,{schema:1,familiarId:id,conversationId:'conversation-'+id,revision:0,sessionId:null,harness:'coven-code',messages:[],status:'ready'}]));
  let rejectBeforeStart=false;
  const client={async status(){calls.push('status');return {available:true}},async listFamiliars(){calls.push('list');return ['nova','sage'].map(id=>({id,name:id,displayName:id.toUpperCase(),emoji:'ph:brain',workspace:'/fixture/'+id}))},async openConversation(id){calls.push('open:'+id);return structuredClone(conversations.get(id))},
    sendMessage(input,onEvent){calls.push('send:'+input.familiarId);if(rejectBeforeStart)return Promise.reject(Error('Workspace changed. Start a new chat.'));const chat=conversations.get(input.familiarId);chat.harness=input.harness;chat.messages.push({role:'user',text:input.prompt},{role:'assistant',text:''});chat.revision++;chat.status='responding';return new Promise((resolve,reject)=>pending.set(input.familiarId,{input,onEvent,resolve,reject}))},
    async cancel(runId){const [id,job]=[...pending].find(([,job])=>job.input.runId===runId);conversations.get(id).status='stopped';conversations.get(id).revision++;job.reject(Error('Reply stopped'));pending.delete(id)},async command(fid,name){calls.push('command:'+fid+':'+name);return {familiarId:fid,name,columns:['Coven','State'],rows:[['Daemon','Ready']]}}};
  window.OpenSesameCovenClient=client;
  const localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
  const context={location:{href:'https://fixture.invalid/'},window,document,localStorage,state:{scenario:'familiars'},openSesameBridge:{available:true,ready:Promise.resolve()},CustomEvent,Event,TextEncoder,icon:()=>'<svg></svg>',requestAnimationFrame:fn=>{setImmediate(fn);return 1},newId:()=>Math.random().toString(36).slice(2),toast(){},navigator:{clipboard:{writeText:async()=>{}}},OpenSesameGFM:{parse:text=>text},OpenSesameContent:{clean:text=>Object.assign(new Element(),{textContent:text})}};
  vm.runInNewContext(fs.readFileSync('dist/familiar-commands.js','utf8'),context);vm.runInNewContext(source,context);await flush();
  const type=text=>{get('familiar-message').value=text;get('familiar-message').dispatchEvent(new Event('input'))};
  const choose=async id=>{get('familiar-list').children.find(n=>n.dataset.familiar===id).click();await flush()};
  return {get,calls,window,type,choose,storage,pending,conversations,client,set rejectBeforeStart(value){rejectBeforeStart=value}};
}
let e=await environment();
assert.deepEqual(e.calls,[],'No prior connection means no automatic discovery or send');
e.get('familiar-connect').click();await flush();
assert.deepEqual(e.calls,['status','list']);assert.match(e.get('familiar-connection-status').textContent,/2 familiars/);
assert.equal(e.get('familiar-welcome').querySelector('strong').textContent,'Choose your familiar');assert.equal(e.get('familiar-roster-count').textContent,'2');
assert.equal(e.get('familiar-list').children[0].children[0].textContent,'','Icon identifiers must not spill raw text into the rail');
await e.choose('nova');assert.equal(e.get('familiar-name').textContent,'NOVA');assert.equal(e.get('familiar-compose').hidden,false);
assert.equal(e.get('familiar-chat-empty').hidden,false,'A new conversation has an intentional empty state and a visible composer');
e.get('familiar-harness').value='codex';e.get('familiar-harness').dispatchEvent(new Event('change'));e.type('Nova draft');await flush();assert.equal(e.get('familiar-harness').value,'codex','Typing must preserve the chosen harness');await e.choose('sage');assert.equal(e.get('familiar-message').value,'');e.type('Sage draft');await e.choose('nova');assert.equal(e.get('familiar-message').value,'Nova draft');
assert.equal(e.window.OpenSesameFamiliars.prepareDraft('another request'),false,'A prepared command cannot overwrite an existing familiar draft');
e.get('familiar-compose').dispatchEvent(new Event('submit',{cancelable:true}));await flush();
assert.equal(e.get('familiar-message').disabled,false,'Drafts and slash commands remain available while a reply is running');assert.equal(e.get('familiar-stop').hidden,false);
const job=e.pending.get('nova');assert.equal(job.input.harness,'codex','Switching familiars must preserve the selected harness for this draft');const answer={type:'assistant',message:{content:[{type:'text',text:'Streamed reply'}]}};const rosterNode=e.get('familiar-list').children[0];e.get('familiar-list').scrollTop=80;job.onEvent(answer);e.conversations.get('nova').messages.at(-1).text='Streamed reply';await flush();
assert.equal(e.get('familiar-list').scrollTop,80,'Streaming must preserve the familiar picker scroll position');assert.equal(e.get('familiar-list').children[0],rosterNode,'Streaming must not remount the familiar picker');
assert.equal(e.get('familiar-messages').children.at(-1).children.at(-1).children[0].textContent,'Streamed reply');
await e.choose('sage');assert.equal(e.get('familiar-message').value,'Sage draft');await e.choose('nova');e.get('familiar-stop').click();await flush();await flush();
assert.equal(e.get('familiar-message').disabled,false);assert.equal(e.get('familiar-stop').hidden,true);assert.equal(e.get('familiar-chat-error').hidden,true,'An intentional Stop is a status, not a failure');assert.match(e.get('familiar-chat-status').textContent,/Reply stopped/);
await e.choose('sage');e.rejectBeforeStart=true;e.get('familiar-compose').dispatchEvent(new Event('submit',{cancelable:true}));await flush();await flush();
assert.equal(e.get('familiar-message').value,'Sage draft','Host preflight rejection restores the exact unsent draft');
assert.match(e.get('familiar-chat-error').textContent,/Workspace changed/);
const sends=e.calls.filter(x=>x.startsWith('send:')).length;
const restored=await environment(e.storage);await flush();
assert.equal(restored.get('familiar-name').textContent,'SAGE');assert.equal(restored.get('familiar-message').value,'Sage draft');assert.equal(restored.calls.some(x=>x.startsWith('send:')),false,'Remembered connection restores read-only metadata and drafts without sending');
await restored.choose('nova');assert.equal(restored.get('familiar-harness').value,'codex','The chosen harness is restored after relaunch');
assert.equal(sends,2);
const persistent=restored.conversations.get('nova').conversationId;restored.get('familiar-connect').click();await flush();assert.equal(restored.conversations.get('nova').conversationId,persistent);
assert.equal(restored.get('familiar-chat-empty').hidden,false);
restored.get('familiar-search').value='missing';restored.get('familiar-search').dispatchEvent(new Event('input'));assert.equal(restored.get('familiar-roster-empty').hidden,false);assert.equal(restored.get('familiar-roster-count').textContent,'0 / 2');
restored.get('familiar-search').value='';restored.get('familiar-search').dispatchEvent(new Event('input'));
const racing=await environment();racing.get('familiar-connect').click();await flush();
const open=racing.client.openConversation;let resolveOld;let first=true;
racing.client.openConversation=id=>{if(id==='nova'&&first){first=false;return new Promise(resolve=>resolveOld=resolve)}return open(id)};
await racing.choose('nova');await racing.choose('sage');racing.conversations.get('nova').revision=7;await racing.choose('nova');
resolveOld({...racing.conversations.get('nova'),revision:0});await flush();racing.type('Use the current conversation');await flush();racing.get('familiar-compose').dispatchEvent(new Event('submit',{cancelable:true}));await flush();
assert.equal(racing.pending.get('nova').input.revision,7,'A late earlier selection must not replace the current conversation revision');racing.get('familiar-stop').click();await flush();await flush();
let finishStatus;racing.client.status=()=>new Promise(resolve=>finishStatus=resolve);racing.get('familiar-connect').click();await flush();racing.window.dispatchEvent(new Event('open-sesame-desktop-disconnected'));finishStatus({available:true});await flush();
assert.equal(racing.window.OpenSesameFamiliars.snapshot().connected,false,'Late discovery must not reconnect a disconnected host');assert.match(racing.get('familiar-connection-status').textContent,/connection closed/);
const commandUI=await environment();commandUI.get('familiar-connect').click();await flush();await commandUI.choose('nova');assert.equal(commandUI.get('familiar-connection').hidden,true,'The healthy connection row takes no layout space');
commandUI.type('/help');await flush();assert.equal(commandUI.get('familiar-command-menu').hidden,false);const enter=()=>{const event=new Event('keydown',{cancelable:true});Object.defineProperty(event,'key',{value:'Enter'});commandUI.get('familiar-message').dispatchEvent(event)};enter();await flush();assert.match(commandUI.get('familiar-command-body').children[0].textContent,/\/coven status/);assert.equal(commandUI.calls.some(x=>x.startsWith('send:')),false);
commandUI.type('/coven status');await flush();enter();await flush();assert.equal(commandUI.calls.at(-1),'command:nova:status');assert.match(commandUI.get('familiar-command-body').children[0].textContent,/Ready/);assert.equal(commandUI.conversations.get('nova').messages.length,0,'Local command output never becomes model context');
commandUI.type('/new');await flush();enter();await flush();assert.equal(commandUI.conversations.get('nova').conversationId,'conversation-nova');assert.equal(commandUI.calls.some(x=>x.startsWith('send:')),false,'Removed reset commands cannot become model prompts');
let finishCommand;commandUI.client.command=(fid,name)=>new Promise(resolve=>finishCommand=()=>resolve({familiarId:fid,name,columns:['Old'],rows:[['Old result']]}));commandUI.type('/coven skills');await flush();enter();await commandUI.choose('sage');finishCommand();await flush();assert.equal(commandUI.get('familiar-command-result').hidden,true,'Late results cannot appear in another familiar’s chat');
assert.ok(!fs.readFileSync('dist/index.html','utf8').includes('id="familiar-new"'));assert.ok(!fs.readFileSync('desktop/OpenSesame.swift','utf8').includes('"coven.new"'));
console.log('Familiars persistent sessions/drafts, quiet connection state, local keyboard/Coven commands, stream/Stop, recovery and stale command/selection/disconnect races passed with a simulated DOM/host.');
