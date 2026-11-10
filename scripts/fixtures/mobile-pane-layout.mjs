import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const origin=process.env.SESAME_FIXTURE_ORIGIN||'http://127.0.0.1:4196',output=process.env.SESAME_FIXTURE_OUTPUT,receipts=[];
for(const [name,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:320,height:640}});
  await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  await page.goto(origin+'/dist/index.html');await page.waitForFunction(()=>window.OpenSesameMobile?.active);
  await page.evaluate(()=>{for(const id of ['notes','bookmarks','reader','coven','agenda','shells','task-manager'])OpenSesameWidgetLifecycle.set(id,'active')});
  await page.evaluate(()=>{items=[{id:'narrow-note',kind:'note',text:'A narrow-screen note',body:'Saved body',updatedAt:1}];saveItems();changeScenario('items');openItem('narrow-note')});
  for(const [width,height]of [[320,640],[390,844],[568,320]]){
   await page.setViewportSize({width,height});
   const detail=await page.locator('#note-detail').boundingBox();assert(detail.width>=width-32,`${name} ${width}px selected note needs the available reading width; observed ${detail.width}`);
   await page.locator('#detail-title').fill('Edited on mobile');
   await page.evaluate(()=>{window.__finishNote=OpenSesameNotes.finish;OpenSesameNotes.finish=()=>false});
   await page.locator('#mobile-items-back').click();
   assert.equal(await page.evaluate(()=>selectedItemId),'narrow-note','Save veto keeps the current note mounted');
   await page.evaluate(()=>OpenSesameNotes.finish=window.__finishNote);
   await page.locator('#mobile-items-back').click();
   assert.equal(await page.evaluate(()=>selectedItemId),'');
   assert.equal(await page.evaluate(()=>document.activeElement.id),'capture-list');
   const list=await page.locator('#items-sidebar').boundingBox();assert(list.width>=width-32);
   await page.locator('#capture-list .thought-content').click();
   assert.equal(await page.locator('#detail-title').inputValue(),'Edited on mobile');
   if(output){await fs.mkdir(output,{recursive:true});await page.screenshot({path:path.join(output,`projects-${name}-${width}.png`)})}
   receipts.push({browser:name,width,height,detailWidth:detail.width,editRetained:true,backToCollection:true});
  }
  await page.setViewportSize({width:320,height:640});
  await page.evaluate(()=>document.documentElement.style.fontSize='32px');
  assert(await page.locator('#md-preview-content').evaluate(n=>parseFloat(getComputedStyle(n).fontSize)>=32),'Note prose follows large text');
  await page.locator('#mobile-items-back').click();
  assert.equal(await page.locator('#items-sidebar').isVisible(),true);
  await page.locator('#capture-list .thought-content').click();
  await page.evaluate(()=>document.documentElement.style.fontSize='');
  await page.setViewportSize({width:768,height:1024});
  assert.equal(await page.locator('#mobile-items-back').isVisible(),false,'Tablet keeps existing split-view controls');
  assert.equal(await page.locator('#items-sidebar').isVisible(),true);
  for(const [width,height]of [[320,640],[568,320],[844,390]]){
   await page.setViewportSize({width,height});
   await page.locator('[data-mobile-destination=focus]').click();
   await page.locator('#focus-start').click({trial:true,timeout:2000});
   await page.locator('[data-mobile-destination=widgets]').click();
   await page.locator('#plugins-search').fill('Tasks');
   await page.locator('[data-plugin="task-manager"]').click({trial:true,timeout:2000});
   await page.locator('#plugins-search').fill('');
  }
 }finally{await browser.close()}
}
console.log(JSON.stringify({passed:true,receipts},null,2));
