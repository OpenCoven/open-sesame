import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const root=process.cwd();
const read=file=>readFileSync(path.join(root,file),'utf8');
const esm=read('ui/definitions.js');
const legacy=read('dist/tools-model.js');
const body=legacy.slice(legacy.indexOf('  const pages'),legacy.indexOf('  globalThis.OpenSesameToolsModel'));
assert(esm.includes(body),'The pure validator must stay byte-identical to the existing v1/v2 contract');
const model=await import(pathToFileURL(path.join(root,'ui/definitions.js')));
const definition=model.parse(read('dist/tools/meeting-notes/tool.json'));
for(const slug of ['meeting-notes','repository-summary','feed-headlines']) assert.deepEqual(model.validate(model.parse(read(`dist/tools/${slug}/tool.json`))),[]);
for(const field of ['script','module','html','bridge','url']) assert.throws(()=>model.parse(JSON.stringify({...definition,[field]:'./evil.js'})),/Unknown field/);
assert.throws(()=>model.parse(JSON.stringify({...definition,capabilities:['terminal.open']})),/approved/);
assert.throws(()=>model.parse(JSON.stringify({...definition,actions:[{label:'Run',operation:'terminal.open',value:'x'}]})),/approved/);
assert.throws(()=>model.parse(' '.repeat(100001)),/100 KB/);
assert.deepEqual(model.validate({...definition,schemaVersion:1,page:undefined}).filter(s=>!s.startsWith('tool.page')),[]);
const {performAction,createDefinitionStore}=await import(pathToFileURL(path.join(root,'ui/widgets/declarative-model.js')));
{
 const calls=[];const deps={bridge:{request:async(m,p)=>{calls.push([m,p]);return {item:{id:p.item.id}};}},navigate:id=>calls.push(['navigate',id]),signal:new AbortController().signal};
 const action={operation:'note.save',label:'Save',value:'body'};
 const d={...definition,capabilities:['note.save'],actions:[action]};
 await performAction(d,action,{body:'A retained note'},deps,'25f5ec48-9f67-432c-a189-a00a4f46365b');
 assert.deepEqual(calls,[['items.save',{item:{id:'25f5ec48-9f67-432c-a189-a00a4f46365b',kind:'note',text:'A retained note'}}]]);
 await assert.rejects(performAction(d,{...action,operation:'terminal.open'},{},deps),/approved/);
 const controller=new AbortController();controller.abort();
 await assert.rejects(performAction(d,action,{}, {...deps,signal:controller.signal}),/off/);
 assert.equal(calls.length,1,'Aborted widgets do not dispatch writes');
}
{
 let writes=0;const bridge={request:async(method)=>{if(method==='settings.all')return {settings:{'shell.jsonWidgets':{broken:true}}};writes++;return {saved:true};}};
 const store=createDefinitionStore(bridge);
 await assert.rejects(store.read(),/preserved/);
 await assert.rejects(store.save([]),/preserved/);assert.equal(writes,0);
}
{
 let value=[];const bridge={request:async(method,params)=>method==='settings.all'?{settings:{'shell.jsonWidgets':value}}:(value=params.value,{saved:true})};
 const store=createDefinitionStore(bridge);assert.deepEqual(await store.read(),[]);
 const entry={...model.instance(definition),active:true};
 await store.save([entry]);assert.equal((await store.read())[0].definition.id,definition.id);
 bridge.request=async()=>{throw Error('disk failed');};
 await assert.rejects(store.save([]),/disk failed/);assert.equal(value.length,1);
}
console.log('JSON widgets: contract parity, code rejection, approved actions, retirement and storage preservation pass.');

// A present corrupt record is not a fresh installation and cannot enable writes.
for(const raw of [null,{},false]) {
 let writes=0;const store=createDefinitionStore({request:async m=>m==='settings.all'?{settings:{'shell.jsonWidgets':raw}}:(writes++,{saved:true})});
 await assert.rejects(store.read(),/preserved/);await assert.rejects(store.save([]),/preserved/);assert.equal(writes,0);
}
