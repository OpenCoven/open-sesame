import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const window={};vm.runInNewContext(fs.readFileSync('dist/live-capture-model.js','utf8'),{window});
const {capability}=window.OpenSesameLiveCaptureModel;
const native={native:true};
assert.equal(capability(native,'transcribe','mic').available,true);
assert.equal(capability(native,'record','mic').available,true);
for(const mode of ['record','transcribe'])for(const source of ['mic','system','both'])assert.equal(capability(native,mode,source).available,true);
assert.equal(capability(native,'record','unknown').available,false);
const browser={microphone:true,shared:true,mixing:true,recorder:true,speech:true,track:false};
assert.equal(capability(browser,'record','both').available,true);
assert.equal(capability(browser,'transcribe','mic').available,true);
assert.equal(capability(browser,'transcribe','system').available,false);
assert.equal(capability({...browser,track:true},'transcribe','system').available,true);
assert.equal(capability({...browser,microphone:false},'record','system').available,true,'Shared-only capture does not require a microphone');
assert.equal(capability({...browser,microphone:false},'record','both').available,false);
assert.equal(capability({...browser,recorder:false},'record','mic').available,false);
assert.equal(capability({...browser,speech:false},'transcribe','mic').available,false);
console.log('Capture capability checks passed for native microphone, shared-only recording, mixed sources, unavailable speech, and unsupported capture APIs.');

const audio=fs.readFileSync('dist/audio.js','utf8'),start=audio.indexOf('async function startNativeSegment('),end=audio.indexOf("window.addEventListener('open-sesame-desktop-event'",start);
const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,{value:id==='audio-language'?'en-US':'',textContent:''});return elements.get(id)},requests=[];
const controller={$(id){return el(id)},window,newId:()=>String(requests.length),nativeSpeechID:'',audioGeneration:1,audioSession:{timer:null,active:false,starting:true},openSesameBridge:{request:async(method,params)=>{requests.push({method,params});return {sourceLabel:'Fixture source'}}},Date,setAudioControls(){},time:String,setInterval:()=>1,stopAudio(){throw Error('Unexpected audio stop')}};
vm.createContext(controller);vm.runInContext(audio.slice(start,end),controller);
for(const source of ['mic','system','both']){el('audio-source').value=source;await controller.startNativeSegment(1);assert.equal(requests.at(-1).method,'speech.start');assert.equal(requests.at(-1).params.source,source);assert.equal(controller.audioSession.active,true)}
let finish;controller.openSesameBridge.request=()=>new Promise(resolve=>finish=resolve);controller.audioSession.active=false;const pending=controller.startNativeSegment(1);controller.audioGeneration=2;controller.nativeSpeechID='';finish({sourceLabel:'Stale'});await pending;assert.equal(controller.audioSession.active,false,'A stopped permission request cannot reactivate capture');
