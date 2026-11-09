import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {parentPort,workerData} from 'node:worker_threads';

let api;
if(workerData.kind==='source'){
  const code=stripTypeScriptTypes(fs.readFileSync(workerData.source,'utf8'));
  api=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
}else{
  const context={window:{}};vm.createContext(context);
  vm.runInContext(fs.readFileSync(workerData.bundle,'utf8'),context);
  api=context.window.OpenSesameMarkdown;
}
const fixtures=[
  ['  12.\t alpha **bold**  ','numbered_list_item','alpha **bold**  ',2,{listIndex:12}],
  ['#\t Title  ','heading','Title',0,{level:1}],
  ['-\t item','bullet_list_item','item',0,{listMarker:'-'}],
  ['\t- [X]\t done','check_list_item','done',1,{checked:true}],
  ['0.\t','numbered_list_item','',0,{listIndex:0}],
  ['0.\ttext\r','paragraph','0.\ttext',0],
  ['0.\ttext\u2028','paragraph','0.\ttext',0],
  ['0.\ttext\u2028next','paragraph','0.\ttext\u2028next',0],
  ['0.text','paragraph','0.text',0],
  ['> quote','blockquote','quote',0],
];
for(const [input,type,content,indent,meta] of fixtures){
  const token=api.tokenize(input)[0];
  assert.equal(token.type,type,input);assert.equal(token.content,content,input);
  assert.equal(token.indent,indent);assert.equal(token.raw,input);assert.equal(token.line,1);
  if(meta)assert.deepEqual(JSON.parse(JSON.stringify(token.meta)),meta);
}
const prefixes=[['0.','numbered_list_item'],['#','heading'],['-','bullet_list_item'],['- [x]','check_list_item']];
let cases=0;
for(const size of [1000,10000,100000,500000]){
  for(const [prefix,type] of prefixes){
    const whitespace='\t'.repeat(size);
    const valid=api.tokenize(prefix+whitespace+'body')[0];
    assert.equal(valid.type,type);assert.equal(valid.content,'body');
    for(const separator of ['\r','\u2028','\u2029']){
      const input=prefix+whitespace+'body'+separator+'tail';
      const token=api.tokenize(input)[0];
      assert.equal(token.type,'paragraph');assert.equal(token.raw,input);assert.equal(token.content,input);
      cases++;
    }
  }
}
if(workerData.kind==='bundle'){
  const input='0.'+'\t'.repeat(100000)+'body\u2028tail';
  const html=api.blocksToHTML(api.parse(input));
  assert.ok(html.includes('body\u2028tail'));
  const normal=api.blocksToHTML(api.parse('# Title\n\n12. **bold**\n13. next\n\n- [x] done'));
  assert.match(normal,/<h1\b/);assert.match(normal,/<ol\b/);assert.match(normal,/<strong>bold<\/strong>/);
  assert.match(normal,/checked/);
}
parentPort.postMessage({kind:workerData.kind,cases});
