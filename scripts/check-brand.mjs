import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const art=fs.readFileSync('dist/assets/open-sesame-logo.png');
assert.equal(art.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
assert.equal(art.readUInt32BE(16),1254);assert.equal(art.readUInt32BE(20),1254);assert.equal(art[25],6,'Keep supplied RGBA transparency');
assert.equal(createHash('sha256').update(art).digest('hex'),'759ea1a3eca47d501407401282a0c751027f089c86bcb142fe7e1bd8f142e837');
for(const file of ['dist/index.html','dist/sign-in.html']){
 const html=fs.readFileSync(file,'utf8');
 assert.match(html,/<img[^>]+src="assets\/open-sesame-logo\.png"/);assert.match(html,/rel="icon"[^>]+href="assets\/open-sesame-logo\.png"/);
}
console.log('Exact user-supplied square RGBA artwork is preserved in app and sign-in branding, with favicon references.');
