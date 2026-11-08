import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('dist/sign-in.js','utf8'),flush=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(native=true){
  const nodes=new Map();class Node extends EventTarget{constructor(){super();this.hidden=false;this.disabled=false;this.textContent=''}click(){if(!this.disabled)this.dispatchEvent(new Event('click'))}}
  const el=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id)};
  const window=new EventTarget(),calls=[],location={href:'https://fixture.invalid/'};window.__OPEN_SESAME_NATIVE__=native;
  let status={busy:false,message:'Sign in to continue.'},reject=false;
  const bridge={ready:Promise.resolve(),async request(method){calls.push(method);if(reject)throw Error('synthetic-private-provider-error');if(method==='auth.status')return status;if(method==='auth.signIn')status={busy:true,message:'Finish signing in in your browser.'};if(method==='auth.cancel')status={busy:false,message:'Sign in to continue.'};return true}};
  vm.runInNewContext(source,{window,document:{getElementById:el},location,openSesameBridge:bridge});await flush();
  return {el,window,calls,location,set reject(value){reject=value}};
}
const native=await fixture();assert.deepEqual(native.calls,['auth.status'],'Sign-in is always explicit');
native.el('sign-in').click();await flush();assert.equal(native.el('sign-in').disabled,true);assert.equal(native.el('sign-in-cancel').hidden,false);const count=native.calls.length;native.el('sign-in').click();await flush();assert.equal(native.calls.length,count,'Repeated sign-in clicks do not start parallel flows');
native.el('sign-in-cancel').click();await flush();assert.equal(native.el('sign-in').disabled,false);assert.equal(native.el('sign-in-cancel').hidden,true);assert.ok(native.calls.includes('auth.cancel'));
native.reject=true;native.el('sign-in').click();await flush();assert.equal(native.el('sign-in').disabled,false);assert.match(native.el('sign-in-status').textContent,/could not open/);assert.ok(!native.el('sign-in-status').textContent.includes('synthetic-private'));
const browser=await fixture(false);assert.deepEqual(browser.calls,[]);browser.el('sign-in').click();assert.equal(browser.location.href,'opensesame://auth/login');
const swift=fs.readFileSync('desktop/OpenSesame.swift','utf8'),auth=fs.readFileSync('desktop/Authentication.swift','utf8');
const guard=swift.indexOf('guard authentication.authenticated || method == "window.focus"');assert.ok(guard>=0&&guard<swift.indexOf('if method.hasPrefix("webview.")'),'Login guard must run before tool handlers');
assert.ok(swift.includes('if !appUnlocked {')&&swift.includes('showSignIn()')&&swift.includes('authentication.restore()'));
assert.ok(auth.includes('session.authenticateVerified()')&&auth.includes('ticket == epoch')&&auth.includes('kSecAttrAccessibleWhenUnlockedThisDeviceOnly'));
assert.ok(!/localStorage|sessionStorage|print\(/.test(auth),'Native credentials stay outside browser storage and logs');
const html=fs.readFileSync('dist/index.html','utf8');assert.ok(!html.includes('focus-overview.js')&&!html.includes('id="focus-overview"'));assert.ok(html.includes('lockin-tabs console-mode-tabs')&&html.includes('agents-mode-tabs console-mode-tabs'));
for(const id of ['terminal-pane-list','remote-rail-list','familiar-list'])assert.match(html,new RegExp('id="'+id+'"[^>]*aria-orientation="vertical"'));
assert.ok(fs.readFileSync('dist/focus-overview.css','utf8').includes(':not([aria-orientation=vertical])'),'Horizontal tab styling must exclude all vertical rails');
// A delayed privileged response from the old page cannot resolve a signed-out page's new request.
function transport(){
  const window=new EventTarget(),sent=[],timers=new Map();let next=0;
  window.__OPEN_SESAME_NATIVE__=true;window.webkit={messageHandlers:{openSesame:{postMessage:message=>sent.push(message)}}};
  vm.runInNewContext(fs.readFileSync('dist/bridge.js','utf8'),{window,document:{documentElement:{classList:{add(){}}}},CustomEvent,setTimeout:fn=>{timers.set(++next,fn);return next},clearTimeout:id=>timers.delete(id)});
  return {window,sent};
}
const oldPage=transport(),newPage=transport();assert.notEqual(oldPage.sent[0].requestId,newPage.sent[0].requestId);
newPage.window.__openSesameReceive({requestId:oldPage.sent[0].requestId,result:{private:'old result'}});await flush();assert.equal(newPage.window.openSesameBridge.available,false);
newPage.window.__openSesameReceive({requestId:newPage.sent[0].requestId,result:{authenticated:false}});await newPage.window.openSesameBridge.ready;assert.equal(newPage.window.openSesameBridge.available,true);
console.log('Explicit native login, Cancel, duplicate-click/error recovery, browser handoff, native gateway/storage boundaries, Focus tabs and three vertical rail declarations passed. UI transports are simulated.');
