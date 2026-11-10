import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
// Execute actual widget handlers with deferred bridge replies to prove retirement.
class Node extends EventTarget {value='';hidden=false;disabled=false;textContent='';setAttribute(){} }
const nodes=new Map(),el=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id)};
el('image-generation').hidden=true;el('image-shape').value='square';
const window=new EventTarget(),document=new EventTarget(),calls=[],storage=new Map();let installed=true,pending;
Object.assign(document,{getElementById:el,visibilityState:'visible'});
Object.assign(window,{OpenSesameWidgetLifecycle:{isActive:()=>installed},openSesameBridge:{available:true,request(method,params){calls.push({method,params});if(method==='image.status')return Promise.resolve({configured:true});if(method==='image.generate')return new Promise(resolve=>pending=resolve);return Promise.resolve({cancelled:true})}}});
const context={window,document,openSesameBridge:window.openSesameBridge,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},crypto:{randomUUID:()=> 'fixture-image-request-1234'},console};
vm.runInNewContext(fs.readFileSync('dist/image-generation.js','utf8'),context);
assert.equal(calls.length,0,'Loading the widget never contacts the service');
window.OpenSesameImageGeneration.mount(()=>true);await new Promise(setImmediate);
assert.deepEqual(calls.map(x=>x.method),['image.status']);
el('image-prompt').value='A quiet image';el('image-prompt').dispatchEvent(new Event('input'));
el('image-form').dispatchEvent(new Event('submit',{cancelable:true}));
assert.equal(calls.filter(x=>x.method==='image.generate').length,1);
installed=false;window.dispatchEvent(new Event('open-sesame-widgets-changed'));
assert.equal(calls.at(-1).method,'image.cancel');
pending({id:'fixture-image-request-1234',image:'data:image/png;base64,AAAA'});await new Promise(setImmediate);
assert.equal(el('image-preview').src,undefined,'Late result cannot populate a deactivated widget');
assert.equal(JSON.parse(storage.get('open-sesame-image-draft-v1')).prompt,'A quiet image');
el('image-form').dispatchEvent(new Event('submit',{cancelable:true}));
assert.equal(calls.filter(x=>x.method==='image.generate').length,1,'Inactive submission cannot generate');
console.log('Image widget explicit-send, no-auto-generation, draft retention, cancellation and stale-result retirement pass.');
