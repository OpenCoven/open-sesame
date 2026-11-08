import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
const source=fs.readFileSync('dist/music-auth.js','utf8'),modelSource=fs.readFileSync('dist/music-auth-model.js','utf8');
const sandbox={window:{},URL,URLSearchParams,atob,btoa};vm.createContext(sandbox);vm.runInContext(modelSource,sandbox);vm.runInContext(fs.readFileSync('dist/plugins-model.js','utf8'),sandbox);
const model=sandbox.window.OpenSesameMusicAuthModel,plugins=sandbox.window.OpenSesamePluginsModel;
const synthetic='SYNTHETIC-PRIVATE-FIXTURE',publicID='0123456789abcdef0123456789abcdef';
assert.deepEqual(Object.keys(model.publicConfig({spotifyClientId:publicID,clientSecret:synthetic,appleDeveloperToken:synthetic})).sort(),['googleClientId','spotifyClientId']);
assert.equal(JSON.stringify(model.publicConfig({appleDeveloperToken:synthetic,accessToken:synthetic})).includes(synthetic),false);assert.equal(model.publicConfig(null).spotifyClientId,'');
assert.equal(model.environment({protocol:'file:'},true).supported,false);assert.equal(model.environment({protocol:'http:'}).supported,false);assert.equal(model.environment({protocol:'https:'}).supported,true);
assert.equal(model.publicError(Error('SDK diagnostic '+synthetic)).includes(synthetic),false);assert.equal(model.publicError(Error('Sign-in cancelled.')),'Sign-in cancelled.');
for(const input of ['https://app.example/?code='+synthetic+'&state=nonce&keep=yes#section','https://app.example/#access_token='+synthetic+'&refresh_token='+synthetic,'https://app.example/?client_secret='+synthetic+'&code_verifier='+synthetic]){const url=new URL(input);assert.equal(model.stripOAuthParameters(url),true);assert.equal(url.href.includes(synthetic),false)}
const unrelated=new URL('https://app.example/?keep=yes#section');assert.equal(model.stripOAuthParameters(unrelated),false);assert.equal(unrelated.hash,'#section');
for(const plugin of plugins.catalog){const setup=plugins.setup(plugin,{});assert.equal(setup.steps.length,3,plugin.id);assert.ok(setup.repair);assert.ok(setup.note);assert.equal(JSON.stringify(setup).includes(synthetic),false)}
for(const id of ['spotify','apple','youtube']){const plugin=plugins.catalog.find(p=>p.id===id);assert.ok(plugin.docs.startsWith('https://'));assert.equal(plugins.status(plugin,{music:{[id]:{supported:false,configured:true}}}).label,'Browser sign-in required')}

class Element{
  constructor(id=''){this.id=id;this.hidden=true;this.value='';this.textContent='';this.handlers={};this.attrs={};this.children=[];this.classList={toggle(){},add(){},remove(){}};}
  addEventListener(name,fn){(this.handlers[name]??=[]).push(fn)}
  emit(name,extra={}){const event={target:this,preventDefault(){},stopPropagation(){},...extra};for(const fn of this.handlers[name]||[])fn(event)}
  setAttribute(k,v){this.attrs[k]=String(v)}getAttribute(k){return this.attrs[k]||null}
  querySelector(){return this.child??=new Element()}contains(n){return n===this}focus(){}select(){}append(...nodes){this.children.push(...nodes)}
}
function environment({native=false,url='https://app.example/',badSDK=false}={}){
  const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id)},document=new Element(),storage=new Map(),pending=new Map(),sdkCalls=[],toasts=[],history=[];
  document.getElementById=el;document.createElement=()=>new Element();document.head=new Element();
  const nativeCalls=[];const window=new Element();if(native)window.openSesameBridge={ready:Promise.resolve({available:true}),request:async(method,params)=>{nativeCalls.push({method,params});return {connected:false,busy:method==='music.spotify.signIn',clientId:publicID}}};window.__OPEN_SESAME_NATIVE__=native;window.OpenSesameMusicAuthConfig={spotifyClientId:publicID,appleDeveloperToken:synthetic};window.OpenSesameMusic={service:'spotify',choose(){}};window.dispatchEvent=()=>{};
  const instance={isAuthorized:false,authorize:async()=>{throw Error(synthetic)},unauthorize:async()=>{throw Error(synthetic)}};
  window.MusicKit={configure:async config=>{sdkCalls.push(config);if(badSDK)throw Error(synthetic)},getInstance:()=>instance};
  const context={window,document,location:Object.assign(new URL(url),{assign(){}}),history:{replaceState:(_a,_b,value)=>history.push(value)},navigator:{clipboard:{writeText:async()=>{}}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},sessionStorage:{getItem:k=>pending.get(k)||null,removeItem:k=>pending.delete(k),setItem:(k,v)=>pending.set(k,v)},setInterval(){},setTimeout,clearTimeout,URL,URLSearchParams,atob,btoa,Event,toast:text=>toasts.push(text),state:{scenario:'plugins'}};
  vm.createContext(context);vm.runInContext(modelSource,context);window.OpenSesameMusicAuthProviders={spotifyExchange:async()=>{throw Error(synthetic)},appleAuthorize:async()=>{throw Error(synthetic)}};vm.runInContext(source,context);
  return {window,el,storage,pending,sdkCalls,toasts,history,nativeCalls};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const jwt='eyJhbGciOiJFUzI1NiJ9.'+Buffer.from(JSON.stringify({exp:Date.now()/1000+600,origin:'https://app.example'})).toString('base64url')+'.syntheticSignature';
let e=environment();e.window.OpenSesameMusicAuth.providerChanged('apple');assert.equal(e.window.OpenSesameMusicAuth.snapshot().apple.configured,false,'Bundled developer tokens are ignored');
e.el('music-account-config-value').value=jwt;e.el('music-account-config').emit('submit');await flush();assert.equal(e.el('music-account-config-value').type,'password');assert.equal(e.el('music-account-config-value').value,'');assert.equal(e.window.OpenSesameMusicAuth.snapshot().apple.configured,true);assert.equal([...e.storage.values()].some(v=>v.includes(jwt)),false);assert.equal(JSON.stringify(e.window.OpenSesameMusicAuth.snapshot()).includes(jwt),false);
e.el('music-account-toggle').emit('click');assert.equal(e.el('music-account-config-value').value,'','Reopening never repopulates the token field');e.el('music-account-config-value').value=synthetic;e.el('music-account-close').emit('click');assert.equal(e.el('music-account-config-value').value,'');
e.el('music-account-disconnect').emit('click');await flush();assert.equal(e.window.OpenSesameMusicAuth.snapshot().apple.configured,false,'Disconnect drops app-held token even when provider cleanup rejects');
e=environment({badSDK:true});e.window.OpenSesameMusicAuth.providerChanged('apple');e.el('music-account-config-value').value=jwt;e.el('music-account-config').emit('submit');await flush();assert.equal(e.el('music-account-error').textContent.includes(synthetic),false);assert.equal(JSON.stringify(e.window.OpenSesameMusicAuth.snapshot()).includes(synthetic),false);
e=environment({native:true,url:'file:///bundled/index.html'});e.window.OpenSesameMusicAuth.providerChanged('apple');e.el('music-account-config-value').value=jwt;e.el('music-account-config').emit('submit');await flush();assert.equal(e.sdkCalls.length,0);assert.equal(e.storage.size,0);assert.equal(e.el('music-account-connect').disabled,true);assert.equal(e.el('music-account-origin').value,'');assert.equal(e.el('music-account-setup').hidden,true);assert.equal(e.el('music-account-config-value').value,'');
e=environment({native:true,url:'file:///bundled/index.html'});await flush();assert.equal(e.window.OpenSesameMusicAuth.snapshot().spotify.supported,true);assert.equal(e.el('music-account-origin').value,'opensesame-spotify://auth/callback');e.el('music-account-connect').emit('click');await flush();assert.ok(e.nativeCalls.some(c=>c.method==='music.spotify.signIn'));assert.equal(e.pending.size,0,'Native PKCE does not store a verifier in the page');assert.equal(e.history.length,0);e.el('music-account-disconnect').emit('click');await flush();assert.ok(e.nativeCalls.some(c=>c.method==='music.spotify.disconnect'));
e=environment({url:'https://app.example/?code='+synthetic+'&state=expired'});await flush();assert.equal(e.history.length,1);assert.equal(e.history[0].includes(synthetic),false,'Stale or unsolicited callbacks are cleaned before validation');

const result=spawnSync('python3',['-B','-c',String.raw`
from pathlib import Path
import tempfile,sys
sys.path.insert(0,str(Path('scripts').resolve()))
from distribution_safety import private_path,validate_dist
assert all(private_path(p) for p in ['desktop/.env','desktop/.env.local','dist/key.p8','credentials/auth.json','client_secret_fixture.json'])
assert not private_path('dist/music-auth-config.js')
validate_dist(Path('dist'))
with tempfile.TemporaryDirectory() as directory:
    root=Path(directory);private=root/'fixture.p8';private.write_text('SYNTHETIC PRIVATE FIXTURE')
    try:validate_dist(root)
    except ValueError as error:assert 'SYNTHETIC' not in str(error)
    else:raise AssertionError('Private file was accepted')
    private.unlink();(root/'asset.js').write_text('-----BEGIN PRIVATE KEY-----\nSYNTHETIC\n-----END PRIVATE KEY-----')
    try:validate_dist(root)
    except ValueError as error:assert 'SYNTHETIC' not in str(error)
    else:raise AssertionError('Private key was accepted')
    (root/'asset.js').unlink();(root/'music-auth-config.js').write_text("'use strict';window.OpenSesameMusicAuthConfig=Object.freeze({spotifyClientId:'',googleClientId:'',developerToken:'SYNTHETIC'});")
    try:validate_dist(root)
    except ValueError as error:assert 'SYNTHETIC' not in str(error)
    else:raise AssertionError('Nonpublic setting was accepted')
`],{encoding:'utf8',timeout:15000});assert.equal(result.status,0,result.stderr);
console.log('Plugin setup for seven integrations, host gating, masked session fields, memory-only token use, safe errors, callback cleanup, and private distribution exclusions passed with synthetic data.');
