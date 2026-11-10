// Real installed renderer forms and local model writes; no provider or native calls.
import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const origin=process.env.SESAME_FIXTURE_ORIGIN||'http://127.0.0.1:4196',output=process.env.SESAME_FIXTURE_OUTPUT,receipts=[];
for(const [name,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:320,height:640}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  await page.goto(origin+'/dist/index.html');await page.waitForFunction(()=>window.OpenSesameMobile?.active);
  const definition=await page.request.get(origin+'/dist/tools/meeting-notes/tool.json').then(r=>r.json());
  await page.evaluate(definition=>{
   const instances=Object.keys(OpenSesameToolsModel.pages).map(page=>{
    const d={...definition,page,config:{...definition.config,reference:{label:'Long reference',default:''}},description:'Long description '.repeat(20),components:[...definition.components,{type:'text',label:'Long paragraph',text:'A real local form can include long prose. '.repeat(20)},{type:'metric',label:'Saved count',text:'42'},{type:'list',label:'Long saved content',items:Array.from({length:15},(_,i)=>i+' '+('UnbrokenContent'.repeat(15)))}]};
    const x=OpenSesameToolsModel.instance(d);x.id='mobile-form-'+page;return x;
   });
   const value=JSON.stringify(instances);localStorage.setItem('open-sesame-tools-v1',value);window.dispatchEvent(new StorageEvent('storage',{key:'open-sesame-tools-v1',newValue:value}));
  },definition);
  for(const [width,height,font]of [[320,640,16],[320,640,32],[568,320,16],[768,1024,32],[844,390,32]]){
   await page.setViewportSize({width,height});await page.evaluate(font=>document.documentElement.style.fontSize=font+'px',font);
   for(const owner of ['projects','widgets','focus','console','reader','media','live']){
    await page.evaluate(owner=>OpenSesamePageWidgets.open('mobile-form-'+owner),owner);
    const tab=page.locator('#page-widget-view-'+owner).locator('..').locator('.page-widget-host-toolbar [role=tab][aria-selected=true]');
    assert(await tab.evaluate((n,font)=>n.getBoundingClientRect().height>=44&&parseFloat(getComputedStyle(n).fontSize)>=font*.875,font),'Installed '+owner+' tab stays readable and reachable');
    await tab.click({trial:true,timeout:2500});
    const host=page.locator('#page-widget-view-'+owner),notes=host.locator('textarea'),reference=host.locator('input'),save=host.getByRole('button',{name:'Save configuration',exact:true});
    assert(await notes.evaluate((n,font)=>parseFloat(getComputedStyle(n).fontSize)>=font*.875,font),'Installed form text follows text enlargement');
    assert(await host.locator('li').first().evaluate((n,font)=>parseFloat(getComputedStyle(n).fontSize)>=font*.875,font),'Long installed content follows text enlargement');
    await notes.fill('Canonical local note '+owner+' '+width+' '+font);await reference.fill('https://example.org/'+('long-reference-'.repeat(30)));
    await save.click({timeout:2500});
    const saved=await page.evaluate(owner=>JSON.parse(localStorage.getItem('open-sesame-tools-v1')).find(x=>x.id==='mobile-form-'+owner).config.notes,owner);
    assert.equal(saved,await notes.inputValue(),'Save delegates to the installed configuration owner');
    const bounds=await host.evaluate(n=>({client:n.clientWidth,scroll:n.scrollWidth}));assert(bounds.scroll<=bounds.client+1,'Long form content wraps within the page');
    await host.getByRole('button',{name:'Save note',exact:true}).click({timeout:2500});
    assert(await page.evaluate(text=>items.some(n=>n.kind==='note'&&(n.text===text||n.body===text)),await notes.inputValue()),'Action writes through the canonical note owner');
    await page.evaluate(text=>{const saved=items.find(n=>n.kind==='note'&&(n.text===text||n.body===text));if(!setItemStatus(saved,'done'))throw Error('Fixture could not archive its saved note')},await notes.inputValue());
    receipts.push({browser:name,owner,width,height,font,configurationSaved:true,noteSaved:true});
   }
  }
  await page.evaluate(()=>OpenSesameWidgetLifecycle.set('task-manager','active'));
  for(const [width,height,font]of [[320,640,32],[568,320,16],[768,1024,32],[844,390,32]]){
   await page.setViewportSize({width,height});await page.evaluate(font=>{document.documentElement.style.fontSize=font+'px';OpenSesamePageWidgets.open('builtin-task-manager')},font);
   const title=page.locator('#task-manager-title'),task='Canonical mobile task '+width;
   assert(await title.evaluate((n,font)=>parseFloat(getComputedStyle(n).fontSize)>=font,font),'Built-in task form text follows enlargement');
   assert(await page.locator('#task-manager-submit').evaluate((n,font)=>parseFloat(getComputedStyle(n).fontSize)>=font,font),'Task action text follows enlargement');
   await page.locator('#task-manager-new-list').click({timeout:2500});await page.locator('#task-manager-list-name').fill('Mobile list '+width);
   await page.locator('#task-manager-list-form button[type=submit]').click({timeout:2500});
   await title.fill(task);await page.locator('#task-manager-priority').selectOption('high');await page.locator('#task-manager-submit').click({timeout:2500});
   assert(await page.evaluate(text=>items.some(n=>n.kind==='task'&&n.text===text),task),'Built-in form writes the shared task model');
   await page.locator('#task-manager-items .task-manager-title').filter({hasText:task}).click({timeout:2500});
   await title.fill('Edited '+task);await page.locator('#task-manager-submit').click({timeout:2500});
   assert(await page.evaluate(text=>items.some(n=>n.kind==='task'&&n.text==='Edited '+text),task));
   assert.equal(await page.locator('#task-manager-items').evaluate(n=>getComputedStyle(n).overflowY),'visible','The page owns scrolling rather than a collapsed inner task list');
   const row=page.locator('#task-manager-items .task-manager-title').filter({hasText:'Edited '+task});await row.scrollIntoViewIfNeeded();
   if(output){await fs.mkdir(output,{recursive:true});await page.screenshot({path:path.join(output,`tasks-${name}-${width}.png`)})}
   receipts.push({browser:name,owner:'builtin-task-manager',width,height,font,createList:true,createTask:true,editTask:true});
  }
  assert.deepEqual(errors,[]);
  if(output){await fs.mkdir(output,{recursive:true});await page.screenshot({path:path.join(output,`forms-${name}.png`)})}
 }finally{await browser.close()}
}
console.log(JSON.stringify({passed:true,evidence:'Installed renderer forms with local synthetic content only',receipts},null,2));
