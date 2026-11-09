import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {webcrypto} from 'node:crypto';
class Node extends EventTarget{
 constructor(tag){super();this.tag=tag;this.children=[];this.dataset={};this.open=false;this.value=''}
 append(...n){this.children.push(...n)}prepend(...n){this.children.unshift(...n)}replaceChildren(...n){this.children=n}setAttribute(){}showModal(){this.open=true}close(){this.open=false;this.dispatchEvent(new Event('close'))}click(){return this.onclick?.()}scrollIntoView(){}querySelectorAll(tag){return this.children.flatMap(x=>[...(x.tag===tag?[x]:[]),...x.querySelectorAll(tag)])}
}
const nodes=new Map(),el=id=>{if(!nodes.has(id))nodes.set(id,new Node('div'));return nodes.get(id)};const store=new Map();let effects=0;
const ctx=vm.createContext({TextEncoder,URL,crypto:webcrypto,Event,CustomEvent,window:null,document:{createElement:t=>new Node(t),getElementById:el},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},confirm:()=>true,state:{scenario:'plugins'},changeScenario(){},fetch(){effects++;throw Error('Unexpected fetch')},openSesameBridge:{request(){effects++;throw Error()}},items:[],activeItems:()=>[],newId:()=> 'note',saveItems:()=>true,renderItems(){},setTimeout,Blob});ctx.window=ctx;const events=new EventTarget();ctx.addEventListener=events.addEventListener.bind(events);ctx.dispatchEvent=events.dispatchEvent.bind(events);
vm.runInContext(fs.readFileSync('dist/tools-model.js','utf8'),ctx);ctx.OpenSesameCaptureCatalog={roots:[]};vm.runInContext(fs.readFileSync('dist/tools.js','utf8'),ctx);
ctx.OpenSesameTools.open();const dialog=el('widget-panel').children[0],file=dialog.children[1].children[0];file.files=[{size:1000,text:async()=>fs.readFileSync('dist/tools/meeting-notes/tool.json','utf8')}];await file.onchange();assert.equal(effects,0,'Import/preview is isolated');const stage=dialog.children[4];const preview=stage.children[1];assert(preview.querySelectorAll('button').every(b=>b.disabled));await stage.children.find(x=>x.textContent==='Install as a new instance').click();assert.equal(JSON.parse(store.values().next().value).length,1);
ctx.OpenSesameTools.open();const collection=dialog.children[5],detail=collection.children[1];detail.open=true;detail.ontoggle();const view=detail.children[1],input=view.querySelectorAll('textarea')[0];input.value='Private notes';input.oninput();await view.querySelectorAll('button').find(x=>x.textContent==='Save configuration').click();assert.equal(JSON.parse(store.values().next().value)[0].config.notes,'Private notes');await view.querySelectorAll('button').find(x=>x.textContent==='Save note').click();assert.equal(ctx.items[0].text,'Private notes');assert.equal(effects,0);
console.log('Fixture isolation, disabled preview actions, install, configuration and explicit note save pass.');

const findButton=(root,label)=>root.querySelectorAll('button').find(b=>b.textContent===label);
const importDefinition=async d=>{ctx.OpenSesameTools.open();file.files=[{size:1000,text:async()=>JSON.stringify(d)}];await file.onchange()};
const readInstalled=()=>JSON.parse(store.get('open-sesame-tools-v1'));
const entry=id=>collection.children.find(n=>n.dataset?.instance===id);
const expand=id=>{const n=entry(id);n.open=true;n.ontoggle();return n.children[1]};
const savedId=readInstalled()[0].id;
input.value='Unsaved old draft';input.oninput();
const updated=JSON.parse(fs.readFileSync('dist/tools/meeting-notes/tool.json','utf8'));updated.version='1.0.1';updated.config.topic={label:'Topic',default:'New default'};
await importDefinition(updated);await findButton(stage,'Replace Meeting notes').click();
let updatedView=expand(savedId);assert.equal(updatedView.querySelectorAll('textarea')[0].value,'Private notes','Replace drops old drafts and retains saved values');assert.equal(updatedView.querySelectorAll('input')[0].value,'New default','New configuration uses its default');
await findButton(entry(savedId),'Roll back definition').click();assert.equal(readInstalled()[0].definition.version,'1.0.0');
// Declining replacement preserves the installed definition and draft.
ctx.confirm=()=>false;await importDefinition(updated);await findButton(stage,'Replace Meeting notes').click();assert.equal(readInstalled()[0].definition.version,'1.0.0');ctx.confirm=()=>true;
// Simulate a failed save without destroying the input or an existing item.
const failedView=expand(savedId),failedInput=failedView.querySelectorAll('textarea')[0];failedInput.value='Retain after failure';failedInput.oninput();ctx.saveItems=()=>false;const count=ctx.items.length;await findButton(failedView,'Save note').click();assert.equal(ctx.items.length,count);assert.equal(failedInput.value,'Retain after failure');ctx.saveItems=()=>true;
// Round trip private drafts in memory without adding them to exported definitions.
const memory=ctx.OpenSesameTools.handoff();ctx.OpenSesameTools.handoff(memory);assert.equal(expand(savedId).querySelectorAll('textarea')[0].value,'Retain after failure');
const blobs=[];class ExportURL extends URL{static createObjectURL(blob){blobs.push(blob);return 'blob:fixture'}static revokeObjectURL(){}}
ctx.URL=ExportURL;await findButton(entry(savedId),'Export definition').click();assert(!((await blobs[0].text()).includes('Private notes')));assert(!((await blobs[0].text()).includes('Retain after failure')));
// Source reads are bound to the clicked configuration and retired on edits/close.
const github=JSON.parse(fs.readFileSync('dist/tools/repository-summary/tool.json','utf8'));github.config.repository.default='OpenCoven/example';await importDefinition(github);await findButton(stage,'Install as a new instance').click();const githubId=readInstalled().find(x=>x.definition.id===github.id).id;
let statusResolve,snapshotResolve;const calls=[];ctx.openSesameBridge.request=(method,params)=>{calls.push([method,params]);return new Promise(resolve=>{if(method==='github.status')statusResolve=resolve;else snapshotResolve=resolve})};
let githubView=expand(githubId),load=findButton(githubView,'Load live data');let loading=load.click();const repo=githubView.querySelectorAll('input')[0];repo.value='OpenCoven/changed';repo.oninput();statusResolve({authenticated:true,repositories:['OpenCoven/example']});await loading;assert.equal(calls.length,1,'Editing before status completes prevents a snapshot request');
repo.value='OpenCoven/example';repo.oninput();loading=load.click();statusResolve({authenticated:true,repositories:['OpenCoven/example']});await new Promise(setImmediate);assert.deepEqual(calls.at(-1)[1].repository,'OpenCoven/example');dialog.close();const before=githubView.children;snapshotResolve({repository:'OpenCoven/example',sections:{pulls:{entries:[{title:'Late result'}]}}});await loading;assert.equal(githubView.children,before,'Closing retires late results');
ctx.OpenSesameTools.open();githubView=expand(githubId);loading=findButton(githubView,'Load live data').click();statusResolve({authenticated:true,repositories:['OpenCoven/example']});await new Promise(setImmediate);snapshotResolve({repository:'OpenCoven/example',sections:{pulls:{entries:[{title:'Current result'}]}}});await loading;assert(githubView.querySelectorAll('p').some(p=>p.textContent==='GitHub data · refresh is manual.'));assert(githubView.querySelectorAll('li').some(p=>p.textContent==='Current result'));
const feed=JSON.parse(fs.readFileSync('dist/tools/feed-headlines/tool.json','utf8'));feed.config.feed.default='feed-1';await importDefinition(feed);await findButton(stage,'Install as a new instance').click();const feedId=readInstalled().find(x=>x.definition.id===feed.id).id;ctx.openSesameReading={handoff:()=>({feeds:[{id:'feed-1',title:'Saved feed'}],entries:[{feedId:'feed-1',title:'Saved headline'}]})};const feedView=expand(feedId);const requestCount=calls.length;await findButton(feedView,'Load saved headlines').click();assert.equal(calls.length,requestCount);assert(feedView.querySelectorAll('li').some(n=>n.textContent==='Saved headline'));
console.log('Replacement/defaults, rollback/cancel, draft handoff, save failure, private export, stale reads and cached feed behavior pass.');
// Global shortcuts must respect the top-layer dialog even when redraw detaches focus.
let globalKey;const appKeys=fs.readFileSync('dist/app.js','utf8').split('\n').find(line=>line.startsWith("document.addEventListener('keydown',e=>"));
vm.runInNewContext(appKeys,{document:{addEventListener:(_,fn)=>globalKey=fn},window:{OpenSesameTools:{active:true}}});
assert.doesNotThrow(()=>globalKey({key:'Escape'}),'An active tool dialog must own Escape before any workspace handler runs');
const multilineView=expand(savedId),multilineInput=multilineView.querySelectorAll('textarea')[0];multilineInput.value='Meeting title\n\nDiscussion\n\nDecisions';multilineInput.oninput();await findButton(multilineView,'Save note').click();assert.equal(ctx.items.at(-1).title,'Meeting title');assert.equal(ctx.items.at(-1).body,'Discussion\n\nDecisions','Generated note forms preserve body text in the existing editor model');

assert(dialog.open);ctx.state.expanded=false;ctx.dispatchEvent(new Event('open-sesame-layout'));assert.equal(dialog.open,false,'Collapsing the workspace retires the top-layer dialog');

// A page-mounted widget shares drafts and keeps its own explicit read lifetime.
let pageVisible=true;const pageHost=new Node('article'),dispose=ctx.OpenSesameTools.mount(githubId,pageHost,()=>pageVisible);assert.equal(calls.length,requestCount,'Mounting a page tab never reads a provider');
ctx.openSesameBridge.request=(method,params)=>{calls.push([method,params]);return new Promise(resolve=>{if(method==='github.status')statusResolve=resolve;else snapshotResolve=resolve})};
const pageRead=findButton(pageHost,'Load live data').click();pageVisible=false;dispose();statusResolve({authenticated:true,repositories:['OpenCoven/example']});await pageRead;assert.equal(calls.at(-1)[0],'github.status','Leaving before status completes prevents a snapshot');
console.log('Inline page mounting, shared drafts and cancelled read scope pass.');
// Disabling an installed instance retires its read, launcher and page entry while preserving both saved config and draft.
ctx.OpenSesameTools.open();const draftHost=expand(savedId),draftInput=draftHost.querySelectorAll('textarea')[0];draftInput.value='Retained inactive draft';draftInput.oninput();
const beforeConfig=JSON.stringify(readInstalled().find(x=>x.id===savedId).config);
await findButton(entry(savedId),'Deactivate widget').click();assert(!ctx.OpenSesameTools.list().some(x=>x.id===savedId));assert.equal(JSON.stringify(readInstalled().find(x=>x.id===savedId).config),beforeConfig);assert(ctx.OpenSesameTools.handoff().some(([id,fields])=>id===savedId&&fields.notes==='Retained inactive draft'));
assert.equal(findButton(entry(savedId),'Open in Projects').disabled,true);
await findButton(entry(savedId),'Activate widget').click();assert(ctx.OpenSesameTools.list().some(x=>x.id===savedId));assert.equal(expand(savedId).querySelectorAll('textarea')[0].value,'Retained inactive draft');
ctx.OpenSesameTools.open();pageVisible=true;const activeHost=new Node('article');ctx.OpenSesameTools.mount(githubId,activeHost,()=>pageVisible);const retiring=findButton(activeHost,'Load live data').click();await findButton(entry(githubId),'Deactivate widget').click();statusResolve({authenticated:true,repositories:['OpenCoven/example']});const previousCalls=calls.length;await retiring;assert.equal(calls.length,previousCalls,'Deactivation prevents the next provider read');
await findButton(entry(savedId),'Uninstall widget').click();assert(!readInstalled().some(x=>x.id===savedId));assert(ctx.items.some(x=>x.title==='Meeting title'),'Uninstall keeps independently saved Projects content');
console.log('Inactive tool configuration/drafts, page/launcher removal, reactivation, pending read retirement and uninstall content preservation pass.');

const remoteTools=readInstalled().map(x=>({...x,active:false})),remoteEvent=new Event('storage');Object.assign(remoteEvent,{key:'open-sesame-tools-v1',newValue:JSON.stringify(remoteTools)});ctx.dispatchEvent(remoteEvent);assert.equal(ctx.OpenSesameTools.list().length,0,'Floating-document deactivation removes original page entries');
const remoteActive=new Event('storage');Object.assign(remoteActive,{key:'open-sesame-tools-v1',newValue:JSON.stringify(remoteTools.map(x=>({...x,active:true})))});ctx.dispatchEvent(remoteActive);assert.equal(ctx.OpenSesameTools.list().length,remoteTools.length);
console.log('Floating-document tool activation and page/launcher synchronization pass.');
