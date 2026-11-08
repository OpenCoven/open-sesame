import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const ctx=vm.createContext({TextEncoder,URL,crypto:webcrypto});vm.runInContext(fs.readFileSync(path.join(root,'dist/tools-model.js'),'utf8'),ctx);
const M=ctx.OpenSesameToolsModel;
const [command,target]=process.argv.slice(2);
try{
 if(command==='create'){
  if(!target)throw Error('Provide a new directory');fs.mkdirSync(target);fs.copyFileSync(path.join(root,'dist/tools/meeting-notes/tool.json'),path.join(target,'tool.json'));console.log('Created '+target+'/tool.json');
 }else if(command==='validate'||command==='preview'){
  const file=fs.statSync(target).isDirectory()?path.join(target,'tool.json'):target;const d=M.parse(fs.readFileSync(file,'utf8'));console.log('Valid: '+d.id+' '+d.version);
  if(command==='preview')console.log(JSON.stringify({name:d.name,components:d.components,fixture:d.fixtures,access:d.capabilities},null,2));
 }else throw Error('Use: npm run tools -- create DIRECTORY | validate FILE | preview FILE');
}catch(e){console.error(e.message);process.exitCode=1}
