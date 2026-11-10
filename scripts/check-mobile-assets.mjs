import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const root='dist/assets/mobile/',manifest=JSON.parse(fs.readFileSync(root+'provenance.json','utf8'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(manifest.scope,'Open Sesame mobile product presentation; not a canonical brand profile');
for(const [name,entry] of Object.entries(manifest.files)){
 assert.match(entry.url,/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[0-9a-f]{40}\//,'Upstreams must be pinned');
 const bytes=fs.readFileSync(root+name);assert.equal(digest(bytes),entry.sha256,'Pinned asset/license bytes: '+name);assert.equal(bytes.length,entry.bytes);
}
const mark=fs.readFileSync(root+'opencoven-mark.svg','utf8');assert.match(mark,/viewBox="0 0 212 212"/);assert.match(mark,/id="mark" fill="currentColor"/);assert(!/<(?:script|image|foreignObject)\b|\bon\w+=|https?:/i.test(mark.replace('http://www.w3.org/2000/svg','')),'Mark has no executable or external content');
for(const file of ['EB-Garamond-OFL.txt','Inter-OFL.txt'])assert.match(fs.readFileSync(root+file,'utf8'),/SIL OPEN FONT LICENSE Version 1.1/i);
const css=fs.readFileSync('dist/mobile-shell.css','utf8'),js=fs.readFileSync('dist/mobile-shell.js','utf8');
for(const file of ['eb-garamond.ttf','inter.ttf'])assert(css.includes(file+'?v='+manifest.files[file].sha256.slice(0,12)),'Font URL content hash');
assert(js.includes('opencoven-mark.svg?v='+manifest.files['opencoven-mark.svg'].sha256.slice(0,12)+'#mark'),'Mark URL content hash');
assert.match(css,/font-display:swap/);assert.match(css,/Open Sesame Mobile Serif[^}]+Georgia/);assert.match(css,/Open Sesame Mobile Sans[^}]+system-ui/);
console.log('Pinned mobile crown/lotus geometry, font/license bytes, scoped fallback roles and content hashes pass.');
