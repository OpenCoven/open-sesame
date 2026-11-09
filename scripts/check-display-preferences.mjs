import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
class Node {
  constructor(){this.handlers={};this.children=[];this.attrs={};this.hidden=false;this.disabled=false}
  setAttribute(name,value){this.attrs[name]=value}append(node){this.children.push(node)}insertBefore(node){this.children.push(node)}addEventListener(name,fn){this.handlers[name]=fn}
}
const source=fs.readFileSync('dist/display-preferences.js','utf8');
let touches=0;vm.runInNewContext(source,{window:{__OPEN_SESAME_NATIVE__:false},document:{getElementById(){touches++}}});assert.equal(touches,0,'Browser preview never exposes a simulated display pin');
const nodes=new Map(),el=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id)},events=new Map(),calls=[];
const context={window:{__OPEN_SESAME_NATIVE__:true,addEventListener:(name,fn)=>events.set(name,fn)},document:{getElementById:el,createElement:()=>new Node()},icon:()=>'',toast(){throw Error('Unexpected toast')},openSesameBridge:{ready:Promise.resolve(),request:async method=>{calls.push(method);return {pinned:false,available:true,detached:false}}}};
vm.runInNewContext(source,context);for(let i=0;i<6;i++)await Promise.resolve();
const button=el('widget-options').children[0],label=button.children[0];assert.deepEqual(calls,['window.display.status']);assert.equal(label.textContent,'Display · Follow pointer');assert.equal(button.attrs['aria-haspopup'],'menu');
await button.handlers.click();assert.equal(calls.at(-1),'window.display.choose');assert.equal(el('widget-options').hidden,true);assert.equal(el('widget-options-toggle').attrs['aria-expanded'],'false');
const change=status=>events.get('open-sesame-desktop-event')({detail:{event:'window.display.changed',status}});
change({pinned:true,name:'Studio',available:true});assert.equal(label.textContent,'Display · Studio');
change({pinned:true,name:'Studio',available:false});assert.equal(label.textContent,'Display · Studio (unavailable)');assert.match(button.title,/reconnects/);
change({pinned:true,name:'Studio',available:true,detached:true});assert.match(button.title,/application window/);
change({pinned:false,available:true});assert.equal(label.textContent,'Display · Follow pointer');
console.log('Display preference: native-only controls, read-only initialization, explicit menu request, selected/unavailable/detached states and follow-pointer restoration passed. No display was moved.');
