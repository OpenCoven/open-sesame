import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
class Node {constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.handlers={};this.value='';this.checked=false}append(...nodes){this.children.push(...nodes)}addEventListener(event,fn){this.handlers[event]=fn}setAttribute(k,v){this[k]=v}focus(){}remove(){this.removed=true}replaceChildren(){this.children=[]}querySelectorAll(){return this.children.filter(x=>x.tagName==='button')}requestFullscreen(){return Promise.resolve()}}
const events={},calls=[],statuses=[];let client;
class RFB {constructor(target,channel){client=this;this.channel=channel;this.events={};this.scaleViewport=false;this.viewOnly=false}addEventListener(n,f){this.events[n]=f}disconnect(){this.events.disconnect?.({detail:{clean:true}})}blur(){this.blurred=true}sendCtrlAltDel(){this.sentKey=true}clipboardPasteFrom(v){this.sentClipboard=v}sendCredentials(v){this.credentials=v}}
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

// Reproduce delayed host responses and retired-session callbacks without real desktops.
window.__OPEN_SESAME_NATIVE__=true;
let resolveOpen;
context.openSesameBridge.request=(method,p)=>{calls.push([method,p]);return method==='vnc.open'?new Promise(resolve=>resolveOpen=resolve):Promise.resolve('')};
const canceledStage=new Node('div');
const canceledOpen=window.OpenSesameVNC.open({id:'cancel',kind:'direct',host:'localhost',port:5900},canceledStage,()=>{});
await new Promise(setImmediate);
const retired=client;
window.OpenSesameVNC.close('cancel');
resolveOpen({token:'late-token'});await canceledOpen;
assert.ok(calls.some(([method,p])=>method==='vnc.close'&&p.token==='late-token'),'Cancellation must close a socket whose token arrives late');
context.openSesameBridge.request=async(method,p)=>{calls.push([method,p]);return method==='vnc.open'?{token:'new-token'}:''};
await window.OpenSesameVNC.open({id:'cancel',kind:'direct',host:'localhost',port:5900},new Node('div'),()=>{});
retired.events.disconnect({detail:{clean:false}});
await assert.rejects(window.OpenSesameVNC.open({id:'cancel',kind:'direct'},new Node('div'),()=>{}),/already open/,'Old callbacks must not delete a replacement session');
window.OpenSesameVNC.close('cancel');
let resolveCredential;
context.openSesameBridge.request=(method,p)=>{calls.push([method,p]);return method==='vnc.credential.read'?new Promise(resolve=>resolveCredential=resolve):Promise.resolve(method==='vnc.open'?{token:'auth-token'}:'')};
const authStage=new Node('div');await window.OpenSesameVNC.open({id:'auth',kind:'direct',host:'localhost',port:5900},authStage,()=>{});
const authPending=client.events.credentialsrequired({detail:{types:['password']}});
window.OpenSesameVNC.close('auth');resolveCredential(JSON.stringify({password:'synthetic-local-value'}));await authPending;
assert.ok(!authStage.children.some(n=>n.tagName==='form'),'Canceled credential lookup must not mount a stale form');
console.log('VNC cancellation race, replacement-session isolation and stale credential-form regressions passed.');

let resolveEarly;
context.openSesameBridge.request=(method,p)=>{calls.push([method,p]);return method==='vnc.open'?new Promise(resolve=>resolveEarly=resolve):Promise.resolve('')};
const earlyOpen=window.OpenSesameVNC.open({id:'early',kind:'direct',host:'localhost',port:5900},new Node('div'),()=>{});
await new Promise(setImmediate);
let bytesReceived=0;client.channel.onmessage=event=>bytesReceived+=event.data.byteLength;
events['open-sesame-desktop-event']({detail:{event:'vnc.open',id:'early',token:'early-token'}});
events['open-sesame-desktop-event']({detail:{event:'vnc.data',id:'early',token:'early-token',data:'AA=='}});
resolveEarly({token:'early-token'});await earlyOpen;
assert.equal(bytesReceived,1,'Early native bytes must wait for their bound token');
window.OpenSesameVNC.close('early');
console.log('VNC early native event buffering and token binding passed.');
