import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {Worker} from 'node:worker_threads';

// A worker timeout terminates a regressed synchronous parser instead of wedging
// npm check, and exit is awaited so no worker is left behind as passing evidence.
async function exercise(kind){
  const worker=new Worker(new URL('./fixtures/markdown-redos-worker.mjs',import.meta.url),{workerData:{
    kind,source:path.resolve('vendor-src/create-markdown/packages/core/src/parsers/tokenizer.ts'),
    bundle:path.resolve('dist/vendor/create-markdown.js'),
  }});
  await new Promise((resolve,reject)=>{
    let result,error;
    const timer=setTimeout(()=>{error=new Error(kind+' Markdown tokenizer exceeded the 6-second adversarial deadline');worker.terminate()},6000);
    worker.on('message',message=>result=message);
    worker.on('error',failure=>error=failure);
    worker.on('exit',code=>{clearTimeout(timer);if(error)reject(error);else if(code!==0||!result)reject(new Error(kind+' worker exited without successful evidence'));else resolve(result)});
  });
}
await exercise('source');await exercise('bundle');

// Refuse stale or independently edited shipped bundles. Rebuild into an owned
// temporary path; normal checks must never rewrite the tracked runtime.
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'sesame-markdown-bundle-'));
try{
  const output=path.join(temporary,'create-markdown.js');
  const result=spawnSync(process.execPath,['scripts/build-markdown.mjs',output],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr||result.error?.message);
  assert.equal(fs.readFileSync(output,'utf8'),fs.readFileSync('dist/vendor/create-markdown.js','utf8'),'The shipped Markdown runtime must match the patched source');
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Markdown source and shipped runtime preserve syntax, finish long tab/CR/LS/PS attacks within bounded workers, and have exact bundle parity.');
