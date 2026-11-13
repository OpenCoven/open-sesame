// Cross-surface rendered baseline: the authored UI with synthetic native replies only.
// No real shell, clipboard, provider, account or capture is reached; external requests are blocked.
// Usage: node scripts/review-design-baseline.mjs [--label name] [--compare dir] [--strict] [--tolerance 0.0005] [--only part,part] [--coverage] [--no-shots --rounds 20] [--root dir] [--browser webkit]
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {surfaces,windowSizes,widgetStates} from './design-baseline-matrix.mjs';

const args=process.argv.slice(2),option=name=>{const i=args.indexOf('--'+name);return i<0?null:args[i+1]},flag=name=>args.includes('--'+name);
const label=option('label')||'current',compare=option('compare'),strict=flag('strict'),tolerance=Number(option('tolerance')??0.0005);
const only=option('only')?.split(','),coverage=flag('coverage'),rounds=Number(option('rounds')??3),noShots=flag('no-shots'),engine=option('browser')||'chromium';
// --browser webkit captures in the shipped engine family; Chromium-only runtime counters are then omitted.
const playwright=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),devtools=engine==='chromium';
// --root serves another checkout read-only, to measure an unmodified tree with this harness.
const root=path.resolve(option('root')||process.cwd()),out=path.resolve('build/design-baseline',label);
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});

const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!file.startsWith(root+'/dist/')&&!file.startsWith(root+'/scripts/fixtures/')){res.writeHead(404);res.end();return}
  try{const body=fs.readFileSync(file);res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(body)}catch{res.writeHead(404);res.end()}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;

const settle=frame=>frame.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,120)))));
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
// Nesting facts the cascade tool relied on to remove declarations; a descendant rendered outside its ancestor would make
// a removed declaration matter again, so each fact is checked wherever a capture is taken.
const ancestryFacts=fs.existsSync(path.join(root,'scripts/design-ancestry.json'))?JSON.parse(fs.readFileSync(path.join(root,'scripts/design-ancestry.json'),'utf8')):{},ancestryPairs=ancestryFacts.pairs||[],ancestryTags=ancestryFacts.tags||[],ancestryBroken=new Set();
const checkAncestry=async(frame,where)=>{if(!ancestryPairs.length&&!ancestryTags.length)return;for(const pair of await frame.evaluate(pairs=>pairs.filter(pair=>{const [ancestor,descendant]=pair.split(' '),inner=document.getElementById(descendant);return inner&&!document.getElementById(ancestor)?.contains(inner)}),ancestryPairs))ancestryBroken.add(`${pair} in ${where}`);
  for(const fact of await frame.evaluate(facts=>facts.filter(fact=>{const [tag,id]=fact.split(' '),node=document.getElementById(id);return node&&((tag!=='*'&&node.localName!==tag)||document.querySelectorAll('[id="'+id+'"]').length>1)}),ancestryTags))ancestryBroken.add(`<${fact.replace(' ','> #')} in ${where}`)};
let browser;const errors=[],shots=[],measurements={label,engine,capturedAt:new Date().toISOString(),surfaces:{}};
try{
  browser=await playwright[engine].launch({headless:true});
  const newContext=async()=>{const made=await browser.newContext({viewport:{width:1700,height:1100},deviceScaleFactor:1,reducedMotion:'reduce',colorScheme:'dark'});await made.route(/^https?:\/\/(?!127\.0\.0\.1)/,route=>route.abort());return made};
  const context=await newContext();
  // fresh=true gives the page its own profile: site storage is per browser context, so a shared one would carry a draft
  // typed in an earlier state into every later capture.
  const open=async(seed,fresh=false,stateSeed=null)=>{
    const owner=fresh?await newContext():context,page=await owner.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-11-04T10:15:00'));
    if(seed)await page.addInitScript(seed);if(stateSeed)await page.addInitScript(stateSeed);
    const started=Date.now();await page.goto(origin+'/scripts/fixtures/widget-fit.html');
    await page.waitForFunction(()=>window.frames.length>0&&!!window.frames[0].OpenSesameContentFocus);
    const frame=page.frames()[1];await frame.waitForFunction(()=>!!window.OpenSesameContentFocus&&!!window.OpenSesameWorkspaceWidgets&&!!window.OpenSesameLauncher);
    return{page,frame,ready:Date.now()-started};
  };
  const capture=async(page,name)=>{
    if(noShots||(only&&!only.some(part=>name.includes(part))))return;
    const file=path.join(out,name+'.png');await page.locator('#viewport').screenshot({path:file,animations:'disabled',caret:'hide'});shots.push(name);
  };

  // Every capture starts with the same saved reading list and every optional widget installed.
  const seed=()=>{try{
    localStorage.setItem('open-sesame-reading-v1',JSON.stringify({feeds:[{id:'baseline-feed',sample:true,title:'Baseline'}],entries:Array.from({length:6},(_,n)=>({id:'baseline-article-'+n,feedId:'baseline-feed',title:['A quieter place to read, with room for every part of the conversation','Designing software that feels at home','Notes on restraint in interface work'][n%3],body:'<h2>Content comes first</h2>'+Array.from({length:12},(_,i)=>'<p>Baseline paragraph '+i+': measured type, steady rhythm and one accent keep the page calm.</p>').join(''),source:'Baseline',full:true})),selected:'baseline-article-0',scope:'unread'}));
  }catch{}};
  const activate=frame=>frame.evaluate(()=>{for(const id of OpenSesameWidgetLifecycle.ids)OpenSesameWidgetLifecycle.set(id,'active')});
  // 1. Detached application window: every surface at three sizes.
  {
    const {page,frame,ready}=await open(seed);measurements.readyMs=ready;
    const client=devtools?await context.newCDPSession(page):null;if(client)await client.send('Performance.enable');
    // Rule tracking slows style recalculation, so timings from a --coverage run are not comparable with ordinary runs.
    if(coverage&&client){await client.send('DOM.enable');await client.send('CSS.enable');await client.send('CSS.startRuleUsageTracking')}
    await frame.evaluate(async()=>{OpenSesameLauncher.close(true);state.size='full';state.expanded=true;render();await OpenSesameWindow.open();for(const id of OpenSesameWidgetLifecycle.ids)OpenSesameWidgetLifecycle.set(id,'active')});
    for(const surface of surfaces){
      const row=measurements.surfaces[surface.id]={};
      await frame.evaluate(surface.enter,surface.id);await settle(frame);if(surface.ready)await frame.waitForFunction(surface.ready).catch(()=>errors.push('Surface never became ready: '+surface.id));
      for(const [width,height] of windowSizes){
        await page.locator('#viewport').evaluate((node,size)=>{node.style.width=size[0]+'px';node.style.height=size[1]+'px'},[width,height]);await settle(frame);
        await capture(page,`window-${surface.id}-${width}x${height}`);await checkAncestry(frame,`${surface.id} ${width}x${height}`);
        row[`${width}x${height}`]=await frame.evaluate(()=>{
          const panel=document.getElementById('widget-panel'),visible=node=>{const box=node.getBoundingClientRect();return box.width>0&&box.height>0&&getComputedStyle(node).visibility!=='hidden'};
          let smallest=Infinity,clipped=0,texts=0;
          for(const node of panel.querySelectorAll('*')){
            if(!visible(node))continue;
            if([...node.childNodes].some(child=>child.nodeType===3&&child.textContent.trim())){texts++;smallest=Math.min(smallest,parseFloat(getComputedStyle(node).fontSize))}
            if(node.matches('button,[role=tab],input,select,textarea')){const box=node.getBoundingClientRect();if(box.right>innerWidth+1||box.bottom>innerHeight+1)clipped++}
          }
          // Text cut off by a clipping ancestor, excluding deliberate ellipsis and scrollable regions.
          const cut=[];
          for(const node of panel.querySelectorAll('*')){
            if(!visible(node)||![...node.childNodes].some(child=>child.nodeType===3&&child.textContent.trim()))continue;
            const style=getComputedStyle(node);if(style.textOverflow==='ellipsis')continue;
            const range=document.createRange();range.selectNodeContents(node);const box=range.getBoundingClientRect();if(!box.width)continue;
            for(let parent=node;parent&&parent!==panel.parentElement;parent=parent.parentElement){
              const css=getComputedStyle(parent);if(css.overflowX==='visible'&&css.overflowY==='visible')continue;
              const frame=parent.getBoundingClientRect(),scrolls=/auto|scroll/.test(css.overflowX+css.overflowY);
              // A 1px clipping box is the visually-hidden label technique, not a layout fault.
              if(css.textOverflow==='ellipsis'||scrolls||frame.width<3||frame.height<3)break;
              if(box.right>frame.right+1.5||box.bottom>frame.bottom+1.5||box.left<frame.left-1.5){cut.push((node.id?'#'+node.id:node.className&&typeof node.className==='string'?'.'+node.className.trim().split(/\s+/)[0]:node.tagName.toLowerCase())+' "'+node.textContent.trim().slice(0,28)+'"');break}
            }
          }
          return{smallestText:smallest===Infinity?null:smallest,textNodes:texts,clippedControls:clipped,clippedText:cut,overflowX:document.documentElement.scrollWidth>innerWidth+1};
        });
      }
    }
    // Interaction budget: time to switch surfaces, median of three rounds at the largest size.
    await page.locator('#viewport').evaluate((node,size)=>{node.style.width=size[0]+'px';node.style.height=size[1]+'px'},windowSizes[0]);
    const switches={},read=async()=>client?Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map(metric=>[metric.name,metric.value])):{},before=await read();
    for(let round=0;round<rounds;round++)for(const surface of surfaces){
      const elapsed=await frame.evaluate(id=>new Promise(resolve=>{const start=performance.now();changeScenario(id);requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(performance.now()-start)))}),surface.scenario||surface.id);
      (switches[surface.id]??=[]).push(elapsed);
    }
    if(client){
    const after=await read(),per=name=>+(1000*(after[name]-before[name])/(rounds*surfaces.length)).toFixed(2);
    // Cost of one surface switch, averaged over the loop: the interaction budget.
    measurements.perSwitch={rounds,styleMs:per('RecalcStyleDuration'),layoutMs:per('LayoutDuration'),scriptMs:per('ScriptDuration')};
    measurements.switchMs=Object.fromEntries(Object.entries(switches).map(([id,values])=>[id,Math.round(median(values)*10)/10]));
    const metrics=Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map(metric=>[metric.name,metric.value]));
    measurements.runtime={scriptSeconds:+metrics.ScriptDuration.toFixed(3),layoutSeconds:+metrics.LayoutDuration.toFixed(3),styleSeconds:+metrics.RecalcStyleDuration.toFixed(3),layoutCount:metrics.LayoutCount,styleCount:metrics.RecalcStyleCount,heapMB:+(metrics.JSHeapUsedSize/1048576).toFixed(1),nodes:metrics.Nodes};
    if(coverage&&client){const usage=(await client.send('CSS.stopRuleUsageTracking')).ruleUsage;measurements.matchedRules=usage.filter(rule=>rule.used).length}
    measurements.coverageRun=coverage;
    }
    measurements.dom=await frame.evaluate(()=>({elements:document.getElementsByTagName('*').length,styleSheets:document.styleSheets.length,rules:[...document.styleSheets].reduce((sum,sheet)=>{try{return sum+sheet.cssRules.length}catch{return sum}},0),scripts:document.scripts.length}));
    await page.close();
  }

  // 2. Attached widget: collapsed, launcher and expanded states, each from a fresh profile.
  for(const state of noShots?[]:widgetStates){
    const {page,frame}=await open(seed,true,state.seed);await activate(frame);await settle(frame);
    await frame.evaluate(state.enter);await settle(frame);await page.waitForTimeout(350);
    if(state.hover){await frame.locator(state.hover).first().hover();await page.waitForTimeout(150)}
    await capture(page,`widget-${state.id}`);await checkAncestry(frame,state.id);await page.context().close();
  }
  // 3. Standalone pages that link their own subset of the stylesheets.
  for(const [id,file,width,height] of [['sign-in','dist/sign-in.html',800,500]]){
    if(noShots||(only&&!only.some(part=>('page-'+id).includes(part))))continue;
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.setViewportSize({width,height});await page.clock.setFixedTime(new Date('2026-11-04T10:15:00'));
    await page.goto(`${origin}/${file}`);await page.waitForTimeout(300);await page.screenshot({path:path.join(out,`page-${id}.png`),animations:'disabled',caret:'hide'});shots.push('page-'+id);await page.close();
  }
  measurements.shots=shots.length;measurements.errors=errors;measurements.ancestry={checked:ancestryPairs.length+ancestryTags.length,broken:[...ancestryBroken]};
  fs.writeFileSync(path.join(out,'measurements.json'),JSON.stringify(measurements,null,2));

  // 4. Optional comparison against an earlier capture.
  let failed=false;
  if(compare){
    const page=await context.newPage(),rows=[];
    for(const name of shots){
      const before=path.join(path.resolve(compare),name+'.png');
      if(!fs.existsSync(before)){rows.push({name,status:'new'});continue}
      const result=await page.evaluate(async([a,b])=>{
        const load=async data=>{const image=new Image();image.src='data:image/png;base64,'+data;await image.decode();return image};
        const [one,two]=await Promise.all([load(a),load(b)]);
        if(one.width!==two.width||one.height!==two.height)return{size:[one.width,one.height,two.width,two.height]};
        const canvas=document.createElement('canvas');canvas.width=one.width;canvas.height=one.height;const pen=canvas.getContext('2d',{willReadFrequently:true});
        pen.drawImage(one,0,0);const first=pen.getImageData(0,0,one.width,one.height);pen.drawImage(two,0,0);const second=pen.getImageData(0,0,one.width,one.height);
        let changed=0,peak=0;const mark=pen.createImageData(one.width,one.height);
        for(let i=0;i<first.data.length;i+=4){
          const delta=Math.max(Math.abs(first.data[i]-second.data[i]),Math.abs(first.data[i+1]-second.data[i+1]),Math.abs(first.data[i+2]-second.data[i+2]));peak=Math.max(peak,delta);
          const hit=delta>2;if(hit)changed++;
          mark.data[i]=hit?255:second.data[i]>>2;mark.data[i+1]=hit?40:second.data[i+1]>>2;mark.data[i+2]=hit?120:second.data[i+2]>>2;mark.data[i+3]=255;
        }
        pen.putImageData(mark,0,0);return{changed,total:first.data.length/4,peak,diff:changed?canvas.toDataURL('image/png').split(',')[1]:null};
      },[fs.readFileSync(before).toString('base64'),fs.readFileSync(path.join(out,name+'.png')).toString('base64')]);
      if(result.size){rows.push({name,status:'resized',size:result.size});continue}
      const ratio=result.changed/result.total;
      if(result.diff)fs.writeFileSync(path.join(out,name+'.diff.png'),Buffer.from(result.diff,'base64'));
      rows.push({name,status:ratio>tolerance?'changed':result.changed?'within-tolerance':'identical',ratio:+ratio.toFixed(6),peak:result.peak});
    }
    // Text newly cut off by a clipping ancestor is a regression even when the pixel change is small.
    const earlier=path.join(path.resolve(compare),'measurements.json'),newlyClipped=[];
    if(fs.existsSync(earlier)){
      const before=JSON.parse(fs.readFileSync(earlier,'utf8')).surfaces||{};
      for(const [surface,sizes] of Object.entries(measurements.surfaces))for(const [size,row] of Object.entries(sizes)){
        const known=new Set(before[surface]?.[size]?.clippedText||[]);if(!before[surface]?.[size]?.clippedText)continue;
        for(const entry of row.clippedText)if(!known.has(entry))newlyClipped.push(`${surface} ${size} ${entry}`);
      }
    }
    const missing=fs.readdirSync(path.resolve(compare)).filter(file=>file.endsWith('.png')&&!file.endsWith('.diff.png')&&!shots.includes(file.slice(0,-4)));
    const summary={against:path.resolve(compare),tolerance,identical:rows.filter(row=>row.status==='identical').length,withinTolerance:rows.filter(row=>row.status==='within-tolerance').length,changed:rows.filter(row=>row.status==='changed').map(row=>row.name),resized:rows.filter(row=>row.status==='resized').map(row=>row.name),added:rows.filter(row=>row.status==='new').map(row=>row.name),missing,newlyClipped,rows};
    fs.writeFileSync(path.join(out,'comparison.json'),JSON.stringify(summary,null,2));
    console.log(`Compared ${rows.length} captures: ${summary.identical} identical, ${summary.withinTolerance} within tolerance, ${summary.changed.length} changed, ${summary.resized.length} resized, ${summary.added.length} new, ${missing.length} missing.`);
    for(const row of rows.filter(row=>row.status==='changed'))console.log(`  changed ${row.name} ${(row.ratio*100).toFixed(3)}% peak ${row.peak}`);
    if(newlyClipped.length){console.log('Newly clipped text:');for(const entry of newlyClipped)console.log('  '+entry);failed=true}
    if(!only&&strict&&(summary.changed.length||summary.resized.length||missing.length))failed=true;
    await page.close();
  }
  console.log(`${shots.length} captures in ${path.relative(root,out)}; ready ${measurements.readyMs} ms; ${errors.length} page errors. Synthetic host only; not native, device or provider acceptance.`);
  if(errors.length){console.error(errors.join('\n'));failed=true}
  if(ancestryBroken.size){console.error('Nesting facts in scripts/design-ancestry.json no longer hold:\n'+[...ancestryBroken].join('\n'));failed=true}
  process.exitCode=failed?1:0;
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
