// Actual authored workspace with a synthetic provider; never sends a real prompt.
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';
const {chromium,webkit}=await import('playwright'),root=process.cwd();
const template=fs.readFileSync('scripts/fixtures/widget-fit.js','utf8').match(/const bootstrap=(`[^]*?`);/)[1];
const png=process.env.IMAGE_REVIEW_PNG?'data:image/png;base64,'+fs.readFileSync(process.env.IMAGE_REVIEW_PNG).toString('base64'):null;
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');try{
 if(url.pathname==='/workspace'){const bootstrap=new Function('location','screen','return '+template)({origin:`http://127.0.0.1:${server.address().port}`},{width:1400,height:950});res.setHeader('Content-Type','text/html');res.end(fs.readFileSync('dist/index.html','utf8').replace('<head>','<head>'+bootstrap));return}
 const file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+'/dist/'))throw Error();res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file));
}catch{res.writeHead(404);res.end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));fs.mkdirSync('build/image-widget-review',{recursive:true});
try{for(const [name,engine] of Object.entries({chromium,webkit})){
 const browser=await engine.launch({headless:true});try{
 const page=await browser.newPage({viewport:{width:1400,height:950}});page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route(/https:\/\//,r=>r.abort());
 await page.goto(`http://127.0.0.1:${server.address().port}/workspace`);await page.waitForFunction(()=>!!window.OpenSesameImageGeneration);
 assert.deepEqual(await page.evaluate(()=>OpenSesameWidgetLifecycle.ids.filter(id=>OpenSesameWidgetLifecycle.isActive(id)).sort()),['agenda','local-media','shells','task-manager']);
 await page.evaluate(()=>{
  window.imageCalls=[];window.openSesameBridge={available:true,request(method,params){imageCalls.push({method,params});if(method==='image.status')return Promise.resolve({configured:true});if(method==='image.generate')return new Promise(resolve=>window.imageResolve=()=>resolve({id:params.id,image:window.fixturePng}));if(method==='image.save')return Promise.resolve({saved:true});return Promise.resolve({cancelled:true})}};
  state.size='full';OpenSesameWidgetLifecycle.set('image-generation','active');OpenSesamePageWidgets.open('builtin-image-generation');
 });
 await page.evaluate(p=>{if(p){window.fixturePng=p;return}const c=document.createElement('canvas');c.width=c.height=512;const context=c.getContext('2d');context.fillStyle='#d7c7ea';context.fillRect(0,0,512,512);context.fillStyle='#30213a';context.font='24px sans-serif';context.fillText('Image preview fixture',125,260);window.fixturePng=c.toDataURL('image/png')},png);await page.locator('#image-refresh').click();await page.waitForFunction(()=>document.getElementById('image-account').textContent.includes('connected'));
 assert.equal(await page.evaluate(()=>imageCalls.filter(x=>x.method==='image.generate').length),0);
 await page.locator('#image-prompt').fill('A bowl in soft morning light');await page.locator('#image-shape').selectOption('landscape');await page.locator('#image-generate').click();await page.evaluate(()=>imageResolve());await page.locator('#image-preview').waitFor({state:'visible'});
 await page.locator('#image-save').click();await page.waitForFunction(()=>document.getElementById('image-status').textContent==='PNG saved.');
 const previewBox=await page.locator('#image-preview').boundingBox(),canvasBox=await page.locator('.image-canvas').boundingBox();assert(previewBox.height<=canvasBox.height-20,'Generated image must fit inside its canvas without clipping');
 await page.screenshot({path:`build/image-widget-review/${name}-wide.png`});
 await page.evaluate(()=>{window.__OPEN_SESAME_SCREEN__={width:460,height:760};window.dispatchEvent(new Event('open-sesame-display-changed'))});await page.setViewportSize({width:460,height:800});
 const overflow=await page.locator('#image-generation').evaluate(n=>n.scrollWidth>n.clientWidth+1);assert.equal(overflow,false,'No horizontal overflow at compact width');
 await page.screenshot({path:`build/image-widget-review/${name}-compact.png`});
 await page.locator('#image-generate').click();await page.evaluate(()=>OpenSesameWidgetLifecycle.set('image-generation','inactive'));await page.evaluate(()=>imageResolve());
 assert.equal(await page.evaluate(()=>imageCalls.filter(x=>x.method==='image.cancel').length),1);
 assert.equal(await page.locator('#image-prompt').inputValue(),'A bowl in soft morning light');
 await page.evaluate(()=>{OpenSesameWidgetLifecycle.set('image-generation','active');OpenSesamePageWidgets.open('builtin-image-generation')});
 assert.equal(await page.locator('#image-prompt').inputValue(),'A bowl in soft morning light');assert.equal(await page.locator('#image-shape').inputValue(),'landscape');
 // Image Studio remains reachable when it is the only active Media widget.
 await page.evaluate(()=>{OpenSesameWidgetLifecycle.set('local-media','inactive');OpenSesamePageWidgets.open('builtin-image-generation')});
 assert.equal(await page.evaluate(()=>OpenSesameWorkspaceWidgets.available('media')),true);
 assert.equal(await page.locator('#image-generation').isVisible(),true);assert.equal(await page.locator('#lockin-media').isVisible(),false);
 await page.evaluate(()=>OpenSesameWidgetLifecycle.set('local-media','active'));
 const cancellations=()=>page.evaluate(()=>imageCalls.filter(x=>x.method==='image.cancel').length);
 let stopped=await cancellations();
 // Page departure and collapse retire the exact request and preserve the prior preview.
 for(const action of ['page','collapse','stop']){
  await page.locator('#image-generate').click();
  const previous=await page.locator('#image-preview').getAttribute('src');
  if(action==='page')await page.evaluate(()=>changeScenario('focus'));
  else if(action==='collapse')await page.evaluate(()=>OpenSesameWindow.collapse());
  else await page.locator('#image-stop').click();
  await page.evaluate(()=>imageResolve());assert.equal(await cancellations(),++stopped,action+' cancels exactly once');
  assert.equal(await page.locator('#image-preview').getAttribute('src'),previous,action+' late result is retired');
  await page.evaluate(()=>{state.size='full';state.expanded=true;render();OpenSesamePageWidgets.open('builtin-image-generation')});
  assert.equal(await page.locator('#image-prompt').inputValue(),'A bowl in soft morning light');
 }
 // Focusing content keeps the existing image widget mounted and does not resubmit.
 await page.evaluate(()=>{window.imageNode=document.getElementById('image-generation');OpenSesameContentFocus.enter()});
 assert.equal(await page.evaluate(()=>OpenSesameContentFocus.active&&imageNode===document.getElementById('image-generation')),true);
 await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>OpenSesameContentFocus.active),false);
 const sent=await page.evaluate(()=>imageCalls.filter(x=>x.method==='image.generate').length);
 await page.evaluate(()=>OpenSesameWidgetLifecycle.set('image-generation','uninstalled'));
 await page.evaluate(()=>{OpenSesameWidgetLifecycle.set('image-generation','active');OpenSesamePageWidgets.open('builtin-image-generation')});
 assert.equal(await page.locator('#image-prompt').inputValue(),'A bowl in soft morning light');
 assert.equal(await page.evaluate(()=>imageCalls.filter(x=>x.method==='image.generate').length),sent,'Reinstallation never generates');
 assert.deepEqual(errors,[]);console.log(`PASS ${name}: install, explicit generation, preview, native-save request, compact fit, cancellation, stale retirement and draft retention.`);
 }finally{await browser.close()}
}}finally{await new Promise(r=>server.close(r))}
