// Which selectors make a surface switch expensive: Chromium selector statistics over a loop of switches.
// Authored UI with synthetic native replies only. Usage: node scripts/review-selector-cost.mjs [--rounds 5] [--top 40] [--root dir]
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {surfaces} from './design-baseline-matrix.mjs';
const args=process.argv.slice(2),option=name=>{const i=args.indexOf('--'+name);return i<0?null:args[i+1]};
const rounds=Number(option('rounds')??5),top=Number(option('top')??40),root=path.resolve(option('root')||process.cwd());
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+'/dist/')&&!file.startsWith(root+'/scripts/fixtures/')){res.writeHead(404);res.end();return}try{const body=fs.readFileSync(file);res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(body)}catch{res.writeHead(404);res.end()}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
try{
  const context=await browser.newContext({viewport:{width:1700,height:1100},reducedMotion:'reduce'});await context.route(/^https?:\/\/(?!127\.0\.0\.1)/,route=>route.abort());
  const page=await context.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/scripts/fixtures/widget-fit.html`);
  await page.waitForFunction(()=>window.frames.length>0&&!!window.frames[0].OpenSesameContentFocus);const frame=page.frames()[1];
  await frame.evaluate(async()=>{OpenSesameLauncher.close(true);state.size='full';state.expanded=true;render();await OpenSesameWindow.open();for(const id of OpenSesameWidgetLifecycle.ids)OpenSesameWidgetLifecycle.set(id,'active')});
  await page.locator('#viewport').evaluate(node=>{node.style.width='1180px';node.style.height='740px'});
  const switchAll=async()=>{for(const surface of surfaces)await frame.evaluate(id=>new Promise(resolve=>{changeScenario(id);requestAnimationFrame(()=>requestAnimationFrame(resolve))}),surface.id)};
  await switchAll();
  await browser.startTracing(page,{categories:['devtools.timeline','disabled-by-default-blink.debug']});
  for(let round=0;round<rounds;round++)await switchAll();
  const trace=JSON.parse((await browser.stopTracing()).toString());
  const selectors=new Map();let recalcs=0,elements=0,styleMicros=0;
  for(const event of trace.traceEvents){
    if(event.name==='UpdateLayoutTree'&&event.ph==='X'){recalcs++;elements+=event.args?.elementCount||0;styleMicros+=event.dur||0}
    if(event.name==='SelectorStats')for(const row of event.args?.selector_stats?.selector_timings||[]){
      const entry=selectors.get(row.selector)||{elapsed:0,attempts:0,matches:0,fastReject:0};
      entry.elapsed+=row['elapsed (us)'];entry.attempts+=row.match_attempts;entry.matches+=row.match_count;entry.fastReject+=row.fast_reject_count;selectors.set(row.selector,entry);
    }
  }
  const switches=rounds*surfaces.length,ranked=[...selectors].sort((a,b)=>b[1].elapsed-a[1].elapsed),total=ranked.reduce((sum,[,entry])=>sum+entry.elapsed,0);
  const summary={switches,recalcsPerSwitch:+(recalcs/switches).toFixed(1),elementsPerSwitch:Math.round(elements/switches),styleMsPerSwitch:+(styleMicros/1000/switches).toFixed(2),selectorsTimed:ranked.length,selectorMsPerSwitch:+(total/1000/switches).toFixed(2),
    top:ranked.slice(0,top).map(([selector,entry])=>({selector:selector.slice(0,220),msPerSwitch:+(entry.elapsed/1000/switches).toFixed(3),attemptsPerSwitch:Math.round(entry.attempts/switches),matchRate:+(entry.matches/Math.max(1,entry.attempts)).toFixed(3)}))};
  const out=path.resolve('build/design-baseline');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'selector-cost.json'),JSON.stringify(summary,null,2));
  console.log(JSON.stringify({...summary,top:undefined}));for(const row of summary.top)console.log(`${row.msPerSwitch.toFixed(3)} ms  ${row.attemptsPerSwitch} tries  ${(row.matchRate*100).toFixed(1)}% hit  ${row.selector}`);
  console.log('Selector timing adds tracing overhead; compare runs with each other, not with untraced budgets. Synthetic host only.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
