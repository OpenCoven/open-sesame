import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const rail={style:{'--playlist-row-height':'58px','--playlist-pager-height':'32px',rowGap:'8px'}},list={parentElement:rail,clientHeight:300,style:{rowGap:'4px'}},pager={hidden:true};
const ctx={window:{},getComputedStyle:n=>({...n.style,getPropertyValue:k=>n.style[k]})};vm.runInNewContext(fs.readFileSync('dist/playlist-layout.js','utf8'),ctx);const capacity=ctx.window.OpenSesamePlaylistLayout.capacity;
assert.equal(capacity(list,pager),4);pager.hidden=false;list.clientHeight=260;assert.equal(capacity(list,pager),4,'Adding a pager must not change the page capacity');list.clientHeight=61;assert.equal(capacity(list,pager),1);list.clientHeight=0;assert.equal(capacity(list,pager),1);list.clientHeight=800;assert.equal(capacity(list,pager,10),10);rail.style['--playlist-row-height']='74px';assert.equal(capacity(list,pager),10);list.clientHeight=300;assert.equal(capacity(list,pager),3,'Larger row typography must reduce page capacity');
const html=fs.readFileSync('dist/index.html','utf8');for(const id of ['youtube-queue','media-queue'])assert.match(html,new RegExp('id="'+id+'" class="[^"]*playlist-rail'));
console.log('YouTube and Media share playlist sizing with measured list space, stable footer reservation, changed row sizes, small/hidden bounds and page limits. Visual fit is reviewed separately.');
