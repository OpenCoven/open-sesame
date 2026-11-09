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
  if(!target)throw Error('Provide a new directory');const id=path.basename(path.resolve(target));if(!/^[a-z][a-z0-9-]{0,63}$/.test(id))throw Error('Use a lowercase slug for the new directory name');
  const d=JSON.parse(fs.readFileSync(path.join(root,'dist/tools/meeting-notes/tool.json'),'utf8'));d.id=id;d.name=id.split('-').map(s=>s[0].toUpperCase()+s.slice(1)).join(' ');d.author='Your name';
  fs.mkdirSync(target);fs.writeFileSync(path.join(target,'tool.json'),JSON.stringify(d,null,2)+'\n');fs.writeFileSync(path.join(target,'README.md'),'# '+d.name+'\n\nDescribe the purpose, configuration and expected fixture output. Replace the author and confirm the license in tool.json before sharing. Preview through Plugins → Tools; actions are disabled until installation.\n');console.log('Created '+target+'/tool.json');
 }else if(command==='validate'||command==='preview'){
  const file=fs.statSync(target).isDirectory()?path.join(target,'tool.json'):target;const d=M.parse(fs.readFileSync(file,'utf8'));console.log('Valid: '+d.id+' '+d.version);
  if(command==='preview')console.log(JSON.stringify({name:d.name,components:d.components,fixture:d.fixtures,access:d.capabilities},null,2));
 }else throw Error('Use: npm run tools -- create DIRECTORY | validate FILE | preview FILE');
}catch(e){console.error(e.message);process.exitCode=1}
