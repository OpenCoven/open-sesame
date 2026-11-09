import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const nodes=new Map();let document;
class Node extends EventTarget{
  constructor(tag='div',cls=''){super();this.tag=tag;this.className=cls;this.children=[];this.attrs={};this.dataset={};this.value='';this.hidden=false;this.disabled=false;this.scrollTop=0;this.classList={toggle(){}}}
  append(...items){this.children.push(...items)}replaceChildren(...items){this.children=[...items];this.scrollTop=0}setAttribute(k,v){this.attrs[k]=String(v)}
  querySelector(selector){const cls=selector.slice(1);return this.children.find(n=>n.className===cls)||this.children.map(n=>n.querySelector(selector)).find(Boolean)}
  focus(){document.activeElement=this}click(){if(!this.disabled)this.dispatchEvent(new Event('click'))}
}
const get=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id)};
get('pane-agent-monitor').append(new Node('div','agent-filter-row'));
document=new EventTarget();document.hidden=false;document.getElementById=get;document.createElement=tag=>new Node(tag);
const window=new EventTarget(),timers=new Map(),announcements=[];let serial=0,respond=async()=>({machine:'Fixture Mac',agents:[]}),calls=0;
const controls=[];let controlReply=async()=>({signalSent:true});
const bridge={available:true,ready:Promise.resolve(),request:async(method,params)=>{if(method==='agents.control'){controls.push(params);return controlReply()}assert.equal(method,'agents.snapshot');calls++;return respond()}};
window.localStorage={getItem:key=>key==='open-sesame-process-view'?'grid':null,setItem(){}};window.openSesameBridge=bridge;window.addEventListener('open-sesame-agents-updated',e=>announcements.push(e.detail));
vm.runInNewContext(fs.readFileSync('dist/agent-monitor.js','utf8'),{window,document,openSesameBridge:bridge,state:{scenario:'agent-monitor'},icon:()=>'<svg></svg>',CustomEvent,Date,setTimeout:fn=>{timers.set(++serial,fn);return serial},clearTimeout:id=>timers.delete(id)});
const flush=()=>new Promise(resolve=>setImmediate(resolve));await flush();
assert.equal(get('agent-empty').hidden,false);assert.match(get('agent-empty-title').textContent,/Ready/);assert.equal(get('agent-refresh').disabled,false);assert.equal(get('agent-clear-filters').hidden,true);
const agents=[{pid:101,name:'Fixture Agent',provider:'coven',state:'running',cpuPercent:2,memoryMB:80,uptimeSeconds:125,controlToken:'fixture-first'},{pid:102,name:'Other Agent',provider:'codex',state:'sleeping',cpuPercent:0,memoryMB:90,uptimeSeconds:400,controlToken:'fixture-second'}];
respond=async()=>({machine:'Fixture Mac',agents});await window.OpenSesameAgentMonitor.refresh();assert.equal(get('agent-cards').children.length,2);assert.equal(get('agent-empty').hidden,true);
agents[0].activity={state:'waiting',source:'fixture',since:Date.now()-60000};agents[0].cwd='/fixture/repo';agents[0].repository={name:'repo',branch:'feature'};
const layoutTools=get('pane-agent-monitor').querySelector('.agent-filter-row').children.find(n=>n.className==='agent-workspace-tools');
const layoutButtons=layoutTools.children[0].children;
for(const label of ['Table','List','Grid','Board','Gantt']){layoutButtons.find(b=>b.textContent===label).click();assert.equal(get('agent-cards').dataset.layout,label.toLowerCase());if(label==='Board')assert.equal(get('agent-cards').children.length,6);if(label==='Table')assert.equal(get('agent-cards').children[0].tag,'table')}
layoutButtons[2].click();
const needsButton=layoutTools.children[1];needsButton.click();assert.equal(get('agent-cards').children.length,1);needsButton.click();
get('agent-search').value='feature';get('agent-search').dispatchEvent(new Event('input'));assert.equal(get('agent-cards').children.length,1);get('agent-search').value='';get('agent-search').dispatchEvent(new Event('input'));

const filter=state=>get('agent-state-filters').children.find(n=>n.dataset.state===state);
filter('running').click();assert.equal(get('agent-cards').children.length,1);assert.equal(filter('running').attrs['aria-pressed'],'true');assert.equal(get('agent-clear-filters').hidden,false);
get('agent-search').value='no match';get('agent-search').dispatchEvent(new Event('input'));assert.equal(get('agent-empty').hidden,false);assert.match(get('agent-empty-title').textContent,/No matching/);
get('agent-clear-filters').click();assert.equal(get('agent-search').value,'');assert.equal(get('agent-cards').children.length,2);assert.equal(filter('all').attrs['aria-pressed'],'true');
const actions=()=>get('agent-cards').children[0].children.at(-1).children;
actions().find(b=>b.textContent==='Stop…').click();assert.equal(controls.length,0,'Stop requires an explicit confirmation');
assert.ok(actions().some(b=>b.textContent==='Cancel'));actions().find(b=>b.textContent==='Cancel').click();assert.equal(controls.length,0);
actions().find(b=>b.textContent==='Pause process').click();await flush();assert.equal(controls[0].action,'pause');assert.equal(controls[0].token,'fixture-first');
assert.equal(controls[0].pid,101);assert.match(get('agent-action-status').textContent,/signal sent/);
respond=async()=>({machine:'Fixture Mac',agents:[{...agents[0],state:'stopped'},agents[1]]});await window.OpenSesameAgentMonitor.refresh();
actions().find(b=>b.textContent==='Resume process').click();await flush();assert.equal(controls[1].action,'resume');
respond=async()=>({machine:'Fixture Mac',agents});await window.OpenSesameAgentMonitor.refresh();
actions().find(b=>b.textContent==='Stop…').click();actions().find(b=>b.textContent==='Stop process').click();await flush();assert.equal(controls[2].action,'stop');
actions().find(b=>b.textContent==='Stop…').click();respond=async()=>({machine:'Fixture Mac',agents:[{...agents[0],controlToken:'replaced-identity'},agents[1]]});await window.OpenSesameAgentMonitor.refresh();assert.ok(!actions().some(b=>b.textContent==='Stop process'),'A replaced process invalidates the stop confirmation');
respond=async()=>({machine:'Fixture Mac',agents});await window.OpenSesameAgentMonitor.refresh();
get('agent-cards').scrollTop=90;await window.OpenSesameAgentMonitor.refresh();assert.equal(get('agent-cards').scrollTop,90,'Refresh preserves the process list scroll position');
respond=async()=>{throw Error('Fixture transport unavailable')};await window.OpenSesameAgentMonitor.refresh();assert.equal(get('agent-cards').children.length,2,'A failed refresh preserves the last snapshot');assert.equal(announcements.at(-1).fresh,false);assert.match(get('agent-freshness').textContent,/Last snapshot/);
let finish;respond=()=>new Promise(resolve=>finish=resolve);const pending=window.OpenSesameAgentMonitor.refresh();assert.equal(get('agent-refresh').disabled,true);const count=calls;await window.OpenSesameAgentMonitor.refresh();assert.equal(calls,count,'Refresh operations are deduplicated');
bridge.available=false;window.dispatchEvent(new Event('open-sesame-desktop-disconnected'));finish({machine:'Stale',agents:[]});await pending;assert.equal(get('agent-cards').children.length,2,'A reply from a disconnected host cannot replace the snapshot');assert.equal(announcements.at(-1).fresh,false);assert.equal(get('agent-refresh').disabled,true);
bridge.available=true;respond=async()=>({machine:'Fixture Mac',agents});window.dispatchEvent(new Event('open-sesame-desktop-ready'));await flush();assert.equal(announcements.at(-1).fresh,true);assert.equal(get('agent-refresh').disabled,false);
document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));const before=calls;await window.OpenSesameAgentMonitor.refresh();assert.equal(calls,before,'Hidden documents pause discovery');assert.equal(timers.size,0);
assert.ok(!fs.readFileSync('dist/index.html','utf8').includes('id="agent-demo"'));
console.log('Processes: real empty/active snapshots, search/state/reset filters, scroll preservation, refresh deduplication, stale/disconnected replies, reconnect and hidden-page polling passed with a simulated DOM/host.');
