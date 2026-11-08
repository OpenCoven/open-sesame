import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const source=fs.readFileSync('dist/app.js','utf8'),sandbox={window:{}};vm.createContext(sandbox);vm.runInContext(fs.readFileSync('dist/frame-model.js','utf8'),sandbox);const model=sandbox.window.OpenSesameFrameModel;
const desktops=[[1280,800],[1512,982],[1728,1117],[1920,1080],[2560,1440],[3440,1440]];
assert.equal(model.ratio,16/9);assert.equal(model.ratioLabel,'16:9');
for(const [w,h] of desktops){const sizes=model.presets(w,h);assert.equal(sizes.length,5);assert.equal(new Set(sizes.map(s=>s.width)).size,5);for(const [i,size] of sizes.slice(0,4).entries()){assert.ok(Math.abs(size.width/size.height-16/9)<.004);assert.ok(size.width<w-39&&size.height<h-71);assert.ok(size.height>=450,'Laptop presets must retain enough height for the composer and scrollable content');if(i)assert.ok(size.width>sizes[i-1].width)}assert.equal(sizes[4].width,w);assert.equal(sizes[4].height,h);const max=sizes[3];assert.ok(max.width*max.height/(w*h)>.399);assert.ok(max.width*max.height/(w*h)<.451);console.log(`${w} × ${h}: ${sizes.map(s=>`${s.name} ${s.width}×${s.height}`).join(' · ')} (${(max.width*max.height/(w*h)*100).toFixed(1)}% max area)`)}
for(const [w,h] of [[320,320],[800,600],[1024,768],[1366,768],[1920,1080],[3840,2160]])for(const size of model.presets(w,h).slice(0,4)){assert.ok(size.width<=w-40&&size.height<=h-72);assert.ok(Math.abs(size.width/size.height-model.ratio)<.02)}
for(const [width,w,h] of [[640,1440,900],[800,1280,800],[960,1440,600],[9000,1280,720],[9000,800,1200],[640,480,300],[NaN,1440,900]]){const size=model.floating(width,w,h);assert.ok(size.width<=w&&size.height<=h);assert.ok(Math.abs(size.width/size.height-model.ratio)<.006)}
assert.equal(model.floating(960,1440,900).height,540,'Saved 4:3 floating windows migrate by retaining width and applying the wide ratio');
for(const size of model.presets(1728,1117)){assert.equal(model.nearest(size.width,model.presets(1728,1117)).key,size.key)}
assert.equal(model.resize({width:780},'left',-50,0).width,880);assert.equal(model.resize({width:780},'right',50,0).width,880);assert.equal(model.resize({width:780},'left',50,0).width,680);assert.equal(model.resize({width:780},'bottom',0,90).width,940);assert.equal(model.resize({width:780},'bottom-right',50,90).width,910);assert.equal(model.resize({width:780},'bottom-right',0,90).width,860);assert.equal(model.resize({width:780},'left',-50,0,{centered:false}).width,830);assert.equal(model.resize({width:780},'bottom',0,2000,{min:630,max:1000}).width,1000);assert.equal(model.resize({width:780},'left',2000,0,{min:630,max:1000}).width,630);
assert.equal(model.capacity(300,210),3);assert.equal(model.capacity(600,210),5);assert.equal(model.capacity(200,210),1);

class Node{
  constructor(id=''){this.id=id;this.hidden=false;this.handlers={};this.attrs={};this.dataset={};this.children=new Map();this.style={values:{},setProperty:(k,v)=>this.style.values[k]=v,getPropertyValue:k=>this.style.values[k]||''};const set=new Set();this.classList={add:(...xs)=>xs.forEach(x=>set.add(x)),remove:(...xs)=>xs.forEach(x=>set.delete(x)),contains:x=>set.has(x),toggle:(x,on)=>{if(on??!set.has(x))set.add(x);else set.delete(x)}};this.captures=new Set()}
  addEventListener(name,fn){(this.handlers[name]??=[]).push(fn)}
  emit(name,extra={}){const event={currentTarget:this,target:this,pointerId:1,button:0,clientX:0,clientY:0,preventDefault(){},stopPropagation(){},stopImmediatePropagation(){},...extra};for(const fn of this.handlers[name]||[])fn(event)}
  setAttribute(k,v){this.attrs[k]=String(v)}getAttribute(k){return this.attrs[k]}
  querySelector(k){if(!this.children.has(k))this.children.set(k,new Node(k));return this.children.get(k)}
  setPointerCapture(id){this.captures.add(id)}hasPointerCapture(id){return this.captures.has(id)}releasePointerCapture(id){this.captures.delete(id);this.emit('lostpointercapture')}
}
const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,new Node(id));return elements.get(id)},win=new Node('window'),doc=new Node('document');doc.body=new Node('body');
const handles=['left','right','bottom','bottom-left','bottom-right'].map(edge=>{const n=el(edge==='bottom'?'frame-resize-bottom':'edge-'+edge);n.dataset.frameEdge=edge;return n}),buttons=model.keys.map(key=>{const n=new Node(key);n.dataset.widgetSize=key;return n});
doc.getElementById=el;doc.querySelectorAll=selector=>selector==='[data-frame-edge]'?handles:selector==='[data-widget-size]'?buttons:[];
let saved=0,fitCalls=0,nativeCalls=0,renderCalls=0,displayScale=.5,clock=100,scheduled=0;const frames=new Map(),timers=new Map();
win.OpenSesameFrameModel=model;win.screen={width:1728,height:1117};win.dispatchEvent=event=>win.emit(event.type);
const runtime={window:win,document:doc,OpenSesameFrameModel:model,$:el,state:{layout:'notch',size:'medium',expanded:true,resolution:'1728,1117',scenario:'music',ratio:8,width:280},hoverTimer:0,Event:class{constructor(type){this.type=type}},performance:{now:()=>clock+=100},requestAnimationFrame:fn=>{frames.set(++scheduled,fn);return scheduled},cancelAnimationFrame:id=>frames.delete(id),setTimeout:fn=>{timers.set(++scheduled,fn);return scheduled},clearTimeout:id=>timers.delete(id),persist:()=>saved++,fit:()=>fitCalls++,syncNativeWindow:()=>nativeCalls++};
vm.createContext(runtime);vm.runInContext(source.slice(source.indexOf('function frameScreen()'),source.indexOf('function renderCompact()')),runtime);
function paintPreset(){const s=model.presets(...runtime.frameScreen()).find(s=>s.key===runtime.state.size);el('widget-anchor').style.setProperty('--panel-width',s.width+'px');el('widget-anchor').style.setProperty('--panel-height',s.height+'px')}
el('widget-anchor').getBoundingClientRect=()=>({width:parseFloat(el('widget-anchor').style.getPropertyValue('--panel-width'))*displayScale});runtime.render=()=>{renderCalls++;paintPreset();win.OpenSesameFrame?.sync()};paintPreset();vm.runInContext(fs.readFileSync('dist/frame.js','utf8'),runtime);
runtime.setExpanded=value=>{runtime.state.expanded=value;runtime.render()};
const width=()=>parseFloat(el('widget-anchor').style.getPropertyValue('--panel-width')),flush=()=>{const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn())},reset=(layout='notch',size='medium')=>{runtime.state.layout=layout;runtime.state.size=size;runtime.state.expanded=true;paintPreset();win.OpenSesameFrame.sync()};
const drag=(edge,dx,dy)=>{const handle=handles.find(h=>h.dataset.frameEdge===edge);handle.emit('pointerdown');handle.emit('pointermove',{clientX:dx,clientY:dy});flush();return handle};
let h=drag('right',120,0);assert.equal(win.OpenSesameFrame.dragging,true);assert.equal(runtime.state.size,'medium','A drag must not commit before release');h.emit('pointerup');assert.equal(runtime.state.size,'max');assert.equal(saved,1);assert.equal(renderCalls,0,'Resizing must preserve mounted editor/media/terminal DOM');assert.equal(win.OpenSesameFrame.dragging,false);assert.equal(el('frame-resize-bottom').getAttribute('aria-valuenow'),'4');
reset();h=drag('left',60,0);h.emit('pointerup');assert.equal(runtime.state.size,'small');assert.equal(runtime.state.expanded,true,'Shrinking to Small must not collapse');
reset('menu');h=drag('right',300,0);assert.equal(win.OpenSesameFrame.dragging,false,'The fixed screen-side menu edge is not draggable');h=drag('left',-200,0);h.emit('pointerup');assert.equal(runtime.state.size,'max');
reset();h=drag('bottom',0,180);const original=model.presets(1728,1117)[1];doc.emit('keydown',{key:'Escape'});assert.equal(runtime.state.expanded,true);assert.equal(runtime.state.size,'medium');assert.equal(width(),original.width);assert.equal(win.OpenSesameFrame.dragging,false);
for(const event of ['pointercancel','lostpointercapture']){reset();h=drag('right',100,0);h.emit(event);assert.equal(width(),original.width);assert.equal(win.OpenSesameFrame.dragging,false)}
reset();h=drag('right',100,0);win.emit('blur');assert.equal(width(),original.width);assert.equal(win.OpenSesameFrame.dragging,false);
reset();h=drag('right',2,0);h.emit('pointerup');assert.equal(runtime.state.size,'medium','A click or tiny movement must not change size');
reset();h=drag('right',100,0);runtime.state.resolution='1280,800';win.OpenSesameFrame.sync();assert.equal(win.OpenSesameFrame.dragging,false);assert.equal(width(),model.presets(1280,800)[1].width,'Changing the virtual desktop must not leave old geometry');
const slider=el('frame-resize-bottom');slider.emit('keydown',{key:'Home'});assert.equal(runtime.state.size,'small');slider.emit('keydown',{key:'ArrowRight'});assert.equal(runtime.state.size,'medium');slider.emit('keydown',{key:'End'});assert.equal(runtime.state.size,'full');assert.match(el('frame-announcement').textContent,/Full/);
reset('menu');win.__OPEN_SESAME_NATIVE__=true;win.OpenSesameFrame.sync();h=drag('left',-200,0);h.emit('pointerup');assert.equal(runtime.state.size,'max');assert.ok(nativeCalls>0);assert.equal(runtime.frameScreen()[0],1728,'The native app uses the real screen, not the preview desktop');win.__OPEN_SESAME_NATIVE__=false;

reset('notch','small');h=drag('bottom',0,-35);assert.equal(el('widget-anchor').classList.contains('frame-collapse-ready'),false);h.emit('pointerup');assert.equal(runtime.state.expanded,true,'A modest overshoot below Small stays open');
reset();h=drag('bottom',0,-120);assert.equal(el('widget-anchor').classList.contains('frame-collapse-ready'),true);assert.equal(el('frame-size-hud').querySelector('span').textContent,'Release to collapse');assert.equal(runtime.state.expanded,true,'Crossing the collapse threshold only arms the gesture');h.emit('pointerup');assert.equal(runtime.state.expanded,false);assert.equal(runtime.state.size,'medium','Collapsing preserves the preferred expanded size');assert.equal(el('frame-size-hud').hidden,true);assert.equal(win.OpenSesameFrame.dragging,false);
for(const layout of ['notch','menu']){reset(layout);h=drag('left',180,0);h.emit('pointerup');assert.equal(runtime.state.expanded,false,layout+' side overshoot collapses');assert.equal(runtime.state.size,'medium')}
reset();h=drag('bottom',0,-120);h.emit('pointermove',{clientY:-35});flush();assert.equal(el('widget-anchor').classList.contains('frame-collapse-ready'),false);h.emit('pointerup');assert.equal(runtime.state.expanded,true,'Dragging back disarms collapse');
for(const event of ['pointercancel','lostpointercapture']){reset();h=drag('bottom',0,-120);h.emit(event);assert.equal(runtime.state.expanded,true);assert.equal(runtime.state.size,'medium');assert.equal(el('widget-anchor').classList.contains('frame-collapse-ready'),false)}
reset();h=drag('bottom',0,-120);doc.emit('keydown',{key:'Escape'});assert.equal(runtime.state.expanded,true);assert.equal(runtime.state.size,'medium');assert.equal(win.OpenSesameFrame.dragging,false);
console.log('Collapse overshoot: deliberate threshold, release-only commit, preferred size retention, side/bottom handles, drag-back recovery, Escape and pointer cancellation passed.');

// Execute the shipped render function, rather than duplicating its geometry rules.
Object.assign(runtime,{libraryOpen:false,lockinViews:['music','focus','youtube','media'],agentsViews:['terminal','remote'],activityFor:s=>['music','focus','youtube','media'].includes(s)?'lockin':['terminal','remote'].includes(s)?'agents':s,fillRange(){},renderItems(){},renderCompact(){},closeUrlEditor(){},renderDraft(){},detailEditor:{layout(){}},transcriptEditor:{layout(){}}});
vm.runInContext(source.slice(source.indexOf('function render(){'),source.indexOf('function syncNativeWindow()')),runtime);
const scenarios=['music','focus','youtube','media','items','audio','terminal','remote','reading','agent-monitor','familiars'];let cases=0;
for(const [w,h] of desktops.slice(0,4))for(const size of model.presets(w,h))for(const layout of ['notch','menu'])for(const scenario of scenarios)for(const library of [false,true]){
  Object.assign(runtime.state,{resolution:`${w},${h}`,size:size.key,layout,scenario,expanded:true,lockinView:'music',agentsView:'terminal',ratio:5+cases%8,width:180+cases%260});runtime.libraryOpen=library;win.innerWidth=w;win.innerHeight=h;runtime.render();assert.equal(width(),size.width);assert.equal(parseFloat(el('widget-anchor').style.getPropertyValue('--panel-height')),size.height);cases++;
}
console.log(`Stable frame verified across ${cases} actual render combinations: four desktop sizes, five presets, both placements, eleven tools, open/closed item details, and changing compact geometry.`);
// The focus fitter must paginate inside its pane without touching the outer frame.
const pane=el('pane-focus'),list=el('focus-topic-list'),clockRow=el('focus-clock-row');
clockRow.offsetHeight=150;
pane.children=[clockRow,...[24,6,10,20,25,28].map(offsetHeight=>({offsetHeight})),list];
pane.clientHeight=300;
Object.assign(runtime,{focusPerPage:5,focusPage:1,focusRunning:false,getComputedStyle:()=>({display:'flex',rowGap:'6px'}),renderAgendaList(){},renderFocus(){},agendaPosition:()=>({index:7})});runtime.state.scenario='focus';runtime.state.expanded=true;
vm.runInContext(source.slice(source.indexOf('function fitFocusTopics(){'),source.indexOf('new ResizeObserver(fitFocusTopics)')),runtime);const stableWidth=width();runtime.fitFocusTopics();assert.equal(runtime.focusPerPage,1);assert.equal(runtime.focusPage,5);assert.equal(width(),stableWidth);pane.clientHeight=450;runtime.focusRunning=true;runtime.fitFocusTopics();assert.equal(runtime.focusPerPage,5);assert.equal(runtime.focusPage,1,'The running topic must remain on its new page');
let topicBlurred=0;doc.activeElement={closest:()=>true,blur(){topicBlurred++;doc.activeElement=null}};reset();h=drag('right',100,0);h.emit('pointerup');assert.equal(topicBlurred,1,'Commit a topic draft before resize pagination replaces its input');
console.log('Shipped drag controller: scaled pointer motion, center/right anchoring, commit-only-on-release, no pane remount, cancellation, desktop changes, native updates, keyboard sizes, and announcements passed using simulated DOM events. Browser visual QA is separate.');

// A pane-specific exception must not strand the native window at its old compact size.
runtime.state.expanded=true;runtime.state.size='small';runtime.state.scenario='focus';win.__OPEN_SESAME_NATIVE__=true;
const beforeFailedPane=nativeCalls;runtime.renderItems=()=>{throw Error('Synthetic pane failure')};
assert.throws(()=>runtime.render(),/Synthetic pane failure/);assert.ok(nativeCalls>beforeFailedPane,'Native frame sizing must happen before pane content can throw');
console.log('Native geometry is committed before pane-specific rendering failures.');
