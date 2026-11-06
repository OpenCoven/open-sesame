import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const ctx={window:{},URL};vm.createContext(ctx);vm.runInContext(fs.readFileSync('dist/content.js','utf8'),ctx);const asset=ctx.window.OpenSesameContent.githubAsset;
assert.equal(asset('img/chart.svg','a/b','main','docs/README.md'),'https://raw.githubusercontent.com/a/b/main/docs/img/chart.svg');
assert.equal(asset('/assets/plot.png','a/b','main','docs/README.md'),'https://raw.githubusercontent.com/a/b/main/assets/plot.png');
assert.equal(asset('../plot.png','a/b','main','docs/README.md'),'https://raw.githubusercontent.com/a/b/main/plot.png');
assert.equal(asset('https://github.com/a/b/blob/main/plot.svg?raw=true','a/b','main'),'https://raw.githubusercontent.com/a/b/main/plot.svg');
assert.equal(asset('//example.com/image.png','a/b','main'),'https://example.com/image.png');
assert.equal(asset('javascript:alert(1)','a/b','main'),'');assert.equal(asset('https://me:pass@example.com/image.png','a/b','main'),'');
console.log('GitHub relative, root-relative, parent, blob and external image paths verified; invalid protocols and credential URLs rejected.');
