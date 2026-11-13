// The interaction budget in a real engine: wall time for one surface switch including the forced style and layout flush.
// Runs in WebKit (the shipped engine family) and Chromium. Authored UI with synthetic native replies only.
// Usage: node scripts/review-switch-cost.mjs [--rounds 15] [--browsers webkit,chromium] [--root dir] [--json file] [--surfaces] [--budget] [--without-has [pattern]]
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {surfaces} from './design-baseline-matrix.mjs';
const args=process.argv.slice(2),option=name=>{const i=args.indexOf('--'+name);return i<0?null:args[i+1]};
const rounds=Number(option('rounds')??15),root=path.resolve(option('root')||process.cwd()),names=(option('browsers')||'webkit,chromium').split(',');
// --without-has [pattern] measures the cost of :has() rules by serving stylesheets with those rules removed (optionally only
// rules whose selector matches the pattern); source files are untouched.
const hasAt=args.indexOf('--without-has'),hasPattern=hasAt<0?null:new RegExp(args[hasAt+1]&&!args[hasAt+1].startsWith('--')?args[hasAt+1]:'.');
const experiment=hasPattern?css=>css.replace(/(^|\})([^{}]*:has\([^{}]*)\{[^{}]*\}/g,(match,lead,selector)=>hasPattern.test(selector)?lead:match):null;
const playwright=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+'/dist/')&&!file.startsWith(root+'/scripts/fixtures/')){res.writeHead(404);res.end();return}try{let body=fs.readFileSync(file);if(experiment&&file.endsWith('.css'))body=Buffer.from(experiment(String(body)));res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(body)}catch{res.writeHead(404);res.end()}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const result={root,rounds,engines:{}};
try{
  for(const name of names){
    const browser=await playwright[name].launch({headless:true});
    try{
      const context=await browser.newContext({viewport:{width:1700,height:1100},reducedMotion:'reduce'});await context.route(/^https?:\/\/(?!127\.0\.0\.1)/,route=>route.abort());
      const page=await context.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/scripts/fixtures/widget-fit.html`);
      await page.waitForFunction(()=>window.frames.length>0&&!!window.frames[0].OpenSesameContentFocus);const frame=page.frames()[1];
      await frame.evaluate(async()=>{OpenSesameLauncher.close(true);state.size='full';state.expanded=true;render();await OpenSesameWindow.open();for(const id of OpenSesameWidgetLifecycle.ids)OpenSesameWidgetLifecycle.set(id,'active')});
      await page.locator('#viewport').evaluate(node=>{node.style.width='1180px';node.style.height='740px'});
      const ids=surfaces.map(surface=>surface.id);
      // One warm pass, then timed passes. Each sample is script plus a forced synchronous style and layout flush.
      const samples=await frame.evaluate(async({ids,rounds})=>{
        const frameDone=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))),times={};
        for(const id of ids){changeScenario(id);await frameDone()}
        for(let round=0;round<rounds;round++)for(const id of ids){
          const start=performance.now();changeScenario(id);const scripted=performance.now();void document.body.offsetHeight;getComputedStyle(document.getElementById('widget-panel')).color;const end=performance.now();
          (times[id]??=[]).push(end-start);(times['script:'+id]??=[]).push(scripted-start);await frameDone();
        }
        return times;
      },{ids,rounds});
      const median=list=>[...list].sort((a,b)=>a-b)[Math.floor(list.length/2)],mean=list=>list.reduce((sum,value)=>sum+value,0)/list.length;
      const per=Object.fromEntries(ids.map(id=>[id,+mean(samples[id]).toFixed(2)])),script=Object.fromEntries(ids.map(id=>[id,+mean(samples['script:'+id]).toFixed(2)])),all=Object.values(per);
      // Means are reported because WebKit rounds timers to a millisecond; a mean over many samples recovers the resolution.
      result.engines[name]={version:browser.version(),medianMs:+median(all).toFixed(2),worstMs:Math.max(...all),meanMs:+mean(all).toFixed(2),scriptMeanMs:+mean(Object.values(script)).toFixed(2),perSurface:per,scriptPerSurface:script};
      console.log(`${name} ${browser.version()}: mean ${result.engines[name].meanMs} ms per switch (script ${result.engines[name].scriptMeanMs} ms, style and layout ${(result.engines[name].meanMs-result.engines[name].scriptMeanMs).toFixed(2)} ms), worst surface ${result.engines[name].worstMs} ms`);if(args.includes('--surfaces'))console.log(JSON.stringify(per),JSON.stringify(script));
    }finally{await browser.close()}
  }
  // --budget fails the run when an engine's mean switch exceeds its ceiling in scripts/design-budget.json.
  if(args.includes('--budget')){
    const ceilings=JSON.parse(fs.readFileSync('scripts/design-budget.json','utf8')).interaction||{},over=Object.entries(result.engines).filter(([name,engine])=>ceilings[name]&&engine.meanMs>ceilings[name].meanSwitchMs).map(([name,engine])=>`${name} ${engine.meanMs} ms exceeds ${ceilings[name].meanSwitchMs} ms`);
    if(over.length){console.error('Interaction budget exceeded: '+over.join('; '));process.exitCode=1}else console.log('Interaction budget holds.');
  }
  if(option('json')){fs.mkdirSync(path.dirname(path.resolve(option('json'))),{recursive:true});fs.writeFileSync(path.resolve(option('json')),JSON.stringify(result,null,2))}
  console.log('Synthetic host in headless engines; not installed-app or device acceptance.');
}finally{await new Promise(resolve=>server.close(resolve))}
