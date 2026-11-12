// What the interface actually renders: distinct computed values for controls and text across every surface in the matrix.
// Source can hold one token and still render many sizes; this measures the result. Synthetic host only.
// Usage: node scripts/review-design-audit.mjs [--root dir] [--label name] [--examples 3]
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {surfaces,widgetStates} from './design-baseline-matrix.mjs';
const args=process.argv.slice(2),option=name=>{const i=args.indexOf('--'+name);return i<0?null:args[i+1]};
const root=path.resolve(option('root')||process.cwd()),label=option('label')||'current',examples=Number(option("examples")??3);
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+'/dist/')&&!file.startsWith(root+'/scripts/fixtures/')){res.writeHead(404);res.end();return}try{const body=fs.readFileSync(file);res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(body)}catch{res.writeHead(404);res.end()}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const probe=where=>{
  const rows=[],name=node=>(node.id?'#'+node.id:typeof node.className==='string'&&node.className.trim()?'.'+node.className.trim().split(/\s+/)[0]:node.tagName.toLowerCase());
  const shown=node=>{const box=node.getBoundingClientRect(),style=getComputedStyle(node);return box.width>0&&box.height>0&&style.visibility!=='hidden'&&+style.opacity>0&&!node.closest('.sr-only')};
  const scope=document.getElementById('widget-anchor');
  for(const node of scope.querySelectorAll('button,[role=tab],input:not([type=hidden]):not([type=range]):not([type=checkbox]):not([type=radio]),select,textarea')){
    if(!shown(node))continue;const style=getComputedStyle(node),box=node.getBoundingClientRect();
    const bordered=parseFloat(style.borderTopWidth)>0&&style.borderTopColor!=='rgba(0, 0, 0, 0)',filled=style.backgroundColor!=='rgba(0, 0, 0, 0)';
    rows.push({kind:'control',where,who:name(node),role:node.matches('[role=tab]')?'tab':node.matches('button')?'button':'field',height:node.offsetHeight,radius:style.borderTopLeftRadius,size:style.fontSize,weight:style.fontWeight,padX:style.paddingLeft,borderColor:bordered?style.borderTopColor:'none',background:filled?style.backgroundColor:'none',color:style.color,transition:style.transitionTimingFunction.split(',')[0]});
  }
  for(const node of scope.querySelectorAll('*')){
    if(!shown(node)||![...node.childNodes].some(child=>child.nodeType===3&&child.textContent.trim()))continue;const style=getComputedStyle(node);
    rows.push({kind:'text',where,who:name(node),size:style.fontSize,weight:style.fontWeight,leading:style.lineHeight==='normal'?'normal':(parseFloat(style.lineHeight)/parseFloat(style.fontSize)).toFixed(2),tracking:style.letterSpacing,color:style.color,family:style.fontFamily.split(',')[0].replace(/"/g,'')});
  }
  return rows;
};
const browser=await chromium.launch({headless:true}),rows=[];
try{
  const context=await browser.newContext({viewport:{width:1700,height:1100},reducedMotion:'reduce'});await context.route(/^https?:\/\/(?!127\.0\.0\.1)/,route=>route.abort());
  const open=async(owner=context)=>{const page=await owner.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/scripts/fixtures/widget-fit.html`);await page.waitForFunction(()=>window.frames.length>0&&!!window.frames[0].OpenSesameContentFocus&&!!window.frames[0].OpenSesameLauncher);return{page,frame:page.frames()[1]}};
  const settle=frame=>frame.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,120)))));
  {
    const {page,frame}=await open();
    await frame.evaluate(async()=>{OpenSesameLauncher.close(true);state.size='full';state.expanded=true;render();await OpenSesameWindow.open();for(const id of OpenSesameWidgetLifecycle.ids)OpenSesameWidgetLifecycle.set(id,'active')});
    await page.locator('#viewport').evaluate(node=>{node.style.width='1180px';node.style.height='740px'});
    for(const surface of surfaces){await frame.evaluate(surface.enter,surface.id);await settle(frame);rows.push(...await frame.evaluate(probe,surface.id))}
    await page.close();
  }
  // Each state gets its own profile with every widget installed, so nothing typed or saved in one reaches the next.
  for(const state of widgetStates.filter(state=>state.id!=='collapsed')){const own=await browser.newContext({viewport:{width:1700,height:1100},reducedMotion:'reduce'});await own.route(/^https?:\/\/(?!127\.0\.0\.1)/,route=>route.abort());const {page,frame}=await open(own);await frame.evaluate(()=>{for(const id of OpenSesameWidgetLifecycle.ids)OpenSesameWidgetLifecycle.set(id,'active')});await settle(frame);await frame.evaluate(state.enter);await settle(frame);await page.waitForTimeout(300);rows.push(...await frame.evaluate(probe,state.id));await own.close()}
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
// The same element appears on many surfaces (the navigation, the capture bar); count each element once.
const unique=new Map();for(const row of rows){const key=row.kind+'|'+row.who+'|'+JSON.stringify({...row,where:undefined});if(!unique.has(key))unique.set(key,row)}
const list=[...unique.values()],tally=(items,field)=>{const groups=new Map();for(const item of items){const value=String(item[field]);if(!groups.has(value))groups.set(value,[]);groups.get(value).push(item.who)}return[...groups].sort((a,b)=>b[1].length-a[1].length).map(([value,who])=>({value,count:who.length,examples:[...new Set(who)].slice(0,examples)}))};
const controls=list.filter(row=>row.kind==='control'),text=list.filter(row=>row.kind==='text');
// Text set tighter than 1.2 without being a single deliberate glyph line (1.0) is hard to read at small sizes.
const tight=rows.filter(row=>row.kind==='text'&&row.leading!=='normal'&&+row.leading>1.001&&+row.leading<1.2&&parseFloat(row.size)<=15).map(row=>`${row.where} ${row.who} ${row.size} at ${row.leading}`);
const report={label,root,controls:controls.length,text:text.length,tightLeading:[...new Set(tight)],
  control:{height:tally(controls,'height'),radius:tally(controls,'radius'),size:tally(controls,'size'),weight:tally(controls,'weight'),padX:tally(controls,'padX'),borderColor:tally(controls,'borderColor'),background:tally(controls,'background'),easing:tally(controls,'transition')},
  type:{size:tally(text,'size'),weight:tally(text,'weight'),leading:tally(text,'leading'),tracking:tally(text,'tracking'),color:tally(text,'color'),family:tally(text,'family')}};
const out=path.resolve('build/design-baseline');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,`audit-${label}.json`),JSON.stringify(report,null,2));
const line=(title,groups)=>console.log(`${title} (${groups.length} distinct): `+groups.slice(0,26).map(group=>`${group.value}×${group.count}`).join('  '));
console.log(`${controls.length} distinct controls and ${text.length} distinct text elements across ${surfaces.length} surfaces and ${widgetStates.length-1} widget states.`);
for(const [key,groups] of Object.entries(report.control))line('control '+key,groups);for(const [key,groups] of Object.entries(report.type))line('text '+key,groups);
if(report.tightLeading.length)console.log(`tight leading (${report.tightLeading.length}): `+report.tightLeading.slice(0,30).join('; '));
console.log('Rendered values from a synthetic host; states not in the matrix (hover, focus, errors) are not covered.');
