import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

let failures=0;
for(const file of readdirSync('scripts').filter(name=>/^check-.*\.mjs$/.test(name)).sort()){
  const result=spawnSync(process.execPath,['scripts/'+file],{encoding:'utf8',timeout:30000});
  process.stdout.write(`${result.status===0?'PASS':'FAIL'} ${file}\n`);
  if(result.status!==0){failures++;process.stderr.write(result.stdout+result.stderr);if(result.error)console.error(result.error.message);}
}
// Authored JavaScript: the current UI in dist/ and the restart's new shell in ui/ (ES modules).
for(const directory of ['dist','ui','ui/dev'])for(const file of readdirSync(directory).filter(name=>name.endsWith('.js'))){
  const result=spawnSync(process.execPath,['--check',directory+'/'+file],{encoding:'utf8',timeout:30000});
  if(result.status!==0){failures++;process.stderr.write(result.stderr);}
}
console.log(failures?`${failures} checks failed.`:'All widget checks and JavaScript syntax checks passed.');
process.exitCode=failures?1:0;
