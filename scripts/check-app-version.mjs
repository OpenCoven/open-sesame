import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
class Node{constructor(){this.children=[];this.attrs={}}append(...items){this.children.push(...items)}prepend(...items){this.children.unshift(...items)}setAttribute(k,v){this.attrs[k]=v}}
for(const version of ['0.0.11',undefined]){
 const rail=new Node(),options=new Node(),main=new Node(),document={createElement:()=>new Node(),querySelector:selector=>selector==='main'?main:version?rail:null,getElementById:()=>version?options:null};
 vm.runInNewContext(fs.readFileSync('dist/app-version.js','utf8'),{window:{__OPEN_SESAME_VERSION__:version},document});
 if(version){assert.equal(rail.children[0].textContent,'v0.0.11');assert.equal(options.children[0].children[1].textContent,'v0.0.11');assert.equal(rail.children[0].attrs['aria-label'],'Open Sesame version 0.0.11')}
 else assert.equal(main.children[0].textContent,'Development');
}
assert.ok(fs.readFileSync('desktop/OpenSesame.swift','utf8').includes('object(forInfoDictionaryKey: "CFBundleShortVersionString")'));
console.log('Version display: native bundle version appears in the rail and app menu, with accessible labeling and honest Development fallback for an unbundled preview.');
