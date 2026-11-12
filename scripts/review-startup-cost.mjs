// Startup budget: what loading every script and stylesheet costs before the first surface is usable.
// Chromium attributes parse and evaluation time per file from a trace; WebKit reports wall time to ready only.
// Authored UI with synthetic native replies only. Usage: node scripts/review-startup-cost.mjs [--runs 5] [--top 15] [--root dir]
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
const args=process.argv.slice(2),option=name=>{const i=args.indexOf('--'+name);return i<0?null:args[i+1]};
const runs=Number(option('runs')??5),top=Number(option('top')??15),root=path.resolve(option('root')||process.cwd());
const playwright=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+'/dist/')&&!file.startsWith(root+'/scripts/fixtures/')){res.writeHead(404);res.end();return}try{const body=fs.readFileSync(file);res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(body)}catch{res.writeHead(404);res.end()}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/scripts/fixtures/widget-fit.html`,median=list=>[...list].sort((a,b)=>a-b)[Math.floor(list.length/2)];
const ready=async page=>{const started=Date.now();await page.goto(url);await page.waitForFunction(()=>window.frames.length>0&&!!window.frames[0].OpenSesameContentFocus&&!!window.frames[0].OpenSesameLauncher);return Date.now()-started};
const result={root,runs,engines:{}};
try{
  for(const name of ['webkit','chromium']){
    const browser=await playwright[name].launch({headless:true}),walls=[],scripts=new Map(),sheets=new Map(),totals={script:[],style:[],layout:[]};
    try{
      for(let run=0;run<runs+1;run++){
        const context=await browser.newContext({viewport:{width:1700,height:1100}});await context.route(/^https?:\/\/(?!127\.0\.0\.1)/,route=>route.abort());const page=await context.newPage();
        const traced=name==='chromium'&&run>0;if(traced)await browser.startTracing(page,{categories:['devtools.timeline','v8','blink']});
        const wall=await ready(page);
        if(traced){
          const events=JSON.parse((await browser.stopTracing()).toString()).traceEvents;let script=0,style=0,layout=0;
          for(const event of events){
            if(event.ph!=='X')continue;const ms=(event.dur||0)/1000;
            if(event.name==='EvaluateScript'||event.name==='v8.compile'){const file=String(event.args?.data?.url||'').split('/').pop().split('?')[0];if(file){scripts.set(file,(scripts.get(file)||0)+ms);script+=ms}}
            if(event.name==='ParseAuthorStyleSheet'){const file=String(event.args?.data?.styleSheetUrl||'').split('/').pop().split('?')[0];sheets.set(file,(sheets.get(file)||0)+ms);style+=ms}
            if(event.name==='UpdateLayoutTree')style+=ms;if(event.name==='Layout')layout+=ms;
          }
          totals.script.push(script);totals.style.push(style);totals.layout.push(layout);
        }
        if(run>0)walls.push(wall);await context.close();
      }
      const entry=result.engines[name]={version:browser.version(),readyMs:median(walls)};
      if(name==='chromium'){
        entry.scriptMs=+median(totals.script).toFixed(1);entry.styleMs=+median(totals.style).toFixed(1);entry.layoutMs=+median(totals.layout).toFixed(1);
        const rank=map=>[...map].sort((a,b)=>b[1]-a[1]).slice(0,top).map(([file,ms])=>({file,ms:+(ms/runs).toFixed(2)}));entry.scripts=rank(scripts);entry.sheets=rank(sheets);
      }
      console.log(`${name} ${browser.version()}: ready in ${entry.readyMs} ms (median of ${runs})`+(entry.scriptMs!==undefined?`; script compile and evaluation ${entry.scriptMs} ms, stylesheet parse and style ${entry.styleMs} ms, layout ${entry.layoutMs} ms`:''));
      if(entry.scripts){console.log('  scripts: '+entry.scripts.map(row=>`${row.file} ${row.ms}`).join(', '));console.log('  sheets:  '+entry.sheets.map(row=>`${row.file} ${row.ms}`).join(', '))}
    }finally{await browser.close()}
  }
  const out=path.resolve('build/design-baseline');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'startup-cost.json'),JSON.stringify(result,null,2));
  console.log('Ready time includes loopback fetches and fixture bootstrap. Synthetic host in headless engines; not installed-app launch time.');
}finally{await new Promise(resolve=>server.close(resolve))}
