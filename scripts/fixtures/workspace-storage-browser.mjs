// Real browser transactions, independent scenes and file artifacts; no host, account or provider.
import {chromium,webkit} from 'playwright';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
const root=new URL('../../',import.meta.url),output=process.env.SESAME_STORAGE_OUTPUT||'build/workspace-storage-browser';
await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{try{
 if(req.url==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><html><title>Workspace storage qualification</title><script src="/dist/workspace-storage-model.js"></script><script src="/dist/workspace-indexeddb.js"></script><button id="export">Export fixture workspace</button><script>document.querySelector("#export").onclick=()=>{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([window.store.exportJSON()],{type:"application/json"}));a.download="workspace.json";a.click()}</script></html>');return}
 if(!['/dist/workspace-storage-model.js','/dist/workspace-indexeddb.js'].includes(req.url)){res.writeHead(404);res.end();return}res.setHeader('content-type','text/javascript');res.end(await readFile(new URL(req.url.slice(1),root)));
}catch{res.writeHead(500);res.end()}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const receipts=[];
try{for(const [name,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch({headless:true});
 try{const context=await browser.newContext({acceptDownloads:true});try{
  await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  const a=await context.newPage(),b=await context.newPage(),errors=[];a.on('pageerror',e=>errors.push(e.message));b.on('pageerror',e=>errors.push(e.message));await a.goto(origin);await b.goto(origin);
  await a.evaluate(async()=>{window.backend=OpenSesameWorkspaceIndexedDB.create(indexedDB);window.store=OpenSesameWorkspaceStorageModel.create(backend);await store.hydrate({'perch-items-v1':JSON.stringify([{id:'legacy',kind:'note',text:'Café 🪷',body:'Second line\n第二行'}])})});
  await b.evaluate(async()=>{window.backend=OpenSesameWorkspaceIndexedDB.create(indexedDB);window.store=OpenSesameWorkspaceStorageModel.create(backend);await store.hydrate({})});
  const results=await Promise.all([a.evaluate(async()=>{try{await store.setItem('open-sesame-projects-v1','[{"id":"a","name":"A"}]');return 'committed'}catch(e){return e.code}}),b.evaluate(async()=>{try{await store.setItem('open-sesame-projects-v1','[{"id":"b","name":"B"}]');return 'committed'}catch(e){return e.code}})]);
  assert.equal(results.filter(x=>x==='committed').length,1);assert.equal(results.filter(x=>x==='conflict').length,1);
  await a.evaluate(()=>store.reconcile());await b.evaluate(()=>store.reconcile());
  assert.equal(await a.evaluate(()=>store.getItem('open-sesame-projects-v1')),await b.evaluate(()=>store.getItem('open-sesame-projects-v1')));
  await a.reload();await a.evaluate(async()=>{window.backend=OpenSesameWorkspaceIndexedDB.create(indexedDB);window.store=OpenSesameWorkspaceStorageModel.create(backend);await store.hydrate({})});
  assert.match(await a.evaluate(()=>store.getItem('open-sesame-items-v1')),/Café 🪷/);
  const downloadPromise=a.waitForEvent('download');await a.locator('#export').click();const download=await downloadPromise;assert.equal(await download.failure(),null);const bytes=await readFile(await download.path(),'utf8');assert.equal(bytes,await a.evaluate(()=>store.exportJSON()));await writeFile(path.join(output,name+'-workspace.json'),bytes);
  await b.evaluate(async text=>{await store.reconcile();await store.importJSON(text,{mode:'replace',expectedRevision:store.revision})},bytes);
  assert.equal(await b.evaluate(()=>store.exportJSON()),bytes);
  await context.close();assert.deepEqual(errors,[]);receipts.push({browser:name,raceResults:results,restarted:true,unicodeDownloadBytes:Buffer.byteLength(bytes),roundTrip:true,errors});
 }catch(e){await context.close();throw e}}finally{await browser.close()}
}
await writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,receipts},null,2));console.log(JSON.stringify({passed:true,receipts}));
}finally{await new Promise(resolve=>server.close(resolve))}
