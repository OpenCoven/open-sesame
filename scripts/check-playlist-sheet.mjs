import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
class Node{
 constructor(){this.children=[];this.attrs={};this.handlers={};this.dataset={};this.inert=false;this.clientHeight=300;this.classes=new Set();this.classList={add:c=>this.classes.add(c),remove:c=>this.classes.delete(c)}}
 append(n){n.detach();n.parentElement=this;this.children.push(n)}detach(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this)}before(n){n.detach();const p=this.parentElement;n.parentElement=p;p.children.splice(p.children.indexOf(this),0,n)}after(n){n.detach();const p=this.parentElement;n.parentElement=p;p.children.splice(p.children.indexOf(this)+1,0,n)}
 setAttribute(k,v){this.attrs[k]=v}removeAttribute(k){delete this.attrs[k]}addEventListener(k,fn){this.handlers[k]=fn}querySelector(s){return s==='input[type=search]'?this.input:this.header}querySelectorAll(){return []}focus(){this.focused=true}
}
const panel=new Node(),page=new Node(),other=new Node(),rail=new Node();panel.append(page);panel.append(other);page.append(rail);other.inert=true;rail.header=new Node();rail.append(rail.header);rail.input=new Node();rail.append(rail.input);let resize,keys;
const window={addEventListener(){}},document={getElementById:()=>panel,createComment:()=>new Node(),createElement:()=>new Node(),addEventListener:(k,fn)=>keys=fn};
vm.runInNewContext(fs.readFileSync('dist/playlist-sheet.js','utf8'),{window,document,icon:()=>'',ResizeObserver:class{constructor(fn){resize=fn}observe(){}}});
const sheet=window.OpenSesamePlaylistSheet;let closes=0;const close=()=>{closes++;sheet.set('youtube',rail,false,close)};
sheet.set('youtube',rail,true,close);assert.equal(rail.parentElement,panel);assert.equal(rail.attrs.role,'dialog');assert.equal(rail.attrs['aria-modal'],'true');assert.equal(page.inert,true);assert.equal(other.inert,true);assert.equal(rail.input.focused,true);assert.equal(rail.dataset.short,'false');panel.clientHeight=150;resize();assert.equal(rail.dataset.short,'true');
let prevented=false,stopped=false;keys({key:'Escape',preventDefault:()=>prevented=true,stopImmediatePropagation:()=>stopped=true});assert.equal(closes,1);assert.ok(prevented&&stopped);assert.equal(rail.parentElement,page);assert.equal(page.inert,false);assert.equal(other.inert,true,'Pre-existing inert ownership must survive sheet dismissal');assert.equal(rail.attrs.role,undefined);
sheet.set('youtube',rail,true,close);sheet.closeAll();assert.equal(closes,2);assert.equal(page.children.filter(n=>n===rail).length,1);assert.equal(rail.header.children.length,1,'Repeated open/close must not duplicate controls');
console.log('Playlist sheet: whole-widget placement, restored DOM home and inert ownership, focus entry, short-height adaptation, Escape dismissal and control deduplication passed with synthetic DOM events.');
