import {readFileSync} from 'node:fs';
import {Script, createContext, runInContext} from 'node:vm';
import assert from 'node:assert/strict';

const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
const source=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(source,'Self-contained app script exists');
new Script(source);
let checks=0;
function test(name,fn){fn();checks++;console.log(`PASS ${name}`)}
function boot({saved=null,now=200000,storageThrows=false}={}){
  const elements=new Map();
  const get=selector=>{
    if(!elements.has(selector))elements.set(selector,{innerHTML:'',textContent:'',value:'',style:{},classList:{add(){},remove(){}},setAttribute(){},focus(){},addEventListener(){},showModal(){this.open=true},close(){this.open=false}});
    return elements.get(selector);
  };
  let stored=saved,clock=now;
  class Clock extends Date{static now(){return clock}}
  const context=createContext({URL,Date:Clock,Intl,console,structuredClone,
    setTimeout:()=>1,clearTimeout(){},setInterval(){},
    document:{querySelector:get,querySelectorAll:()=>[],addEventListener(){},hidden:false},
    localStorage:{getItem(){if(storageThrows)throw Error('blocked');return stored},setItem(k,v){if(storageThrows)throw Error('quota');stored=v}}
  });
  runInContext(source,context);
  return {read:expression=>runInContext(expression,context),write:code=>runInContext(code,context),stored:()=>stored,clock:value=>{clock=value}};
}
test('All five app destinations render',()=>{
  const app=boot();for(const page of ['today','projects','widgets','focus','console'])assert.ok(app.read(`page='${page}';render();screen.innerHTML`).length>500);
});
test('User text is escaped before rendering',()=>{
  const app=boot();app.write(`state.items.push({id:'test',type:'note',title:'<img src=x onerror=alert(1)>',body:'<script>alert(1)</script>',project:'OpenCoven',created:999})`);
  const output=app.read('renderResults()');assert.ok(output.includes('&lt;img'));assert.ok(output.includes('&lt;script&gt;'));assert.ok(!output.includes('<script>'));
});
test('Executable and credential-bearing links are rejected',()=>{
  const app=boot();for(const url of ['javascript:alert(1)','data:text/html,test','file:///tmp/test','https://user:password@example.com'])assert.equal(app.read(`safeUrl(${JSON.stringify(url)})`),null);
  assert.equal(app.read('safeUrl("https://opencoven.ai")'),'https://opencoven.ai/');
});
test('Newly captured note appears on Today',()=>{
  const app=boot();app.write(`state.items.push({id:'latest',type:'note',title:'Latest',body:'A newly captured thought',project:'Personal',created:999})`);
  assert.ok(app.read('renderToday()').includes('A newly captured thought'));
});
test('Saved notes and widget choices survive restart',()=>{
  const app=boot();app.write(`state.items.push({id:'kept',type:'note',title:'Kept note',body:'A thought',project:'Personal',created:999});state.widgets=['clock'];save()`);
  const restored=boot({saved:app.stored()});assert.ok(restored.read('state.items.some(i=>i.id==="kept")'));assert.equal(restored.read('state.widgets.join(",")'),'clock');
});
test('Running timer recovers from an absolute deadline',()=>{
  const app=boot({now:200000});app.write('state.timer.running=true;state.timer.end=260000;state.timer.remaining=60;save()');
  const restored=boot({saved:app.stored(),now:230000});assert.equal(restored.read('timeLeft()'),30);
});
test('Expired timer completes exactly once across repeated ticks and restart',()=>{
  const app=boot({now:200000});app.write('state.timer.running=true;state.timer.end=210000;state.timer.remaining=10;save()');app.clock(211000);app.write('tick();tick();tick()');
  assert.equal(app.read('state.timer.completed'),1);assert.equal(app.read('state.timer.running'),false);
  const restored=boot({saved:app.stored(),now:220000});assert.equal(restored.read('state.timer.completed'),1);assert.equal(restored.read('timeLeft()'),0);
});
test('Paused timer stays paused after restart',()=>{
  const app=boot();app.write('state.timer.remaining=42;state.timer.running=false;save()');const restored=boot({saved:app.stored(),now:999999});assert.equal(restored.read('timeLeft()'),42);assert.equal(restored.read('state.timer.running'),false);
});
test('Unavailable storage leaves a usable session',()=>{
  const app=boot({storageThrows:true});assert.equal(app.read('storageAvailable'),false);assert.equal(app.read('save()'),false);assert.ok(app.read('renderToday()').includes('Session only'));
});
test('Malformed storage does not prevent launch',()=>{assert.ok(boot({saved:'broken JSON'}).read('renderToday()').includes('Your space,'));});
test('Unsafe saved links are discarded on load',()=>{
  const app=boot();app.write(`state.items.push({id:'bad-link',type:'link',title:'Bad',url:'javascript:alert(1)',project:'OpenCoven'});save()`);
  assert.equal(boot({saved:app.stored()}).read('state.items.some(i=>i.id==="bad-link")'),false);
});
test('Conversations retain separate familiar histories',()=>{
  const app=boot();app.write(`state.messages.Kitty.push({role:'user',text:'Kitty only'});save()`);const restored=boot({saved:app.stored()});assert.equal(restored.read('state.messages.Kitty.length'),1);assert.equal(restored.read('state.messages.Cody.length'),0);
});
console.log(`\n${checks} checks passed. Browser, native device, and live integration acceptance remain separate.`);
