import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
class Node {
  constructor(){this.children=[];this.handlers={};this.attrs={};this.value='';this.style={setProperty(){}};this.classList={add(){},toggle(){}}}
  append(...nodes){this.children.push(...nodes)}
  addEventListener(name,fn){this.handlers[name]=fn}
  setAttribute(name,value){this.attrs[name]=value}
}
let level=65,loaded=true,supported=true;const calls=[];
const provider={snapshot:()=>({loaded}),getVolume:()=>supported?level:null,setVolume:value=>{level=value;calls.push(value)}};
const context={window:{},document:{createElement:()=>new Node()},icon:x=>x,hoverTimer:0,clearTimeout(){},toast(){}};
vm.createContext(context);vm.runInContext(fs.readFileSync('dist/media-volume.js','utf8'),context);
const host=new Node(),control=context.window.OpenSesameVolume.attach(host,()=>provider,'Track'),[mute,slider,output]=host.children;
const event={stopPropagation(){}};
assert.equal(slider.value,'65');mute.handlers.click(event);assert.equal(level,0);assert.equal(mute.attrs['aria-label'],'Unmute Track');
mute.handlers.click(event);assert.equal(level,65,'Unmute restores the previous audible level');
slider.handlers.pointerdown(event);slider.value='23';slider.handlers.input(event);assert.equal(level,23);slider.handlers.pointerup();assert.equal(output.textContent,'23%');
level=48;control.sync();assert.equal(slider.value,'48','Provider updates reach every surface');
supported=false;control.sync();assert.equal(slider.disabled,true);assert.equal(output.textContent,'Player','Unsupported embedded volume is never presented as working');
loaded=false;control.sync();assert.equal(mute.disabled,true);assert.equal(output.textContent,'—');
console.log('Shared volume: real provider dispatch, mute restoration, dragging, external updates, and unsupported/unloaded states passed.');

// Exercise the actual YouTube placement function: revisiting a parent must not remount its iframe.
const source=fs.readFileSync('dist/youtube.js','utf8');const start=source.indexOf('  function place(host)'),end=source.indexOf('\n',start);
let moves=0;const music={append(node){moves++;node.parentElement=this}},youtube={},workspace={parentElement:music};
const nodes={'youtube-workspace':workspace,'music-youtube-stage':music,'pane-youtube':youtube,'music-provider-stage':{},'youtube-error':{after(node){moves++;node.parentElement=youtube}}};
const placement={el:id=>nodes[id]};vm.createContext(placement);vm.runInContext(source.slice(start,end)+';this.place=place',placement);
placement.place('music');placement.place('music');assert.equal(moves,0);
placement.place('youtube');assert.equal(moves,1);placement.place('youtube');assert.equal(moves,1);
console.log('YouTube placement: same-parent revisits preserve the existing iframe.');
