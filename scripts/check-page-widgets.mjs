import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
class Node extends EventTarget{
 constructor(tag='div'){super();this.tagName=tag.toUpperCase();this.children=[];this.attrs={};this.dataset={};this.hidden=false;this.disabled=false;this.className='';this.handlers={};this.classList={add:c=>this.className+=' '+c,toggle:(c,on)=>{const set=new Set(this.className.split(' '));on?set.add(c):set.delete(c);this.className=[...set].join(' ')}}}
 append(...nodes){for(const n of nodes){n.remove();this.children.push(n);n.parentElement=this}}
 prepend(n){n.remove();this.children.unshift(n);n.parentElement=this}
 remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(n=>n!==this);this.parentElement=null}}
 replaceChildren(...n){for(const child of [...this.children])child.remove();this.append(...n)}setAttribute(k,v){this.attrs[k]=String(v)}
 contains(n){return this===n||this.children.some(c=>c.contains(n))}
 matches(s){if(s[0]==='#')return this.id===s.slice(1);if(s[0]==='.')return this.className.split(' ').includes(s.slice(1));if(s==='button')return this.tagName==='BUTTON';if(s==='[data-page-widget]')return !!this.dataset.pageWidget;const m=s.match(/^\[([^=]+)="([^"]+)"\]$/);return !!m&&this.attrs[m[1]]===m[2]}
 querySelectorAll(s){return this.children.flatMap(n=>[...(n.matches(s)?[n]:[]),...n.querySelectorAll(s)])}querySelector(s){return this.querySelectorAll(s)[0]||null}closest(s){return this.matches(s)?this:this.parentElement?.closest(s)}
 addEventListener(t,fn){(this.handlers[t]??=[]).push(fn)}click(){for(const fn of this.handlers.click||[])fn({target:this});let p=this.parentElement;while(p){for(const fn of p.handlers.click||[])fn({target:this});p=p.parentElement}this.onclick?.()}
 focus(){doc.activeElement=this}
}
const roots=new Map(),node=id=>{if(!roots.has(id)){const n=new Node();n.id=id;roots.set(id,n)}return roots.get(id)},doc={getElementById:node,createElement:t=>new Node(t)},events=new EventTarget(),storage=new Map();let entries=[],mounts=[],disposals=0,reads=0;
const config={focus:['pane-focus','focus-top','focus-view-tabs'],media:['lockin-workspace','console-toolbar','lockin-tabs'],projects:['pane-items','projects-toolbar','projects-mode-tabs'],console:['agents-workspace','console-toolbar','agents-mode-tabs'],reader:['pane-reading','reading-toolbar','reading-collections']};
for(const [page,[root,tb,ts]] of Object.entries(config)){const toolbar=new Node();toolbar.className=tb;toolbar.id=tb;const tabs=new Node();tabs.id=ts;tabs.className=ts;tabs.setAttribute('role','tablist');const b=new Node('button');b.setAttribute('role','tab');b.setAttribute('aria-selected','true');tabs.append(b);toolbar.append(tabs);node(root).append(toolbar)}node('pane-plugins').append(node('github-monitor'));
const pages={focus:'Focus',media:'Media',projects:'Projects',console:'Console',reader:'Reader',live:'Live',widgets:'Widgets'},state={scenario:'focus',expanded:true},window={OpenSesameTools:{list:()=>entries,mount(id,host,scope){mounts.push({id,host,scope});return()=>disposals++},invalidate(){}},OpenSesameGitHubMonitor:{pause(){},mount(scope){this.scope=scope;node('github-monitor').hidden=false},activate(){if(this.scope?.())reads++}},OpenSesameNotes:{finish:()=>true},addEventListener:events.addEventListener.bind(events)};
const ctx={OpenSesameToolsModel:{pages},window,document:doc,state,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},changeScenario(s){state.scenario=({entertainment:'music',agents:'familiars'})[s]||s;events.dispatchEvent(new Event('open-sesame-view-changed'))},toast(){}};vm.runInNewContext(fs.readFileSync('dist/page-widgets.js','utf8'),ctx);const P=window.OpenSesamePageWidgets;
assert.equal(mounts.length,0);assert.equal(reads,0,'Startup does not connect providers');
entries=Object.keys(pages).map(page=>({id:page,name:page+' widget',page,definition:{page}}));events.dispatchEvent(new Event('open-sesame-tools-changed'));
for(const page of Object.keys(pages)){
 P.open(page);assert.equal(P.active,true);const m=mounts.at(-1);assert.equal(m.id,page);assert.equal(m.scope(),true);state.expanded=false;assert.equal(m.scope(),false);state.expanded=true;
 P.close();assert.equal(P.active,false);assert.equal(m.scope(),false,'Closing retires the view scope');
}
P.open('projects');let prior=mounts.at(-1);entries=entries.map(x=>x.id==='projects'?{...x,page:'reader',definition:{page:'reader'}}:x);events.dispatchEvent(new Event('open-sesame-tools-changed'));assert.equal(P.active,false);assert.equal(prior.scope(),false,'Moving a definition retires its old page');P.open('projects');assert.equal(state.scenario,'reading');assert.equal(mounts.at(-1).id,'projects');
entries=entries.filter(x=>x.id!=='projects');events.dispatchEvent(new Event('open-sesame-tools-changed'));assert.equal(P.active,false);assert(disposals>0);
P.github();assert.equal(state.scenario,'items');assert.equal(P.active,true);assert(reads>0);P.close();assert.equal(node('github-monitor').parentElement,node('pane-plugins'),'Closing returns the built-in host to its retained home');
P.open('reader');P.github();assert.equal(node('github-monitor').hidden,false);P.removeGithub();assert.equal(P.list().some(x=>x.id==='builtin-github'),false);assert.equal(P.active,false);P.github();assert.equal(node('github-monitor').hidden,false,'Removing and reinstalling preserves the built-in host');
window.OpenSesameNotes.finish=()=>false;const scenario=state.scenario;P.open('focus');assert.equal(state.scenario,scenario,'Unsaved note veto preserves navigation');
console.log('All seven page adapters, explicit installation/navigation, native tabs, view retirement, definition moves/removal, retained GitHub host and unsaved note guard pass.');
assert.match(fs.readFileSync('dist/page-widgets.css','utf8'),/\.page-widget-open\[hidden\]\{display:none!important\}/,'Inactive pages cannot leak retained widget panels behind the active page');
