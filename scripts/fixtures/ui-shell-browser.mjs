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
// The first view at startup is Today (#77); holding or failing its module holds or fails the first view.
const FIRST_VIEW='**/ui/widgets/today.js';
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
    // Settings is a sheet over the view: the switches are reached with it open, the view with it closed.
    const settingsOpen=async(target=page)=>{if(await target.locator('#widget-settings').isHidden())await target.getByRole('button',{name:'Settings',exact:true}).click();};
    const settingsClosed=async(target=page)=>{if(!await target.locator('#widget-settings').isHidden())await target.keyboard.press('Escape');};
    try {
      await page.goto(origin+'/ui/index.html');
      await page.locator('[data-ready="true"]').waitFor();
      await step('startup loads only shell and last view',async()=>{
        assert(await page.locator('[data-widget-view="today"]').isVisible());
        for(const part of ['shells.js','shells.css','terminal.js','xterm.js','xterm.css','declarative.js','definitions.js'])assert(!requests.some(r=>r.endsWith('/'+part)),part+' must not load');
        assert.deepEqual(await page.evaluate(()=>Object.keys(window).filter(k=>k.startsWith('OpenSesame'))),[]);
        // The account and shortcut of #72 and #71 sit outside every widget, in the Settings sheet,
        // and answer at start whether or not the sheet is open.
        assert(await page.locator('#widget-settings').isHidden(),'Settings start closed');
        await page.getByRole('button',{name:'Settings',exact:true}).click();
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
        // The sheet covers the view while it is open and gives it back when it closes.
        await page.keyboard.press('Escape');
        assert(await page.locator('#widget-settings').isHidden());
        assert(await page.locator('[data-widget-view="today"]').isVisible());
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
        await page.getByRole('button',{name:'Settings',exact:true}).click();
        await page.locator('[data-widget="shells"]').uncheck();
        await page.locator('[data-widget-view="shells"]').waitFor({state:'detached'});
        await page.waitForFunction(()=>window.__fixture__.calls.some(c=>c.method==='terminal.close'));
        assert.equal(await page.locator('link[data-widget-style*="shells"]').count(),0);
      });
      await step('repeated terminal toggles leave no pane or stylesheet behind',async()=>{
        for(let i=0;i<12;i++) {
          await settingsOpen();
          await page.locator('[data-widget="shells"]').check();
          await page.locator('[data-launch]').waitFor();
          await settingsClosed();
          await page.getByRole('button',{name:'New shell',exact:true}).click();
          await page.locator('.xterm').waitFor();
          if(i===0) {
            const geometry=await page.locator('.panes').boundingBox();
            assert(geometry.height>100,'Terminal keeps a usable viewport');
            await page.screenshot({path:path.join(output,`${name}-terminal.png`),fullPage:true});
          }
          await settingsOpen();
          await page.locator('[data-widget="shells"]').uncheck();
          await page.locator('[data-widget-view="shells"]').waitFor({state:'detached'});
        }
        await page.waitForFunction(()=>window.__fixture__.calls.filter(c=>c.method==='terminal.open').length===window.__fixture__.calls.filter(c=>c.method==='terminal.close').length);
        assert.equal(await page.locator('.xterm,link[data-widget-style*="shells"]').count(),0);
      });
      await step('Shells fits the narrow column, fills its height and works from the keyboard',async()=>{
        // A 56 px strip and the 400 px panel (docs/companion-rail.md): Shells must fit the
        // narrow column as well as the wide one (issues #190 to #196).
        await page.setViewportSize({width:456,height:900});
        await settingsOpen();
        await page.locator('[data-widget="shells"]').check();
        await page.locator('[data-launch]').waitFor();
        await settingsClosed();
        const view=page.locator('[data-widget-view="shells"]');
        const newShell=view.getByRole('button',{name:'New shell',exact:true});
        for(let n=1;n<=3;n++){await newShell.click();await page.waitForFunction(n=>document.querySelectorAll('.pane .xterm').length===n,n);}
        const shown=view.locator('.pane:not([hidden]) .xterm');
        await shown.click();
        await view.locator('.pane:not([hidden]) .xterm.focus').waitFor();
        await page.screenshot({path:path.join(output,`${name}-shells-narrow.png`)});
        // #190: the emulator marks itself `focus`; the Focus view's rule must not reach it.
        assert.deepEqual(await shown.evaluate(node=>{const style=getComputedStyle(node);return [style.textAlign==='center',style.paddingTop];}),[false,'0px'],'a focused terminal is not centred or pushed down');
        // #191: nothing in the column scrolls sideways, and the launch fields and the terminal are inside it.
        const fit=await view.evaluate(node=>{
          const right=node.getBoundingClientRect().right,wide=[];
          for(let at=node.querySelector('.panes');at;at=at.parentElement)if(at.scrollWidth>at.clientWidth)wide.push(`${at.className||at.tagName} ${at.scrollWidth}>${at.clientWidth}`);
          const past=['[name="cwd"]','[name="host"]','[name="user"]','.panes','.pane:not([hidden]) .xterm-screen'].filter(selector=>node.querySelector(selector).getBoundingClientRect().right>right+0.5);
          return {wide,past};
        });
        assert.deepEqual(fit,{wide:[],past:[]},'Shells fits the 400 px panel');
        // #192: the panes take the last row whether or not the notice is shown.
        const rows=()=>view.evaluate(node=>{const all=node.querySelector('.terminals').getBoundingClientRect(),panes=node.querySelector('.panes').getBoundingClientRect();return {gap:Math.round(all.bottom-panes.bottom),height:panes.height};});
        const quiet=await rows();
        assert.equal(quiet.gap,0,'the panes reach the bottom of the view');
        await view.evaluate(node=>{const notice=node.querySelector('[data-notice]');notice.textContent='Fixture notice';notice.hidden=false;});
        const noted=await rows();
        assert.equal(noted.gap,0,'and still do with a notice above them');
        assert(noted.height<quiet.height,'the notice takes its room from the panes');
        await view.evaluate(node=>{const notice=node.querySelector('[data-notice]');notice.textContent='';notice.hidden=true;});
        // #196: the emulator keeps an accessibility tree and a live region for screen readers.
        assert.equal(await shown.locator('.xterm-accessibility-tree').count(),1,'the terminal has its accessibility tree');
        assert.equal(await shown.locator('[aria-live]').count(),1,'and a live region');
        // #193: the tabs are one stop in the tab order and the arrows, Home and End move along them.
        const tab=n=>view.getByRole('tab',{name:`Shell ${n}`,exact:true});
        const selected=()=>view.evaluate(node=>{const active=document.activeElement;return {selected:node.querySelector('[role="tab"][aria-selected="true"]')?.textContent,focused:active?.getAttribute('role')==='tab'?active.textContent:active?.tagName};});
        await tab(3).focus();
        for(const [key,expected] of [['ArrowLeft','Shell 2'],['Home','Shell 1'],['End','Shell 3'],['ArrowRight','Shell 1']]) {
          await page.keyboard.press(key);
          assert.deepEqual(await selected(),{selected:expected,focused:expected},`${key} selects and focuses ${expected}`);
        }
        assert.deepEqual(await view.evaluate(node=>[...node.querySelectorAll('[role="tab"]')].map(tab=>{const panel=document.getElementById(tab.getAttribute('aria-controls'));return [panel?.getAttribute('role'),panel?.getAttribute('aria-labelledby')===tab.id];})),[['tabpanel',true],['tabpanel',true],['tabpanel',true]],'each tab names its panel and each panel is labelled by its tab');
        assert.deepEqual(await view.evaluate(node=>[...node.querySelectorAll('[role="tablist"] :is(button,a,input,[tabindex]):not([role="tab"])')].filter(other=>other.tabIndex>=0||other.getAttribute('aria-hidden')!=='true').length),0,'nothing but tabs is in the tablist for the keyboard or a screen reader');
        await newShell.focus();
        await page.keyboard.press('Tab');
        assert.deepEqual(await selected(),{selected:'Shell 1',focused:'Shell 1'},'Tab from New shell reaches the shown tab');
        // #194: the focus ring of a tab is drawn in full, not clipped by the tab around it.
        await page.screenshot({path:path.join(output,`${name}-shells-tab-focus.png`),clip:{x:0,y:0,width:456,height:260}});
        const ring=await page.evaluate(()=>{
          const focused=document.activeElement,style=getComputedStyle(focused),width=parseFloat(style.outlineWidth),offset=parseFloat(style.outlineOffset),box=focused.getBoundingClientRect(),out=width+offset;
          const clipped=[];
          for(let at=focused.parentElement;at;at=at.parentElement){const cut=getComputedStyle(at);if(cut.overflowX==='visible'&&cut.overflowY==='visible')continue;const edge=at.getBoundingClientRect();if(box.left-out<edge.left||box.top-out<edge.top||box.right+out>edge.right||box.bottom+out>edge.bottom)clipped.push(at.className||at.tagName);}
          return {visible:focused.matches(':focus-visible')&&style.outlineStyle!=='none'&&width>=2,clipped};
        });
        assert.deepEqual(ring,{visible:true,clipped:[]},'the focused tab shows its whole ring');
        // #195: Delete closes the focused tab and gives the keyboard to its neighbour; the close
        // button gives it to the neighbour's terminal; closing the last gives it to New shell.
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Delete');
        assert.deepEqual(await selected(),{selected:'Shell 3',focused:'Shell 3'},'Delete on a tab focuses the next tab');
        assert.equal(await view.getByRole('tab').count(),2);
        await view.locator('.tab .close').nth(1).click();
        assert.equal(await view.getByRole('tab').count(),1);
        assert(await page.evaluate(()=>Boolean(document.activeElement?.closest('.pane:not([hidden])'))),'closing the shown shell focuses the next terminal');
        await view.locator('.tab .close').click();
        assert.equal(await view.getByRole('tab').count(),0);
        assert(await newShell.evaluate(node=>node===document.activeElement),'closing the last shell focuses New shell, not the page');
        await settingsOpen();
        await page.locator('[data-widget="shells"]').uncheck();
        await view.waitFor({state:'detached'});
        await page.setViewportSize({width:1090,height:700});
      });
      await step('JSON preview is isolated and install is explicit',async()=>{
        await settingsOpen();
        await page.locator('[data-widget="declarative"]').check();
        await settingsClosed();
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
        await settingsOpen();
        const wasOn=new Map();
        for(const id of ids) {
          const box=page.locator(`[data-widget="${id}"]`),view=page.locator(`[data-widget-view="${id}"]`);
          wasOn.set(id,await box.isChecked());
          if(wasOn.get(id)){await box.uncheck();await view.waitFor({state:'detached'});}
          await box.check();await view.waitFor({state:'visible'});
          if(id==='shells'){await settingsClosed();await view.getByRole('button',{name:'New shell',exact:true}).click();await view.locator('.xterm').waitFor();await settingsOpen();}
          assert.deepEqual(await added(),allowed(),`turning ${id} on adds no global`);
          await box.uncheck();await view.waitFor({state:'detached'});
          assert.deepEqual(await added(),allowed(),`turning ${id} off leaves no global`);
        }
        for(const [id,on] of wasOn)if(on)await page.locator(`[data-widget="${id}"]`).check();
        await settingsClosed();
      });
      await step('a switch turned while the first view loads is saved',async()=>{
        const loading=await context.newPage();
        try {
          let release;const held=new Promise(resolve=>release=resolve);
          await loading.route(FIRST_VIEW,async route=>{await held;await route.continue();});
          // WebKit holds the load event while the first view's import is pending; the page is ready to use before it.
          await loading.goto(origin+'/ui/index.html',{waitUntil:'domcontentloaded'});
          await loading.locator('[data-widget="reader"]:not([disabled])').waitFor({state:'attached'});
          assert.notEqual(await loading.locator('.shell').getAttribute('data-ready'),'true','the first view is still loading');
          await loading.getByRole('button',{name:'Settings',exact:true}).click();
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
          await runner.route(FIRST_VIEW,()=>{});
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
      await step('the rail: strip alone when closed, buttons in place when the panel opens, host-led state',async()=>{
        // A host that reports the rail, as src-tauri/src/rail.rs does, and resizes nothing: the
        // viewport stands in for the window the host would resize.
        const railed=await context.newPage();
        try {
          await railed.addInitScript(()=>{
            const host={presentation:'rail',shown:true,expanded:false,held:false,wide:false,edge:'right',hover:true};
            const invoke=window.__TAURI__.core.invoke;
            window.__TAURI__.core.invoke=async(command,payload)=>{
              const {requestId,method,params}=payload.message;
              if(method==='rail.status')return {requestId,result:{...host}};
              if(method==='rail.set'){Object.assign(host,params);if('expanded' in params)host.held=params.expanded;window.__fixture__.calls.push({method,params});return {requestId,result:{...host}};}
              return invoke(command,payload);
            };
            window.__rail__={host,peek:()=>{host.expanded=true;host.held=false;window.__fixture__.emit({event:'rail.changed',status:{...host}});}};
          });
          await railed.setViewportSize({width:56,height:376});
          await railed.goto(origin+'/ui/index.html');
          await railed.locator('[data-ready="true"]').waitFor();
          const shell=railed.locator('.shell'),panel=railed.locator('[data-panel]'),today=railed.locator('[data-view="today"]');
          assert.deepEqual([await shell.getAttribute('data-presentation'),await shell.getAttribute('data-rail')],['rail','collapsed']);
          assert(await panel.isHidden(),'the closed rail draws the strip alone');
          assert.equal(await panel.evaluate(node=>node.inert),true,'the closed panel is out of the tab order');
          assert(await railed.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight),'the strip fits the closed window');
          for(const id of ['today','projects','focus','shells','agents'])assert(await railed.locator(`[data-view="${id}"]`).isVisible(),id+' is on the strip');
          for(const name of ['Commands','Settings'])assert(await railed.getByRole('button',{name,exact:true}).isVisible());
          const closed=await today.boundingBox();
          await railed.screenshot({path:path.join(output,`${name}-rail-strip.png`)});
          // The host opens a peek: the window grows away from the edge, around the strip.
          await railed.setViewportSize({width:400,height:900});
          await railed.evaluate(()=>window.__rail__.peek());
          await panel.waitFor({state:'visible'});
          assert.equal(await shell.getAttribute('data-rail'),'expanded');
          assert.equal(await panel.evaluate(node=>node.inert),false);
          const open=await today.boundingBox();
          // Against the right edge and centred on the display: the same distance from the right
          // edge and from the middle as in the closed window.
          assert.equal(400-open.x,56-closed.x,'a strip button keeps its distance from the screen edge');
          assert.equal(open.y-900/2,closed.y-376/2,'and from the middle of the display');
          assert(await railed.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'the panel fits its width');
          await railed.screenshot({path:path.join(output,`${name}-rail-panel.png`)});
          // A click on a view asks the host to hold the panel open; the page does not decide.
          await railed.locator('[data-view="focus"]').click();
          await railed.locator('[data-widget-view="focus"]').waitFor({state:'visible'});
          await railed.waitForFunction(()=>window.__fixture__.calls.some(c=>c.method==='rail.set'&&c.params.expanded===true));
          assert.equal(await railed.locator('[data-view-title]').textContent(),'Focus');
          // Shells asks for the wide panel, and another view gives the width back.
          await railed.locator('[data-view="shells"]').click();
          await railed.waitForFunction(()=>window.__rail__.host.wide===true);
          await railed.setViewportSize({width:860,height:900});
          assert.equal(await shell.getAttribute('data-rail'),'wide');
          assert(await railed.locator('[data-wide-toggle]').isVisible());
          await railed.screenshot({path:path.join(output,`${name}-rail-wide.png`)});
          await railed.locator('[data-wide-toggle]').click();
          await railed.waitForFunction(()=>window.__rail__.host.wide===false);
          await railed.locator('[data-view="today"]').click();
          await railed.setViewportSize({width:400,height:900});
          assert(await railed.locator('[data-wide-toggle]').isHidden());
          // The left edge mirrors the layout.
          await railed.getByRole('button',{name:'Settings',exact:true}).click();
          await railed.locator('[data-rail-edge]').selectOption('left');
          await railed.waitForFunction(()=>document.querySelector('.shell').dataset.edge==='left');
          assert.equal((await today.boundingBox()).x,closed.x,'on the left edge the strip is against the left of the window');
          await railed.locator('[data-rail-edge]').selectOption('right');
          await railed.waitForFunction(()=>document.querySelector('.shell').dataset.edge==='right');
          // Escape closes the sheet first, then the panel.
          await railed.keyboard.press('Escape');
          assert(await railed.locator('#widget-settings').isHidden());
          await railed.keyboard.press('Escape');
          await railed.waitForFunction(()=>window.__rail__.host.expanded===false);
          await railed.setViewportSize({width:56,height:376});
          assert.equal(await shell.getAttribute('data-rail'),'collapsed');
          assert(await panel.isHidden());
          // The strip names the view that needs the person.
          await railed.evaluate(()=>{const started=Date.now()-900001;window.__fixture__.settings['focus.session']={version:1,durationMs:900000,startedAt:started,deadlineAt:started+900000,pausedAt:null};});
          await railed.evaluate(()=>window.__rail__.peek());
          await railed.evaluate(()=>{const host=window.__rail__.host;host.expanded=false;window.__fixture__.emit({event:'rail.changed',status:{...host}});});
          await railed.locator('[data-view="focus"][data-mark="attention"]').waitFor();
          assert.equal(await railed.locator('[data-view="focus"]').getAttribute('title'),'Focus: Session complete');
          assert.equal(await railed.locator('[data-rail-toggle]').getAttribute('data-mark'),'attention');
          await railed.screenshot({path:path.join(output,`${name}-rail-attention.png`)});
        }finally{await railed.close();}
      });
      await step('initial widget failure does not strand shell restoration',async()=>{
        const recovering=await context.newPage();
        try {
          await recovering.route(FIRST_VIEW,route=>route.abort());
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
