import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const html=fs.readFileSync('dist/index.html','utf8');let checked=0;
for(const [,name,version] of html.matchAll(/(?:src|href)="([^"?]+)\?v=([0-9a-f]{8,64})"/g)){
 const file=path.join('dist',name);if(!fs.existsSync(file))continue;
 const actual=createHash('sha256').update(fs.readFileSync(file)).digest('hex');assert.ok(actual.startsWith(version),'Stale content hash: '+name);checked++;
}
assert.ok(checked>60);console.log(checked+' exact local asset cache references match authored bytes, including similarly named script suffixes.');
