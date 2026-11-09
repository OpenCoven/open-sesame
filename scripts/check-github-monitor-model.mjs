import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const context={window:{}};vm.runInNewContext(fs.readFileSync('dist/github-monitor-model.js','utf8'),context);const M=context.window.OpenSesameGitHubMonitorModel;
const data={entries:[
 {id:1,title:'Zebra fix',state:'failure',subtitle:'main',updatedAt:'2026-11-07T01:00:00Z',createdAt:'2026-11-06T00:00:00Z',url:'https://github.com/Owner/Project/actions/runs/1'},
 {id:2,title:'Alpha feature',state:'in_progress',subtitle:'feat/layout',updatedAt:'2026-11-08T02:00:00Z',createdAt:'2026-11-05T00:00:00Z',url:'https://github.com/Owner/Project/actions/runs/2'},
 {id:3,title:'Draft polish',state:'draft',subtitle:'author',url:'https://github.com/Owner/Project/pull/3'},
 {id:4,title:'Invalid',state:'failure',url:'https://github.com.evil/Owner/Project/issues/4'}]};
const ids=options=>Array.from(M.entries(data,options),e=>e.id);
assert.deepEqual(ids({}),[2,1,3]);assert.deepEqual(ids({sort:'title'}),[2,3,1]);assert.deepEqual(ids({sort:'created'}),[1,2,3]);
assert.deepEqual(ids({filter:'attention'}),[1]);assert.deepEqual(ids({filter:'active'}),[2]);assert.deepEqual(ids({filter:'draft'}),[3]);assert.deepEqual(ids({query:'ALPHA layout'}),[2]);assert.deepEqual(ids({query:'unknown'}),[]);
assert.deepEqual(ids({sort:'state'}),[3,1,2]);assert.equal(data.entries[0].id,1,'Sorting never mutates a provider snapshot');assert.equal(M.relative('2026-11-08T00:00:00Z',Date.parse('2026-11-08T01:30:00Z')),'1h ago');assert.equal(M.relative('bad date'),'');
for(const url of ['javascript:alert(1)','https://token@github.com/a/b/pull/1','https://github.com/a/b/issues/1?token=x'])assert.equal(M.safeLink(url),false);
console.log('GitHub local text/status filters, stable sorts, safe links, timestamps and snapshot immutability pass.');
