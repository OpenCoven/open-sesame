// Optional renderer lifecycle fixture. The Playwright route replaces only the transport;
// actual application models, Coven client, xterm and mobile navigation run unchanged.
import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const origin=process.env.SESAME_FIXTURE_ORIGIN||'http://127.0.0.1:4196',output=process.env.SESAME_FIXTURE_OUTPUT;
function fixtureBridge(){
 const calls=[],terminals=new Set(),turns=new Map();let conversation={familiarId:'fixture',conversationId:'fixture-conversation',revision:1,sessionId:'fixture-session',harness:'codex',status:'ready',messages:Array.from({length:40},(_,i)=>({role:i%2?'assistant':'user',text:'Synthetic history '+i+' · '+('A long local fixture message. '.repeat(8))}))};
 const emit=message=>window.dispatchEvent(new CustomEvent('open-sesame-desktop-event',{detail:message}));
 function request(method,params={}){
  calls.push({method,params:JSON.parse(JSON.stringify(params))});
  if(method==='terminal.open'){terminals.add(params.id);return Promise.resolve(true)}
  if(method==='terminal.close'){terminals.delete(params.id);return Promise.resolve(true)}
  if(['terminal.resize','terminal.input','coven.permissions.cancel'].includes(method))return Promise.resolve(true);
  if(method==='coven.status')return Promise.resolve({available:true,transport:'cli',sdkHealth:'ok',version:'Synthetic fixture'});
  if(method==='coven.familiars')return Promise.resolve([{id:'fixture',name:'fixture',displayName:'Fixture familiar',description:'Synthetic lifecycle fixture · no provider',workspace:'/fixture',emoji:'◇'}]);
  if(method==='coven.open')return Promise.resolve(JSON.parse(JSON.stringify(conversation)));
  if(method==='coven.send')return new Promise(resolve=>turns.set(params.runId,{params,resolve}));
  if(method==='coven.cancel'){const turn=turns.get(params.runId);if(turn){turn.resolve({runId:params.runId,events:[]});turns.delete(params.runId)}return Promise.resolve(true)}
  return Promise.reject(Error('Unavailable in deterministic transport fixture: '+method));
 }
 window.openSesameBridge=Object.freeze({request,ready:Promise.resolve({available:true,platform:'fixture'}),available:true});
 window.__mobileTransportFixture={calls,terminals,turns,terminalOutput(id,text){emit({event:'terminal.data',id,data:btoa(text)})},stream(runId,text){const turn=turns.get(runId);if(!turn)throw Error('Missing fixture turn');emit({event:'coven.event',runId,familiarId:turn.params.familiarId,conversationId:turn.params.conversationId,payload:{type:'assistant',message:{content:[{type:'text',text}]}}})},finish(runId){const turn=turns.get(runId);if(!turn)throw Error('Missing fixture turn');conversation={...conversation,revision:2,messages:[...conversation.messages,{role:'user',text:turn.params.prompt},{role:'assistant',text:'Finished synthetic reply'}]};turns.delete(runId);turn.resolve({runId,events:[]})}};
}
const receipts=[];
for(const [name,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin!==origin)return route.abort();
   if(url.pathname==='/dist/bridge.js')return route.fulfill({contentType:'text/javascript',body:`(${fixtureBridge.toString()})();`});
   return route.continue();
  });
  await page.goto(origin+'/dist/index.html');await page.waitForFunction(()=>window.OpenSesameMobile?.active);
  await page.evaluate(()=>changeScenario('terminal'));await page.locator('#terminal-connect-open').click();
  await page.waitForFunction(()=>OpenSesameTerminal.inputTarget().ready);
  const target=await page.evaluate(()=>{window.__terminalNode=document.querySelector('.terminal-native');return OpenSesameTerminal.inputTarget()});
  await page.evaluate(id=>__mobileTransportFixture.terminalOutput(id,Array.from({length:80},(_,i)=>'retained terminal fixture '+i+'\r\n').join('')),target.sessionId);
  await page.waitForFunction(id=>openSesameTerminalScreens()[id]?.replace(/\s/g,'').includes('retainedterminalfixture79'),target.sessionId);
  await page.locator('#capture-input').fill('Unsent connected shell draft');
  for(let i=0;i<3;i++)for(const id of ['today','projects','widgets','focus','console'])await page.locator(`[data-mobile-destination=${id}]`).click();
  assert.equal(await page.evaluate(()=>OpenSesameTerminal.inputTarget().sessionId),target.sessionId);
  assert.equal(await page.evaluate(()=>__terminalNode===document.querySelector('.terminal-native')),true);
  assert.equal(await page.locator('#capture-input').inputValue(),'Unsent connected shell draft');
  assert.equal(await page.evaluate(()=>__mobileTransportFixture.calls.filter(c=>c.method==='terminal.open').length),1);
  assert.equal(await page.evaluate(()=>__mobileTransportFixture.calls.filter(c=>['terminal.close','terminal.input'].includes(c.method)).length),0);
  assert.match(await page.evaluate(id=>openSesameTerminalScreens()[id].replace(/\s/g,''),target.sessionId),/retainedterminalfixture/);
  await page.evaluate(()=>{OpenSesameWidgetLifecycle.set('coven','active');changeScenario('familiars')});
  await page.locator('#familiar-connect').click();await page.locator('#familiar-tab-fixture').click();
  await page.locator('#familiar-message').fill('Synthetic pending turn');
  await page.locator('#familiar-send').click();await page.waitForFunction(()=>OpenSesameCovenClient.busy);
  const run=await page.evaluate(()=>{window.__chatNode=document.getElementById('familiar-thread');window.__firstMessage=document.querySelector('#familiar-messages>article');const log=document.getElementById('familiar-messages');log.scrollTop=150;return [...__mobileTransportFixture.turns.keys()][0]});
  const scroll=await page.locator('#familiar-messages').evaluate(n=>n.scrollTop);assert(scroll>0,'Chat fixture must have real scrollable history');
  await page.locator('#familiar-message').fill('Next-turn draft while reply runs');
  await page.locator('[data-mobile-destination=today]').click();await page.evaluate(run=>__mobileTransportFixture.stream(run,'Streaming while hidden'),run);
  for(const id of ['projects','widgets','focus','console'])await page.locator(`[data-mobile-destination=${id}]`).click();
  assert.equal(await page.evaluate(()=>OpenSesameCovenClient.busy),true);
  assert.equal(await page.evaluate(()=>__chatNode===document.getElementById('familiar-thread')&&__firstMessage===document.querySelector('#familiar-messages>article')),true);
  assert.equal(await page.locator('#familiar-message').inputValue(),'Next-turn draft while reply runs');
  assert.equal(await page.locator('#familiar-messages').evaluate(n=>n.scrollTop),scroll,'Hidden streaming retains the reading anchor');
  const calls=await page.evaluate(()=>__mobileTransportFixture.calls);
  assert.equal(calls.filter(c=>c.method==='coven.send').length,1);assert.equal(calls.filter(c=>c.method==='coven.open').length,1);assert.equal(calls.filter(c=>c.method==='coven.cancel').length,0);
  assert.match(await page.locator('#familiar-messages').innerText(),/Streaming while hidden/);
  for(const [width,height]of [[320,640],[844,390],[390,844]]){
   await page.setViewportSize({width,height});
   await page.locator('#familiar-message').fill('Next-turn draft while reply runs');
   await page.locator('#familiar-stop').click({trial:true,timeout:2000});
   assert.equal(await page.evaluate(()=>OpenSesameCovenClient.busy),true);
  }
  await page.evaluate(run=>__mobileTransportFixture.finish(run),run);await page.waitForFunction(()=>!OpenSesameCovenClient.busy);
  await page.waitForFunction(()=>document.getElementById('familiar-messages').textContent.includes('Finished synthetic reply'));
  assert.equal(await page.locator('#familiar-message').inputValue(),'Next-turn draft while reply runs');
  assert.deepEqual(errors,[]);
  if(output){await fs.mkdir(output,{recursive:true});await page.screenshot({path:path.join(output,`transport-${name}.png`)})}
  receipts.push({browser:name,terminal:{sameSession:true,sameNode:true,opens:1,unintendedInput:0,closes:0},chat:{sameThread:true,sameHistoryNodes:true,sends:1,reopens:0,cancels:0,hiddenStream:true,nextDraft:true,scrollAnchor:true}});
 }finally{await browser.close()}
}
console.log(JSON.stringify({passed:true,evidence:'Synthetic renderer transport only; no real PTY, account, provider or companion',receipts},null,2));
