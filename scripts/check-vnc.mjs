import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
class Node {constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.handlers={};this.value='';this.checked=false}append(...nodes){this.children.push(...nodes)}addEventListener(event,fn){this.handlers[event]=fn}setAttribute(k,v){this[k]=v}focus(){}remove(){this.removed=true}replaceChildren(){this.children=[]}querySelectorAll(){return this.children.filter(x=>x.tagName==='button')}requestFullscreen(){return Promise.resolve()}}
const events={},calls=[],statuses=[];let client;
class RFB {constructor(){client=this;this.events={};this.scaleViewport=false;this.viewOnly=false}addEventListener(n,f){this.events[n]=f}disconnect(){this.events.disconnect?.({detail:{clean:true}})}blur(){this.blurred=true}sendCtrlAltDel(){this.sentKey=true}clipboardPasteFrom(v){this.sentClipboard=v}sendCredentials(v){this.credentials=v}}
const window={addEventListener:(n,f)=>events[n]=f,__OPEN_SESAME_NATIVE__:true};
const context={window,document:{createElement:n=>new Node(n),createTextNode:s=>s},openSesameBridge:{request:async(method,p)=>{calls.push([method,p]);return method==='vnc.open'?{token:'fixture'}:''}},setTimeout,clearTimeout,Uint8Array,ArrayBuffer,btoa,atob,toast(){},MockRFB:RFB};vm.createContext(context);
const source=fs.readFileSync('dist/vnc-client.js','utf8').replace("await import('./vendor/novnc/rfb.js')",'({default:MockRFB})');vm.runInContext(source,context);
const stage=new Node('div');await window.OpenSesameVNC.open({id:'one',kind:'direct',host:'localhost',port:5900},stage,s=>statuses.push(s));
assert.equal(calls[0][0],'vnc.open');assert.equal(statuses.at(-1),'Connecting');client.events.connect();assert.equal(statuses.at(-1),'Connected');
const toolbar=stage.children[0],button=name=>toolbar.children.find(b=>b.textContent===name);
button('View only').handlers.click({currentTarget:button('View only')});assert.equal(client.viewOnly,true);button('Ctrl Alt Del').handlers.click();assert.equal(client.sentKey,undefined);
button('View only').handlers.click({currentTarget:button('View only')});button('Ctrl Alt Del').handlers.click();assert.equal(client.sentKey,true);
events['open-sesame-desktop-event']({detail:{event:'vnc.open',id:'one',token:'fixture'}});
events['open-sesame-desktop-event']({detail:{event:'vnc.data',id:'one',token:'stale',data:'AA=='}});assert.equal(calls.filter(c=>c[0]==='vnc.ack').length,0);
events['blur']();assert.equal(client.blurred,true);window.OpenSesameVNC.close('one');assert.equal(statuses.at(-1),'Disconnected');assert.ok(calls.some(c=>c[0]==='vnc.close'));
window.__OPEN_SESAME_NATIVE__=false;await assert.rejects(window.OpenSesameVNC.open({id:'two',kind:'direct'},new Node('div'),()=>{}),/Mac app/);
console.log('VNC controller: handshake-derived status, view-only input gating, stale tokens, focus release, cleanup and browser direct-connection refusal passed (mock RFB; real rendering separate).');
