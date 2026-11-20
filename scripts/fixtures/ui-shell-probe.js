// Shared renderer probe: same authored entrypoint and assertions in WKWebView, WebKitGTK and
// WebView2. Host calls are synthetic. No app, credential, provider or real PTY acceptance.
(async()=>{
  const checks=[];
  const check=(name,condition)=>{if(!condition)throw Error(name);checks.push(name);};
  const wait=async predicate=>{const end=Date.now()+15000;while(!predicate()){if(Date.now()>end)throw Error('Renderer probe timed out.');await new Promise(r=>setTimeout(r,25));}};
  const paths=()=>performance.getEntriesByType('resource').map(r=>new URL(r.name).pathname);
  const click=selector=>{const el=document.querySelector(selector);if(!el)throw Error('Missing control: '+selector);el.click();};
  let startup=[];
  try {
    await wait(()=>document.querySelector('[data-ready="true"]'));
    startup=paths();
    check('last-used view is painted',!!document.querySelector('[data-widget-view="today"]')&&!document.querySelector('[data-widget-view="today"]').hidden);
    for(const name of ['shells.js','shells.css','terminal.js','xterm.js','xterm.css','declarative.js','definitions.js'])check('off widget does not load '+name,!startup.some(p=>p.endsWith('/'+name)));
    click('[data-palette-toggle]');
    const query=document.querySelector('[data-command-query]');query.value='GitHub';query.dispatchEvent(new Event('input'));
    check('off command is discoverable',!!document.querySelector('[data-command="github.open"]'));
    click('[data-command="github.open"]');await wait(()=>document.querySelector('[data-widget-view="github"]'));
    click('[data-view="shells"]');await wait(()=>document.querySelector('[data-launch]'));
    check('shell stylesheet loaded on demand',!!document.querySelector('link[data-widget-style*="shells"]'));
    document.querySelector('[data-launch]').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    await wait(()=>window.__shellFixture.calls.some(c=>c.method==='terminal.open'));
    check('emulator module loaded on demand',!!document.querySelector('.xterm'));
    click('[data-widgets-toggle]');click('[data-widget="shells"]');
    await wait(()=>!document.querySelector('[data-widget-view="shells"]')&&window.__shellFixture.calls.some(c=>c.method==='terminal.close'));
    check('off removes shell stylesheet',!document.querySelector('link[data-widget-style*="shells"]'));
    click('[data-widget="declarative"]');await wait(()=>document.querySelector('[aria-label="Import widget JSON"]'));
    const definition={schemaVersion:2,page:'projects',id:'renderer-note',version:'1.0.0',name:'Renderer note',description:'Synthetic renderer fixture',author:'Open Sesame',license:'MIT',config:{body:{label:'Note',default:''}},capabilities:['note.save'],source:null,components:[{type:'input',label:'Note',field:'body'}],actions:[{label:'Save note',operation:'note.save',value:'body'}],presentations:['card','panel','launcher'],fixtures:{title:'Sample',count:0,entries:[]}};
    const input=document.querySelector('[aria-label="Import widget JSON"]');
    Object.defineProperty(input,'files',{value:[new File([JSON.stringify(definition)],'fixture.json',{type:'application/json'})],configurable:true});
    input.dispatchEvent(new Event('change'));
    await wait(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Install widget'));
    check('preview does not install or run an action',!document.querySelector('.json-card')&&!window.__shellFixture.calls.some(c=>c.method==='items.save'));
    [...document.querySelectorAll('button')].find(b=>b.textContent==='Install widget').click();
    await wait(()=>document.querySelector('.json-card'));
    check('explicit install renders JSON widget',!!document.querySelector('[data-json-surface] textarea'));
    click('[data-widget="declarative"]');await wait(()=>!document.querySelector('[data-widget-view="declarative"]'));
    check('off removes JSON stylesheet',!document.querySelector('link[data-widget-style*="declarative"]'));
    finish({passed:true,checks,startup,resources:paths(),userAgent:navigator.userAgent,kind:'native renderer with synthetic bridge; no Tauri app/device/provider acceptance'});
  }catch(error){finish({passed:false,error:error.stack||String(error),checks,startup,resources:paths(),userAgent:navigator.userAgent});}
  function finish(report){
    const text=JSON.stringify(report);
    window.__shellProbeReport=text;
    window.webkit?.messageHandlers?.report?.postMessage(text);
    window.chrome?.webview?.postMessage(text);
  }
})();
