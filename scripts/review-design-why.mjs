// Which rules decide a property on an element: the matched rules in cascade order with their stylesheet, for folding an
// override into the rule that owns the element. Synthetic host only.
// Usage: node scripts/review-design-why.mjs --enter focus|<widget state id> --props height,min-height,padding '#selector' ['#selector' ...]
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {surfaces,widgetStates} from './design-baseline-matrix.mjs';
import {coveredBy} from './design-selectors.mjs';
const args=process.argv.slice(2),option=name=>{const i=args.indexOf('--'+name);return i<0?null:args[i+1]};
const enter=option('enter')||'focus',props=(option('props')||'height,min-height').split(','),root=path.resolve(option('root')||process.cwd());
const selectors=args.filter((arg,index)=>!arg.startsWith('--')&&!(index>0&&args[index-1].startsWith('--')));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+'/dist/')&&!file.startsWith(root+'/scripts/fixtures/')){res.writeHead(404);res.end();return}try{const body=fs.readFileSync(file);res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(body)}catch{res.writeHead(404);res.end()}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
try{
  const context=await browser.newContext({viewport:{width:1700,height:1100},reducedMotion:'reduce'});await context.route(/^https?:\/\/(?!127\.0\.0\.1)/,route=>route.abort());
  const surface=surfaces.find(item=>item.id===enter),state=widgetStates.find(item=>item.id===enter);
  const page=await context.newPage();if(state?.seed)await page.addInitScript(state.seed);await page.goto(`http://127.0.0.1:${server.address().port}/scripts/fixtures/widget-fit.html`);
  await page.waitForFunction(()=>window.frames.length>0&&!!window.frames[0].OpenSesameContentFocus&&!!window.frames[0].OpenSesameLauncher);const frame=page.frames()[1];
  if(surface){await frame.evaluate(async()=>{OpenSesameLauncher.close(true);state.size='full';state.expanded=true;render();await OpenSesameWindow.open();for(const id of OpenSesameWidgetLifecycle.ids)OpenSesameWidgetLifecycle.set(id,'active')});await page.locator('#viewport').evaluate(node=>{node.style.width='1180px';node.style.height='740px'});await frame.evaluate(surface.enter,surface.id)}
  else if(state){await frame.evaluate(()=>{for(const id of OpenSesameWidgetLifecycle.ids)OpenSesameWidgetLifecycle.set(id,'active')});await frame.evaluate(state.enter)}else throw new Error('Unknown surface or state: '+enter);
  await page.waitForTimeout(500);if(state?.hover){await frame.locator(state.hover).first().hover();await page.waitForTimeout(150)}
  for(const selector of selectors){
    const report=await frame.evaluate(([selector,props,covering])=>{
      const node=document.querySelector(selector);if(!node)return null;
      // Specificity as [ids, classes, types]; :is(), :not() and :has() count their most specific argument, :where() nothing.
      const split=(text,separators)=>{const parts=[];let depth=0,start=0;for(let k=0;k<text.length;k++){const c=text[k];if(c==='('||c==='[')depth++;else if(c===')'||c===']')depth--;else if(depth===0&&separators.includes(c)){parts.push(text.slice(start,k));start=k+1}}parts.push(text.slice(start));return parts.filter(part=>part.trim())};
      const specificity=text=>{const total=[0,0,0];let k=0;
        while(k<text.length){const c=text[k];
          if(c==='#'){total[0]++;k++;while(k<text.length&&/[\w-]/.test(text[k]))k++;continue}
          if(c==='.'){total[1]++;k++;while(k<text.length&&/[\w-]/.test(text[k]))k++;continue}
          if(c==='['){total[1]++;let depth=1;k++;while(k<text.length&&depth){if(text[k]==='[')depth++;else if(text[k]===']')depth--;k++}continue}
          if(c===':'){const element=text[k+1]===':';k+=element?2:1;const begin=k;while(k<text.length&&/[\w-]/.test(text[k]))k++;const name=text.slice(begin,k);let inner=null;
            if(text[k]==='('){let depth=1;const open=++k;while(k<text.length&&depth){if(text[k]==='(')depth++;else if(text[k]===')')depth--;k++}inner=text.slice(open,k-1)}
            if(element)total[2]++;else if(name==='where'){}else if(['is','not','has'].includes(name)&&inner!==null){const best=split(inner,[',']).map(specificity).sort((x,y)=>y[0]-x[0]||y[1]-x[1]||y[2]-x[2])[0]||[0,0,0];for(let n=0;n<3;n++)total[n]+=best[n]}else total[1]++;continue}
          if(/[a-zA-Z]/.test(c)){total[2]++;while(k<text.length&&/[\w-]/.test(text[k]))k++;continue}
          k++}
        return total};
      const rows=[];let order=0;
      const walk=(rules,sheet,context)=>{for(const rule of rules){
        if(rule.cssRules&&!rule.selectorText){walk(rule.cssRules,sheet,context+(rule.conditionText?` @${rule.conditionText}`:''));continue}
        if(!rule.selectorText)continue;order++;
        const parts=rule.selectorText.split(/,(?![^()]*\))/).map(part=>part.trim()).filter(part=>{try{return node.matches(part)}catch{return false}});if(!parts.length)continue;
        const hits=[];for(const name of props){const whole=rule.style.getPropertyValue(name);if(whole)hits.push(`${name}:${whole}${rule.style.getPropertyPriority(name)?' !important':''}`)}
        for(const name of props)if(!rule.style.getPropertyValue(name))for(let i=0;i<rule.style.length;i++){const property=rule.style[i];if((property===name||property.startsWith(name+'-'))&&rule.style.getPropertyValue(property))hits.push(`${property}:${rule.style.getPropertyValue(property)}${rule.style.getPropertyPriority(property)?' !important':''}`)}
        // A shorthand holding var() leaves its longhands empty until substitution, so name the shorthand itself.
        for(const name of props)if(!rule.style.getPropertyValue(name))for(const short of covering[name]){const whole=rule.style.getPropertyValue(short);if(whole&&!hits.some(hit=>hit.startsWith(short+':')))hits.push(`${short}:${whole}${rule.style.getPropertyPriority(short)?' !important':''}`)}
        if(!hits.length)continue;
        const best=parts.map(part=>({part,weight:specificity(part)})).sort((x,y)=>y.weight[0]-x.weight[0]||y.weight[1]-x.weight[1]||y.weight[2]-x.weight[2])[0];
        rows.push({sheet,context,selector:best.part,weight:best.weight,order,hits:[...new Set(hits)]});
      }};
      for(const sheet of document.styleSheets){try{walk(sheet.cssRules,String(sheet.href||'inline').split('/').pop().split('?')[0],'')}catch{}}
      const style=getComputedStyle(node);
      return{computed:Object.fromEntries(props.map(name=>[name,style.getPropertyValue(name)])),box:node.offsetWidth+'x'+node.offsetHeight,rows};
    },[selector,props,Object.fromEntries(props.map(name=>[name,coveredBy(name)]))]);
    if(!report){console.log(`${selector}: not found in ${enter}`);continue}
    console.log(`\n${selector} in ${enter}: `+Object.entries(report.computed).map(([name,value])=>`${name}=${value}`).join('  ')+`  box=${report.box}`);
    // Weakest first, so the last line that sets a property is the one that wins (before !important).
    for(const row of report.rows.sort((x,y)=>x.weight[0]-y.weight[0]||x.weight[1]-y.weight[1]||x.weight[2]-y.weight[2]||x.order-y.order))console.log(`  [${row.weight.join(',')}] ${row.sheet}${row.context}  ${row.selector.slice(0,130)}  {${row.hits.join(';')}}`);
  }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
