import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
class Node {
  constructor(){this.handlers={};this.attrs={};this.value='';this.placeholder='Original capture';this.children=[];this.dataset={};this.style={};this.hidden=false;this.classList={add(){},remove(){},toggle(){}}}
  addEventListener(name,fn){this.handlers[name]=fn}setAttribute(name,value){this.attrs[name]=value}getAttribute(name){return this.attrs[name]??null}removeAttribute(name){delete this.attrs[name]}append(node){this.children.push(node)}focus(){}querySelector(){return null}
}
const nodes=new Map(),el=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id)},document=new Node(),window=new Node();
document.body=new Node();document.getElementById=el;document.querySelector=()=>el('footer');document.createElement=()=>new Node();
let submits=0,choices=0,back=false,screen=[1512,982];el('capture-form').requestSubmit=()=>submits++;el('capture-commands').hidden=true;
const context={document,window,state:{expanded:false,size:'medium'},frameScreen:()=>screen,render(){},renderDraft(){},fit(){},syncNativeWindow(){},ResizeObserver:class{observe(){}},MutationObserver:class{observe(){}},requestAnimationFrame:fn=>fn()};vm.createContext(context);
vm.runInContext(fs.readFileSync('dist/calculator.js','utf8'),context);
const capture=fs.readFileSync('dist/capture.js','utf8');vm.runInContext(capture.slice(capture.indexOf('  const views='),capture.indexOf('  const el=id=>'))+';this.intent=interpret',context);
assert.equal(context.intent('/widgets').view,'plugins');assert.equal(context.intent('/plugins').view,'plugins','Existing commands still reach the renamed catalog');
window.openSesameCapture={hide(){el('capture-commands').hidden=true;el('capture-input').removeAttribute('aria-activedescendant')},openMenu(){el('capture-commands').hidden=false;el('capture-input').setAttribute('aria-activedescendant','selected');el('selected').dataset.actionLabel='Open'},choose(){choices++;return true},back(){const value=back;back=false;return value},interpret:context.intent};
vm.runInContext(fs.readFileSync('dist/capture-launcher.js','utf8'),context);const palette=window.OpenSesameLauncher;palette.open();palette.sync();
assert.equal(el('footer').attrs['aria-modal'],'true');assert.match(el('capture-input').placeholder,/Search commands/);assert.equal(el('launcher-primary').textContent,'Open ↵');assert.equal(el('launcher-primary').disabled,false);
el('capture-input').value='/';palette.sync();assert.equal(el('launcher-primary').textContent,'Open ↵','Slash opens commands rather than an incomplete calculator');assert.equal(el('launcher-primary').disabled,false);
el('launcher-primary').handlers.click();assert.equal(choices,1);assert.equal(submits,0,'Opening a selection cannot also submit a note');
window.openSesameCapture.hide();el('capture-input').value='2-2';palette.sync();assert.equal(window.OpenSesameCalculator.calculate('2-2').result,'0');assert.equal(el('launcher-primary').textContent,'Copy result ↵');assert.equal(el('launcher-primary').disabled,false);assert.equal(palette.nativeFrame().height,500,'A calculation retains a full results area');el('launcher-primary').handlers.click();assert.equal(submits,1);
el('capture-input').value='2/0';palette.sync();assert.equal(el('launcher-primary').disabled,true);
el('capture-input').value='open Safari';palette.sync();assert.equal(el('launcher-primary').textContent,'Review in Agents ↵','External actions keep their explicit review label');
el('capture-input').value='/unknown';palette.sync();assert.equal(el('launcher-primary').disabled,true);
screen=[320,240];assert.deepEqual(JSON.parse(JSON.stringify(palette.nativeFrame())),{width:296,height:176});
back=true;document.handlers.keydown({key:'Escape',preventDefault(){},stopImmediatePropagation(){}});assert.equal(palette.active,true,'Escape returns from a submenu first');document.handlers.keydown({key:'Escape',preventDefault(){},stopImmediatePropagation(){}});assert.equal(palette.active,false);assert.equal(el('capture-input').placeholder,'Original capture');assert.equal(el('footer').attrs['aria-modal'],undefined);
console.log('Command palette: stable result geometry, small-screen fit, selected actions, zero-valued calculator, safe review/error labels, submenu Escape and capture restoration passed. No app, command or model was launched.');
const html=fs.readFileSync('dist/index.html','utf8');assert.ok(html.indexOf('launcher-palette.css')>html.indexOf('interface-polish.css'),'Palette frame rules must win over the old inset launcher layout');
