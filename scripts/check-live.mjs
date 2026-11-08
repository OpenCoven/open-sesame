import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class Element extends EventTarget {
  value = ''; textContent = ''; hidden = false; checked = false; children = []; style = {};
  classList = {toggle(){}, contains(){return false}};
  append(...items){this.children.push(...items)}
  replaceChildren(){this.children=[]}
  attributes = new Map();
  setAttribute(key,value){this.attributes.set(key,String(value))} getAttribute(key){return this.attributes.get(key)??null} removeAttribute(key){this.attributes.delete(key)} focus(){}
  click(){this.dispatchEvent(new Event('click'))}
  showModal(){this.open=true} close(){this.open=false}
}
const elements=new Map(), get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)};
const doc=new Element(), win=new EventTarget();
doc.getElementById=get; doc.createElement=()=>new Element(); doc.body=new Element();
get('audio-source').value='mic'; get('audio-language').value='en-US'; get('audio-transcribe').checked=true;
get('live-agent').value='local'; get('audio-elapsed').textContent='0:00';
let next=0, reply, deny=false, recordStart, calls=[];
const bridge={available:true,ready:Promise.resolve(),request(method,params){
  calls.push({method,params});
  if(method==='live.agents')return Promise.resolve({claude:true,codex:true});
  if(method==='live.ask')return new Promise(resolve=>{reply=resolve});
  if(method==='speech.start'&&deny)return Promise.reject(Error('Microphone denied'));
  if(method==='record.start')return new Promise((resolve,reject)=>{recordStart={resolve,reject}});
  if(method==='record.stop')return Promise.resolve({ready:true});
  return Promise.resolve(true);
}};
Object.assign(win,{__OPEN_SESAME_NATIVE__:true,openSesameBridge:bridge});
const ctx=vm.createContext({window:win,document:doc,navigator:{userAgent:'Mac WKWebView'},openSesameBridge:bridge,
  newId:()=>String(++next),$:get,localStorage:{getItem:()=>null,setItem(){}},Event,Blob,URL,Date,
  setInterval:()=>1,clearInterval(){},setTimeout,clearTimeout,cancelAnimationFrame(){},
  transcriptEditor:{set(text){get('audio-transcript').value=text},layout(){}},renderCompact(){},renderDraft(){},
  state:{scenario:'audio',expanded:true},time:n=>String(n),toast(){},console});
for(const file of ['live-capture-model.js','audio.js','live-questions.js','live.js'])vm.runInContext(fs.readFileSync('dist/'+file,'utf8'),ctx);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const speech=(id,text,final=false)=>win.dispatchEvent(Object.assign(new Event('open-sesame-desktop-event'),{detail:{event:'voice.result',id,text,final}}));
const starts=()=>calls.filter(c=>c.method==='speech.start');
await flush();
assert.equal(starts().length,0);
get('audio-start').click(); await flush();
assert.equal(get('live-text').hidden,false,'Show the transcript while recording');
assert.equal(get('panel-caption').textContent,'TRANSCRIBING · 0','Native capture must initialize its clock before rendering active status');
const first=starts()[0].params.id;
speech(first,'The beta opens Thursday.',true); await flush();
const second=starts()[1].params.id;
speech(second,'Maya will invite twelve designers');
get('live-agent').value='codex'; get('live-agent').dispatchEvent(new Event('change'));
assert.equal(win.OpenSesameLive.ask('When is the beta?'),true);
assert.equal(get('live-transcript-view').hidden,false,'Asking must keep the transcript visible');
assert.equal(get('live-questions-view').hidden,false,'Answers remain beside the transcript');
const request=calls.find(c=>c.method==='live.ask');
assert.match(request.params.transcript,/Thursday.*\nMaya will invite/);
speech(second,'Maya will invite twelve designers next week.',true); await flush();
assert.equal(request.params.transcript.includes('next week'),false);
reply({agent:'codex',answer:'Thursday.'}); await flush();
assert.equal(get('live-answers').children.at(-1).children.at(-1).textContent,'Thursday.');
const third=starts().at(-1).params.id;
get('audio-stop').click(); speech(third,'Final phrase while stopping',true); await flush();
assert.match(get('audio-transcript').value,/Final phrase while stopping/);
speech(third,'late transcript',true); await flush();
assert.doesNotMatch(get('audio-transcript').value,/late transcript/);
get('transcript-clear').click(); assert.equal(get('audio-transcript').value,'');
deny=true; get('audio-start').click();await flush();
assert.equal(get('audio-start').disabled,false);assert.match(get('audio-status').textContent,/denied/);
console.log('Live listening, segment rotation, explicit CLI requests, interim snapshots, concurrent transcript updates, stop, clear, and denial passed with simulated speech and agent responses.');

const micCalls=starts().length;
get('live-sample').click();
assert.equal(get('audio-interim').textContent,'Maya: The');
assert.equal(get('live-source-badge').hidden,false);
get('audio-stop').click();
assert.equal(get('audio-transcript').value,'Maya: The');
assert.equal(get('live-text').hidden,false);
assert.equal(get('transcript-clear').disabled,false);
deny=false;
get('audio-start').click();await flush();
assert.equal(starts().length,micCalls+1,'Start after a stopped sample must open real transcription, not replay the sample');
assert.equal(win.OpenSesameLive.isDemo(),false);
assert.equal(get('audio-transcript').value,'','Sample text must not contaminate real transcription');
get('audio-stop').click();speech(starts().at(-1).params.id,'Real microphone text',true);await flush();
get('transcript-clear').click();
assert.equal(starts().length,micCalls+1,'Demo itself must never request microphone input');
assert.equal(get('live-sample').hidden,false);

get('audio-record').checked=true;get('audio-transcribe').checked=false;
get('audio-start').click();await flush();
assert.equal(get('audio-start').disabled,true,'Pending microphone permission locks capture');
recordStart.resolve({sourceLabel:'Test external microphone'});await flush();
assert.equal(vm.runInContext('audioSession.sourceLabel',ctx),'Test external microphone');
assert.equal(get('audio-start').getAttribute('aria-label'),'Start recording');
const recordID=calls.find(c=>c.method==='record.start').params.id;
get('audio-stop').click();await flush();await flush();
assert.equal(vm.runInContext('audioSession.nativeRecording',ctx),recordID);
assert.equal(get('audio-download').hidden,false,'Stopping a native recording exposes the save action');
assert.match(get('audio-status').textContent,/Recording ready/);
get('audio-download').click();await flush();
assert.equal(calls.filter(c=>c.method==='record.save').at(-1).params.id,recordID);
vm.runInContext("audioSession.final='Keep this transcript'",ctx);get('transcript-clear').click();
assert.equal(vm.runInContext('audioSession.nativeRecording',ctx),recordID,'Clearing text must preserve a completed recording');
get('audio-start').click();await flush();get('audio-stop').click();await flush();await flush();
recordStart.resolve({sourceLabel:'Late permission'});await flush();
assert.equal(vm.runInContext('audioSession.active',ctx),false,'Late permission must not restart a cancelled recording');
get('audio-start').click();await flush();recordStart.reject(Error('Microphone denied'));await flush();await flush();
assert.equal(get('audio-start').disabled,false,'Recording denial must restore Start');
assert.match(get('audio-status').textContent,/denied/);
get('audio-record').checked=false;get('audio-transcribe').checked=true;
console.log('Sample-to-microphone transition, native recording, save, cancellation, late permission, independent outputs, and denial recovery passed with a simulated native recorder.');

const shortcuts=win.OpenSesameQuestionShortcuts;
assert.equal(shortcuts.find('/WHAT   DID I MISS').kind,'recap');
assert.equal(shortcuts.since('First\nSecond','First'),'Second');
assert.equal(shortcuts.since('First\nSecond revised','First\nSecond'),'Second revised');
assert.equal(shortcuts.since('First','First'),'');
assert.throws(()=>shortcuts.save('','action items','Override'),/already in use/);
shortcuts.save('','/my follow-up','What did Maya decide?');
assert.equal(shortcuts.find('/MY FOLLOW-UP').prompt,'What did Maya decide?');
shortcuts.save('my follow-up','next question','What is next?');
assert.equal(shortcuts.find('/my follow-up'),undefined);
shortcuts.remove('next question');
assert.equal(shortcuts.find('/next question'),undefined);
vm.runInContext("audioSession.final="+JSON.stringify("Maya: The beta opens Thursday.\nSam: I will send the draft Friday."),ctx);
get('live-agent').value='local';
assert.equal(win.OpenSesameLive.ask('/what did I miss?'),true);
assert.match(get('live-answers').children.at(-1).children.at(-1).textContent,/Thursday/);
assert.equal(win.OpenSesameLive.ask('/what did I miss?'),true);
assert.match(get('live-answers').children.at(-1).children.at(-1).textContent,/No new transcript/);
get('live-agent').value='codex';
assert.equal(win.OpenSesameLive.ask('/recommend questions'),true);
assert.match(calls.filter(c=>c.method==='live.ask').at(-1).params.question,/Suggest up to three/);
reply({agent:'codex',answer:'Which feedback should we prioritize?'});await flush();
assert.match(get('live-answers').children.at(-1).children.at(-1).textContent,/prioritize/);
console.log('Question commands, prompt expansion, custom edits, deletion, and incremental catch-up passed.');

get('live-shortcut-editor').hidden=true;
get('live-customize').click();
assert.equal(get('live-shortcut-dialog').open,true);
assert.equal(get('live-shortcut-saved').hidden,true,'A first shortcut needs no redundant saved-shortcut selector');
assert.equal(get('live-shortcut-save').disabled,true);
get('live-shortcut-name').value='/Open questions';get('live-shortcut-name').dispatchEvent(new Event('input'));
get('live-shortcut-prompt').value='Which questions are still unresolved?';get('live-shortcut-prompt').dispatchEvent(new Event('input'));
assert.equal(get('live-shortcut-preview').textContent,'/open questions');assert.equal(get('live-shortcut-save').disabled,false);
const requestCount=calls.length;get('live-shortcut-editor').dispatchEvent(new Event('submit',{cancelable:true}));
assert.equal(get('live-shortcut-dialog').open,false);assert.equal(shortcuts.find('/open questions').prompt,'Which questions are still unresolved?');
assert.equal(calls.length,requestCount,'Saving a shortcut cannot send it or start audio');
get('live-customize').click();get('live-shortcut-choice').value='open questions';get('live-shortcut-choice').dispatchEvent(new Event('change'));
assert.equal(get('live-shortcut-title').textContent,'Edit shortcut');assert.equal(get('live-shortcut-save').textContent,'Save changes');
get('live-shortcut-prompt').value='Do not save this';get('live-shortcut-cancel').click();
assert.equal(shortcuts.find('/open questions').prompt,'Which questions are still unresolved?','Cancel preserves the saved question');
get('live-customize').click();ctx.state.expanded=false;win.dispatchEvent(new Event('open-sesame-layout'));
assert.equal(get('live-shortcut-dialog').open,false,'Collapsing cannot strand a modal over the compact widget');
console.log('Shortcut creation/editing: focused modal, normalized preview, empty save guard, local-only save, cancel and collapse cleanup passed.');
