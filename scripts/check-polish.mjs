import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const source=fs.readFileSync('dist/capture.js','utf8'),start=source.indexOf('  function interpret('),end=source.indexOf('  const el=id=>',start),ctx={window:{OpenSesameCovenChat:{isActive:()=>false}},URL,console,pageUrl(raw){try{const u=new URL(raw.includes('://')?raw:'https://'+raw);return /^https?:$/.test(u.protocol)&&u.hostname.includes('.')&&!u.username&&!u.password&&!/\s/.test(raw)?u.href:''}catch{return ''}}};vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('  const views='),start)+source.slice(start,end)+';this.interpret=interpret;',ctx);const read=ctx.interpret;
assert.equal(read('/agents').view,'agents');assert.equal(read('open desktops').view,'remote');assert.equal(read('/terminal').view,'terminal');assert.equal(read('! ls').kind,'bash');assert.equal(read('!').incomplete,true);assert.equal(read('/task Finish this').type,'task');assert.equal(read('/note Title\nBody').text,'Title\nBody');assert.equal(read('example.com','auto','reading').view,'reading');assert.equal(read('example.com','note','reading').kind,'item');assert.equal(read('arxiv 2401.01234').view,'reading');assert.equal(read('/unknown').kind,'error');assert.equal(read('open Safari').computer,true);ctx.window.OpenSesameCovenChat.isActive=()=>true;assert.equal(read('hello','auto','terminal').kind,'chat');assert.equal(read('','auto','terminal').incomplete,true);assert.equal(read('! pwd','auto','terminal').kind,'bash');assert.equal(read('/note literal','auto','terminal').type,'note');
const sdk={window:{},console};vm.createContext(sdk);vm.runInContext(fs.readFileSync('dist/vendor/coven-runtime.js','utf8'),sdk);const create=sdk.window.OpenSesameCovenRuntime.create;assert.equal((await create().status()).available,false);let sent=false;const mock=create({available:()=>true,invoke:async(command,args)=>{if(command==='coven_runtime_send'){sent=true;args.onEvent.onmessage({type:'assistant',message:{role:'assistant',content:[{type:'text',text:'mock'}]}});return {runId:args.input.runId,events:[]}}return {available:true,sdkHealth:'unavailable'}}});let streamed='';await mock.send({runId:'qa',prompt:'test'},event=>streamed=event.message.content[0].text);assert.equal(sent,true);assert.equal(streamed,'mock');await assert.rejects(create({available:()=>true,invoke:async()=>({wrong:true})}).send({runId:'qa',prompt:'test'}),/invalid native result/);
console.log('Capture routing, explicit overrides, multiline commands, Coven preview transport, and native-result validation passed.');

ctx.window.OpenSesameLive={inQuestions:()=>true};
ctx.window.OpenSesameQuestionShortcuts={find:()=>undefined};
assert.equal(read('/what did I miss?','auto','audio').kind,'live');
assert.equal(read('/recommend questions','auto','audio').kind,'live');
assert.equal(read('/my custom question?','auto','audio').question,'/my custom question?');
assert.equal(read('/task do this','auto','audio').type,'task');
assert.equal(read('/projects','auto','audio').view,'items');
assert.equal(read('/screenshot research notes','auto','audio').kind,'screen');
ctx.window.OpenSesameLive.inQuestions=()=>false;
assert.equal(read('/what did I miss?','auto','audio').kind,'error');
console.log('Live slash routing stays scoped to Questions and preserves global actions.');

vm.runInContext(fs.readFileSync('dist/capture-catalog.js','utf8'),ctx);
const catalog=ctx.window.OpenSesameCaptureCatalog;
assert.ok(catalog.roots.find(row=>row.id==='notes').children.find(row=>row.id==='outline').children.length>1);
assert.ok(catalog.search('/subtopics').some(row=>row.id==='outline-topics'));
assert.ok(catalog.search('/meeting').some(row=>row.template?.includes('## Decisions')));
assert.equal(catalog.search('/nothing-matches-this').length,0);
assert.equal(read('/out').kind,'help');
const outline=read('/outline Product launch > Audience > Milestones');
assert.equal(outline.kind,'item');assert.equal(outline.type,'note');
assert.equal(outline.text,'Product launch\n\n## Audience\n\n- \n\n## Milestones\n\n- ');
assert.equal(read('/outline').incomplete,true);
assert.equal(read('/outline Research\nEvidence\nNext steps').text,'Research\n\n## Evidence\n\n- \n\n## Next steps\n\n- ');
ctx.window.OpenSesameLive.inQuestions=()=>true;
assert.equal(read('/outline Topic > Detail','auto','audio').type,'note');
for(const command of catalog.search('/'))assert.ok(command.label&&command.icon&&command.description);
console.log('Nested capture catalog, template search, and topic/subtopic note routing passed.');

assert.equal(read('When is the beta?','auto','audio').kind,'live');
assert.equal(read('Keep as a note','note','audio').kind,'item');

ctx.window.OpenSesameLive.inQuestions=()=>false;
assert.equal(read('Keep a note while recording','auto','audio').kind,'item','Record audio must not route unrelated notes into transcript questions');
