import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

let failures=0;
for(const file of readdirSync('scripts').filter(name=>/^check-.*\.mjs$/.test(name)).sort()){
  const result=spawnSync(process.execPath,['scripts/'+file],{encoding:'utf8',timeout:30000});
  process.stdout.write(`${result.status===0?'PASS':'FAIL'} ${file}\n`);
  if(result.status!==0){failures++;process.stderr.write(result.stdout+result.stderr);if(result.error)console.error(result.error.message);}
}
for(const file of readdirSync('dist').filter(name=>name.endsWith('.js'))){
  const result=spawnSync(process.execPath,['--check','dist/'+file],{encoding:'utf8',timeout:30000});
  if(result.status!==0){failures++;process.stderr.write(result.stderr);}
}
console.log(failures?`${failures} checks failed.`:'All widget checks and JavaScript syntax checks passed.');
process.exitCode=failures?1:0;
