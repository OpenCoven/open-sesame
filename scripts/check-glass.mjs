import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
class Events{
 constructor(){this.listeners={}}
 addEventListener(type,fn){(this.listeners[type]??=[]).push(fn)}
 emit(type,extra={}){const event={type,target:this,preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true},...extra};for(const fn of this.listeners[type]||[]){fn(event);if(event.stopped)break}return event}
}
class Element extends Events{
 constructor(surface=false,control=false){super();this.surface=surface;this.control=control;this.attrs={};this.children=[];this.props={};this.style={setProperty:(k,v)=>this.props[k]=v};this.captured=null}
 matches(){return this.surface}closest(){return this.control?this:null}prepend(node){this.children.unshift(node)}append(node){this.children.push(node)}setAttribute(k,v){this.attrs[k]=v}removeAttribute(k){delete this.attrs[k]}hasPointerCapture(id){return this.captured===id}setPointerCapture(id){this.captured=id}releasePointerCapture(){this.captured=null}getBoundingClientRect(){return {left:100,top:0,width:735,height:551}}
}
const anchor=new Element(true),panel=new Element(true),window=new Events(),document=new Events(),preference=new Events();preference.matches=false;
let selection='',clock=0,next=0;const jobs=new Map(),native=[];
const schedule=(fn,ms,repeat=false)=>{const id=++next;jobs.set(id,{fn,at:clock+ms,ms,repeat});return id};
function advance(ms){const end=clock+ms;while(true){const ready=[...jobs].filter(([,j])=>j.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!ready)break;clock=ready[1].at;const [id,job]=ready;if(job.repeat)job.at+=job.ms;else jobs.delete(id);job.fn()}clock=end}
document.getElementById=id=>id==='widget-anchor'?anchor:panel;document.createElement=()=>new Element();window.matchMedia=()=>preference;window.getSelection=()=>({toString:()=>selection});window.OpenSesameFrame={dragging:false};window.__OPEN_SESAME_NATIVE__=true;window.openSesameBridge={request:async(method,params)=>native.push({method,...params})};
const state={expanded:true,layout:'notch',size:'medium'};
const storage=new Map();const context={window,document,state,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},toast(){},performance:{now:()=>clock},requestAnimationFrame:fn=>schedule(()=>fn(clock),16),cancelAnimationFrame:id=>jobs.delete(id),setTimeout:(fn,ms)=>schedule(fn,ms),clearTimeout:id=>jobs.delete(id)};
vm.createContext(context);vm.runInContext(fs.readFileSync('dist/glass-model.js','utf8'),context);context.OpenSesameGlassModel=window.OpenSesameGlassModel;vm.runInContext(fs.readFileSync('dist/glass.js','utf8'),context);
const held=()=>Object.hasOwn(anchor.attrs,'data-glass-held'),opacity=()=>Number(anchor.props['--glass-opacity']);
const down=(target=panel,extra={})=>anchor.emit('pointerdown',{target,pointerId:1,clientX:200,clientY:100,button:0,isPrimary:true,altKey:true,...extra});
const up=()=>window.emit('pointerup',{pointerId:1});
const initial=opacity(),initialNative=native.length;
down(panel,{altKey:false});advance(700);assert.equal(held(),false,'Unmodified holding is reserved for voice');up();
down();advance(200);up();advance(200);assert.equal(held(),false);assert.equal(native.length,initialNative);assert.equal(storage.size,0);
down();advance(700);assert.equal(held(),true);assert.ok(opacity()<initial);up();const clear=opacity(),saved=JSON.parse(storage.get('open-sesame-glass-v2'));assert.equal(native.at(-1).transient,false);assert.equal(native.at(-1).level,saved.level);advance(2000);assert.equal(opacity(),clear,'Release keeps the chosen level');
down();advance(700);assert.ok(opacity()>clear,'Next hold reverses toward opaque');up();const committed=opacity();
down();advance(800);document.emit('keydown',{key:'Escape'});assert.equal(opacity(),committed,'Escape rolls back only the current gesture');
down();advance(8000);assert.ok(opacity()>=.679&&opacity()<=.981,'Continuous holding bounces within material bounds');up();const retained=opacity();
for(const target of [new Element(true,true),new Element(false),new Element(false,true)]){down(target);advance(500);assert.equal(held(),false);up()}
selection='selected text';down();advance(500);assert.equal(held(),false);selection='';down(panel,{button:2});advance(500);assert.equal(held(),false);
down();window.emit('pointermove',{pointerId:1,buttons:1,clientX:215,clientY:100});advance(500);assert.equal(held(),false);
for(const type of ['pointercancel','blur','pagehide','resize','open-sesame-view-changed']){down();advance(600);window.emit(type,{pointerId:1});assert.equal(held(),false,type);assert.equal(opacity(),retained)}
down();advance(600);anchor.emit('lostpointercapture',{pointerId:1});assert.equal(held(),false);
down();advance(600);document.hidden=true;document.emit('visibilitychange');assert.equal(held(),false);document.hidden=false;
down();advance(600);state.size='large';window.emit('open-sesame-layout');assert.equal(held(),false);
window.OpenSesameFrame.dragging=true;down();advance(500);assert.equal(held(),false);window.OpenSesameFrame.dragging=false;
down();advance(600);down(panel,{pointerId:2,isPrimary:false});assert.equal(held(),false);
panel.emit('keydown',{code:'Space',repeat:false});advance(600);assert.equal(held(),true);window.emit('keyup',{code:'Space'});assert.equal(held(),false);assert.equal(JSON.parse(storage.get('open-sesame-glass-v2')).level,native.at(-1).level);
panel.emit('keydown',{code:'Space',target:new Element(false,true)});advance(500);assert.equal(held(),false);
preference.matches=true;preference.emit('change');down();advance(500);assert.equal(held(),false);assert.equal(opacity(),.98);preference.matches=false;preference.emit('change');
state.expanded=false;down();advance(500);assert.equal(held(),false);
const swift=fs.readFileSync('desktop/OpenSesame.swift','utf8');assert.ok(swift.includes('surface.addSubview(web)'));assert.ok(!swift.includes('effect.addSubview(web)'));assert.ok(swift.includes('Timer(timeInterval: 4'));assert.ok(swift.includes('glassSavedLevel'));
console.log('Glass hold delay, saved release, reverse and bounded cycling, Escape/cancellation rollback, controls/selection exclusion, native material updates, keyboard, and reduced transparency passed using simulated DOM events. Browser/macOS visual QA is separate.');
