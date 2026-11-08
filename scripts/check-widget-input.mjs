import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class Node {
  constructor(){this.handlers={};this.children=[];this.attrs={};this.value='';this.hidden=false;this.style={};this.classList={add(){},remove(){},toggle(){}};this.offsetHeight=64;this.selectionStart=this.selectionEnd=0;}
  addEventListener(name,fn){(this.handlers[name]??=[]).push(fn)}
  emit(name,extra={}){const event={target:this,preventDefault(){this.prevented=true},stopImmediatePropagation(){},stopPropagation(){},...extra};for(const fn of this.handlers[name]||[])fn(event);return event}
  setAttribute(k,v){this.attrs[k]=v}removeAttribute(k){delete this.attrs[k]}getAttribute(k){return this.attrs[k]??null}
  append(n){n.parentElement=this;this.children.push(n)}remove(){this.parentElement.children=this.parentElement.children.filter(n=>n!==this)}
  querySelector(selector){return this.children.find(n=>'.'+n.className===selector)||null}
  focus(){document.activeElement=this}select(){this.selectionStart=0;this.selectionEnd=this.value.length}setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b}
}
const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,new Node());return elements.get(id)},document=new Node(),window=new Node();document.body=new Node();document.activeElement=null;document.createElement=()=>new Node();document.getElementById=el;document.querySelector=selector=>el(selector==='.capture-input-wrap'?'capture-input-wrap':'footer');
let renders=0;
const ctx={window,document,state:{expanded:false,size:'medium'},frameScreen:()=>[1512,982],ResizeObserver:class{observe(){}},MutationObserver:class{observe(){}},render(){renders++},renderDraft(){},fit(){},syncNativeWindow(){}};
vm.runInNewContext(fs.readFileSync('dist/capture-launcher.js','utf8'),ctx);
el('capture-input-wrap').scrollHeight=56;el('capture-commands').hidden=true;assert.equal(window.OpenSesameLauncher.nativeFrame().height,74,'The search row fits with its full native inset');el('capture-commands').hidden=false;el('capture-commands').scrollHeight=800;assert.equal(window.OpenSesameLauncher.nativeFrame().height,514,'Measure command content even while its viewport is clipped');el('capture-input-wrap').scrollHeight=120;assert.equal(window.OpenSesameLauncher.nativeFrame().height,578,'Multiline input expands the native launcher');
const key=()=>document.emit('keydown',{code:'Space',altKey:true});
key();assert.equal(window.OpenSesameLauncher.active,true);assert.equal(ctx.state.expanded,true);key();assert.equal(window.OpenSesameLauncher.active,false);
window.__OPEN_SESAME_GLOBAL_SHORTCUT__=true;const before=renders;assert.equal(key().prevented,true);assert.equal(renders,before,'Native shortcut ownership must prevent a second DOM toggle');
window.OpenSesameLauncher.open();document.activeElement=null;window.OpenSesameLauncher.open();assert.equal(document.activeElement,el('capture-input'),'Reopening an already visible launcher restores input focus');

const source=fs.readFileSync('dist/app.js','utf8');let current={id:'one',url:'https://old.example/',text:'https://old.example/',title:'',projectId:''},persist=true,saves=0,preview=0;
const bookmark={currentItem:()=>current,$:el,pageUrl:raw=>{try{const u=new URL(raw.includes('://')?raw:'https://'+raw);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:''}catch{return ''}},clearTimeout(){},bookmarkUrlTimer:0,items:[current],OpenSesameBookmarkModel:{duplicate:()=>false},saveItems:()=>{saves++;return persist},renderBookmarkMeta(){},renderItems(){},setBookmarkPreview:()=>preview++,bookmarkPreview:true,toast(){},Date};
vm.createContext(bookmark);vm.runInContext(source.slice(source.indexOf('function applyBookmarkUrl('),source.indexOf("$('bookmark-edit-url').addEventListener")),bookmark);
el('detail-url').value='new.example/path';assert.equal(bookmark.applyBookmarkUrl(),true);assert.equal(current.url,'https://new.example/path');assert.equal(current.text,current.url);assert.equal(preview,1);
const saved=JSON.stringify(current);persist=false;el('detail-url').value='another.example';assert.equal(bookmark.applyBookmarkUrl(),false);assert.equal(JSON.stringify(current),saved);assert.equal(preview,1,'Failed persistence must preserve the current page');
el('detail-url').value='javascript:alert(1)';assert.equal(bookmark.applyBookmarkUrl(),false);assert.equal(JSON.stringify(current),saved);

const terminal=fs.readFileSync('dist/terminal.js','utf8'),pane={id:'one',name:'Shell'},row=new Node(),button=el('terminal-pane-one'),label=new Node();label.className='terminal-pane-name';button.append(label);row.append(button);
let renamed=0;const rename={renaming:null,lastNameClick:{},panes:[pane],mounted:new Map(),selected:'one',el,document,save:()=>renamed++};vm.createContext(rename);
vm.runInContext(terminal.slice(terminal.indexOf('  function finishRename('),terminal.indexOf('  const hasPicker=')),rename);
rename.beginRename(pane);let input=row.querySelector('.terminal-pane-rename');input.value='  Work shell  ';input.emit('input');input.emit('keydown',{key:'Enter'});assert.equal(pane.name,'Work shell');assert.equal(renamed,1);assert.equal(row.querySelector('.terminal-pane-rename'),null);
rename.beginRename(pane);input=row.querySelector('.terminal-pane-rename');input.value='Discard';input.emit('input');input.emit('keydown',{key:'Escape'});assert.equal(pane.name,'Work shell');assert.equal(renamed,1);
rename.beginRename(pane);input=row.querySelector('.terminal-pane-rename');input.value='Saved on blur';input.emit('input');const other=new Node();other.focus();input.emit('blur');assert.equal(pane.name,'Saved on blur');assert.equal(document.activeElement,other,'Blur commit must not steal the next field focus');
const swift=fs.readFileSync('desktop/OpenSesame.swift','utf8'),hotkey=fs.readFileSync('desktop/GlobalShortcut.swift','utf8');
assert.ok(hotkey.includes('RegisterEventHotKey')&&hotkey.includes('UnregisterEventHotKey'));
assert.ok(swift.includes('panel.becomesKeyOnlyIfNeeded = false')&&!swift.includes('.nonactivatingPanel'));
assert.ok(swift.includes('OpenSesameScreenPlacement.screenIndex(pointer: pointer')&&swift.includes('requestedSize = NSSize(width: requestedWidth, height: requestedHeight); fillsDisplay = full'));
assert.ok(terminal.includes("request('window.focus')"));
let pointer,activate,focused=0;const focusRecord={},focusCalls=[];
const focusContext={viewport:{addEventListener:(name,callback)=>pointer=callback},window:{__OPEN_SESAME_NATIVE__:true},openSesameBridge:{request:(method)=>{focusCalls.push(method);return new Promise(resolve=>activate=resolve)}},record:focusRecord,p:{id:'one'},mounted:new Map([['one',focusRecord]]),term:{focus:()=>focused++},toast(){}};
const pointerStart=terminal.indexOf("viewport.addEventListener('pointerdown'");
vm.runInNewContext(terminal.slice(pointerStart,terminal.indexOf(';render();',pointerStart))+';',focusContext);
pointer({button:0});assert.deepEqual(focusCalls,['window.focus']);assert.equal(focused,0);activate();await Promise.resolve();assert.equal(focused,1,'xterm focus follows native window activation');
pointer({button:0});focusContext.mounted.clear();activate();await Promise.resolve();assert.equal(focused,1,'A late activation must not refocus a disconnected terminal');
let dataHandler;const inputCalls=[],inputContext={term:{onData:fn=>dataHandler=fn,onBinary(){},onResize(){}},record:{live:true},send:(method,params)=>inputCalls.push({method,...params}),btoa,queuePtyResize(){}};
const inputStart=terminal.indexOf('term.onData(');
vm.runInNewContext(terminal.slice(inputStart,terminal.indexOf('\n',inputStart)),inputContext);
dataHandler('echo typed\r');assert.equal(inputCalls[0].method,'terminal.input');assert.equal(inputCalls[0].data,'echo typed\r');inputContext.record.live=false;dataHandler('ignored');assert.equal(inputCalls.length,1);
console.log('Launcher ownership/focus, atomic bookmark URL updates, shell rename commit/cancel/blur, and native shortcut/focus/display declarations passed. Native hardware acceptance is separate.');
