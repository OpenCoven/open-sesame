import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const window={};vm.runInNewContext(fs.readFileSync('dist/speaker-model.js','utf8'),{window});const m=window.OpenSesameSpeakerModel;
const words=[{text:'Hello',start:0,end:.5},{text:'there.',start:.5,end:1},{text:'Reply',start:1,end:1.5},{text:'together',start:1.5,end:2},{text:'new',start:3,end:4}];
const turns=m.turns(words,m.validSegments([{start:0,end:1,speaker:0},{start:1,end:2,speaker:1},{start:1.5,end:2,speaker:0}]),2);
assert.equal(turns[0].text,'Hello there.');assert.equal(turns[0].speakers[0],0);assert.equal(turns[1].speakers[0],1);assert.equal(turns[2].speakers.length,2);assert.equal(turns[3].pending,true);
for(const row of [{start:NaN,end:1,speaker:0},{start:0,end:1,speaker:4},{start:2,end:1,speaker:0}])assert.throws(()=>m.validSegments([row]));
assert.equal(m.validWords([{text:'secret',start:-1,end:0}]).length,0);console.log('Speaker alignment: anonymous labels, preserved words, overlap, pending attribution and malformed interval refusal passed.');
