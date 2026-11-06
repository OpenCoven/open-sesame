import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const ctx={window:{}};vm.createContext(ctx);vm.runInContext(fs.readFileSync('dist/controller-model.js','utf8'),ctx);
const parse=ctx.window.OpenSesameControllerModel.parse,plain=x=>JSON.parse(JSON.stringify(x));
assert.deepEqual(plain(parse('open sesame: feed add example.com/blog')),{action:'feed.add',site:true,url:'example.com/blog'});
assert.equal(parse('feed follow example.com/rss').site,false);
assert.equal(parse('feed pause My Reading Feed').name,'My Reading Feed');
for(const text of ['! rm -rf /','shell ls','open https://evil.example','size 10000','focus 5','open sesames status','feed delete all','x'.repeat(2001)])assert.throws(()=>parse(text));
class Node{
 constructor(){this.children=[];this.handlers={};this.value='';this.hidden=false;this.inert=false;this.attrs={}}
 append(n){this.children.push(n)}setAttribute(k,v){this.attrs[k]=v}addEventListener(k,fn){this.handlers[k]=fn}focus(){}querySelectorAll(){return []}click(){this.handlers.click?.()}getClientRects(){return [{}]}
}
const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,new Node());return elements.get(id)};
let saveOK=true,next=0,managed;
const runtime={window:{addEventListener(){}},document:{getElementById:el,createElement:()=>new Node()},icon:()=>'',setInterval(){},OpenSesameControllerModel:ctx.window.OpenSesameControllerModel,openSesameBridge:{available:false},state:{size:'medium'},items:[],focusRunning:false,focusMinutes:25,focusTopics:[{name:'One'}],pageUrl:x=>{try{const u=new URL(x.includes('://')?x:'https://'+x);return ['https:','http:'].includes(u.protocol)&&!u.username&&!/\s/.test(x)?u.href:''}catch{return ''}},newId:()=>String(++next),saveItems:()=>saveOK,renderItems(){},renderCompact(){},render(){},topicLimit:n=>n<=25?5:n<=60?10:Infinity,changeScenario:x=>runtime.state.scenario=x,setFocusDuration:n=>runtime.focusMinutes=n,openSesameReading:{listFeeds:()=>[{title:'One',url:'https://one.example',paused:false}],addFeed:async(url,site)=>{managed={url,site};return 'ready'},manageFeed:async(action,name)=>{managed={action,name};return 'changed'}}};
runtime.activeItems=()=>runtime.items.filter(x=>!x.done);el('focus-start').handlers.click=()=>runtime.focusRunning=!runtime.focusRunning;
vm.createContext(runtime);vm.runInContext(fs.readFileSync('dist/controller.js','utf8'),runtime);const run=runtime.window.OpenSesameController.execute;
await run('note A new thought','same-message');await run('note A new thought','same-message');assert.equal(runtime.items.length,1);
saveOK=false;await assert.rejects(()=>run('task Must save'),/storage/);assert.equal(runtime.items.length,1);saveOK=true;
await assert.rejects(()=>run('bookmark javascript:alert(1)'),/URL/);
await run('bookmark https://example.com/');assert.equal(runtime.items.at(-1).url,'https://example.com/');
await run('feed add example.com/blog');assert.deepEqual(managed,{url:'example.com/blog',site:true});
await run('feed resume One');assert.deepEqual(managed,{action:'resume',name:'One'});
await run('open reading');assert.equal(runtime.state.scenario,'reading');await run('size max');assert.equal(runtime.state.size,'max');
await run('focus 25');assert.equal(runtime.focusRunning,true);await assert.rejects(()=>run('focus 45'),/Pause/);await run('focus pause');assert.equal(runtime.focusRunning,false);
runtime.focusTopics=Array.from({length:6},()=>({}));await assert.rejects(()=>run('focus 25'),/too many topics/);
runtime.focusTopics=[];await assert.rejects(()=>run('focus 25'),/Add a topic/);
runtime.items=Array.from({length:30},(_,i)=>({id:'full-'+i}));await assert.rejects(()=>run('note Full'),/full/);
assert.match(await run('status'),/30 active items/);
const swift=fs.readFileSync('desktop/OpenSesame.swift','utf8');for(const method of ['controller.start','controller.stop','controller.poll','controller.ack','reading.saveRSS'])assert.ok(swift.includes('"'+method+'"'));
console.log('Controller command allowlist, feed routing, capture deduplication/rollback/capacity, focus limits, navigation, and native dispatch coverage passed. DOM is simulated; live providers are not exercised.');
