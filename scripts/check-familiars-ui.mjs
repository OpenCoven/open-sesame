import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('dist/familiars.js','utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function environment(storage=new Map()){
  const nodes=[];let document;
  class Element extends EventTarget{
    constructor(tag='div'){super();nodes.push(this);this.tag=tag;this.id='';this.children=[];this.dataset={};this.attrs={};this.value='';this.hidden=false;this.disabled=false;this.textContent='';this.scrollHeight=0;this.scrollTop=0;this.clientHeight=100;this.classList={toggle(){}}}
    append(...items){this.children.push(...items)}replaceChildren(...items){this.children=[...items];this.scrollTop=0}
    setAttribute(key,value){this.attrs[key]=String(value)}removeAttribute(key){delete this.attrs[key]}
    focus(){document.activeElement=this}querySelector(tag){return this.children.find(n=>n.tag===tag)}click(){if(!this.disabled)this.dispatchEvent(new Event('click'))}
  }
  const get=id=>nodes.findLast(n=>n.id===id)||Object.assign(new Element(),{id});
  document=new EventTarget();document.getElementById=get;document.createElement=tag=>new Element(tag);
  get('familiar-welcome').append(new Element('strong'));
  const window=new EventTarget(),calls=[],pending=new Map(),conversations=new Map(['nova','sage'].map(id=>[id,{schema:1,familiarId:id,conversationId:'conversation-'+id,revision:0,sessionId:null,harness:'coven-code',messages:[],status:'ready'}]));
  let rejectBeforeStart=false;
  const client={async status(){calls.push('status');return {available:true}},async listFamiliars(){calls.push('list');return ['nova','sage'].map(id=>({id,name:id,displayName:id.toUpperCase(),workspace:'/fixture/'+id}))},async openConversation(id){calls.push('open:'+id);return structuredClone(conversations.get(id))},
    sendMessage(input,onEvent){calls.push('send:'+input.familiarId);if(rejectBeforeStart)return Promise.reject(Error('Workspace changed. Start a new chat.'));const chat=conversations.get(input.familiarId);chat.harness=input.harness;chat.messages.push({role:'user',text:input.prompt},{role:'assistant',text:''});chat.revision++;chat.status='responding';return new Promise((resolve,reject)=>pending.set(input.familiarId,{input,onEvent,resolve,reject}))},
    async cancel(runId){const [id,job]=[...pending].find(([,job])=>job.input.runId===runId);conversations.get(id).status='stopped';conversations.get(id).revision++;job.reject(Error('Reply stopped'));pending.delete(id)},async newConversation(id){const chat=conversations.get(id);Object.assign(chat,{conversationId:'fresh-'+id,revision:0,sessionId:null,messages:[],status:'ready'});return structuredClone(chat)}};
  window.OpenSesameCovenClient=client;
  const localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
  const context={location:{href:'https://fixture.invalid/'},window,document,localStorage,state:{scenario:'familiars'},openSesameBridge:{available:true,ready:Promise.resolve()},CustomEvent,Event,TextEncoder,requestAnimationFrame:fn=>{setImmediate(fn);return 1},newId:()=>Math.random().toString(36).slice(2),toast(){},navigator:{clipboard:{writeText:async()=>{}}},OpenSesameGFM:{parse:text=>text},OpenSesameContent:{clean:text=>Object.assign(new Element(),{textContent:text})}};
  vm.runInNewContext(source,context);await flush();
  const type=text=>{get('familiar-message').value=text;get('familiar-message').dispatchEvent(new Event('input'))};
  const choose=async id=>{get('familiar-list').children.find(n=>n.dataset.familiar===id).click();await flush()};
  return {get,calls,window,type,choose,storage,pending,conversations,set rejectBeforeStart(value){rejectBeforeStart=value}};
}
let e=await environment();
assert.deepEqual(e.calls,[],'No prior connection means no automatic discovery or send');
e.get('familiar-connect').click();await flush();
assert.deepEqual(e.calls,['status','list']);assert.match(e.get('familiar-connection-status').textContent,/2 familiars/);
await e.choose('nova');assert.equal(e.get('familiar-name').textContent,'NOVA');assert.equal(e.get('familiar-compose').hidden,false);
e.get('familiar-harness').value='codex';e.get('familiar-harness').dispatchEvent(new Event('change'));e.type('Nova draft');await flush();assert.equal(e.get('familiar-harness').value,'codex','Typing must preserve the chosen harness');await e.choose('sage');assert.equal(e.get('familiar-message').value,'');e.type('Sage draft');await e.choose('nova');assert.equal(e.get('familiar-message').value,'Nova draft');
assert.equal(e.window.OpenSesameFamiliars.prepareDraft('another request'),false,'A prepared command cannot overwrite an existing familiar draft');
e.get('familiar-compose').dispatchEvent(new Event('submit',{cancelable:true}));await flush();
assert.equal(e.get('familiar-message').disabled,true);assert.equal(e.get('familiar-stop').hidden,false);
const job=e.pending.get('nova');assert.equal(job.input.harness,'codex','Switching familiars must preserve the selected harness for this draft');const answer={type:'assistant',message:{content:[{type:'text',text:'Streamed reply'}]}};const rosterNode=e.get('familiar-list').children[0];e.get('familiar-list').scrollTop=80;job.onEvent(answer);e.conversations.get('nova').messages.at(-1).text='Streamed reply';await flush();
assert.equal(e.get('familiar-list').scrollTop,80,'Streaming must preserve the familiar picker scroll position');assert.equal(e.get('familiar-list').children[0],rosterNode,'Streaming must not remount the familiar picker');
assert.equal(e.get('familiar-messages').children.at(-1).children.at(-1).children[0].textContent,'Streamed reply');
await e.choose('sage');assert.equal(e.get('familiar-message').value,'Sage draft');await e.choose('nova');e.get('familiar-stop').click();await flush();await flush();
assert.equal(e.get('familiar-message').disabled,false);assert.equal(e.get('familiar-stop').hidden,true);assert.match(e.get('familiar-chat-error').textContent,/Reply stopped/);
await e.choose('sage');e.rejectBeforeStart=true;e.get('familiar-compose').dispatchEvent(new Event('submit',{cancelable:true}));await flush();await flush();
assert.equal(e.get('familiar-message').value,'Sage draft','Host preflight rejection restores the exact unsent draft');
assert.match(e.get('familiar-chat-error').textContent,/Workspace changed/);
const sends=e.calls.filter(x=>x.startsWith('send:')).length;
const restored=await environment(e.storage);await flush();
assert.equal(restored.get('familiar-name').textContent,'SAGE');assert.equal(restored.get('familiar-message').value,'Sage draft');assert.equal(restored.calls.some(x=>x.startsWith('send:')),false,'Remembered connection restores read-only metadata and drafts without sending');
await restored.choose('nova');assert.equal(restored.get('familiar-harness').value,'codex','The chosen harness is restored after relaunch');
assert.equal(sends,2);
console.log('Shipped Familiars UI: explicit connect/choose/send path, per-familiar drafts, streamed text, switching, Stop, unsent-draft recovery, and relaunch without automatic sends passed with a simulated DOM/host.');
