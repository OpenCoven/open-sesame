// Optional real-browser qualification over authored source; no native host or provider is available.
import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {checkMobilePreservation} from './mobile-preservation.mjs';
const origin=process.env.SESAME_FIXTURE_ORIGIN||'http://127.0.0.1:4196';
const output=process.env.SESAME_FIXTURE_OUTPUT;
const receipts=[];
for(const [name,type] of Object.entries({chromium,webkit})){
 const browser=await type.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  await page.goto(origin+'/dist/index.html');
  await page.waitForFunction(()=>window.OpenSesameMobile?.active);
  assert.equal(await page.evaluate(async()=>{
   const serif=await document.fonts.load('16px "Open Sesame Mobile Serif"'),sans=await document.fonts.load('16px "Open Sesame Mobile Sans"');
   return serif.length===1&&sans.length===1&&serif[0].status==='loaded'&&sans[0].status==='loaded';
  }),true,'Bundled fonts load without external services');
  for(const [width,height] of [[320,640],[390,844],[768,1024],[1024,768],[844,390]]){
   await page.setViewportSize({width,height});
   await page.waitForFunction(()=>Math.abs(document.getElementById('widget-panel').getBoundingClientRect().width-innerWidth)<1);
   for(const destination of ['projects','widgets','focus','console','today']){
    await page.locator(`[data-mobile-destination="${destination}"]`).click();
    const rect=await page.locator('.mobile-navigation').boundingBox();assert(rect.y>=0&&rect.y+rect.height<=height+1,`${name} ${width} navigation reachable`);
    assert.equal(await page.locator(`[data-mobile-destination="${destination}"]`).getAttribute('aria-current'),'page');
   }
   if(output){await fs.mkdir(output,{recursive:true});await page.screenshot({path:path.join(output,`${name}-${width}x${height}.png`)});}
   receipts.push({browser:name,width,height,destinations:5});
  }
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{
   window.__mobileNodes=['pane-items','pane-focus','agents-workspace','pane-familiars','pane-plugins'].map(id=>document.getElementById(id));
   items=[{id:'fixture-note',kind:'note',text:'Literal <img src=x onerror=alert(1)>',updatedAt:1},{id:'fixture-task',kind:'task',text:'Task',done:false},{id:'fixture-bookmark',kind:'bookmark',text:'Read',url:'https://example.org',readingLater:true}];saveItems();
   focusRemaining=123;renderFocus();
  });
  await page.waitForFunction(()=>document.querySelector('.mobile-note-card').textContent.includes('Literal <img'));
  assert.equal(await page.locator('.mobile-card img').count(),0);
  assert.match(await page.locator('.mobile-today').innerText(),/1 open · 0 completed/);
  assert.match(await page.locator('.mobile-today').innerText(),/1 saved for later/);
  await page.evaluate(()=>{items[0].text='Edited note';items[1].done=true;saveItems()});
  await page.waitForFunction(()=>document.querySelector('.mobile-today').textContent.includes('Edited note'));
  assert.match(await page.locator('.mobile-today').innerText(),/0 open · 1 completed/);
  await page.locator('#mobile-capture').click();await page.locator('#capture-input').fill('A preserved draft');
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!OpenSesameLauncher.active);
  assert.equal(await page.evaluate(()=>state.expanded),true);
  assert.equal(await page.locator('#capture-input').inputValue(),'A preserved draft');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'mobile-capture');
  for(let i=0;i<5;i++)for(const destination of ['projects','widgets','focus','console','today'])await page.locator(`[data-mobile-destination="${destination}"]`).click();
  assert.equal(await page.evaluate(()=>__mobileNodes.every(n=>n===document.getElementById(n.id))),true);
  await page.locator('#mobile-capture').click();assert.equal(await page.locator('#capture-input').inputValue(),'A preserved draft');
  await page.setViewportSize({width:390,height:360});await page.locator('#launcher-return').click();
  await page.setViewportSize({width:320,height:640});await page.evaluate(()=>document.documentElement.style.fontSize='32px');
  const large=await page.locator('.mobile-navigation').boundingBox();assert(large.y+large.height<=641);
  assert.equal(await page.locator('.mobile-navigation').evaluate(nav=>[...nav.querySelectorAll('button')].every(b=>{const text=b.querySelector('span').getBoundingClientRect(),r=b.getBoundingClientRect();return text.left>=r.left&&text.right<=r.right+1})),true,'Large-text destination labels fit their controls');
  assert.equal(await page.locator('.mobile-navigation').evaluate(nav=>[...nav.querySelectorAll('button span')].every(n=>(()=>{const range=document.createRange();range.selectNodeContents(n);return new Set([...range.getClientRects()].map(r=>Math.round(r.top))).size===1})())),true,'Large-text destination names remain whole on reflowed rows');
  const largeCapture=await page.locator('#mobile-capture').boundingBox();assert(largeCapture.x>=0&&largeCapture.x+largeCapture.width<=321,'Large-text Capture remains within the viewport');
  await page.evaluate(()=>document.documentElement.style.fontSize='');
  receipts.push({browser:name,preservation:await checkMobilePreservation(page)});
  await page.setViewportSize({width:1280,height:800});await page.waitForFunction(()=>!OpenSesameMobile.active);
  assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('open-sesame-mobile')),false);
  assert.deepEqual(errors,[]);
 }finally{await browser.close()}
}
console.log(JSON.stringify({passed:true,receipts},null,2));
