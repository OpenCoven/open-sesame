import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(native=true){
  const nodes=new Map(),window=new EventTarget(),calls=[],timers=new Map(),copied=[];let sequence=0,document;
  class Node extends EventTarget{
    constructor(){super();this.hidden=false;this.disabled=false;this.value='';this.textContent='';this.children=[];this.dataset={};this.attrs={};this.isConnected=true;this.classes=new Set();this.classList={add:c=>this.classes.add(c),remove:c=>this.classes.delete(c)};}
    setAttribute(k,v){this.attrs[k]=String(v)}append(...n){this.children.push(...n)}replaceChildren(...n){this.children=[...n]}focus(){document.activeElement=this}click(){if(!this.disabled)this.dispatchEvent(new Event('click'))}
  }
  const get=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id)};
  document=new EventTarget();document.getElementById=get;document.createElement=()=>new Node();document.visibilityState='visible';get('github-monitor').hidden=true;
  get('github-repository').parentElement=new Node();get('pane-plugins').querySelector=()=>get('current-github-card');
  let repos=['Owner/Project'],login='fixture-user',handler=null;
  const data=repo=>({repository:repo,description:'Fixture project',private:true,branch:'main',url:'https://github.com/'+repo,updatedAt:1000,sections:{pulls:{entries:[{id:1,title:'<script>Plain title</script>',subtitle:'fixture',state:'open',url:'https://github.com/'+repo+'/pull/1'},{id:2,title:'Bad link',subtitle:'fixture',state:'open',url:'javascript:alert(1)'}]},issues:{entries:[]},runs:{entries:[{id:99,title:'Build',subtitle:'main',state:'success',url:'https://github.com/'+repo+'/actions/runs/99'}]}}});
  const bridge={available:true,request:async(method,params)=>{calls.push({method,params});if(handler)return handler(method,params);if(method==='github.status')return {authenticated:true,account:login,repositories:[...repos]};if(method==='github.snapshot')return data(params.repository);if(method==='github.add'){repos.push('Other/Repo');return {repository:'Other/Repo',repositories:[...repos]}}if(method==='github.remove'){repos=repos.filter(r=>r!==params.repository);return {repositories:[...repos]}}throw Error('Unexpected request') }};
  window.__OPEN_SESAME_NATIVE__=native;window.openSesameBridge=bridge;
  const state={expanded:true,scenario:'plugins'},context={window,document,state,Event,Date,setTimeout:fn=>{timers.set(++sequence,fn);return sequence},clearTimeout:id=>timers.delete(id),navigator:{clipboard:{writeText:async s=>copied.push(s)}},toast(){}};
  vm.runInNewContext(fs.readFileSync('dist/github-monitor.js','utf8'),context);
  return {get,window,document,calls,timers,copied,state,data,set handler(value){handler=value},set login(value){login=value}};
}
let e=fixture();assert.equal(e.calls.length,0,'No background account discovery before opening the widget');e.window.OpenSesameGitHub.open(e.get('source'));await flush();await flush();
assert.deepEqual(e.calls.map(c=>c.method),['github.status','github.snapshot']);assert.equal(e.get('github-account').textContent,'@fixture-user · Read only');assert.equal(e.get('github-cards').children.length,3);assert.equal(e.get('github-cards').children[0].children[1].children.length,1,'Untrusted link origins are excluded');assert.equal(e.get('github-cards').children[0].children[1].children[0].children[0].children[0].textContent,'<script>Plain title</script>','Provider titles are plain text');assert.equal(e.timers.size,1);
e.document.visibilityState='hidden';e.document.dispatchEvent(new Event('visibilitychange'));assert.equal(e.timers.size,0);e.document.visibilityState='visible';e.document.dispatchEvent(new Event('visibilitychange'));await flush();await flush();assert.equal(e.timers.size,1);
e.get('github-repository-input').value='Other/Repo';e.get('github-add-form').dispatchEvent(new Event('submit',{cancelable:true}));await flush();await flush();assert.equal(e.get('github-project-name').textContent,'Other/Repo');assert.equal(e.get('github-repository-input').value,'');e.get('github-remove').click();await flush();await flush();assert.equal(e.get('github-project-name').textContent,'Owner/Project');
e.state.expanded=false;e.window.dispatchEvent(new Event('open-sesame-layout'));assert.equal(e.timers.size,0);e.state.expanded=true;e.window.dispatchEvent(new Event('open-sesame-layout'));assert.equal(e.timers.size,1);
let finish;e.handler=()=>new Promise(resolve=>finish=resolve);e.get('github-refresh').click();await flush();e.window.OpenSesameGitHub.close();finish({authenticated:true,account:'late-user',repositories:['Old/Repo']});await flush();assert.equal(e.get('github-monitor').hidden,true);assert.equal(e.timers.size,0,'Late requests cannot reopen or restart a closed widget');
assert.equal(e.document.activeElement,e.get('current-github-card'),'Back reacquires the newly rendered catalog card for keyboard focus');
e=fixture();e.handler=async()=>({authenticated:false,installed:false,repositories:[],code:'install',error:'Install GitHub CLI first.'});e.window.OpenSesameGitHub.open();await flush();assert.equal(e.get('github-setup').hidden,false);assert.equal(e.get('github-add').disabled,true);e.get('github-copy-login').click();await flush();assert.equal(e.copied[0],'gh auth login --hostname github.com --web --git-protocol https');assert.equal(e.calls.length,1,'Copying the sign-in guide never runs a shell or OAuth command');
assert.equal(e.get('github-add-form').hidden,true);assert.equal(e.get('github-repository').parentElement.hidden,true);assert.equal(e.get('github-empty').hidden,true,'Signed-out setup has one clear happy path without redundant empty controls');
e=fixture(false);e.window.OpenSesameGitHub.open();await flush();assert.equal(e.calls.length,0);assert.match(e.get('github-error').textContent,/Mac app/);
e=fixture();e.window.OpenSesameGitHub.open();await flush();await flush();e.window.dispatchEvent(new Event('open-sesame-desktop-disconnected'));assert.equal(e.timers.size,0);assert.equal(e.get('github-project').hidden,true);assert.equal(e.window.OpenSesameGitHub.snapshot().connected,false);
const model={window:{}};vm.runInNewContext(fs.readFileSync('dist/plugins-model.js','utf8'),model);const p=model.window.OpenSesamePluginsModel.catalog.find(p=>p.id==='github');assert.equal(p.kind,'github');assert.equal(model.window.OpenSesamePluginsModel.setup(p).steps.length,3);assert.match(fs.readFileSync('dist/github-monitor.css','utf8'),/max-width:540px/);
console.log('GitHub widget explicit opening, read-only states, safe text/links, local repo controls, visible-only polling, stale close/disconnect handling and sign-in guidance passed with synthetic data.');
