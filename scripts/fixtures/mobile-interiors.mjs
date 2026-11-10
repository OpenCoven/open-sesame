// Built-in mobile interiors with synthetic local content and real renderer owners.
import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const origin=process.env.SESAME_FIXTURE_ORIGIN||'http://127.0.0.1:4196',output=process.env.SESAME_FIXTURE_OUTPUT,receipts=[],failures=[];
for(const [name,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch({headless:true});
 try{
  for(const area of ['calendar','reader','tools']){
   const page=await browser.newPage({viewport:{width:320,height:640}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   try{
    await page.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
    await page.goto(origin+'/dist/index.html');await page.waitForFunction(()=>window.OpenSesameMobile?.active);
  await page.evaluate(()=>{for(const id of ['notes','bookmarks','reader','coven','agenda','shells','task-manager'])OpenSesameWidgetLifecycle.set(id,'active')});
    for(const [width,height,font]of [[320,640,16],[320,640,32],[568,320,16],[768,1024,32]]){
     await page.setViewportSize({width,height});await page.evaluate(font=>document.documentElement.style.fontSize=font+'px',font);
     if(area==='calendar'){
      await page.locator('[data-mobile-destination=focus]').click();await page.locator('button[data-focus-view=calendar]').click({timeout:2500});
      for(const mode of ['month','week','day'])await page.locator('[data-calendar-mode='+mode+']').click({timeout:2500});
      await page.locator('#focus-calendar-add').click({timeout:2500});await page.locator('#focus-event-title').fill('Mobile session '+width+' '+font);
      if(output){await fs.mkdir(output,{recursive:true});await page.screenshot({path:path.join(output,`calendar-editor-${name}-${width}-${font}.png`)})}
      for(let i=0;i<20;i++){await page.keyboard.press('Tab');assert(await page.evaluate(()=>document.getElementById('focus-calendar-editor').contains(document.activeElement)),'Calendar Tab stays in its editor')}
      await page.locator('#focus-event-duration').fill('25');await page.locator('#focus-calendar-editor button[type=submit]').click({timeout:2500});
      assert(await page.evaluate(title=>OpenSesameFocusCalendar.handoff().events.some(e=>e.title===title),'Mobile session '+width+' '+font),'Calendar writes through its canonical owner');
      await page.locator('#focus-calendar-add').click({timeout:2500});await page.keyboard.press('Escape');assert.equal(await page.locator('#focus-calendar-editor').isVisible(),false);
      assert.equal(await page.evaluate(()=>document.activeElement.id),'focus-calendar-add');
     }else if(area==='reader'){
      await page.evaluate(()=>{const data=openSesameReading.handoff();data.entries=[{id:'mobile-article',title:'Long local article with a readable title',url:'https://example.org/article',date:Date.now(),full:true,body:'<p>Saved article paragraph with meaningful readable text.</p>'.repeat(100)}];data.meta=[];data.entries.push(...Array.from({length:26},(_,i)=>({id:'other-'+i,title:'Other saved article '+i,url:'https://example.org/other-'+i,date:Date.now()-i,full:true,body:'<p>Other saved local content.</p>'})));data.scope='all';data.selected='mobile-article';data.hideRead=data.hideLater=false;openSesameReading.handoff(data);changeScenario('reading')});
      assert(await page.locator('#reading-title').evaluate((n,font)=>parseFloat(getComputedStyle(n).fontSize)>=font,font),'Reader title follows enlargement');
      assert(await page.locator('.reading-item-copy>span').first().evaluate((n,font)=>parseFloat(getComputedStyle(n).fontSize)>=font*.875,font),'Reading list follows enlargement');
      await page.locator('#reading-next').click({timeout:2500});await page.locator('#reading-prev').click({timeout:2500});
      const article=page.locator('#reading-article'),box=await article.boundingBox();if(width<=600)assert(box.width>=width-32,'Article receives phone reading width; observed '+box.width);
      assert(await article.evaluate((n,font)=>parseFloat(getComputedStyle(n).fontSize)>=font,font),'Article text follows enlargement');
      await article.evaluate(n=>n.scrollTop=200);const scroll=await article.evaluate(n=>n.scrollTop);assert(scroll>0,'Article really scrolls');
      await page.locator('[data-mobile-destination=today]').click();await page.locator('[data-mobile-destination=console]').click();await page.evaluate(()=>changeScenario('reading'));
      assert.equal(await article.evaluate(n=>n.scrollTop),scroll,'Navigation preserves the reading anchor');
      await page.locator('#reading-export-toggle').click({timeout:2500});
      await page.locator('#reading-later').click({timeout:2500});assert.equal(await page.locator('#reading-later').getAttribute('aria-pressed'),'true');
      await article.focus();await article.scrollIntoViewIfNeeded();
      const visible=await article.boundingBox(),header=await page.locator('.mobile-header').boundingBox(),nav=await page.locator('.mobile-navigation').boundingBox();
      assert(Math.min(nav.y,visible.y+visible.height)-Math.max(header.y+header.height,visible.y)>=font*1.6,'Focused article exposes at least one full text line');
     }else{
      await page.locator('[data-mobile-destination=widgets]').click();await page.locator('.tools-open').click({timeout:2500});
      const dialog=page.locator('.tools-dialog');await dialog.getByRole('button',{name:'meeting notes',exact:true}).click({timeout:2500});
      await dialog.getByRole('button',{name:'Install as a new instance',exact:true}).click({timeout:2500});
      assert(await page.evaluate(()=>OpenSesameTools.list().some(x=>x.definition.id==='meeting-notes')));
      const box=await dialog.boundingBox();assert(box.x>=0&&box.x+box.width<=width+1,'Tools dialog fits the viewport');
      assert(await dialog.locator('header h2').evaluate((n,font)=>parseFloat(getComputedStyle(n).fontSize)>=font,font),'Tools text follows enlargement');
      if(output){await fs.mkdir(output,{recursive:true});await page.screenshot({path:path.join(output,`tools-dialog-${name}-${width}-${font}.png`)})}
      await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),false);assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('tools-open')),true);
     }
     if(output){await fs.mkdir(output,{recursive:true});await page.screenshot({path:path.join(output,`${area}-${name}-${width}-${font}.png`)})}
     receipts.push({browser:name,area,width,height,font});
    }
    assert.deepEqual(errors,[]);
   }catch(error){failures.push({browser:name,area,error:error.message});}finally{await page.close()}
  }
 }finally{await browser.close()}
}
console.log(JSON.stringify({passed:!failures.length,receipts,failures},null,2));assert.deepEqual(failures,[]);
