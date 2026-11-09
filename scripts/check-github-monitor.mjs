import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(native=true){
  const nodes=new Map(),window=new EventTarget(),calls=[],timers=new Map(),copied=[];let sequence=0,document;
  class Node extends EventTarget{
    constructor(){super();this.hidden=false;this.disabled=false;this.value='';this.textContent='';this.children=[];this.dataset={};this.attrs={};this.isConnected=true;this.classes=new Set();this.classList={add:c=>this.classes.add(c),remove:c=>this.classes.delete(c),toggle:(c,on)=>on?this.classes.add(c):this.classes.delete(c)};}
    querySelector(){return null}querySelectorAll(){return []}setAttribute(k,v){this.attrs[k]=String(v)}getAttribute(k){return this.attrs[k]??null}append(...n){this.children.push(...n)}replaceChildren(...n){this.children=[...n]}focus(){document.activeElement=this}click(){if(!this.disabled)this.dispatchEvent(new Event('click'))}
  }
  const get=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id)};
  document=new EventTarget();document.getElementById=get;document.createElement=()=>new Node();document.querySelectorAll=()=>[];document.visibilityState='visible';get('github-monitor').hidden=true;
  get('github-monitor-repository').parentElement=new Node();get('pane-plugins').querySelector=()=>get('current-github-card');
  let repos=['Owner/Project'],login='fixture-user',handler=null;
  const data=repo=>({repository:repo,description:'Fixture project',private:true,branch:'main',url:'https://github.com/'+repo,updatedAt:1000,sections:{pulls:{entries:[{id:1,title:'<script>Plain title</script>',subtitle:'fixture',state:'open',url:'https://github.com/'+repo+'/pull/1'},{id:2,title:'Bad link',subtitle:'fixture',state:'open',url:'javascript:alert(1)'}]},issues:{entries:[]},runs:{entries:[{id:99,title:'Build',subtitle:'main',state:'success',url:'https://github.com/'+repo+'/actions/runs/99'}]}}});
  const bridge={available:true,request:async(method,params)=>{calls.push({method,params});if(method==='window.size')return true;if(handler)return handler(method,params);if(method==='github.status')return {authenticated:true,account:login,repositories:[...repos]};if(method==='github.snapshot')return data(params.repository);if(method==='github.add'){repos.push('Other/Repo');return {repository:'Other/Repo',repositories:[...repos]}}if(method==='github.remove'){repos=repos.filter(r=>r!==params.repository);return {repositories:[...repos]}}throw Error('Unexpected request') }};
  window.__OPEN_SESAME_NATIVE__=native;window.openSesameBridge=bridge;
  const localStorage={getItem:()=>null,setItem(){}};const state={expanded:true,scenario:'plugins',layout:'notch',size:'small'},context={localStorage,confirm:()=>true,URL,window,document,state,Event,Date,setTimeout:fn=>{timers.set(++sequence,fn);return sequence},clearTimeout:id=>timers.delete(id),navigator:{clipboard:{writeText:async s=>copied.push(s)}},toast(){}};
  vm.createContext(context);vm.runInContext(fs.readFileSync('dist/github-viewer.js','utf8'),context);const preview=window.OpenSesameGitHub;
  vm.runInContext(fs.readFileSync('dist/github-monitor-model.js','utf8'),context);
  vm.runInContext(fs.readFileSync('dist/github-monitor.js','utf8'),context);
  assert.equal(window.OpenSesameGitHub,preview,'Monitoring must not replace the repository-preview API used during every widget render');
  assert.equal(typeof window.OpenSesameGitHub.render,'function');
  context.$=get;context.currentItem=()=>null;context.detailEditor={layout(){}};context.libraryOpen=false;
  const source=fs.readFileSync('dist/app.js','utf8');vm.runInContext(source.slice(source.indexOf('function setBookmarkPreview('),source.indexOf('function closeBookmarkUrl(')),context);
  vm.runInContext(source.slice(source.indexOf('function syncNativeWindow('),source.indexOf('function setExpanded(')),context);
  context.OpenSesameLauncher=window.OpenSesameLauncher;context.openSesameBridge=bridge;get('widget-anchor').style={getPropertyValue:key=>key==='--panel-width'?'800px':'450px'};
  vm.runInContext('setBookmarkPreview(false); syncNativeWindow();',context);
  if(native){assert.equal(calls.at(-1).method,'window.size');assert.equal(calls.at(-1).params.height,450,'A complete render must resize beyond the 35px initial native frame');calls.length=0}
  return {get,window,document,calls,timers,copied,state,data,set handler(value){handler=value},set login(value){login=value}};
}
let e=fixture();assert.equal(e.calls.length,0,'No background account discovery before opening the widget');e.window.OpenSesameGitHubMonitor.open(e.get('source'));await flush();await flush();
assert.deepEqual(e.calls.map(c=>c.method),['github.status','github.snapshot']);assert.equal(e.get('github-monitor-account').textContent,'@fixture-user · Read only');assert.equal(e.get('github-monitor-cards').children.length,3);assert.equal(e.get('github-monitor-cards').children[0].children[1].children.length,1,'Untrusted link origins are excluded');assert.equal(e.get('github-monitor-cards').children[0].children[1].children[0].children[0].children[0].textContent,'<script>Plain title</script>','Provider titles are plain text');assert.equal(e.timers.size,1);
e.document.visibilityState='hidden';e.document.dispatchEvent(new Event('visibilitychange'));assert.equal(e.timers.size,0);e.document.visibilityState='visible';e.document.dispatchEvent(new Event('visibilitychange'));await flush();await flush();assert.equal(e.timers.size,1);
e.get('github-monitor-repository-input').value='Other/Repo';e.get('github-monitor-add-form').dispatchEvent(new Event('submit',{cancelable:true}));await flush();await flush();assert.equal(e.get('github-monitor-project-name').textContent,'Other/Repo');assert.equal(e.get('github-monitor-repository-input').value,'');e.get('github-monitor-remove').click();await flush();await flush();assert.equal(e.get('github-monitor-project-name').textContent,'Owner/Project');
e.state.expanded=false;e.window.dispatchEvent(new Event('open-sesame-layout'));assert.equal(e.timers.size,0);e.state.expanded=true;e.window.dispatchEvent(new Event('open-sesame-layout'));await flush();await flush();assert.equal(e.timers.size,1);
let finish;e.handler=()=>new Promise(resolve=>finish=resolve);e.get('github-monitor-refresh').click();await flush();e.window.OpenSesameGitHubMonitor.close();finish({authenticated:true,account:'late-user',repositories:['Old/Repo']});await flush();assert.equal(e.get('github-monitor').hidden,true);assert.equal(e.timers.size,0,'Late requests cannot reopen or restart a closed widget');
assert.equal(e.document.activeElement,e.get('current-github-card'),'Back reacquires the newly rendered catalog card for keyboard focus');
e=fixture();e.handler=async()=>({authenticated:false,installed:false,repositories:[],code:'install',error:'Install GitHub CLI first.'});e.window.OpenSesameGitHubMonitor.open();await flush();assert.equal(e.get('github-monitor-setup').hidden,false);assert.equal(e.get('github-monitor-add').disabled,true);e.get('github-monitor-copy-login').click();await flush();assert.equal(e.copied[0],'gh auth login --hostname github.com --web --git-protocol https');assert.equal(e.calls.length,1,'Copying the sign-in guide never runs a shell or OAuth command');
assert.equal(e.get('github-monitor-add-form').hidden,true);assert.equal(e.get('github-monitor-repository').parentElement.hidden,true);assert.equal(e.get('github-monitor-empty').hidden,true,'Signed-out setup has one clear happy path without redundant empty controls');
e=fixture(false);e.window.OpenSesameGitHubMonitor.open();await flush();assert.equal(e.calls.length,0);assert.match(e.get('github-monitor-error').textContent,/Mac app/);
e=fixture();e.window.OpenSesameGitHubMonitor.open();await flush();await flush();e.window.dispatchEvent(new Event('open-sesame-desktop-disconnected'));assert.equal(e.timers.size,0);assert.equal(e.get('github-monitor-project').hidden,true);assert.equal(e.window.OpenSesameGitHubMonitor.snapshot().connected,false);
const model={window:{}};vm.runInNewContext(fs.readFileSync('dist/plugins-model.js','utf8'),model);const p=model.window.OpenSesamePluginsModel.catalog.find(p=>p.id==='github');assert.equal(p.kind,'github');assert.equal(model.window.OpenSesamePluginsModel.setup(p).steps.length,3);assert.match(fs.readFileSync('dist/github-monitor.css','utf8'),/max-width:540px/);
console.log('GitHub widget explicit opening, read-only states, safe text/links, local repo controls, visible-only polling, stale close/disconnect handling and sign-in guidance passed with synthetic data.');
