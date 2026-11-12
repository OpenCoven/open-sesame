import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const html=fs.readFileSync('dist/index.html','utf8'),css=fs.readFileSync('dist/flat-theme.css','utf8'),swift=fs.readFileSync('desktop/OpenSesame.swift','utf8');
for(const path of ['dist/glass.js','dist/glass-model.js','dist/glass.css']){assert.equal(fs.existsSync(path),false);assert.equal(html.includes(path.slice(5)),false)}
assert.ok(html.lastIndexOf('flat-theme.css')>html.lastIndexOf('activity-rail.css'),'The final palette must own the widget surfaces');
assert.equal(swift.includes('NSVisualEffectView'),false);assert.equal(swift.includes('window.glass'),false);assert.equal(swift.includes('glassSavedLevel'),false);assert.equal(swift.includes('animator().alphaValue'),false);assert.ok(swift.includes('blue: 19.0/255, alpha: 1).cgColor'));assert.ok(swift.includes('surface.addSubview(web)'));
assert.equal(fs.readFileSync('dist/app.js','utf8').includes('Alt-hold to adjust glass'),false);assert.equal(fs.readFileSync('dist/refinement.css','utf8').includes('open-sesame-view-arrive'),false);
assert.equal(css.includes('linear-gradient('),false);assert.ok(css.includes('backdrop-filter:none'));assert.ok(css.includes('button{background-image:none!important}'));assert.ok(css.includes('outline:2px solid var(--accent)'));assert.ok(css.includes('button[aria-current=true]'));assert.ok(css.includes('prefers-reduced-motion'));assert.ok(css.includes('forced-colors'));assert.ok(css.includes(':disabled{opacity:1'));
// The palette is defined once in the token sheet; the theme may alias it. Resolve each name to its final hex.
const tokenCss=fs.readFileSync('dist/design-tokens.css','utf8'),defined=Object.fromEntries([...(tokenCss+css).matchAll(/--([a-z0-9-]+):([^;{}]+)(?=[;}])/g)].map(([,name,value])=>[name,value.trim()]));
const resolveToken=(name,depth=0)=>{const value=defined[name],alias=value?.match(/^var\(--([a-z0-9-]+)\)$/);return alias&&depth<8?resolveToken(alias[1],depth+1):/^#[0-9a-f]{6}$/.test(value||'')?value.slice(1):undefined};
const colors=Object.fromEntries(Object.keys(defined).map(name=>[name,resolveToken(name)]));
assert.ok(html.indexOf('design-tokens.css')>0&&html.indexOf('design-tokens.css')<html.indexOf('style.css'),'Tokens load before every surface stylesheet');
function luminance(hex){const values=hex.match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*values[0]+.7152*values[1]+.0722*values[2]}
function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
for(const surface of ['surface-base','surface-inset','surface-raised','surface-hover','surface-selected']){assert.match(colors[surface],/^[a-f0-9]{6}$/);for(const ink of ['ink-primary','ink-secondary','ink-muted'])assert.ok(contrast(colors[ink],colors[surface])>=4.5,ink+' contrast on '+surface)}
assert.ok(contrast(colors.accent,colors['surface-base'])>=7,'The keyboard focus ring must remain clear on the dark surface');

class Node{
  constructor(id=''){this.id=id;this.listeners={};this.children=[];this.dataset={};this.attrs={};this.checked=true;this.value='auto';this.hidden=false;this.flags=new Set();this.classList={contains:key=>this.flags.has(key)};}
  addEventListener(name,fn){(this.listeners[name]??=[]).push(fn)}
  emit(name,event={}){for(const fn of this.listeners[name]||[])fn({target:this,...event})}
  append(child){if(child.parentElement)child.parentElement.children=child.parentElement.children.filter(n=>n!==child);this.children.push(child);child.parentElement=this}
  setAttribute(key,value){this.attrs[key]=value}
}
const nodes=new Map(),el=id=>{if(!nodes.has(id))nodes.set(id,new Node(id));return nodes.get(id)},window=new Node(),document=new Node(),storage=new Map(),timers=[];
document.body=new Node();document.getElementById=el;document.createElement=()=>new Node();window.OpenSesameVoice={active:false};
const context={window,document,focusRunning:false,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},MutationObserver:class{observe(){}},setInterval(){},setTimeout:fn=>{timers.push(fn);return timers.length},clearTimeout(){}};
vm.createContext(context);vm.runInContext(fs.readFileSync('dist/ember.js','utf8'),context);
const indicator=()=>[...nodes.values()].flatMap(n=>n.children).find(n=>n.className==='activity-indicator');
const status=()=>el('widget-anchor').children.find(n=>n.id==='ember-state');
assert.equal(indicator().hidden,true);context.focusRunning=true;window.emit('open-sesame-layout');assert.equal(indicator().parentElement.id,'tab-lockin');assert.equal(indicator().hidden,false);
context.focusRunning=false;window.emit('open-sesame-agents-updated',{detail:{agents:[{state:'running'}],fresh:true}});assert.equal(el('widget-anchor').dataset.ember,'working');assert.equal(indicator().parentElement.id,'tab-agents');
document.body.flags.add('audio-active');window.emit('open-sesame-layout');assert.equal(indicator().parentElement.id,'tab-audio');assert.equal(el('widget-anchor').dataset.ember,'listening');
document.body.flags.clear();window.emit('open-sesame-agents-updated',{detail:{agents:[{state:'blocked'}],fresh:true}});assert.equal(el('widget-anchor').dataset.ember,'attention');
el('ember-enabled').checked=false;el('ember-enabled').emit('change');assert.equal(indicator().hidden,true);assert.equal(storage.get('open-sesame-ember-enabled'),'false');assert.equal(status().textContent,'Activity indicators off');
el('ember-enabled').checked=true;el('ember-enabled').emit('change');el('ember-preview').value='focus';el('ember-preview').emit('change');assert.equal(indicator().parentElement.id,'tab-lockin');assert.match(status().textContent,/Status preview/);timers.at(-1)();assert.equal(el('ember-preview').value,'auto');
assert.equal(fs.readFileSync('dist/ember.js','utf8').includes('open-sesame-ember\''),false);assert.equal(fs.readFileSync('dist/ember-agents.css','utf8').includes('ember-breathe'),false);
console.log('Opaque native surface, removed translucency gestures and fades, palette text/focus contrast, selected Reader rows, static activity routing, preference retention, preview expiry, and reduced-motion/forced-color hooks passed. Native visual acceptance is separate.');
