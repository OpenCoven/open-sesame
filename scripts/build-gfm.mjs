// Bundle pinned Marked sources without requiring registry access at runtime.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const root=path.resolve('vendor-src/marked'),modules=new Map();
function resolve(from,spec){
  let name=path.posix.normalize(path.posix.join(path.posix.dirname(from),spec));
  if(!name.endsWith('.ts'))name+=existsSync(path.join(root,name+'.ts'))?'.ts':'/index.ts';
  if(!existsSync(path.join(root,name)))throw new Error('Missing upstream module '+name);return name;
}
const names=list=>list.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,'').split(',').map(s=>s.trim()).filter(Boolean).map(s=>s.split(/\s+as\s+/));
function load(name){
  if(modules.has(name))return;modules.set(name,'');let code=stripTypeScriptTypes(readFileSync(path.join(root,name),'utf8'),{mode:'transform',sourceUrl:name}),exported=[];
  const dependency=spec=>{const id=resolve(name,spec);load(id);return '__require('+JSON.stringify(id)+')'};
  code=code.replace(/^import\s+([\s\S]*?)\s+from\s+(['"])([^'"]+)\2;?/gm,(_,binding,q,spec)=>{
    const dep=dependency(spec);if(binding.trim().startsWith('{'))return 'const {'+names(binding.trim().slice(1,-1)).map(([a,b])=>a+(b?':'+b:'')).join(',')+'}='+dep+';';
    const star=binding.trim().match(/^\*\s+as\s+(\w+)$/);if(star)return 'const '+star[1]+'='+dep+';';throw new Error('Unsupported import '+binding);
  });
  code=code.replace(/^export\s*\{([\s\S]*?)\}\s*from\s*(['"])([^'"]+)\2;?/gm,(_,list,q,spec)=>{const dep=dependency(spec);return names(list).map(([a,b])=>'__exports.'+(b||a)+'='+dep+'.'+a+';').join('\n')});
  code=code.replace(/^export\s*\{([^}]+)\};?/gm,(_,list)=>names(list).map(([a,b])=>'__exports.'+(b||a)+'='+a+';').join('\n'));
  code=code.replace(/^export\s+((?:async\s+)?(?:function|class|const|let|var))\s+(\w+)/gm,(_,type,n)=>{exported.push(n);return type+' '+n});
  code+='\n'+exported.map(n=>'__exports.'+n+'='+n+';').join('\n');new vm.Script('(function(__exports,__require){'+code+'})',{filename:name});modules.set(name,code);
}
load('src/Instance.ts');
const bundle='/*! Marked 18.1.3 source snapshot | MIT | pinned ba50aa95636ac8f97f46446bbfeb04592ed22216 */\n(()=>{const factories={'+[...modules].map(([n,c])=>JSON.stringify(n)+':function(__exports,__require){\n'+c+'\n}').join(',\n')+'};const cache={};function __require(id){if(cache[id])return cache[id];const out=cache[id]={};factories[id](out,__require);return out}window.OpenSesameGFM=new (__require("src/Instance.ts").Marked)({gfm:true,async:false});})();\n';
writeFileSync('dist/vendor/marked.js',bundle);console.log('Bundled Marked: '+modules.size+' modules, '+bundle.length+' bytes');
