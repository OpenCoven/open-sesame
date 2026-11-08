import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
class Node extends EventTarget {
  constructor(){super();this.children=[];this.attrs={};this.dataset={};this.classList={add(){}}}
  append(...nodes){for(const node of nodes){if(node.parentElement)node.parentElement.children=node.parentElement.children.filter(child=>child!==node);node.parentElement=this;this.children.push(node)}}prepend(...nodes){this.append(...nodes);this.children.splice(0,0,...this.children.splice(-nodes.length))}
  querySelector(selector){return selector==='.items-workspace'?workspace:selector==='.global-project'?projectPicker:libraryTools}setAttribute(key,value){this.attrs[key]=String(value)}
  click(){this.dispatchEvent(new Event('click'))}focus(){document.activeElement=this}
}
const nodes=new Map(),el=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id)},workspace=new Node(),projectPicker=new Node(),libraryTools=new Node(),document={getElementById:el,createElement:()=>new Node(),activeElement:null},window=new EventTarget();
el('capture-list-heading').append(projectPicker,libraryTools);libraryTools.append(el('item-search-toggle'),el('new-item'));el('items-rail-heading').append(el('detail-width-toggle'));
let finish=true,renders=0;window.OpenSesameNotes={finish:()=>finish};
const ctx={window,document,icon:()=>'<svg></svg>',libraryOpen:false,detailFullWidth:false,itemsArchive:false,libraryQuery:'',itemsSearchOpen:false,expandedCategories:new Set(),categoryFilter:'all',projectFilter:'retained-project',selectedItemId:'',filteredItems(){return Array(ctx.itemsArchive?0:({note:2,bookmark:1,task:1,all:4}[ctx.categoryFilter])).fill({})},selectCollection(kind){ctx.categoryFilter=kind;ctx.selectedItemId=''},render(){renders++;window.OpenSesameProjects?.sync()}};
vm.runInNewContext(fs.readFileSync('dist/projects-overview.js','utf8'),ctx);
const tabs=el('pane-items').children[0].children[0],buttons=tabs.children;
assert.equal(buttons.length,4);assert.equal(ctx.categoryFilter,'note');assert.equal(ctx.libraryOpen,true);assert.equal(workspace.attrs['aria-labelledby'],'projects-note');
assert.equal(el('capture-list-heading').children.length,0,'Project scope and global actions share the tab toolbar instead of consuming a second header');
assert.equal(projectPicker.parentElement,el('pane-items').children[0]);assert.equal(el('new-item').parentElement,libraryTools,'New item remains available when the sidebar is hidden');
assert.equal(el('item-search-toggle').parentElement.id,'projects-rail-actions');assert.equal(el('detail-width-toggle').parentElement,el('item-search-toggle').parentElement);
for(const [index,kind] of ['note','bookmark','task','all'].entries()){
  buttons[index].click();assert.equal(ctx.categoryFilter,kind);assert.equal(ctx.projectFilter,'retained-project');
  assert.equal(buttons[index].attrs['aria-selected'],'true');assert.equal(buttons.filter(b=>b.tabIndex===0).length,1);
  assert.equal(buttons.filter(b=>b.attrs['aria-selected']==='true').length,1);assert.equal(el('capture-list').attrs['aria-label'],['Notes','Bookmarks','Tasks','Recent'][index]);
  assert.equal(el('items-rail-heading').children.find(n=>n.id==='projects-item-count').textContent,String([2,1,1,4][index]));
}
finish=false;buttons[0].click();assert.equal(ctx.categoryFilter,'all','A pending unsaved editor blocks collection changes');finish=true;
buttons[1].focus();const key=new Event('keydown',{cancelable:true});Object.defineProperty(key,'key',{value:'ArrowRight'});tabs.dispatchEvent(key);assert.equal(ctx.categoryFilter,'task');assert.equal(document.activeElement,buttons[2]);
ctx.itemsArchive=true;window.OpenSesameProjects.sync();assert.equal(el('collection-title').textContent,'Archived');window.OpenSesameProjects.show();assert.equal(ctx.itemsArchive,false);assert.equal(ctx.categoryFilter,'task');assert.equal(ctx.projectFilter,'retained-project');assert.ok(renders>0);
const html=fs.readFileSync('dist/index.html','utf8');assert.ok(!html.includes('id="terminal-agent"'));assert.ok(html.includes('interface-polish.css'));
console.log('Projects: one selected tab, scoped count, consolidated toolbar/sidebar, retained project scope, keyboard navigation, unsaved-editor guard and archive return passed with a simulated DOM.');
