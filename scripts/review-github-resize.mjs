// Authored application fixture only: no GitHub account, network reads or native app actions.
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),root=process.cwd(),out=path.resolve(process.env.GITHUB_RESIZE_OUTPUT||'build/github-resize-browser'),baseline=process.env.GITHUB_RESIZE_BASELINE==='1';
fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+pathname);
 if(!file.startsWith(root+'/dist/')&&!['/scripts/fixtures/widget-fit.html','/scripts/fixtures/widget-fit.js'].includes(pathname)){res.writeHead(404);res.end();return}
 try{const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'}[path.extname(file)]||'application/octet-stream';res.setHeader('Content-Type',type);res.setHeader('Cache-Control','no-store');const previous=baseline&&['/dist/page-widgets.js','/dist/github-monitor.css'].includes(pathname);res.end(previous?execFileSync('git',['show','HEAD:'+pathname.slice(1)],{cwd:root}):fs.readFileSync(file))}catch{res.writeHead(404);res.end()}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser,page,frame;const errors=[],measurements=[];
try{
 browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1600,height:1050}});page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));await page.route(/https:\/\//,route=>route.abort());
 await page.goto(`http://127.0.0.1:${server.address().port}/scripts/fixtures/widget-fit.html`);frame=page.frames().find(f=>f!==page.mainFrame());await frame.waitForFunction(()=>!!window.OpenSesamePageWidgets,null,{timeout:8000});
 await frame.evaluate(()=>{OpenSesameWidgetLifecycle.set('github','active');__fitCheck('app-github')});await frame.locator('.github-entry').first().waitFor();await frame.locator('#github-monitor-repository').selectOption('Studio/interface');await frame.waitForFunction(()=>document.getElementById('github-monitor-project-name').textContent==='Studio/interface');
 await frame.locator('#github-monitor-search').fill('widget');await frame.evaluate(()=>document.getElementById('github-monitor-search').focus({preventScroll:true}));
 const before=await frame.evaluate(()=>({calls:__fixtureCalls.filter(m=>m.startsWith('github.')).length,count:document.querySelectorAll('.github-entry').length}));
 for(const [width,height] of [[1180,740],[800,500],[390,320],[560,360],[460,640],[1180,740]]){
  await page.locator('#viewport').evaluate((node,size)=>{node.style.width=size.width+'px';node.style.height=size.height+'px'},{width,height});
  await frame.waitForFunction(()=>{const tab=document.querySelector('[data-page-widget="builtin-github"]'),strip=tab.parentElement,a=tab.getBoundingClientRect(),b=strip.getBoundingClientRect();return a.left>=b.left+strip.clientLeft-2&&a.right<=b.left+strip.clientLeft+strip.clientWidth+2},null,{timeout:2500});
  const measured=await frame.evaluate(()=>{const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}},host=document.getElementById('github-monitor'),cards=document.getElementById('github-monitor-cards'),tab=document.querySelector('[data-page-widget="builtin-github"]');return {viewport:[innerWidth,innerHeight],host:rect(host),firstEntry:rect(document.querySelector('.github-entry')),tab:rect(tab),strip:rect(tab.parentElement),columns:getComputedStyle(cards).gridTemplateColumns.split(' ').length,overflow:host.scrollWidth>host.clientWidth+2,repository:document.getElementById('github-monitor-repository').value,query:document.getElementById('github-monitor-search').value,focus:document.activeElement.id,count:document.querySelectorAll('.github-entry').length}});
  assert.equal(measured.overflow,false);assert.equal(measured.repository,'Studio/interface');assert.equal(measured.query,'widget');assert.equal(measured.focus,'github-monitor-search');assert.equal(measured.count,before.count);assert.equal(measured.viewport[0],width);assert.equal(measured.viewport[1],height);
  if(width===1180)assert.equal(measured.columns,3);if(width===800)assert.equal(measured.columns,2);if(width===560||width===390)assert.equal(measured.columns,1);
  if(width===560&&height===360)assert.ok(measured.firstEntry.top+25<=measured.host.bottom,'Short native-minimum window exposes activity without scrolling past the controls');
  measurements.push(measured);await frame.locator('#widget-panel').screenshot({path:path.join(out,`${width}x${height}.png`)});
 }
 assert.equal(await frame.evaluate(()=>__fixtureCalls.filter(m=>m.startsWith('github.')).length),before.calls,'Resizing never refreshes or remounts GitHub');
 await frame.locator('[data-github-collection="issues"]').click();await page.locator('#viewport').evaluate(node=>{node.style.width='560px';node.style.height='360px'});
 await frame.waitForFunction(()=>document.querySelector('[data-github-collection="issues"]').getAttribute('aria-selected')==='true');
 await frame.evaluate(()=>{const host=document.getElementById('github-monitor');host.scrollTop=host.scrollHeight});
 const footer=await frame.evaluate(()=>{const host=document.getElementById('github-monitor'),last=document.querySelector('[data-collection="issues"] .github-entry:last-child'),a=host.getBoundingClientRect(),b=last.getBoundingClientRect();return {hostBottom:a.bottom,lastBottom:b.bottom,scroll:host.scrollTop}});assert.ok(footer.scroll>0);assert.ok(footer.lastBottom<=footer.hostBottom+2,'Rows remain reachable in the bounded content scroller');
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({baseline,measurements,before,footer,errors},null,2)+'\n');console.log('PASS GitHub resize: detached authored app fills viewport, selected tab stays visible, 3/2/1-column reflow, short-window activity, repository/query/focus retention, no resize reads and reachable scrolling. Synthetic metadata only.');
}catch(error){fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({baseline,measurements,errors,error:String(error)},null,2)+'\n');if(frame)await frame.locator('#widget-panel').screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
