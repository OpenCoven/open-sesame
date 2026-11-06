// Bundle the pinned upstream packages without requiring registry access at runtime.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const root=path.resolve('vendor-src/create-markdown'),modules=new Map();
function resolve(from,spec){
  let name=spec==='@create-markdown/core'?'packages/core/src/index.ts':path.posix.normalize(path.posix.join(path.posix.dirname(from),spec));
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
  code=code.replace(/import\(['"]@create-markdown\/core['"]\)/g,()=> 'Promise.resolve('+dependency('@create-markdown/core')+')');
  code+='\n'+exported.map(n=>'__exports.'+n+'='+n+';').join('\n');new vm.Script('(function(__exports,__require){'+code+'})',{filename:name});modules.set(name,code);
}
load('packages/core/src/index.ts');load('packages/preview/src/html-serializer.ts');
const bundle='/*! @create-markdown/core + preview 2.0.3 | MIT | pinned source c5c291c9801078674069fd30eea8203777e6f7d8 */\n(()=>{const factories={'+[...modules].map(([n,c])=>JSON.stringify(n)+':function(__exports,__require){\n'+c+'\n}').join(',\n')+'};const cache={};function __require(id){if(cache[id])return cache[id];const out=cache[id]={};factories[id](out,__require);return out}window.OpenSesameMarkdown={...__require("packages/core/src/index.ts"),...__require("packages/preview/src/html-serializer.ts")};})();\n';
writeFileSync('dist/vendor/create-markdown.js',bundle);console.log('Bundled '+modules.size+' upstream modules ('+bundle.length+' bytes)');
