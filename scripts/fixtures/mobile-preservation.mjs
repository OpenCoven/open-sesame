import assert from 'node:assert/strict';

// Exercise real renderer owners with synthetic local content; no native/provider turn is available.
export async function checkMobilePreservation(page){
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{
  items=[{id:'mobile-note',kind:'note',text:'Open this exact note',body:'Long note\n'.repeat(100),updatedAt:10},{id:'mobile-reading',kind:'bookmark',text:'Saved article',url:'https://example.org',readingLater:true},...Array.from({length:25},(_,i)=>({id:'mobile-task-'+i,kind:'task',text:'Task '+i,createdAt:i,updatedAt:i,done:false}))];
  saveItems();OpenSesameWidgetLifecycle.set('task-manager','active');OpenSesamePageWidgets.open('builtin-task-manager');
 });
 await page.locator('#task-manager-title').fill('Keep this installed widget draft');
 await page.locator('#page-widget-view-projects').evaluate(n=>{n.scrollTop=200});
 const scroll=await page.locator('#page-widget-view-projects').evaluate(n=>n.scrollTop);assert(scroll>0,'Fixture must actually scroll the installed widget page');
 await page.locator('[data-mobile-destination=today]').click();
 await page.locator('[data-mobile-destination=projects]').click();
 assert.equal(await page.evaluate(()=>OpenSesamePageWidgets.active),true,'Destination navigation retains installed page selection');
 assert.equal(await page.locator('#task-manager-title').inputValue(),'Keep this installed widget draft');
 assert.equal(await page.locator('#page-widget-view-projects').evaluate(n=>n.scrollTop),scroll,'Installed widget page scroll anchor survives navigation');
 await page.locator('[data-mobile-destination=today]').click();
 await page.locator('.mobile-card').filter({hasText:'Latest note'}).click();
 assert.equal(await page.evaluate(()=>OpenSesamePageWidgets.active),false,'Explicit latest-note link reveals the native note');
 assert.equal(await page.evaluate(()=>selectedItemId),'mobile-note');
 assert(await page.locator('#detail-title').isVisible());
 await page.locator('[data-mobile-destination=today]').click();
 await page.locator('.mobile-card').filter({hasText:'Tasks'}).click();
 assert.equal(await page.locator('#projects-task').getAttribute('aria-selected'),'true','Task summary routes to native Tasks');
 await page.evaluate(()=>OpenSesamePageWidgets.open('builtin-task-manager'));
 assert.equal(await page.locator('#task-manager-title').inputValue(),'Keep this installed widget draft','Explicit native route preserves installed widget draft for reopening');
 await page.locator('[data-mobile-destination=today]').click();
 await page.locator('.mobile-card').filter({hasText:'Reading'}).focus();
 await page.keyboard.press('Enter');
 assert.equal(await page.locator('[data-reading-scope=later]').getAttribute('aria-selected'),'true','Reading summary routes to canonical saved-for-later collection');
 assert.equal(await page.evaluate(()=>document.getElementById('pane-reading').contains(document.activeElement)),true,'Keyboard routing moves focus into visible Reader');
 const definition=await page.request.get(new URL('/dist/tools/meeting-notes/tool.json',page.url()).href).then(r=>r.json());
 await page.evaluate(definition=>{
  const instance=OpenSesameToolsModel.instance({...definition,page:'focus'});instance.id='mobile-focus-notes';
  const value=JSON.stringify([instance]);localStorage.setItem('open-sesame-tools-v1',value);
  window.dispatchEvent(new StorageEvent('storage',{key:'open-sesame-tools-v1',newValue:value}));
  OpenSesamePageWidgets.open(instance.id);
 },definition);
 const notes=page.locator('#page-widget-view-focus textarea');await notes.fill('Retain this imported tool draft');
 await page.locator('[data-mobile-destination=today]').click();
 await page.locator('[data-mobile-destination=focus]').click();
 assert.equal(await notes.inputValue(),'Retain this imported tool draft');
 assert.equal(await page.evaluate(()=>OpenSesamePageWidgets.active),true);
 await page.locator('[data-mobile-destination=today]').click();
 await page.locator('.mobile-card').filter({hasText:'Focus'}).click();
 assert.equal(await page.evaluate(()=>OpenSesamePageWidgets.active),false,'Focus summary explicitly reveals the canonical timer');
 await page.locator('button[data-focus-view=calendar]').click();
 await page.locator('[data-mobile-destination=today]').click();
 await page.locator('.mobile-card').filter({hasText:'Focus'}).click();
 assert.equal(await page.locator('button[data-focus-view=agenda]').getAttribute('aria-selected'),'true');
 await page.locator('#focus-start').click();
 const deadline=await page.evaluate(()=>focusEnd);assert(deadline>Date.now());
 for(let i=0;i<3;i++)for(const id of ['console','widgets','projects','today','focus'])await page.locator(`[data-mobile-destination=${id}]`).click();
 assert.equal(await page.evaluate(()=>focusEnd),deadline,'Navigation retains the same running timer deadline');
 assert.equal(await page.evaluate(()=>focusRunning),true);
 await page.locator('#focus-start').click();
 await page.evaluate(()=>{OpenSesameFamiliars.prepareDraft('Queued disconnected familiar message');changeScenario('terminal')});
 await page.locator('#capture-input').fill('A shell draft, never sent');
 await page.locator('[data-mobile-destination=today]').click();
 await page.locator('[data-mobile-destination=console]').click();
 assert.equal(await page.evaluate(()=>state.scenario),'terminal','Saved Console subview survives destination navigation');
 assert.equal(await page.locator('#capture-input').inputValue(),'A shell draft, never sent');
 assert.equal(await page.evaluate(()=>localStorage.getItem('open-sesame-familiar-queued-draft-v1')),'Queued disconnected familiar message');
 assert.equal(await page.evaluate(()=>OpenSesameFamiliars.snapshot().connected),false,'A fixture draft never fabricates connection success');
 const script=await page.request.get(new URL('/dist/mobile-shell.js',page.url()).href).then(r=>r.text());
 const duplicate=await page.evaluate(source=>{
  let listeners=0;const add=EventTarget.prototype.addEventListener;EventTarget.prototype.addEventListener=function(...args){listeners++;return add.apply(this,args)};
  try{(0,eval)(source);return {listeners,headers:document.querySelectorAll('.mobile-header').length,navs:document.querySelectorAll('.mobile-navigation').length}}finally{EventTarget.prototype.addEventListener=add}
 },script);
 assert.deepEqual(duplicate,{listeners:0,headers:1,navs:1},'Repeated bootstrap must not create listeners or duplicate shell resources');
 return {installedTab:true,installedDraft:true,scrollAnchor:true,todayContentLinks:true,timerDeadline:true,shellDraft:true,disconnectedChatDraft:true,idempotentBootstrap:true};
}
