// How layered the rendered interface is: for every visible element and property, how many authored declarations compete.
// One cascade means one declaration per element and property; every extra one is an override somebody has to reason about.
// Synthetic host only. Usage: node scripts/review-cascade-depth.mjs [--root dir] [--top 12] [--hot] [--hot-count 30] [--budget]
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {surfaces} from './design-baseline-matrix.mjs';
const args=process.argv.slice(2),option=name=>{const i=args.indexOf('--'+name);return i<0?null:args[i+1]};
const root=path.resolve(option('root')||process.cwd()),top=Number(option('top')??12);
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+'/dist/')&&!file.startsWith(root+'/scripts/fixtures/')){res.writeHead(404);res.end();return}try{const body=fs.readFileSync(file);res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(body)}catch{res.writeHead(404);res.end()}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const probe=()=>{
  const scope=document.getElementById('widget-anchor'),slots=new Map(),sheetOf=new Map();
  const walk=(rules,sheet)=>{for(const rule of rules){
    if(rule.cssRules&&!rule.selectorText){
      // Only conditions that currently apply compete.
      if(rule.constructor.name==='CSSMediaRule'&&!matchMedia(rule.conditionText).matches)continue;
      walk(rule.cssRules,sheet);continue}
    if(!rule.selectorText||!rule.style.length)continue;
    let nodes;try{nodes=scope.querySelectorAll(rule.selectorText.replace(/::?(before|after|placeholder|selection|-webkit-[\w-]+)/g,''))}catch{continue}
    if(/::?(before|after|placeholder|selection|-webkit-)/.test(rule.selectorText))continue;
    for(const node of nodes){
      if(!node.offsetWidth&&!node.offsetHeight)continue;
      let own=slots.get(node);if(!own){own=new Map();slots.set(node,own)}
      for(let i=0;i<rule.style.length;i++){const property=rule.style[i];if(property.startsWith('--'))continue;let list=own.get(property);if(!list){list=[];own.set(property,list)}list.push(sheet+'  '+rule.selectorText.slice(0,120))}
    }
  }};
  for(const sheet of document.styleSheets){const name=String(sheet.href||'inline').split('/').pop().split('?')[0];if(name.startsWith('xterm')||name.includes('markdown-theme'))continue;try{walk(sheet.cssRules,name)}catch{}}
  let properties=0,declarations=0,deepest=0;const losers={},depths={},rules={};
  for(const own of slots.values())for(const list of own.values()){properties++;declarations+=list.length;deepest=Math.max(deepest,list.length);depths[Math.min(list.length,8)]=(depths[Math.min(list.length,8)]||0)+1;
    // Every declaration but one loses; attribute the extras to the stylesheets that hold them.
    if(list.length>1)for(const entry of list){const sheet=entry.split('  ')[0],share=(list.length-1)/list.length;losers[sheet]=(losers[sheet]||0)+share;rules[entry]=(rules[entry]||0)+share}}
  return{elements:slots.size,properties,declarations,deepest,depths,losers,rules:Object.fromEntries(Object.entries(rules).sort((a,b)=>b[1]-a[1]).slice(0,400))};
};
const browser=await chromium.launch({headless:true}),total={elements:0,properties:0,declarations:0,deepest:0,depths:{},losers:{},rules:{}};
try{
  const context=await browser.newContext({viewport:{width:1700,height:1100},reducedMotion:'reduce'});await context.route(/^https?:\/\/(?!127\.0\.0\.1)/,route=>route.abort());
  const page=await context.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/scripts/fixtures/widget-fit.html`);
  await page.waitForFunction(()=>window.frames.length>0&&!!window.frames[0].OpenSesameContentFocus&&!!window.frames[0].OpenSesameLauncher);const frame=page.frames()[1];
  await frame.evaluate(async()=>{for(const id of OpenSesameWidgetLifecycle.ids)OpenSesameWidgetLifecycle.set(id,'active');OpenSesameLauncher.close(true);state.size='full';state.expanded=true;render();await OpenSesameWindow.open()});
  await page.locator('#viewport').evaluate(node=>{node.style.width='1180px';node.style.height='740px'});
  for(const surface of surfaces){
    await frame.evaluate(id=>new Promise(resolve=>{changeScenario(id);setTimeout(resolve,250)}),surface.id);const row=await frame.evaluate(probe);
    for(const key of ['elements','properties','declarations'])total[key]+=row[key];total.deepest=Math.max(total.deepest,row.deepest);
    for(const [depth,count] of Object.entries(row.depths))total.depths[depth]=(total.depths[depth]||0)+count;for(const [sheet,count] of Object.entries(row.losers))total.losers[sheet]=(total.losers[sheet]||0)+count;for(const [rule,count] of Object.entries(row.rules))total.rules[rule]=(total.rules[rule]||0)+count;
  }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
const overridden=total.declarations-total.properties,single=total.depths[1]||0;
const report={root,surfaces:surfaces.length,elements:total.elements,properties:total.properties,declarations:total.declarations,overridden,meanDepth:+(total.declarations/total.properties).toFixed(3),singleOwnerShare:+(single/total.properties).toFixed(3),deepest:total.deepest,
  bySheet:Object.entries(total.losers).sort((a,b)=>b[1]-a[1]).slice(0,top).map(([sheet,count])=>({sheet,share:+(count/overridden).toFixed(3)}))};
const out=path.resolve('build/design-baseline');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'cascade-depth.json'),JSON.stringify(report,null,2));
console.log(`${report.elements} rendered elements, ${report.properties} element-property pairs set by ${report.declarations} declarations: ${overridden} are overridden (mean depth ${report.meanDepth}, ${(report.singleOwnerShare*100).toFixed(1)}% have a single owner, deepest ${report.deepest}).`);
console.log('Overrides by stylesheet: '+report.bySheet.map(row=>`${row.sheet} ${(row.share*100).toFixed(1)}%`).join(', '));
if(args.includes('--hot'))for(const [rule,count] of Object.entries(total.rules).sort((a,b)=>b[1]-a[1]).slice(0,Number(option('hot-count')??30)))console.log(`  ${Math.round(count)}  ${rule}`);
// --budget fails the run when more declarations are overridden than the ceiling in scripts/design-budget.json allows.
if(args.includes('--budget')){
  const ceiling=JSON.parse(fs.readFileSync('scripts/design-budget.json','utf8')).rendered?.overriddenDeclarations;
  if(ceiling!==undefined&&overridden>ceiling){console.error(`Rendered cascade budget exceeded: ${overridden} overridden declarations, ceiling ${ceiling}. Edit the rule that owns the declaration instead of overriding it.`);process.exitCode=1}
  else console.log(`Rendered cascade budget holds${ceiling!==undefined&&overridden<ceiling?`; lower the ceiling to ${overridden}`:''}.`);
}
console.log('Longhand level, 13 surfaces at one window size, states that apply at capture time only. Synthetic host.');
