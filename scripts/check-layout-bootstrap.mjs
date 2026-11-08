import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const nodes=[];let document;
class Node{
  constructor(){nodes.push(this);this.id='';this.hidden=false;this.dataset={};this.value='';this.disabled=false;this.children=[];this.attrs={};this.clientHeight=450;this.validity={valid:true};this.listeners={};this.classes=new Set();this.classList={add:(...xs)=>xs.forEach(x=>this.classes.add(x)),remove:(...xs)=>xs.forEach(x=>this.classes.delete(x)),contains:x=>this.classes.has(x),toggle:(x,on)=>on?this.classes.add(x):this.classes.delete(x)}}
  append(...n){this.children.push(...n)}prepend(...n){this.children.unshift(...n)}after(){}remove(){}setAttribute(k,v){this.attrs[k]=String(v)}querySelector(){return new Node()}querySelectorAll(){return []}addEventListener(k,fn){(this.listeners[k]??=[]).push(fn)}focus(){document.activeElement=this}contains(){return false}
}
const get=id=>id==='projects-overview'?null:nodes.find(n=>n.id===id)||Object.assign(new Node(),{id});
document=new Node();document.body=new Node();document.getElementById=get;document.createElement=()=>new Node();const window=new Node();window.OpenSesameNotes={};
const context={document,window,Date,icon:()=>'<svg></svg>',state:{scenario:'focus'},focusRunning:false,focusMinutes:30,focusRemaining:1800,focusTopics:[{name:'First'}],topicLimit:()=>10,OpenSesameFocusCalendarModel:{validDuration:n=>n>=15&&n<=1440},setFocusDuration:()=>true,toast(){},requestAnimationFrame:()=>1,cancelAnimationFrame(){},fitFocusTopics(){},ResizeObserver:class{observe(node){assert.ok(node instanceof Node)}},MutationObserver:class{observe(node){assert.ok(node instanceof Node,'An observer must not target a removed section')}}};
vm.createContext(context);
assert.doesNotThrow(()=>vm.runInContext(fs.readFileSync('dist/layout-fit.js','utf8'),context),'Layout setup must work with the current tabbed Projects DOM');
assert.doesNotThrow(()=>vm.runInContext(fs.readFileSync('dist/focus-controls.js','utf8'),context),'Focus setup must not reference a removed control');
assert.equal(get('focus-duration-value').textContent,'30 min');assert.equal(get('focus-duration-open').disabled,false);
context.focusRunning=true;assert.doesNotThrow(()=>window.OpenSesameFocusControls.sync());assert.equal(get('focus-duration-open').disabled,true);assert.equal(get('agenda-capture-input').disabled,true,'Running sessions keep their existing edit guard');
context.focusRunning=false;window.OpenSesameFocusControls.sync();assert.equal(get('focus-duration-open').disabled,false);assert.equal(get('agenda-capture-input').disabled,false);
console.log('Full Focus and layout module setup works without removed Projects/Focus controls; running-session guards and idle recovery remain intact.');
