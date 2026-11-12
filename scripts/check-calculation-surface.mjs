import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const nodes=[],frames=new Map(),copied=[];let sequence=0,tick;
class Node{
  constructor(){nodes.push(this);this.id='';this.value='';this.hidden=false;this.children=[];this.attrs={};this.handlers={};this.offsetWidth=0;this.style={};this.classList={add(){},toggle(){}};this.parentElement={classList:{add(){}}}}
  closest(){return null}
  append(...n){this.children.push(...n)}after(){}setAttribute(k,v){this.attrs[k]=v}addEventListener(k,fn){this.handlers[k]=fn}querySelector(){return new Node()}
}
const get=id=>nodes.find(n=>n.id===id)||Object.assign(new Node(),{id});
const window={addEventListener(){}},context={window,state:{scenario:'focus'},document:{getElementById:get,createElement:()=>new Node()},icon:()=>'<svg></svg>',requestAnimationFrame:fn=>{frames.set(++sequence,fn);return sequence},cancelAnimationFrame:id=>frames.delete(id),ResizeObserver:class{observe(){}},MutationObserver:class{observe(){}},navigator:{clipboard:{writeText:async value=>copied.push(value)}},toast(){},setInterval(fn){tick=fn}};
vm.createContext(context);vm.runInContext(fs.readFileSync('dist/calculator.js','utf8'),context);
vm.runInContext(fs.readFileSync('dist/world-clock.js','utf8'),context);
const capture=fs.readFileSync('dist/capture.js','utf8');vm.runInContext(capture.slice(capture.indexOf('  const views='),capture.indexOf('  const el=id=>'))+';this.interpret=interpret;',context);window.openSesameCapture={interpret:context.interpret};
get('capture-type').value='auto';get('capture-commands').hidden=true;vm.runInContext(fs.readFileSync('dist/input-tools.js','utf8'),context);
const flush=()=>{const ready=[...frames.values()];frames.clear();for(const fn of ready)fn()};
const type=value=>{get('capture-input').value=value;window.OpenSesameInputTools.refresh();flush()};
type('2-2');assert.equal(get('capture-calculation').hidden,false);assert.equal(get('capture-calculation').children[0].children[0].children[1].textContent,'0');await window.OpenSesameInputTools.copyCalculation();assert.deepEqual(copied,['0']);
get('capture-commands').hidden=false;type('2-2');assert.equal(get('capture-calculation').hidden,true,'Manual commands and calculations occupy one result surface');get('capture-commands').hidden=true;
for(const value of ['/','/focus','/2+2','!','! 2+2','An ordinary thought']){type(value);assert.equal(get('capture-calculation').hidden,true,`A command or note cannot retain a stale calculation: ${value}`);await window.OpenSesameInputTools.copyCalculation();assert.deepEqual(copied,['0'])}
type('2/0');assert.equal(get('capture-calculation').hidden,false);assert.equal(get('capture-calculation').children[0].disabled,true);await window.OpenSesameInputTools.copyCalculation();assert.deepEqual(copied,['0']);
get('capture-type').value='task';type('2+2');assert.equal(get('capture-calculation').hidden,true,'Explicit capture types remain literal');
get('capture-type').value='auto';type('time in Germany');assert.equal(get('capture-calculation').hidden,false);assert.match(get('capture-calculation').children[0].children[0].children[0].textContent,/Europe\/Berlin/);assert.match(get('capture-calculation').children[0].attrs['aria-label'],/Copy local time:.*Europe\/Berlin/);tick();assert.equal(get('capture-calculation').hidden,false);await window.OpenSesameInputTools.copyCalculation();assert.equal(copied.length,2);type('time in USA');assert.equal(get('capture-calculation').children[0].disabled,true);type('ordinary note');tick();assert.equal(get('capture-calculation').hidden,true);
const html=fs.readFileSync('dist/index.html','utf8'),ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length,'All authored control IDs must be unique across coexisting views');
console.log('Actual calculation surface shares command intent, clears stale cards on slash/Bash/notes, preserves zero results and literal types, refuses invalid copies; authored control IDs are unique.');
