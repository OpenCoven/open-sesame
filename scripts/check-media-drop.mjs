import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
class Node extends EventTarget{
 constructor(){super();this.children=[];this.attrs={};this.classList={toggle(){},contains:()=>false}}
 append(...items){this.children.push(...items)}insertBefore(n,b){const i=this.children.indexOf(b);this.children.splice(i<0?this.children.length:i,0,n)}before(n){this.sibling=n}getAttribute(k){return this.attrs[k]||null}setAttribute(k,v){this.attrs[k]=String(v)}focus(){}
}
const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id)},added=[],messages=[];
const window={OpenSesameLocalMedia:{addFiles:(files,options)=>added.push({files,options})},OpenSesameRails:{set(){}}},document={createElement:()=>new Node(),getElementById:get};
vm.runInNewContext(fs.readFileSync('dist/media-drop.js','utf8'),{window,document,Array,Promise,Object,Error,icon:()=>'<svg></svg>',toast:value=>messages.push(value)});
const file={name:'episode.mp3',type:'audio/mpeg',size:42};let transfer={files:[file],items:[]};let result=await window.OpenSesameMediaDrop.dropped(transfer);assert.equal(result.files[0],file);assert.equal(result.folder,false);
const child={isFile:true,name:'episode.mp3',file:resolve=>resolve({...file})};let read=false;const root={isDirectory:true,name:'Podcast',createReader:()=>({readEntries:resolve=>{resolve(read?[]:[child]);read=true}})};
result=await window.OpenSesameMediaDrop.dropped({files:[],items:[{webkitGetAsEntry:()=>root}]});assert.equal(result.folder,true);assert.equal(result.files[0].webkitRelativePath,'Podcast/episode.mp3');
let prevented=false,stopped=false;const event=new Event('drop');Object.defineProperties(event,{dataTransfer:{value:{types:['Files'],files:[file],items:[]}},preventDefault:{value:()=>prevented=true},stopPropagation:{value:()=>stopped=true}});get('pane-media').dispatchEvent(event);await new Promise(resolve=>setImmediate(resolve));assert.ok(prevented&&stopped);assert.equal(added[0].files[0],file);assert.equal(added[0].options.append,true,'Dropping preserves the existing playlist');assert.equal(messages.length,0);
const swift=fs.readFileSync('desktop/OpenSesame.swift','utf8');assert.ok(swift.includes('picker.beginSheetModal(for: panel)'));assert.ok(swift.includes('webView === web, frame.isMainFrame, let url = webView.url'));
console.log('Media dropzone: direct files, folder enumeration, relative-path preservation, explicit append behavior, prevented file navigation and trusted native sheet declaration passed with simulated file/DOM transports. Finder presentation remains a GUI check.');
