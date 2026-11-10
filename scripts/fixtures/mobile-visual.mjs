// Reference-derived presentation checks over canonical production models, without prototype state.
import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const origin=process.env.SESAME_FIXTURE_ORIGIN||'http://127.0.0.1:4196',output=process.env.SESAME_FIXTURE_OUTPUT,receipts=[];
for(const [name,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:320,height:640}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  await page.addInitScript(()=>{if(window===window.top)localStorage.setItem('opensesame.mobile.prototype.v1',JSON.stringify({items:[{type:'task',title:'PROTOTYPE_ONLY_TASK'}],familiar:'Kitty'}))});
  await page.goto(origin+'/dist/index.html');await page.waitForFunction(()=>window.OpenSesameMobile?.active);
  await page.evaluate(()=>{for(const id of ['notes','bookmarks','reader','coven','agenda','shells','task-manager'])OpenSesameWidgetLifecycle.set(id,'active')});
  assert(!await page.locator('.mobile-today').innerText().then(t=>/PROTOTYPE_ONLY_TASK|Kitty/.test(t)),'Prototype storage never populates production Today');
  await page.evaluate(()=>{
   projects=[{id:'visual-project',name:'OpenCoven'}];
   items=[{id:'visual-note',kind:'note',text:'A real model note',body:'Make tools feel like a place you want to return to.',projectId:'visual-project',updatedAt:3},{id:'visual-task',kind:'task',text:'Canonical task',projectId:'visual-project',done:false},{id:'visual-link',kind:'bookmark',text:'Real reading link',url:'https://example.org/reading',readingLater:true}];saveItems();
  });
  await page.waitForFunction(()=>document.querySelector('.mobile-note-card').textContent.includes('Make tools feel'));
  assert.equal(await page.evaluate(async()=>{const faces=await document.fonts.load('italic 16px "Open Sesame Mobile Serif"');return faces.length===1&&faces[0].status==='loaded'}),true);
  assert.equal(await page.locator('#widget-panel').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(18, 18, 20)');
  assert.equal(await page.locator('.mobile-note-card').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(221, 214, 225)');
  for(const [width,height]of [[320,640],[390,844],[768,1024],[844,390]]){
   await page.setViewportSize({width,height});
   assert.equal(await page.locator('.mobile-focus-card>span').first().evaluate(n=>{const r=document.createRange();r.selectNodeContents(n);return new Set([...r.getClientRects()].map(x=>Math.round(x.top))).size}),1,'Timer numerals stay on one line');
   const a=await page.locator('.mobile-focus-card').boundingBox(),b=await page.locator('.mobile-note-card').boundingBox();assert(Math.abs(a.y-b.y)<1,'Reference essentials share a row at normal text');
   assert.equal(await page.locator('.mobile-navigation [data-mobile-destination=console] use').count(),1);
   if(output){await fs.mkdir(output,{recursive:true});await page.screenshot({path:path.join(output,`today-${name}-${width}.png`)})}
   receipts.push({browser:name,width,height,essentialsRow:true,timerSingleLine:true});
  }
  await page.evaluate(()=>OpenSesameWidgetLifecycle.set('task-manager','inactive'));
  await page.waitForTimeout(50);
  assert.equal(await page.locator('.mobile-task-check').isDisabled(),true,'Today cannot mutate an inactive Task Manager');
  await page.evaluate(()=>OpenSesameWidgetLifecycle.set('task-manager','active'));
  await page.locator('.mobile-task-open').click();
  assert.equal(await page.locator('#task-manager-title').inputValue(),'Canonical task','Today opens the real task editor');
  await page.locator('[data-mobile-destination=today]').click();
  await page.locator('.mobile-task-check').click();
  await page.waitForFunction(()=>document.querySelector('.mobile-task-section').textContent.includes('0 open · 1 completed'));
  assert.equal(await page.evaluate(()=>OpenSesameItemWorkflow.isArchived(items.find(n=>n.id==='visual-task'))),true);
  await page.locator('.mobile-capture-entry').click();await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('mobile-capture-entry')),true);
  await page.locator('.mobile-capture-entry').click();await page.locator('#capture-input').fill('/projects');
  await page.locator('#capture-form').evaluate(form=>form.requestSubmit());
  await page.waitForFunction(()=>state.scenario==='items'&&!OpenSesameLauncher.active);
  assert.equal(await page.evaluate(()=>document.activeElement!==document.body&&document.activeElement.getClientRects().length>0),true,'A home capture command returns focus to visible content');
  await page.locator('[data-mobile-destination=today]').click();
  await page.evaluate(()=>OpenSesameWidgetLifecycle.set('coven','inactive'));
  await page.locator('.mobile-familiar-entry').click();
  assert.equal(await page.evaluate(()=>state.scenario),'plugins');
  await page.locator('[data-plugin=coven]').click({trial:true});
  assert.equal(await page.evaluate(()=>OpenSesameWidgetLifecycle.isActive('coven')),false,'Availability route never activates the provider widget');
  await page.evaluate(()=>OpenSesameWidgetLifecycle.set('coven','active'));
  await page.locator('[data-mobile-destination=today]').click();
  await page.locator('.mobile-familiar-entry').click();
  assert.equal(await page.evaluate(()=>state.scenario),'familiars');assert.equal(await page.evaluate(()=>OpenSesameFamiliars.snapshot().connected),false);
  await page.setViewportSize({width:320,height:640});
  await page.evaluate(()=>document.documentElement.style.fontSize='32px');
  const brand=await page.locator('.mobile-brand').boundingBox(),capture=await page.locator('#mobile-capture').boundingBox();
  assert(brand.y+brand.height<=capture.y||brand.x+brand.width<=capture.x,'Enlarged brand leaves Capture unobscured');
  assert.deepEqual(errors,[]);
 }finally{await browser.close()}
}
console.log(JSON.stringify({passed:true,receipts},null,2));
