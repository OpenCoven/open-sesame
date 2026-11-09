import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';import {webcrypto} from 'node:crypto';
const ctx=vm.createContext({TextEncoder,URL,crypto:webcrypto});vm.runInContext(fs.readFileSync('dist/tools-model.js','utf8'),ctx);const M=ctx.OpenSesameToolsModel;
const raw=fs.readFileSync('dist/tools/meeting-notes/tool.json','utf8');const d=M.parse(raw);
for(const slug of fs.readdirSync('dist/tools'))M.parse(fs.readFileSync('dist/tools/'+slug+'/tool.json','utf8'));
for(const mutate of [x=>x.schemaVersion=2,x=>x.html='<script>bad()</script>',x=>x.capabilities=['terminal.open'],x=>x.source={operation:'note.save'},x=>x.components[0].field='unknown',x=>x.actions[0]={label:'Bad',operation:'link.open',value:'javascript:alert(1)'}]){const bad=JSON.parse(raw);mutate(bad);assert.throws(()=>M.parse(JSON.stringify(bad)))}
assert.throws(()=>M.parse(' '.repeat(100001)));assert.throws(()=>M.parse('{'));
const first=M.instance(d),second=M.instance(d);assert.notEqual(first.id,second.id);first.config.notes='Keep my draft';const update=M.parse(raw);update.version='1.0.1';const changed=M.replace(first,update);assert.equal(changed.config.notes,'Keep my draft');assert.equal(M.rollback(changed).definition.version,'1.0.0');
const fourth=M.parse(raw);fourth.id='fourth-tool';fourth.name='Fourth tool';assert.equal(M.parse(JSON.stringify(fourth)).name,'Fourth tool');
assert.equal(M.safeUrl('javascript:alert(1)'),false);assert.equal(M.safeUrl('https://user:pass@example.org'),false);
console.log('Tool contract, three packages, fourth definition, replacement and rollback pass.');
const restore=M.restore([first]);assert.equal(restore[0].config.notes,'Keep my draft');
assert.throws(()=>M.restore([first,first]),'Duplicate instance identities must fail closed');
const corrupted=JSON.parse(JSON.stringify([first]));corrupted[0].config.notes=42;assert.equal(M.restore(vm.runInContext('JSON.parse('+JSON.stringify(JSON.stringify(corrupted))+')',ctx))[0].config.notes,d.config.notes.default);
for(const mutate of [x=>delete x.components[0].field,x=>x.version=['1.0.0'],x=>x.capabilities={},x=>x.config=[],x=>x.components=[{type:'text',label:'Missing content'}]]){const bad=JSON.parse(raw);mutate(bad);assert.throws(()=>M.parse(JSON.stringify(bad)))}
const oversized=JSON.parse(raw);oversized.components=Array.from({length:20},()=>({type:'text',label:'Unicode',text:'😀'.repeat(990)}));oversized.fixtures.entries=Array(15).fill('😀'.repeat(990));assert(JSON.stringify(oversized).length<100000);assert.throws(()=>M.parse(JSON.stringify(oversized)),/100 KB/);
console.log('Durable instance recovery, required bindings and UTF-8 package limits pass.');
// A generated fourth package is immediately usable without changing host code.
const {spawnSync}=await import('node:child_process'),{tmpdir}=await import('node:os'),path=await import('node:path');
const temporary=fs.mkdtempSync(path.join(tmpdir(),'sesame-tool-scaffold-')),target=path.join(temporary,'fourth-example');
try{for(const command of ['create','validate','preview']){const result=spawnSync(process.execPath,['scripts/tools.mjs',command,target],{encoding:'utf8',timeout:10000});assert.equal(result.status,0,result.stderr)}const generated=M.parse(fs.readFileSync(path.join(target,'tool.json'),'utf8'));assert.equal(generated.id,'fourth-example');assert(fs.existsSync(path.join(target,'README.md')));assert.equal(spawnSync(process.execPath,['scripts/tools.mjs','create',target],{timeout:10000}).status,1,'Existing packages cannot be overwritten');}finally{fs.rmSync(temporary,{recursive:true})}
