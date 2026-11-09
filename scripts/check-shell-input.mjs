import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class Node {
  constructor(){this.value='';this.hidden=true;this.attrs={};this.handlers={}}
  addEventListener(name,fn){(this.handlers[name]??=[]).push(fn)}
  emit(name,extra={}){const e={target:this,preventDefault(){this.defaultPrevented=true},stopPropagation(){},...extra};for(const fn of this.handlers[name]||[])fn(e);return e}
  setAttribute(k,v){this.attrs[k]=v}removeAttribute(k){delete this.attrs[k]}focus(){this.focused=true}
  querySelector(){return {disabled:false}}
}
const document=new Node(),window=new Node(),elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,new Node());return elements.get(id)};
document.getElementById=el;document.querySelector=()=>el('capture-label');
const storage=new Map(),calls=[],errors=[];let pending=[],target={paneId:'one',sessionId:'pty-one',name:'Project shell',mode:'local',ready:true};
window.OpenSesameLauncher={active:false};window.OpenSesameTerminal={inputTarget:()=>({...target}),sendInput:(bound,text)=>{calls.push({bound,text});return new Promise((resolve,reject)=>pending.push({resolve,reject}))}};
window.OpenSesameCovenChat={isActive:()=>false};window.OpenSesameCalculator={calculate:text=>text==='2-2'?{result:'0'}:null};
const ctx={document,window,state:{scenario:'items',expanded:true},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},attachedUrl:'https://draft.example',ignoredInlineUrl:'',closeUrlEditor(){el('capture-url-row').hidden=true},toast:message=>errors.push(message),renderDraft(){window.OpenSesameShellInput?.sync()},URL};
vm.createContext(ctx);
const capture=fs.readFileSync('dist/capture.js','utf8');vm.runInContext(capture.slice(capture.indexOf('  const views='),capture.indexOf('  const el=id=>'))+';this.interpret=interpret;window.openSesameCapture={interpret,isReservedCommand};',ctx);
const interpret=ctx.interpret;
assert.equal(interpret('ls','auto','terminal').kind,'item','The old Shells fallback reproduces note routing before the shell controller loads');
vm.runInContext(fs.readFileSync('dist/shell-input.js','utf8'),ctx);const shell=window.OpenSesameShellInput;
el('capture-type').value='task';el('capture-input').value='Keep my project draft';document.emit('DOMContentLoaded');
ctx.state.scenario='terminal';window.emit('open-sesame-view-changed');assert.equal(el('capture-input').value,'');assert.equal(el('capture-input').focused,true);assert.equal(el('capture-input').spellcheck,false);assert.equal(el('attach-link').hidden,true);assert.equal(ctx.attachedUrl,'');
for(const text of ['ls','2-2','! pwd','!!','open Safari','task: literal','google.com','/bin/echo hello','/usr/bin/env','  printf "a b"  ','first\nsecond']){
 const intent=interpret(text,'task','terminal');assert.equal(intent.kind,'shell',text);assert.equal(intent.text,text,'Terminal text must remain unchanged');assert.equal(intent.target.sessionId,'pty-one');
}
assert.equal(interpret('/note A thought','auto','terminal').type,'note');assert.equal(interpret('/projects','auto','terminal').view,'items');assert.equal(interpret('/','auto','terminal').kind,'help');
el('capture-input').value='  printf "hello"  ';el('capture-input').emit('input');assert.equal(shell.submit(),true);assert.equal(calls[0].text,'  printf "hello"  ');assert.equal(shell.busy,true);shell.submit();assert.equal(calls.length,1,'Repeated Enter cannot duplicate a pending send');
target={...target,paneId:'two',sessionId:'pty-two',name:'Other shell'};window.emit('open-sesame-terminal-changed');assert.equal(el('capture-input').value,'');el('capture-input').value='other draft';el('capture-input').emit('input');pending.shift().resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(el('capture-input').value,'other draft','Late success must not clear another pane');
target={...target,paneId:'one',sessionId:'pty-one'};window.emit('open-sesame-terminal-changed');assert.equal(el('capture-input').value,'','Acknowledged text must not reappear');
el('capture-input').value='failed input';el('capture-input').emit('input');shell.submit();pending.shift().reject(new Error('Disconnected'));await new Promise(resolve=>setImmediate(resolve));assert.equal(el('capture-input').value,'failed input');assert.equal(errors.at(-1),'Disconnected');
shell.submit();el('capture-input').value='edited while sending';el('capture-input').emit('input');pending.shift().resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(el('capture-input').value,'edited while sending');
for(const patch of [{ready:false},{mode:'web',ready:false},{paneId:'',sessionId:'',ready:false},{connecting:true,ready:false}]){target={...target,...patch};const before=calls.length;assert.equal(interpret('ls','auto','terminal').incomplete,true);shell.submit();assert.equal(calls.length,before)}
target={paneId:'one',sessionId:'pty-new',name:'Shell',mode:'local',ready:true};window.emit('open-sesame-terminal-changed');el('capture-input').value='/projects';const origin=shell.commandContext;
ctx.state.scenario='items';window.emit('open-sesame-view-changed');shell.finishCommand(origin,'/projects');assert.equal(el('capture-input').value,'Keep my project draft','Navigating from a shell command must restore the existing capture draft');assert.equal(el('capture-type').value,'task');assert.equal(ctx.attachedUrl,'https://draft.example');assert.equal(el('attach-link').hidden,false);
ctx.state.scenario='terminal';window.emit('open-sesame-view-changed');assert.equal(el('capture-input').value,'');
el('capture-input').value='shell draft';el('capture-input').emit('input');window.OpenSesameLauncher.active=true;shell.sync();assert.equal(el('capture-input').value,'Keep my project draft');assert.equal(interpret('2-2','auto','terminal').kind,'calculation');window.OpenSesameLauncher.active=false;shell.sync();assert.equal(el('capture-input').value,'shell draft');
assert.equal(JSON.parse(storage.get('open-sesame-shell-drafts-v1')).one,'shell draft');

// Exercise the actual terminal adapter: immutable backend binding, exact bytes and failure propagation.
const source=fs.readFileSync('dist/terminal.js','utf8'),record={term:{},live:true,backendId:'pty-one'},pane={id:'one',name:'Shell',mode:'local'},transport=[];
const adapter={window:{},state:{scenario:'terminal'},selected:'one',current:()=>pane,mounted:new Map([['one',record]]),openSesameBridge:{request:async(method,params)=>{transport.push({method,...params})}}};vm.createContext(adapter);
vm.runInContext(source.slice(source.indexOf('  function inputTarget('),source.indexOf('  function isVisible(')),adapter);
const terminal=adapter.window.OpenSesameTerminal,bound=terminal.inputTarget();await terminal.sendInput(bound,'  echo "héllo"\nsecond  ');assert.equal(transport[0].id,'pty-one');assert.equal(transport[0].data,'  echo "héllo"\rsecond  \r');
record.backendId='replacement';await assert.rejects(()=>terminal.sendInput(bound,'no'),/changed/);record.backendId='pty-one';record.live=false;await assert.rejects(()=>terminal.sendInput(bound,'no'),/changed/);record.live=true;pane.mode='web';await assert.rejects(()=>terminal.sendInput(bound,'no'),/changed/);pane.mode='local';adapter.state.scenario='items';await assert.rejects(()=>terminal.sendInput(bound,'no'),/changed/);adapter.state.scenario='terminal';await assert.rejects(()=>terminal.sendInput(bound,'bad\x1bcode'),/control/);assert.equal(transport.length,1);
adapter.openSesameBridge.request=async()=>{throw new Error('bridge rejected')};await assert.rejects(()=>terminal.sendInput(bound,'keep'),/bridge rejected/);

// A background/occluded WebKit page must still open its PTY if no paint callback arrives.
let paintDeadline,paintResolved=false,paintCancels=0;const paintContext={setTimeout:fn=>{paintDeadline=fn;return 1},clearTimeout(){},requestAnimationFrame:()=>2,cancelAnimationFrame:()=>paintCancels++};vm.createContext(paintContext);vm.runInContext(source.slice(source.indexOf('  function nextTerminalPaint('),source.indexOf('  async function connect(')),paintContext);const paint=paintContext.nextTerminalPaint().then(()=>paintResolved=true);assert.equal(paintResolved,false);paintDeadline();await paint;assert.equal(paintResolved,true);assert.equal(paintCancels,2);

// Existing Enter conventions also apply to shell input, including IME and expanded editing.
let submitted=0;const keys={event:null,window:{OpenSesameComposer:{full:false}},input:()=>el('capture-input'),el,menu:()=>el('capture-commands'),matches:[],state:{scenario:'terminal'}};el('capture-commands').hidden=true;el('capture-form').requestSubmit=()=>submitted++;
vm.createContext(keys);const start=capture.indexOf("  input().addEventListener('keydown'");vm.runInContext(capture.slice(start,capture.indexOf("  el('capture-project').addEventListener",start)),keys);
assert.equal(el('capture-input').emit('keydown',{key:'Enter'}).defaultPrevented,true);assert.equal(submitted,1);keys.hide=()=>{};el('capture-input').emit('keydown',{key:'Enter',shiftKey:true});el('capture-input').emit('keydown',{key:'Enter',isComposing:true});assert.equal(submitted,1);keys.window.OpenSesameComposer.full=true;el('capture-input').emit('keydown',{key:'Enter'});assert.equal(submitted,1);el('capture-input').emit('keydown',{key:'Enter',metaKey:true});assert.equal(submitted,2);
console.log('Shell routing, exact PTY binding and bytes, per-pane/capture/launcher drafts, asynchronous failure/races, inactive/web refusal, and Enter/IME conventions passed. Transport and DOM are synthetic; the full suite separately exercises real PTYs.');
