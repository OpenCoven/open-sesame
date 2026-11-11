import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync('dist/widget-lifecycle.js','utf8'),key='open-sesame-widget-lifecycle-v2';
function load(storage=new Map(),fail=false){
 const events=[],win=new EventTarget();win.addEventListener('open-sesame-widgets-changed',e=>events.push(e.detail));const ctx={window:win,document:{documentElement:{dataset:{}}},CustomEvent,localStorage:{getItem:k=>storage.get(k)??null,setItem(k,v){if(fail)throw Error('Storage full');storage.set(k,v)}}};
 vm.runInNewContext(source,ctx);return {api:ctx.window.OpenSesameWidgetLifecycle,events,ctx};
}
const storage=new Map(),{api,events,ctx}=load(storage);
assert.deepEqual(JSON.parse(JSON.stringify(api.defaults)),['agenda','local-media','task-manager','shells']);for(const id of api.ids)assert.equal(api.isActive(id),api.defaults.includes(id),'Fresh default '+id);assert.equal(api.status('reader'),'uninstalled');assert.equal(api.status('transcribe'),'uninstalled');assert.equal(api.status('image-generation'),'uninstalled');assert.equal(api.status('rss'),'uninstalled');assert.equal(api.status('github'),'uninstalled');assert.equal(ctx.document.documentElement.dataset.widgetRss,'off');
const catalogContext={window:{}};vm.runInNewContext(fs.readFileSync('dist/plugins-model.js','utf8'),catalogContext);
for(const {id} of catalogContext.window.OpenSesamePluginsModel.catalog){
 await api.set(id,'active');assert(api.isActive(id));await api.set(id,'inactive');assert.equal(api.status(id),'inactive');assert.equal(load(storage).api.status(id),'inactive');await api.set(id,'uninstalled');assert.equal(api.isActive(id),false);assert.equal(events.at(-1).id,id);
}
const reading=JSON.stringify({feeds:[{id:'saved',url:'https://example.com/feed'}],entries:[{title:'Saved article'}]}),legacy=new Map([['open-sesame-reading-v1',reading],['open-sesame-builtin-widgets-v1','["github"]']]);
const migrated=load(legacy).api;assert(migrated.isActive('rss'));assert(migrated.isActive('github'));await migrated.set('rss','uninstalled');assert.equal(legacy.get('open-sesame-reading-v1'),reading);assert.equal(load(legacy).api.status('rss'),'uninstalled','Explicit uninstall wins over legacy subscriptions');
for(const raw of ['{','[]','{"rss":"maybe"}']){const corrupt=new Map([[key,raw]]),a=load(corrupt).api;assert(a.error);assert.equal(a.isActive('coven'),false);await assert.rejects(()=>a.set('rss','active'));assert.equal(corrupt.get(key),raw)}
const full=load(new Map(),true).api;await assert.rejects(()=>full.set('coven','inactive'));assert(full.isActive('agenda'),'Failed storage writes leave runtime state unchanged');
// Execute the feed boundary with deferred native responses: disabled feeds cannot start or commit a late read.
const readingSource=fs.readFileSync('dist/reading.js','utf8');let active=false,requests=0,resolve;
const feedCtx={window:{OpenSesameWidgetLifecycle:{isActive:()=>active}},openSesameBridge:{ready:Promise.resolve(),available:true,request(){requests++;return new Promise(r=>resolve=r)}}};vm.createContext(feedCtx);
vm.runInContext(readingSource.slice(readingSource.indexOf('  const rssActive='),readingSource.indexOf('  async function merge(')),feedCtx);
await assert.rejects(vm.runInContext("fetchFeed({url:'https://example.com/feed'})",feedCtx),/Activate/);assert.equal(requests,0);
active=true;const pending=vm.runInContext("fetchFeed({url:'https://example.com/feed'})",feedCtx);await new Promise(setImmediate);assert.equal(requests,1);active=false;vm.runInContext('feedEpoch++',feedCtx);active=true;resolve({text:'late'});await assert.rejects(pending,/cancelled/,'Even immediate reactivation cannot admit an old feed response');
console.log('Built-in lifecycle persistence, optional defaults, legacy migration, content preservation, corrupt/full storage and feed read retirement pass.');

const remoteStorage=new Map(),remote=load(remoteStorage);await remote.api.set('coven','active');const storageEvent=new Event('storage');Object.assign(storageEvent,{key,newValue:JSON.stringify({coven:'inactive',rss:'active'})});remote.ctx.window.dispatchEvent(storageEvent);assert.equal(remote.api.status('coven'),'inactive');assert(remote.api.isActive('rss'));assert.equal(remote.events.at(-1).id,'rss');assert.equal(remote.ctx.document.documentElement.dataset.widgetRss,'on');
const brokenEvent=new Event('storage');Object.assign(brokenEvent,{key,newValue:'{'});remote.ctx.window.dispatchEvent(brokenEvent);assert(remote.api.error);assert(!remote.api.isActive('rss'));
console.log('Catalog coverage and floating-document state synchronization retire changed or corrupt installations.');

const oldState='{"spotify":"active","coven":"inactive","rss":"uninstalled"}',oldStore=new Map([['open-sesame-widget-lifecycle-v1',oldState]]),upgraded=load(oldStore).api;
assert(upgraded.isActive('spotify'));assert(!upgraded.isActive('coven'));assert(upgraded.isActive('agenda'));upgraded.set('reader','active');assert.equal(oldStore.get('open-sesame-widget-lifecycle-v1'),oldState,'The older app lifecycle remains readable after new core widgets are activated');assert(oldStore.has(key));console.log('Versioned core-widget migration retains explicit choices and leaves the older app configuration intact.');
for(const state of ['active','inactive','uninstalled']){const prior=JSON.stringify({'image-generation':state}),saved=new Map([['open-sesame-widget-lifecycle-v1',prior]]),next=load(saved).api;assert.equal(next.status('image-generation'),state);assert(!next.error);assert.equal(saved.get('open-sesame-widget-lifecycle-v1'),prior)}
