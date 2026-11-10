import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
let listener,collapsed=0,cancelled=0,closed=0,attachmentClosed=0,focused=0,modal=null,menus=[],nativeEvent;
const nodes={'capture-url-row':{hidden:true},'attach-link':{focus:()=>focused++}};
const active={dispatchEvent:event=>{nativeEvent=event;return true}},window={OpenSesameWindow:{collapse:()=>collapsed++},addEventListener:(name,fn)=>listener=fn},document={activeElement:active,getElementById:id=>nodes[id],querySelector:()=>modal,querySelectorAll:()=>menus};
const ctx={window,document,state:{expanded:true},closeUrlEditor:()=>{attachmentClosed++;nodes['capture-url-row'].hidden=true},Event,KeyboardEvent:class{constructor(type,params){this.type=type;Object.assign(this,params)}}};vm.runInNewContext(fs.readFileSync('dist/escape.js','utf8'),ctx);
const event=extra=>({key:'Escape',preventDefault(){this.defaultPrevented=true},stopImmediatePropagation(){this.stopped=true},...extra});
for(const target of ['input','textarea','terminal','browser-child']){const e=event({target});assert.equal(listener(e),true);assert.equal(e.defaultPrevented,true)}assert.equal(collapsed,4);
for(const extra of [{defaultPrevented:true},{isComposing:true},{keyCode:229},{key:'Enter'},{metaKey:true},{ctrlKey:true},{altKey:true},{shiftKey:true}])assert.equal(listener(event(extra)),false);assert.equal(collapsed,4);
modal={dispatchEvent:()=>{cancelled++;return false},close:()=>closed++};assert.equal(listener(event()),false);window.OpenSesameEscape.native();assert.equal(cancelled,1);assert.equal(closed,0,'A dialog owns its cancel action and draft preservation');modal.dispatchEvent=()=>true;window.OpenSesameEscape.native();assert.equal(closed,1);modal=null;
menus=[{hidden:false,getClientRects:()=>[{}]}];assert.equal(listener(event()),false);menus=[];window.OpenSesameFrame={dragging:true};assert.equal(listener(event()),false);window.OpenSesameFrame.dragging=false;
nodes['capture-url-row'].hidden=false;assert.equal(listener(event()),true);assert.equal(attachmentClosed,1);assert.equal(focused,1);assert.equal(collapsed,4);
ctx.state.expanded=false;assert.equal(listener(event()),false);ctx.state.expanded=true;window.OpenSesameEscape.native();assert.equal(nativeEvent.key,'Escape');assert.equal(nativeEvent.bubbles,true);assert.equal(nativeEvent.cancelable,true);
// The terminal's public key hook must consume Escape before xterm sends it to the PTY.
const terminal=fs.readFileSync('dist/terminal.js','utf8');let keyHook;const term={attachCustomKeyEventHandler:fn=>keyHook=fn};vm.runInNewContext(terminal.match(/term\.attachCustomKeyEventHandler\([^;]+;/)[0],{term,window});assert.equal(keyHook(event()),false);assert.equal(keyHook(event({key:'a'})),true);
const swift=fs.readFileSync('desktop/OpenSesame.swift','utf8');assert.ok(swift.includes('event.keyCode == 53')&&swift.includes('self.panel.isKeyWindow')&&swift.includes('self.panel.attachedSheet == nil')&&swift.includes('window.OpenSesameEscape?.native()'));
console.log('Escape collapses focused input/terminal/browser contexts, preserves modifier and IME keys, defers to dialogs/menus/resize, consumes xterm Escape, and routes native child views through the trusted dismissal stack. OS event delivery remains a native acceptance check.');

let focusExits=0;window.OpenSesameContentFocus={active:true,exit(){focusExits++;this.active=false}};const collapsedBeforeFocus=collapsed;
assert.equal(listener(event({type:'keyup'})),false);assert.equal(focusExits,0);
assert.equal(listener(event({type:'keydown'})),true);assert.equal(focusExits,1);assert.equal(collapsed,collapsedBeforeFocus,'Escape restores content before collapsing the app');
assert.equal(listener(event({type:'keyup'})),false);assert.equal(collapsed,collapsedBeforeFocus,'A retargeted terminal keyup cannot dismiss a second layer');
console.log('Content-focus Escape priority and terminal keyup retargeting preserve the next dismissal layer.');
