// Rewrite the content-hash query of every local stylesheet and script reference in dist/index.html to match its bytes.
// check-asset-cache.mjs verifies the result; this only saves doing it by hand after an edit.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
let html=fs.readFileSync('dist/index.html','utf8'),changed=0;
html=html.replace(/((?:src|href)=")([^"?]+)\?v=([0-9a-f]{8,64})"/g,(match,lead,name,version)=>{
  const file=path.join('dist',name);if(!fs.existsSync(file))return match;
  const hash=createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0,version.length);
  if(hash!==version)changed++;return`${lead}${name}?v=${hash}"`;
});
fs.writeFileSync('dist/index.html',html);console.log(`${changed} asset reference${changed===1?'':'s'} refreshed.`);
