import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const sandbox={console,structuredClone,TextEncoder,crypto,URL};sandbox.globalThis=sandbox;
runInNewContext(readFileSync('dist/workspace-storage-model.js','utf8'),sandbox);
const M=sandbox.OpenSesameWorkspaceStorageModel;
const clone=value=>structuredClone(value);
class Backend{
 constructor(){this.state={current:null,previous:null};this.failure='';this.wait=null}
 async read(){return clone(this.state)}
 async commit(expected,next,{preserveRecovery=false}={}){
  if(this.wait)await this.wait;
  if(this.failure==='quota')throw Object.assign(Error('Quota full'),{code:'quota',committed:false});
  if((this.state.current?.revision??0)!==expected)throw Object.assign(Error('Stale writer'),{code:'conflict',committed:false});
  this.state={current:clone(next),previous:clone(preserveRecovery?this.state.previous:this.state.current),recovery:preserveRecovery?clone(this.state.current):this.state.recovery};
  if(this.failure==='ack')throw Object.assign(Error('Lost acknowledgment'),{code:'uncertain'});
  return clone(next);
 }
}
const key='open-sesame-items-v1',project='open-sesame-projects-v1';
const note={id:'same-id',kind:'note',text:'Café 🪷',body:'Line one\n第二行',projectId:'p'};
let checks=0;async function test(name,fn){await fn();checks++;console.log('PASS '+name)}
await test('Hydration migrates allowlisted legacy keys without deleting originals',async()=>{
 const b=new Backend(),legacy={'perch-items-v1':JSON.stringify([note]),[project]:JSON.stringify([{id:'p',name:'Project'}]),'perch-oauth-state':'secret','opensesame.mobile.prototype.v1':'demo'};
 const original=clone(legacy),s=M.create(b);await s.hydrate(legacy);assert.equal(s.getItem(key),legacy['perch-items-v1']);assert.deepEqual(legacy,original);assert.throws(()=>s.getItem('open-sesame-oauth-state'),e=>e.code==='authority');assert.equal(s.revision,1);
});
await test('Malformed and future storage never silently reset or write defaults',async()=>{
 const b=new Backend(),s=M.create(b);await assert.rejects(()=>s.hydrate({[key]:'broken'}));assert.equal(b.state.current,null);assert.throws(()=>s.getItem(key));
 b.state.current={schemaVersion:999,revision:3,values:{}};await assert.rejects(()=>M.create(b).hydrate({}));assert.equal(b.state.current.schemaVersion,999);
});
await test('Acknowledgment precedes visible state and quota preserves committed originals',async()=>{
 const b=new Backend(),s=M.create(b);await s.hydrate({[key]:'[]',[project]:'[{"id":"p","name":"Project"}]'});let release;b.wait=new Promise(r=>release=r);const pending=s.setItem(key,JSON.stringify([note]));await Promise.resolve();assert.equal(s.getItem(key),'[]');release();await pending;assert.equal(JSON.parse(s.getItem(key))[0].id,'same-id');
 b.failure='quota';await assert.rejects(()=>s.setItem(key,'[]'));assert.equal(JSON.parse(s.getItem(key))[0].id,'same-id');assert.equal(JSON.parse(b.state.current.values[key])[0].id,'same-id');
});
await test('Two stale scenes cannot overwrite the first committed generation',async()=>{
 const b=new Backend(),a=M.create(b);await a.hydrate({[key]:'[]',[project]:'[{"id":"p","name":"Project"}]'});const c=M.create(b);await c.hydrate({});await a.setItem(key,JSON.stringify([note]));await assert.rejects(()=>c.setItem(key,'[]'),e=>e.code==='conflict');assert.equal(JSON.parse(b.state.current.values[key])[0].id,'same-id');await c.reconcile();assert.equal(c.revision,a.revision);
});
await test('Lost acknowledgment blocks further writes until explicit reconciliation',async()=>{
 const b=new Backend(),s=M.create(b);await s.hydrate({[key]:'[]',[project]:'[{"id":"p","name":"Project"}]'});b.failure='ack';await assert.rejects(()=>s.setItem(key,JSON.stringify([note])));assert.equal(s.status,'uncertain');await assert.rejects(()=>s.setItem(key,'[]'));b.failure='';await s.reconcile();assert.equal(JSON.parse(s.getItem(key))[0].id,'same-id');
});
await test('JSON bytes round-trip preserves Unicode and identity without importing authority',async()=>{
 const b=new Backend(),s=M.create(b);await s.hydrate({[key]:JSON.stringify([note]),[project]:JSON.stringify([{id:'p',name:'Project'}]),'open-sesame-access-token':'secret'});const bytes=s.exportJSON();assert(!bytes.includes('secret'));const c=M.create(new Backend());await c.hydrate({});await c.importJSON(bytes,{mode:'replace',expectedRevision:c.revision});assert.equal(c.getItem(key),s.getItem(key));assert.equal(c.getItem(project),s.getItem(project));
 for(const bad of ['broken',JSON.stringify({format:'open-sesame-workspace',schemaVersion:999,values:{}}),JSON.stringify({format:'open-sesame-workspace',schemaVersion:1,values:{'open-sesame-access-token':'x'}})])await assert.rejects(()=>c.importJSON(bad,{mode:'replace',expectedRevision:c.revision}));
});
await test('Import is explicit, bounded, revision-bound and keeps rollback generation',async()=>{
 const b=new Backend(),s=M.create(b);await s.hydrate({[key]:'[]',[project]:'[{"id":"p","name":"Project"}]'});const before=s.exportJSON();await assert.rejects(()=>s.importJSON(before,{}));await assert.rejects(()=>s.importJSON('x'.repeat(M.MAX_BYTES+1),{mode:'replace',expectedRevision:s.revision}));await s.setItem(key,JSON.stringify([note]));await assert.rejects(()=>s.importJSON(before,{mode:'replace',expectedRevision:1}));await s.importJSON(before,{mode:'replace',expectedRevision:s.revision});assert.equal(s.getItem(key),'[]');assert.equal(JSON.parse(b.state.previous.values[key])[0].id,'same-id');await s.restorePrevious({expectedRevision:s.revision});assert.equal(JSON.parse(s.getItem(key))[0].id,'same-id');
});
await test('Explicit damaged-generation recovery retains the corrupt original',async()=>{
 const b=new Backend(),s=M.create(b);await s.hydrate({[key]:'[]',[project]:'[{"id":"p","name":"Project"}]'});await s.setItem(key,JSON.stringify([note]));b.state.current.values[key]='broken';const damaged=clone(b.state.current),reopened=M.create(b);await assert.rejects(()=>reopened.hydrate({}));await reopened.restorePrevious({expectedRevision:damaged.revision});assert.equal(reopened.getItem(key),'[]');assert.deepEqual(b.state.recovery,damaged);
});
await test('A valid JSON edit with an invalid checksum cannot be mistaken for committed data',async()=>{
 const b=new Backend(),s=M.create(b);await s.hydrate({[key]:'[]',[project]:'[{"id":"p","name":"Project"}]'});await s.setItem(key,JSON.stringify([note]));b.state.current.values[key]=JSON.stringify([{...note,text:'Changed outside a transaction'}]);const original=clone(b.state.current);await assert.rejects(()=>M.create(b).hydrate({}),e=>e.code==='corrupt');assert.deepEqual(b.state.current,original);
});
await test('Identical saves do not manufacture revisions but still detect a stale scene',async()=>{
 const b=new Backend(),a=M.create(b);await a.hydrate({[key]:'[]',[project]:'[{"id":"p","name":"Project"}]'});const revision=a.revision;await a.setItem(key,'[]');assert.equal(a.revision,revision);const c=M.create(b);await c.hydrate({});await a.setItem(key,JSON.stringify([note]));await assert.rejects(()=>c.setItem(key,'[]'),e=>e.code==='conflict');
});
await test('Replacement retires old owners before a queued stale mutation can run',async()=>{
 const s=M.create(new Backend());await s.hydrate({});const text=s.exportJSON(),operation=s.importJSON(text,{mode:'replace',expectedRevision:s.revision,retireAfter:true});const stale=s.setItem(key,'[]');await operation;await assert.rejects(()=>stale,e=>e.code==='retired');assert.equal(s.status,'retired');
});
await test('Preview and commit share validation and reject duplicate identities and credentials',async()=>{
 const s=M.create(new Backend(),{validate(v){if(v['open-sesame-tools-v1'])throw Error('Host validator rejected tool')}});await s.hydrate({});for(const map of [{[key]:JSON.stringify([{...note,projectId:''},{...note,projectId:''}])},{'open-sesame-settings-v1':JSON.stringify({apiKey:'not-exportable'})},{'open-sesame-tools-v1':'[]'}]){const text=JSON.stringify({format:'open-sesame-workspace',schemaVersion:1,values:map});assert.throws(()=>s.previewImport(text));await assert.rejects(()=>s.importJSON(text,{mode:'replace',expectedRevision:s.revision}));}assert.equal(Object.keys(s.entries()).length,0);
});
await test('Malformed commit acknowledgment blocks later writes even when persistence succeeded',async()=>{
 const b=new Backend(),s=M.create(b);await s.hydrate({});const commit=b.commit.bind(b);b.commit=async(...args)=>{await commit(...args);return {schemaVersion:1}};await assert.rejects(()=>s.setItem(key,'[]'),e=>e.code==='uncertain');assert.equal(s.status,'uncertain');await assert.rejects(()=>s.setItem(key,'[]'));await s.reconcile();assert.equal(s.getItem(key),'[]');
});
await test('Hydration rejects a mismatched acknowledgment rather than accepting another generation',async()=>{
 const b=new Backend(),commit=b.commit.bind(b);b.commit=async(...args)=>{const ack=await commit(...args);ack.mutationId='wrong';return ack};const s=M.create(b);await assert.rejects(()=>s.hydrate({}),e=>e.code==='uncertain');assert.equal(s.status,'uncertain');assert.throws(()=>s.getItem(key));
});
await test('Malformed Reader and calendar nested records never pass to filtering owners',async()=>{
 for(const data of [{'open-sesame-reading-v1':JSON.stringify({entries:[{id:'missing-title'}]})},{'open-sesame-reading-v1':JSON.stringify({feeds:[{id:'bad-url',url:'file:///private'}]})},{'open-sesame-focus-calendar-v1':JSON.stringify({events:{bad:true}})}]){const b=new Backend();await assert.rejects(()=>M.create(b).hydrate(data));assert.equal(b.state.current,null)}
});
await test('Current lifecycle v2 and default-recipient preferences survive migration without admitting identity',async()=>{
 const b=new Backend(),s=M.create(b),key='open-sesame-widget-lifecycle-v2',value=JSON.stringify({notes:'active',shells:'inactive'});await s.hydrate({[key]:value,'open-sesame-default-familiar-v1':'roster-reference'});assert.equal(s.getItem(key),value);const restored=M.create(new Backend());await restored.hydrate({});await restored.importJSON(s.exportJSON(),{mode:'replace',expectedRevision:restored.revision});assert.equal(restored.getItem(key),value);assert.equal(restored.getItem('open-sesame-default-familiar-v1'),'roster-reference');assert.throws(()=>restored.getItem('open-sesame-selected-familiar-v1'));
});
await test('Native dictionary key reordering preserves acknowledgment identity and no-op revisions',async()=>{
 const b=new Backend(),commit=b.commit.bind(b);b.commit=async(...args)=>{const result=await commit(...args);result.values=Object.fromEntries(Object.entries(result.values).reverse());return result};const s=M.create(b);await s.hydrate({[key]:'[]',[project]:'[]'});await s.patch({'open-sesame-current-project':'all'});const revision=s.revision;await s.patch({[key]:'[]',[project]:'[]'});assert.equal(s.revision,revision);assert.equal(s.status,'ready');
});
console.log(checks+' workspace storage checks passed; installed-device qualification remains separate.');
