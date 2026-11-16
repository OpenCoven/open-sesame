// Rendered shell/JSON behavior against a synthetic host, with real module/CSS requests.
// Starts and closes its own loopback-only server. No provider, credential or real PTY is used.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium,webkit} from 'playwright';

const root=fileURLToPath(new URL('../../',import.meta.url));
const output=path.resolve(process.argv[2]||'build/ui-shell-browser');
await mkdir(output,{recursive:true});
const requested=[];
const server=createServer(async(req,res)=>{
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    const aliases={'/ui/xterm.js':'dist/vendor/xterm.js','/ui/xterm.css':'dist/vendor/xterm.css'};
    const name=aliases[pathname]||pathname.slice(1);
    const file=path.resolve(root,name);
    if(!file.startsWith(root)){res.writeHead(403);res.end();return;}
    requested.push(pathname);
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');
    res.end(await readFile(file));
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browsers=process.env.UI_SHELL_ENGINES?.split(',')||['chromium','webkit'];
const report={kind:'browser with synthetic host; no native/device/provider acceptance',platform:process.platform,results:[]};
const definition=JSON.parse(await readFile(path.join(root,'dist/tools/meeting-notes/tool.json'),'utf8'));
try {
  for(const name of browsers) {
    const browser=await ({chromium,webkit})[name].launch({headless:process.env.UI_SHELL_HEADLESS!=='0'});
    const context=await browser.newContext({viewport:{width:1090,height:700}});
    await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
    await context.addInitScript(()=>{
      const settings=JSON.parse(sessionStorage.getItem('fixture.settings')||'{}');
      const states=JSON.parse(sessionStorage.getItem('fixture.states')||'{}');
      const calls=[];let noteReply,releaseOpen;
      const listeners=[],savedItems=[];
      window.__fixture__={settings,states,calls,holdNotes:false,holdOpen:false,releaseNote:()=>noteReply?.(),releaseOpen:()=>releaseOpen?.(),emit:payload=>{for(const handler of listeners)handler({payload});}};
      window.__OPEN_SESAME_NATIVE__=true;
      window.__TAURI__={event:{listen:async(name,handler)=>{listeners.push(handler);return()=>{};}},core:{Channel:class{},invoke:async(command,{message})=>{
        const {requestId,method,params}=message;calls.push({method,params:{...params,channel:undefined}});
        let result;
        if(method==='system.info')result={available:true,platform:'darwin',authenticated:false};
        // The host settings of #71 and #72, in the shapes src-tauri/src/summon.rs and auth.rs answer.
        else if(method==='auth.status')result={authenticated:false,busy:false,message:'',name:'',email:''};
        else if(method==='summon.status')result={session:'macos',shortcut:'Control+Alt+Shift+Space',defaultShortcut:'Control+Alt+Shift+Space',registered:true,message:'',toggleCommand:'open-sesame --toggle',hideOnBlur:false};
        else if(method==='settings.all')result={settings};
        else if(method==='widgets.list')result={widgets:states};
        else if(method==='settings.set'){settings[params.key]=params.value;sessionStorage.setItem('fixture.settings',JSON.stringify(settings));result={saved:true};}
        else if(method==='widgets.set'){states[params.id]=params.state;sessionStorage.setItem('fixture.states',JSON.stringify(states));result={saved:true};}
        else if(method==='items.save') {
          if(window.__fixture__.holdNotes)await new Promise(resolve=>noteReply=resolve);
          if(window.__fixture__.failNote)return {requestId,error:'The note could not be saved.'};
          result={item:{id:params.item.id}};savedItems.push({...params.item,id:params.item.id||`fixture-${savedItems.length}`});
        } else if(method==='terminal.open') {
          if(window.__fixture__.holdOpen)await new Promise(resolve=>releaseOpen=resolve);
          result={id:params.id,pid:0,machine:'fixture'};
        }
        // Only a page started with a development self-test asks storage for the items it saved.
        else if(method==='items.list'&&window.__OPEN_SESAME_SELFTEST__)result={items:savedItems};
        else result=true;
        return {requestId,result};
      }}};
    });
    const page=await context.newPage();
    const errors=[],events=[];page.on('pageerror',e=>errors.push(e.message));
    for(const event of ['load','domcontentloaded','crash'])page.on(event,()=>events.push({event,time:Date.now()}));
    page.on('requestfailed',request=>events.push({event:'requestfailed',url:request.url(),error:request.failure()}));
    const requests=[];page.on('request',req=>requests.push(new URL(req.url()).pathname));
    const step=async(label,action)=>{await action();report.results.push({engine:name,label,passed:true});};
    try {
      await page.goto(origin+'/ui/index.html');
      await page.locator('[data-ready="true"]').waitFor();
      await step('startup loads only shell and last view',async()=>{
        assert(await page.locator('[data-widget-view="today"]').isVisible());
        for(const part of ['shells.js','shells.css','terminal.js','xterm.js','xterm.css','declarative.js','definitions.js'])assert(!requests.some(r=>r.endsWith('/'+part)),part+' must not load');
        assert.deepEqual(await page.evaluate(()=>Object.keys(window).filter(k=>k.startsWith('OpenSesame'))),[]);
        // The account and shortcut of #72 and #71 sit outside every widget and answer at start.
        await page.locator('[data-account]').getByText('Not signed in').waitFor();
        assert.equal(await page.locator('#summon-shortcut').inputValue(),'Control+Alt+Shift+Space');
        assert(await page.locator('[data-summon-blur]').isVisible());
        assert.equal(await page.locator('[data-view-host] [data-account], [data-view-host] [data-summon]').count(),0,'host settings are not inside a widget view');
        // Restoring the saved state is not a change: a clean start with no action writes nothing.
        assert.deepEqual(await page.evaluate(()=>window.__fixture__.calls.filter(c=>c.method==='widgets.set'||c.method==='settings.set')),[],'startup writes no preference');
        const trace=await page.evaluate(()=>({paint:performance.getEntriesByType('paint').map(x=>({name:x.name,time:x.startTime})),resources:performance.getEntriesByType('resource').map(x=>({name:x.name,start:x.startTime,duration:x.duration,bytes:x.transferSize}))}));
        await writeFile(path.join(output,`${name}-startup.json`),JSON.stringify({requests:[...requests],...trace},null,2));
      });
      await step('the status line follows a sign-in change from the host',async()=>{
        const status=page.locator('[data-status]'),account=page.locator('[data-account]');
        assert.equal(await status.textContent(),'Connected · Local workspace');
        const changed=authenticated=>page.evaluate(authenticated=>window.__fixture__.emit({event:'auth.changed',status:{authenticated,busy:false,message:'',name:'',email:authenticated?'person@example.com':''}}),authenticated);
        await changed(true);
        await account.getByText('Signed in as person@example.com').waitFor();
        assert.equal(await status.textContent(),'Connected · Signed in','the bar agrees with the account control');
        await changed(false);
        await account.getByText('Not signed in').waitFor();
        assert.equal(await status.textContent(),'Connected · Local workspace');
      });
      await step('off widget command is discoverable without import',async()=>{
        await page.getByRole('button',{name:'Commands',exact:true}).click();
        await page.locator('[data-command-query]').fill('GitHub');
        assert(await page.locator('[data-command="github.open"]').isVisible());
        assert(!requests.some(r=>r.includes('github.js')));
        await page.locator('[data-command-query]').press('Enter');
        await page.locator('[data-widget-view="github"]').waitFor({state:'visible'});
      });
      await step('Shells code and CSS load on selection; new pane and off cleanup',async()=>{
        await page.locator('[data-view="shells"]').click();
        await page.locator('[data-widget-view="shells"]').waitFor({state:'visible'});
        assert(requests.some(r=>r.endsWith('/shells.js')));assert(requests.some(r=>r.endsWith('/shells.css')));
        await page.getByRole('button',{name:'New shell',exact:true}).click();
        await page.locator('.xterm').waitFor();
        await page.getByRole('button',{name:'Widgets',exact:true}).click();
        await page.locator('[data-widget="shells"]').uncheck();
        await page.locator('[data-widget-view="shells"]').waitFor({state:'detached'});
        await page.waitForFunction(()=>window.__fixture__.calls.some(c=>c.method==='terminal.close'));
        assert.equal(await page.locator('link[data-widget-style*="shells"]').count(),0);
      });
      await step('repeated terminal toggles leave no pane or stylesheet behind',async()=>{
        for(let i=0;i<12;i++) {
          await page.locator('[data-widget="shells"]').check();
          await page.locator('[data-launch]').waitFor();
          await page.getByRole('button',{name:'New shell',exact:true}).click();
          await page.locator('.xterm').waitFor();
          if(i===0) {
            const geometry=await page.locator('.panes').boundingBox();
            assert(geometry.height>100,'Terminal keeps a usable viewport');
            await page.screenshot({path:path.join(output,`${name}-terminal.png`),fullPage:true});
          }
          await page.locator('[data-widget="shells"]').uncheck();
          await page.locator('[data-widget-view="shells"]').waitFor({state:'detached'});
        }
        await page.waitForFunction(()=>window.__fixture__.calls.filter(c=>c.method==='terminal.open').length===window.__fixture__.calls.filter(c=>c.method==='terminal.close').length);
        assert.equal(await page.locator('.xterm,link[data-widget-style*="shells"]').count(),0);
      });
      await step('JSON preview is isolated and install is explicit',async()=>{
        await page.locator('[data-widget="declarative"]').check();
        const host=page.locator('[data-widget-view="declarative"]');
        const before=await page.evaluate(()=>window.__fixture__.calls.filter(c=>c.method==='items.save').length);
        await host.getByLabel('Import widget JSON').setInputFiles({name:'widget.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(definition))});
        await host.getByRole('heading',{name:'Preview: '+definition.name}).waitFor();
        assert.equal(await host.locator('.json-card').count(),0);
        assert.equal(await page.evaluate(()=>window.__fixture__.calls.filter(c=>c.method==='items.save').length),before);
        await host.getByRole('button',{name:'Install widget',exact:true}).click();
        await host.locator('.json-card').waitFor();
        assert(!await host.getByText('Sample content · no action or provider is run.',{exact:true}).count());
      });
      await step('unknown code is rejected and markup is rendered as text',async()=>{
        const host=page.locator('[data-widget-view="declarative"]');
        await host.getByLabel('Import widget JSON').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...definition,script:'./evil.js'}))});
        await host.getByRole('status').filter({hasText:'Unknown field'}).waitFor();
        assert.equal(await host.getByRole('button',{name:'Install widget',exact:true}).count(),0);
        const unsafe={...definition,name:'<img src=x onerror=alert(1)>',components:[{type:'text',label:'Literal',text:'<script>bad()</script>'}]};
        await host.getByLabel('Import widget JSON').setInputFiles({name:'literal.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(unsafe))});
        await host.getByText('<script>bad()</script>',{exact:true}).waitFor();
        assert.equal(await host.locator('img,script,iframe').count(),0);
        await host.getByRole('button',{name:'Dismiss preview',exact:true}).click();
      });
      await step('failed note retains draft; off removes inner widget surface',async()=>{
        const host=page.locator('[data-widget-view="declarative"]');
        const input=host.locator('.json-card textarea').first();
        await input.fill('A draft retained after a failed save.');
        await page.evaluate(()=>window.__fixture__.failNote=true);
        await host.getByRole('button',{name:definition.actions.find(a=>a.operation==='note.save').label,exact:true}).click();
        await host.getByRole('status').filter({hasText:'could not be saved'}).waitFor();
        assert.equal(await input.inputValue(),'A draft retained after a failed save.');
        await host.getByRole('button',{name:'Turn off',exact:true}).click();
        await host.locator('[data-json-surface]').waitFor({state:'detached'});
        await host.getByRole('button',{name:'Turn on',exact:true}).click();
        assert.equal(await host.locator('textarea').first().inputValue(),'A draft retained after a failed save.');
      });
      await step('turning off retires a delayed failed action',async()=>{
        const host=page.locator('[data-widget-view="declarative"]');
        await host.getByRole('button',{name:'Save configuration',exact:true}).click();
        await host.getByRole('status').filter({hasText:'Configuration saved.'}).waitFor();
        const before=await page.evaluate(()=>window.__fixture__.calls.filter(c=>c.method==='items.save').length);
        await page.evaluate(()=>{window.__fixture__.holdNotes=true;window.__fixture__.failNote=true;});
        await host.getByRole('button',{name:'Save note',exact:true}).click();
        await page.waitForFunction(count=>window.__fixture__.calls.filter(c=>c.method==='items.save').length>count,before);
        await host.getByRole('button',{name:'Turn off',exact:true}).click();
        await host.locator('[data-json-surface]').waitFor({state:'detached'});
        const beforeReply=await host.getByRole('status').textContent();
        await page.evaluate(()=>window.__fixture__.releaseNote());
        await page.waitForTimeout(100);
        assert.equal(await host.getByRole('status').textContent(),beforeReply,'A retired action must not report its late error');
      });
      await step('last view and installed command survive reload without JSON code loading',async()=>{
        await page.locator('[data-view="today"]').click();
        await page.waitForFunction(()=>window.__fixture__.settings['shell.lastView']==='today');
        requests.length=0;
        await page.reload();await page.locator('[data-ready="true"]').waitFor();
        assert(!requests.some(r=>r.endsWith('/declarative.js')||r.endsWith('/definitions.js')));
        await page.getByRole('button',{name:'Commands',exact:true}).click();
        await page.locator('[data-command-query]').fill(definition.name);
        assert(await page.locator('[data-command^="json."]').isVisible());
        await page.locator('[data-command-query]').press('Escape');
      });
      await step('keyboard palette stays reachable; narrow layout fits',async()=>{
        await page.setViewportSize({width:390,height:844});
        await page.getByRole('button',{name:'Commands',exact:true}).click();
        await page.locator('[data-command-query]').fill('new shell');
        await page.locator('[data-command-query]').press('ArrowDown');
        assert.equal(await page.locator('[data-command="shells.new"]').evaluate(e=>e===document.activeElement),true);
        await page.keyboard.press('Escape');
        assert.equal(await page.getByRole('button',{name:'Commands',exact:true}).evaluate(e=>e===document.activeElement),true);
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        await page.screenshot({path:path.join(output,`${name}-narrow.png`),fullPage:true});
        await page.setViewportSize({width:1090,height:700});
        await page.screenshot({path:path.join(output,`${name}-desktop.png`),fullPage:true});
      });
      await step('turning each widget on and off adds no global',async()=>{
        // Baseline: the same browser and the same injected fixture host, on a document with no
        // script of the app. The only key a widget may add is the vendored terminal bundle's
        // hand-over object, and only after that bundle has been loaded for a pane.
        const blank=await context.newPage();
        let defaults;
        try {await blank.goto(origin+'/README.md');defaults=new Set(await blank.evaluate(()=>Reflect.ownKeys(window).map(String)));}
        finally{await blank.close();}
        // Own keys, so a non-enumerable define or a symbol counts as well as a plain assignment.
        const added=async()=>(await page.evaluate(()=>Reflect.ownKeys(window).map(String))).filter(key=>!defaults.has(key)).sort();
        const allowed=()=>requests.some(r=>r.endsWith('/xterm.js'))?['OpenSesameXterm']:[];
        assert.deepEqual(await added(),allowed(),'the shell and the widgets loaded so far add no other global');
        const ids=await page.evaluate(async()=>(await import(location.origin+'/ui/manifest.js')).widgets.map(widget=>widget.id));
        if(await page.locator('#widget-settings').isHidden())await page.getByRole('button',{name:'Widgets',exact:true}).click();
        const wasOn=new Map();
        for(const id of ids) {
          const box=page.locator(`[data-widget="${id}"]`),view=page.locator(`[data-widget-view="${id}"]`);
          wasOn.set(id,await box.isChecked());
          if(wasOn.get(id)){await box.uncheck();await view.waitFor({state:'detached'});}
          await box.check();await view.waitFor({state:'visible'});
          if(id==='shells'){await view.getByRole('button',{name:'New shell',exact:true}).click();await view.locator('.xterm').waitFor();}
          assert.deepEqual(await added(),allowed(),`turning ${id} on adds no global`);
          await box.uncheck();await view.waitFor({state:'detached'});
          assert.deepEqual(await added(),allowed(),`turning ${id} off leaves no global`);
        }
        for(const [id,on] of wasOn)if(on)await page.locator(`[data-widget="${id}"]`).check();
      });
      await step('a switch turned while the first view loads is saved',async()=>{
        const loading=await context.newPage();
        try {
          let release;const held=new Promise(resolve=>release=resolve);
          await loading.route('**/ui/widgets/pending.js',async route=>{await held;await route.continue();});
          // WebKit holds the load event while the first view's import is pending; the page is ready to use before it.
          await loading.goto(origin+'/ui/index.html',{waitUntil:'domcontentloaded'});
          await loading.locator('[data-widget="reader"]:not([disabled])').waitFor({state:'attached'});
          assert.notEqual(await loading.locator('.shell').getAttribute('data-ready'),'true','the first view is still loading');
          await loading.getByRole('button',{name:'Widgets',exact:true}).click();
          await loading.locator('[data-widget="reader"]').check();
          release();
          await loading.locator('[data-ready="true"]').waitFor();
          await loading.waitForFunction(()=>window.__fixture__.states.reader==='active',null,{timeout:3000});
          await loading.waitForFunction(()=>window.__fixture__.settings['shell.lastView']==='reader',null,{timeout:3000});
        }finally{await loading.close();}
      });
      await step('the runtime self-test of #105 runs through the bridge without opening a widget',async()=>{
        const runner=await context.newPage();
        try {
          // As src-tauri/src/window.rs defines it in a development build started with OPEN_SESAME_SELFTEST.
          await runner.addInitScript(()=>Object.defineProperty(window,'__OPEN_SESAME_SELFTEST__',{value:Object.freeze({kind:'runtime',phase:'save',text:'Fixture runtime qualification'})}));
          // The first view never finishes loading: the qualification must not wait for it.
          await runner.route('**/ui/widgets/pending.js',()=>{});
          // WebKit holds the load event while the first view's import is pending; the page is ready to use before it.
          await runner.goto(origin+'/ui/index.html',{waitUntil:'domcontentloaded'});
          const result=runner.locator('[data-runtime-result]');
          await runner.locator('[data-runtime-result]:not([data-runtime-result="pending"])').waitFor({timeout:10000});
          assert.equal(await result.getAttribute('data-runtime-result'),'passed',await result.textContent());
          assert.notEqual(await runner.locator('.shell').getAttribute('data-ready'),'true','the first view is still loading');
          const calls=await runner.evaluate(()=>window.__fixture__.calls.map(c=>c.method));
          assert(calls.includes('items.save')&&calls.includes('items.list'),'the self-test saved and listed through the bridge');
          assert(!calls.some(m=>m==='widgets.set'||m==='settings.set'),'the runtime self-test changes no preference');
          assert(!calls.includes('terminal.open'),'the runtime self-test opens no pane');
        }finally{await runner.close();}
      });
      await step('initial widget failure does not strand shell restoration',async()=>{
        const recovering=await context.newPage();
        try {
          await recovering.route('**/ui/widgets/pending.js',route=>route.abort());
          await recovering.goto(origin+'/ui/index.html');
          await recovering.locator('[data-shell-notice]:not([hidden])').waitFor();
          await recovering.locator('[data-view="shells"]').click();
          await recovering.locator('[data-launch]').waitFor();
          await recovering.waitForTimeout(100);
          assert.equal(await recovering.locator('.shell').getAttribute('aria-busy'),'false');
          assert.equal(await recovering.locator('.shell').getAttribute('data-ready'),'true');
          assert.equal(await recovering.evaluate(()=>window.__fixture__.settings['shell.lastView']),'shells');
        }finally{await recovering.close();}
      });
      assert.deepEqual(errors,[]);
    }catch(error){
      const state=await Promise.race([page.evaluate(()=>({url:location.href,ready:document.readyState,shellReady:document.querySelector('.shell')?.dataset.ready,busy:document.querySelector('.shell')?.getAttribute('aria-busy'),notice:document.querySelector('[data-shell-notice]')?.textContent,resources:performance.getEntriesByType('resource').map(r=>r.name)})).catch(e=>({error:String(e)})),new Promise(resolve=>setTimeout(()=>resolve({error:'diagnostic observation timed out'}),2000))]);
      await writeFile(path.join(output,`${name}-diagnostic.json`),JSON.stringify({state,events,requests,errors},null,2));
      await page.screenshot({path:path.join(output,`${name}-failure.png`),fullPage:true}).catch(()=>{});report.results.push({engine:name,passed:false,error:error.stack});throw error;}
    finally {await browser.close();}
  }
}finally {
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify(report,null,2));
