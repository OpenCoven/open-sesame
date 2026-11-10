import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class Element {
  constructor(){this.handlers={};this.hidden=false;this.disabled=false;this.value='';this.open=false;this.dataset={};this.attrs={};this.children=[]}
  addEventListener(name,fn){this.handlers[name]=fn}emit(name,event={}){return this.handlers[name]?.(event)}
  setAttribute(name,value){this.attrs[name]=value}replaceChildren(...children){this.children=children;this.value=children[0]?.value||''}
  showModal(){this.open=true}close(){this.open=false}
}
const source=fs.readFileSync('dist/privacy.js','utf8'),flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve()};
const idle={available:true,active:false,starting:false,windowOpen:false,revision:0,error:'',displays:[{id:1,name:'Main',width:1512,height:982},{id:2,name:'External',width:1920,height:1080}]};
function load(native){
  const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)},events=new Map(),calls=[];
  const document={getElementById:el,createElement:()=>new Element(),addEventListener:(name,fn)=>events.set('document:'+name,fn)};
  let result=()=>Promise.resolve({...idle}),expanded=0;
  const window={__OPEN_SESAME_NATIVE__:native,addEventListener:(name,fn)=>events.set(name,fn),openSesameBridge:{ready:Promise.resolve({available:native}),request:(method,params)=>{calls.push({method,params});return result(method,params)}}};
  vm.runInNewContext(source,{window,document,setExpanded:()=>expanded++});
  return {el,events,calls,setResult:fn=>result=fn,get expanded(){return expanded},event:status=>events.get('open-sesame-desktop-event')({detail:{event:'privacy.changed',status}})};
}
const browser=load(false);await flush();browser.el('privacy-hide').emit('click');await flush();assert.equal(browser.calls.length,0,'Browser information and loading never start capture');assert.equal(browser.el('share-privacy-native').hidden,true);assert.equal(browser.el('share-privacy-browser').hidden,false);
const app=load(true);await flush();assert.deepEqual(app.calls.map(c=>c.method),['privacy.status'],'Native initialization reads status only');assert.equal(app.el('share-privacy-start').disabled,false);assert.equal(app.el('panel-privacy').attrs['aria-pressed'],'false');
app.el('panel-privacy').emit('click');await flush();assert.equal(app.expanded,1);assert.equal(app.el('share-privacy').open,true);assert.ok(app.calls.every(c=>c.method==='privacy.status'));
app.el('share-privacy-display').value='2';let finishStart;
app.setResult(method=>method==='privacy.start'?new Promise(resolve=>finishStart=resolve):Promise.resolve({...idle,revision:4}));
const starting=app.el('share-privacy-start').emit('click');await flush();const start=app.calls.find(c=>c.method==='privacy.start');assert.equal(start.params.displayID,2,'Only explicit Start sends the selected display');assert.equal(app.el('share-privacy-stop').hidden,false,'Pending permission can be cancelled');
app.event({...idle,starting:true,revision:2});assert.equal(app.el('panel-privacy').attrs['aria-pressed'],'false','Preparing a stream is not a ready protection state');
await app.el('share-privacy-stop').emit('click');await flush();finishStart({...idle,active:true,windowOpen:true,revision:3});await starting;await flush();assert.equal(app.el('panel-privacy').attrs['aria-pressed'],'false','Late completion cannot restore a cancelled share');
app.event({...idle,active:true,windowOpen:true,displayID:2,revision:7});assert.equal(app.el('panel-privacy').attrs['aria-pressed'],'true');assert.equal(app.el('share-privacy-show').hidden,false);assert.equal(app.el('share-privacy-display').value,'2','Restored active output identifies the display actually being captured');
assert.equal(app.el('share-privacy-fullscreen').hidden,false);app.setResult(()=>Promise.resolve({...idle,active:true,windowOpen:true,displayID:2,revision:7,fullscreen:true}));await app.el('share-privacy-fullscreen').emit('click');await flush();assert.ok(app.calls.some(c=>c.method==='privacy.fullscreen'));assert.equal(app.el('share-privacy-fullscreen').textContent,'Exit full screen');
app.event({...idle,starting:true,revision:6});assert.equal(app.el('panel-privacy').attrs['aria-pressed'],'true','Stale status cannot replace a newer frame state');
app.event({...idle,revision:8,error:'Display configuration changed.'});assert.equal(app.el('panel-privacy').attrs['aria-pressed'],'false');assert.equal(app.el('share-privacy-error').textContent,'Display configuration changed.');
app.events.get('open-sesame-desktop-disconnected')();assert.equal(app.el('share-privacy-start').disabled,true);assert.equal(app.el('panel-privacy').attrs['aria-pressed'],'false');
const closing=load(true);await flush();let finishClosed;
closing.setResult(method=>method==='privacy.start'?new Promise(resolve=>finishClosed=resolve):Promise.resolve({...idle,revision:4}));
const preparation=closing.el('share-privacy-start').emit('click');closing.event({...idle,starting:true,windowOpen:true,revision:2});closing.event({...idle,revision:4});
assert.equal(closing.el('share-privacy-start').hidden,false);assert.equal(closing.el('share-privacy-start').disabled,false,'Closing the native black window clears pending preparation immediately');
finishClosed({...idle,active:true,windowOpen:true,revision:3});await preparation;await flush();assert.equal(closing.el('panel-privacy').attrs['aria-pressed'],'false');
const html=fs.readFileSync('dist/index.html','utf8'),swift=fs.readFileSync('desktop/ProtectedShare.swift','utf8');
assert.ok(html.includes('Present now → A window')&&html.includes('Sharing your entire screen can still show Open Sesame.')&&html.includes('physically looking at your monitor'));
assert.ok(swift.includes('excludingApplications: excluded, exceptingWindows: []')&&swift.includes('configuration.capturesAudio = false')&&!swift.includes('sharingType = .none'));
console.log('Protected share: no automatic capture, browser/native capability, explicit selected-display start, permission cancellation, late/stale state refusal, error/disconnect reset and Meet instructions passed. No screen recording was started.');
