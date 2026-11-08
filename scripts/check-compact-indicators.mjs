import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
class Node{constructor(){this.children=[];this.attrs={};this.props={};this.classes=new Set();this.style={setProperty:(k,v)=>this.props[k]=v};this.classList={toggle:(k,v)=>v?this.classes.add(k):this.classes.delete(k),add:k=>{this.className=(this.className||'')+' '+k}};this._html='';this.value='';this.checked=false;this.textContent=''}set innerHTML(v){this._html=v;this.children=[]}get innerHTML(){return this._html}append(n){n.parent=this;this.children.push(n)}remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this)}replaceChildren(...n){this.children=n}setAttribute(k,v){this.attrs[k]=v}getAttribute(k){return this.attrs[k]}removeAttribute(k){delete this.attrs[k]}querySelector(selector){return this.children.find(n=>(n.className||'').split(' ').includes(selector.slice(1)))||null}}
const nodes=new Map(),el=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id)},win={},audio={active:true,starting:false,stopping:false};let meter;
const ctx={window:win,document:{getElementById:el,createElement:()=>new Node()},audioSession:audio,icon:name=>'<'+name+'>',MutationObserver:class{constructor(fn){meter=fn}observe(){}}};vm.createContext(ctx);vm.runInContext(fs.readFileSync('dist/compact-indicators.js','utf8'),ctx);
el('audio-elapsed').textContent='0:12';
for(const source of ['mic','system','both'])for(const record of [false,true]){
 el('audio-source').value=source;el('audio-record').checked=record;win.OpenSesameCompactIndicators.sync();
 assert.match(el('compact-left').innerHTML,new RegExp(source==='system'?'monitor':'mic'));if(source==='both')assert.match(el('compact-left').innerHTML,/monitor/);
 assert.equal(el('compact-right').children[0].textContent,record?'REC':'Transcribing');assert.equal(el('compact-right').querySelector('.compact-wave').children.length,7);
 assert.equal(el('widget-anchor').classes.has('compact-recording'),record);
}
el('audio-meter').setAttribute('aria-valuenow','75');meter();assert.equal(el('widget-anchor').props['--capture-level'],'0.75','The capture wave follows measured RMS');
audio.active=false;el('compact-left').innerHTML='music';win.OpenSesameCompactIndicators.sync({playing:true});assert.equal(el('widget-anchor').classes.has('compact-capturing'),false);assert.ok(el('compact-left').querySelector('.compact-playback-wave'));assert.equal(el('widget-anchor').classes.has('compact-playing'),true);
// Stop without any microphone, audio context or capture request.
win.OpenSesameCompactIndicators.sync({playing:false});assert.equal(el('widget-anchor').classes.has('compact-playing'),false);assert.equal(el('compact-left').querySelector('.compact-playback-wave'),null);
console.log('Compact indicators distinguish all six transcription/recording source states, measured input level, media playback and stopped capture without requesting audio.');
