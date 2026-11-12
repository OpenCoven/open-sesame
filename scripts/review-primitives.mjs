// Conformance of the shared primitives: wherever a primitive rule in the theme matches a rendered element, every property
// that rule declares must be decided by the theme stylesheet. Another stylesheet deciding it is an override of the
// primitive, which is the layering the design system removes. Rules inside a media or container condition are
// responsive adaptation and are allowed. A primitive rule is one whose selector names a `.ui-` class. Synthetic host only.
// Usage: node scripts/review-primitives.mjs [--root dir] [--strict] [--verbose]
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {surfaces,widgetStates,windowSizes} from './design-baseline-matrix.mjs';
import {splitTop,specificity,compare} from './design-selectors.mjs';
const args=process.argv.slice(2),option=name=>{const i=args.indexOf('--'+name);return i<0?null:args[i+1]};
const root=path.resolve(option('root')||process.cwd()),strict=args.includes('--strict'),verbose=args.includes('--verbose');
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+'/dist/')&&!file.startsWith(root+'/scripts/fixtures/')){res.writeHead(404);res.end();return}try{const body=fs.readFileSync(file);res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(body)}catch{res.writeHead(404);res.end()}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const helpers=`const splitTop=${splitTop.toString()};const compare=${compare.toString()};${specificity.toString()}`;
const probe=([where,source])=>{
  const {specificity,compare,splitTop}=new Function(source+';return{specificity,compare,splitTop}')();
  const scope=document.getElementById('widget-anchor'),all=[];let order=0;
  const walk=(rules,sheet,conditional)=>{for(const rule of rules){
    if(rule.cssRules&&!rule.selectorText){
      const kind=rule.constructor.name;if(kind==='CSSMediaRule'&&!matchMedia(rule.conditionText).matches)continue;
      walk(rule.cssRules,sheet,conditional||kind==='CSSMediaRule'||kind==='CSSContainerRule');continue}
    if(!rule.selectorText||!rule.style.length||/::|:(before|after)\b/.test(rule.selectorText))continue;
    all.push({rule,sheet,conditional,order:order++,primitive:sheet==='flat-theme.css'&&/\.ui-[a-z]/.test(rule.selectorText)});
  }};
  for(const sheet of document.styleSheets){const name=String(sheet.href||'inline').split('/').pop().split('?')[0];try{walk(sheet.cssRules,name,false)}catch{}}
  const members=new Map();
  for(const entry of all.filter(entry=>entry.primitive)){
    let nodes;try{nodes=scope.querySelectorAll(entry.rule.selectorText)}catch{continue}
    for(const node of nodes){if(!node.offsetWidth&&!node.offsetHeight)continue;if(!members.has(node))members.set(node,new Set());for(let i=0;i<entry.rule.style.length;i++)if(!entry.rule.style[i].startsWith('--'))members.get(node).add(entry.rule.style[i])}
  }
  const name=node=>node.id?'#'+node.id:(typeof node.className==='string'&&node.className.trim()?'.'+node.className.trim().split(/\s+/)[0]:(node.parentElement.id?'#'+node.parentElement.id:'.'+String(node.parentElement.className).trim().split(/\s+/)[0])+'>'+node.tagName.toLowerCase());
  const violations=[];
  for(const [node,properties] of members){
    const matched=[];
    for(const entry of all){
      let best=null;for(const part of splitTop(entry.rule.selectorText,[','])){const text=part.trim();let ok=false;try{ok=node.matches(text)}catch{}if(ok){const weight=specificity(text);if(!best||compare(weight,best)>0)best=weight}}
      if(best)matched.push({...entry,weight:best});
    }
    for(const property of properties){
      const rivals=matched.filter(entry=>{for(let i=0;i<entry.rule.style.length;i++)if(entry.rule.style[i]===property)return true;return false});
      const rank=entry=>[entry.rule.style.getPropertyPriority(property)?1:0,...entry.weight,entry.order];
      rivals.sort((a,b)=>{const x=rank(a),y=rank(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return x[i]-y[i];return 0});
      const winner=rivals.at(-1);if(!winner||winner.primitive||winner.conditional||winner.sheet==='flat-theme.css')continue;
      violations.push({who:name(node),property,sheet:winner.sheet,selector:winner.rule.selectorText.slice(0,150),where});
    }
  }
  return{members:members.size,violations};
};
const browser=await chromium.launch({headless:true}),found=new Map();let members=0,states=0;
const note=row=>{members=Math.max(members,row.members);states++;for(const item of row.violations){const key=[item.who,item.property,item.sheet,item.selector].join('|');if(!found.has(key))found.set(key,item)}};
try{
  const fresh=async(seed=null)=>{const context=await browser.newContext({viewport:{width:1700,height:1100},reducedMotion:'reduce'});await context.route(/^https?:\/\/(?!127\.0\.0\.1)/,route=>route.abort());
    const page=await context.newPage();if(seed)await page.addInitScript(seed);await page.goto(`http://127.0.0.1:${server.address().port}/scripts/fixtures/widget-fit.html`);
    await page.waitForFunction(()=>window.frames.length>0&&!!window.frames[0].OpenSesameContentFocus&&!!window.frames[0].OpenSesameLauncher);const frame=page.frames()[1];
    await frame.evaluate(()=>{for(const id of OpenSesameWidgetLifecycle.ids)OpenSesameWidgetLifecycle.set(id,'active')});return{context,page,frame}};
  {const {context,page,frame}=await fresh();await frame.evaluate(async()=>{OpenSesameLauncher.close(true);state.size='full';state.expanded=true;render();await OpenSesameWindow.open()});
    for(const [width,height] of windowSizes){await page.locator('#viewport').evaluate((node,[w,h])=>{node.style.width=w+'px';node.style.height=h+'px'},[width,height]);
      for(const surface of surfaces){await frame.evaluate(id=>new Promise(resolve=>{changeScenario(id);setTimeout(resolve,200)}),surface.id);note(await frame.evaluate(probe,[`${surface.id} ${width}x${height}`,helpers]))}}
    await context.close()}
  for(const state of widgetStates){const {context,page,frame}=await fresh(state.seed);await frame.evaluate(state.enter);await page.waitForTimeout(500);if(state.hover){await frame.locator(state.hover).first().hover();await page.waitForTimeout(150)}note(await frame.evaluate(probe,[state.id,helpers]));await context.close()}
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
// Exceptions are named rules that may decide a primitive's property, each with its reason, in the budget file.
const exceptions=JSON.parse(fs.readFileSync(path.join(root,'scripts/design-budget.json'),'utf8')).rendered?.primitiveExceptions||{},normal=text=>text.replace(/\s*([>,])\s*/g,'$1').replace(/"/g,'');
const allowed=new Set(Object.keys(exceptions).map(normal));
const rows=[...found.values()].filter(row=>!allowed.has(normal(row.sheet+'  '+row.selector))),bySheet={};for(const row of rows)bySheet[row.sheet]=(bySheet[row.sheet]||0)+1;
const out=path.resolve('build/design-baseline');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'primitives.json'),JSON.stringify({root,states,violations:rows},null,2));
// One line per overriding rule: the members it reaches and the properties it decides, longhands folded to their shorthand.
const fold=property=>property.replace(/^border-(top|right|bottom|left)-(color|style|width)$/,'border').replace(/^border-image-.*$/,'border').replace(/^border-(top|bottom)-(left|right)-radius$/,'border-radius').replace(/^padding-.*$/,'padding');
const groups=new Map();for(const row of rows){const key=row.sheet+'  '+row.selector;if(!groups.has(key))groups.set(key,{who:new Set(),properties:new Set()});groups.get(key).who.add(row.who);groups.get(key).properties.add(fold(row.property))}
for(const [key,group] of groups)console.log(`  ${key}\n      {${[...group.properties].join(', ')}}  on ${[...group.who].join(' ')}`);
console.log(`${states} states checked. ${rows.length} properties of primitive members are decided outside the theme${rows.length?': '+Object.entries(bySheet).sort((a,b)=>b[1]-a[1]).map(([sheet,count])=>`${sheet} ${count}`).join(', '):''}.`);
if(strict&&rows.length)process.exit(1);
