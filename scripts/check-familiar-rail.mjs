import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const nodes=new Map(),storage=new Map(),window=new EventTarget();let document;
class Node extends EventTarget{
  constructor(id){super();this.id=id;this.attrs={};this.children=[];this.hidden=false;this.classes=new Set();this.classList={contains:key=>this.classes.has(key),toggle:(key,on)=>on?this.classes.add(key):this.classes.delete(key)};this.innerHTML=''}
  prepend(node){if(node.parentElement)node.parentElement.children=node.parentElement.children.filter(n=>n!==node);this.children.unshift(node);node.parentElement=this}
  append(node){this.children.push(node);node.parentElement=this}setAttribute(k,v){this.attrs[k]=String(v)}getAttribute(k){return this.attrs[k]}focus(){document.activeElement=this}
}
const el=id=>{if(!nodes.has(id))nodes.set(id,new Node(id));return nodes.get(id)};
document={activeElement:null,getElementById:el,createElement:()=>new Node(),querySelectorAll:()=>[]};
const state={scenario:'familiars'},conversation={id:'persistent-session',draft:'Keep this draft',messages:['Earlier message']};el('familiar-thread').conversation=conversation;
const context={window,document,state,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},icon:name=>name,Event,CustomEvent,changeScenario(){}};
vm.runInNewContext(fs.readFileSync('dist/workspace.js','utf8'),context);
const button=el('agents-rail-toggle');await new Promise(setImmediate);assert.equal(button.parentElement,el('familiar-rail-title'));await new Promise(setImmediate);assert.equal(button.attrs['aria-controls'],'familiar-rail');await new Promise(setImmediate);assert.equal(button.attrs['aria-expanded'],'true');
button.focus();button.dispatchEvent(new Event('click'));await new Promise(setImmediate);assert.equal(el('familiar-rail').hidden,true);await new Promise(setImmediate);assert.equal(button.parentElement,el('agents-context'));await new Promise(setImmediate);assert.equal(button.attrs['aria-expanded'],'false');await new Promise(setImmediate);assert.equal(document.activeElement,button);await new Promise(setImmediate);assert.ok(el('familiars-workspace').classes.has('rail-collapsed'));await new Promise(setImmediate);assert.equal(el('familiar-thread').conversation,conversation);
assert.equal(JSON.parse(storage.get('open-sesame-workspace-rails-v1')).familiars,false);
state.scenario='terminal';window.OpenSesameWorkspace.sync();await new Promise(setImmediate);assert.equal(el('terminal-rail').hidden,false,'Other rails keep independent preferences');state.scenario='familiars';window.OpenSesameWorkspace.sync();await new Promise(setImmediate);assert.equal(el('familiar-rail').hidden,true);
button.dispatchEvent(new Event('click'));await new Promise(setImmediate);assert.equal(el('familiar-rail').hidden,false);await new Promise(setImmediate);assert.equal(button.parentElement,el('familiar-rail-title'));await new Promise(setImmediate);assert.equal(conversation.draft,'Keep this draft');
window.OpenSesameRails.set('familiars',false);vm.runInNewContext(fs.readFileSync('dist/workspace.js','utf8'),{...context,window:new EventTarget()});await new Promise(setImmediate);assert.equal(el('familiar-rail').hidden,true,'Relaunch restores the saved collapsed state');
const css=fs.readFileSync('dist/familiar-conversation.css','utf8');await new Promise(setImmediate);assert.ok(css.includes('#familiars-workspace.rail-collapsed'));await new Promise(setImmediate);assert.ok(css.includes('100% - 780px'));await new Promise(setImmediate);assert.ok(css.includes('overflow-x:auto'));await new Promise(setImmediate);assert.ok(css.includes('max-width:480px'));
const swift=fs.readFileSync('desktop/OpenSesame.swift','utf8'),allowed=swift.match(/let allowed = \[([^\n]+)\]/)[1];await new Promise(setImmediate);assert.ok(!allowed.includes('native.coven.'));await new Promise(setImmediate);assert.ok(swift.indexOf('guard authentication.authenticated || method')<swift.indexOf('familiarPermissions.request(operation:'));await new Promise(setImmediate);assert.ok(swift.includes('id.hasPrefix("native-")'));
console.log('Shared Familiar rail collapse/reopen/focus, independent persisted preference and mounted conversation/draft preservation passed; native approval routing boundaries retained.');
