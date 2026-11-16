// Adversarial renderer recovery checks found during the fresh review. Synthetic host only.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=path.resolve(process.argv[2]||'build/ui-shell-recovery');await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{try{res.setHeader('Content-Type','text/javascript');res.end(await readFile(root+new URL(req.url,'http://localhost').pathname));}catch{res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
const findings=[];
const verify=(name,fn)=>{try{fn();findings.push({name,passed:true});}catch(error){findings.push({name,passed:false,error:error.message});}};
try{
 browser=await chromium.launch({headless:true});const page=await browser.newPage();
 await page.goto(`http://127.0.0.1:${server.address().port}/ui/package.json`);
 const result=await page.evaluate(async()=>{
  const {mount}=await import('/ui/widgets/declarative.js');const model=await import('/ui/definitions.js');
  const definition=await(await fetch('/dist/tools/meeting-notes/tool.json')).json();const field=definition.components[0].field;
  const delay=()=>new Promise(r=>setTimeout(r,30));
  const click=(s,label)=>[...s.querySelectorAll('button')].find(b=>b.textContent===label).click();
  const input=(s,text)=>{const el=s.querySelector('textarea');el.value=text;el.dispatchEvent(new Event('input'));};
  const make=async bridge=>{const surface=document.createElement('section');document.body.append(surface);const controller=new AbortController();const api=await mount({surface,signal:controller.signal,bridge,navigate:()=>{}});return {surface,controller,api};};
  const evidence={};
  {
   let storage=[{...model.instance(definition),active:true}],release,hold=true;let done=false;
   const bridge={request:async(m,p)=>{if(m==='settings.all')return {settings:{'shell.jsonWidgets':structuredClone(storage)}};if(m==='settings.set'){const snapshot=structuredClone(p.value);if(hold){hold=false;await new Promise(r=>release=r);}storage=snapshot;return {saved:true};}}};
   const old=await make(bridge);input(old.surface,'First lifetime draft');click(old.surface,'Save configuration');while(!release)await delay();
   old.controller.abort();const closing=Promise.resolve(old.api.dispose()).then(()=>done=true);await delay();evidence.drainedBeforeReply=done;release();await closing;
   const fresh=await make(bridge);evidence.restoredDraft=fresh.surface.querySelector('textarea').value;
   fresh.controller.abort();await fresh.api.dispose();
  }
  {
   const entries=[{...model.instance(definition),active:true},{...model.instance({...definition,name:'Second note'}),active:true}];let release,hold=true;const saves=[];
   const bridge={request:async(m,p)=>{if(m==='settings.all')return {settings:{'shell.jsonWidgets':entries}};if(m==='settings.set')return {saved:true};if(m==='items.save'){saves.push(structuredClone(p.item));if(hold){hold=false;await new Promise(r=>release=r);}return {item:{id:p.item.id}};}}};
   const live=await make(bridge);let cards=live.surface.querySelectorAll('.json-card');input(cards[0],'First note');click(cards[0],'Save note');while(!release)await delay();click(cards[1],'Turn off');await delay();release();await delay();evidence.statusAfterUnrelatedToggle=live.surface.querySelector('[role=status]').textContent;
   cards=live.surface.querySelectorAll('.json-card');input(cards[0],'Second note');click(cards[0],'Save note');await delay();evidence.unrelatedIdsDiffer=saves[0].id!==saves[1].id;
   live.controller.abort();await live.api.dispose();
  }
  {
   const entry={...model.instance(definition),active:true};let noteCalls=0;
   const bridge={request:async(m,p)=>{if(m==='settings.all')return {settings:{'shell.jsonWidgets':[entry]}};if(m==='settings.set')throw Error('Disk full');if(m==='items.save'){noteCalls++;return {item:{id:p.item.id}};}}};
   const live=await make(bridge);click(live.surface,'Remove widget');click(live.surface,'Confirm removal');await delay();click(live.surface,'Save note');await delay();evidence.noteAfterFailedRemoval=noteCalls;
   live.controller.abort();await live.api.dispose();
  }
  {
   const entry={...model.instance(definition),active:true};const saves=[];
   const bridge={request:async(m,p)=>{if(m==='settings.all')return {settings:{'shell.jsonWidgets':[entry]}};if(m==='items.save'){saves.push(structuredClone(p.item));throw Error('Reply lost');}}};
   const live=await make(bridge);input(live.surface,'Retry this');click(live.surface,'Save note');await delay();click(live.surface,'Save note');await delay();input(live.surface,'A different note');click(live.surface,'Save note');await delay();
   evidence.samePayloadReusesId=saves[0].id===saves[1].id;evidence.changedPayloadGetsId=saves[1].id!==saves[2].id;
   live.controller.abort();await live.api.dispose();
  }
  return evidence;
 });
 verify('teardown drains dispatched settings writes',()=>assert.equal(result.drainedBeforeReply,false));
 verify('new lifetime reads committed draft',()=>assert.equal(result.restoredDraft,'First lifetime draft'));
 verify('unrelated toggle preserves successful note result',()=>assert.equal(result.statusAfterUnrelatedToggle,'Note saved.'));
 verify('separate confirmed notes use separate IDs',()=>assert(result.unrelatedIdsDiffer));
 verify('failed removal restores usable controls',()=>assert.equal(result.noteAfterFailedRemoval,1));
 verify('same lost-reply payload reuses ID',()=>assert(result.samePayloadReusesId));
 verify('changed lost-reply payload gets a new ID',()=>assert(result.changedPayloadGetsId));
 const {createDefinitionStore}=await import(path.join(root,'ui/widgets/declarative-model.js'));
 let writes=0,refused=false;const store=createDefinitionStore({request:async m=>m==='settings.all'?{settings:{'shell.jsonWidgets':null}}:(writes++,{saved:true})});
 try{await store.read();}catch{refused=true;}try{await store.save([]);}catch{}
 verify('explicit null catalog is preserved',()=>{assert(refused);assert.equal(writes,0);});
 const {createPreferences}=await import(path.join(root,'ui/preferences.js'));
 for(const malformed of [{bad:true},42,false,[], '']){
  const calls=[],errors=[];const prefs=createPreferences({request:async(m,p)=>m==='settings.all'?{settings:{'shell.lastView':malformed}}:m==='widgets.list'?{widgets:{}}:(calls.push([m,p]),{saved:true})},e=>errors.push(e));
  await prefs.read();await prefs.save({lastView:'today',on:{today:true}});
  verify('malformed navigation preserved: '+JSON.stringify(malformed),()=>{assert(errors.length);assert.equal(calls.length,0);});
 }
 await writeFile(path.join(output,'observations.json'),JSON.stringify(result,null,2));
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await writeFile(path.join(output,'report.json'),JSON.stringify(findings,null,2));}
console.log(JSON.stringify(findings,null,2));if(findings.some(f=>!f.passed))process.exitCode=1;
