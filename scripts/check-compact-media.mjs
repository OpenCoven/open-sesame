import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
class Node {constructor(){this.hidden=false;this.disabled=false;this.handlers={};this.attrs={};this.style={setProperty(){}};this.classList={toggle(){}};this.children=[]}addEventListener(k,f){this.handlers[k]=f}setAttribute(k,v){this.attrs[k]=v}append(v){this.children.push(v)}}
const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id)},win=new Node(),calls=[],errors=[];
let playback={loaded:true,ready:true,playing:false,title:'Track',previous:false,next:true},release;
win.OpenSesameLocalMedia={snapshot:()=>playback,control:async action=>{calls.push(action);if(action==='toggle')playback.playing=!playback.playing;if(action==='next')await new Promise(resolve=>release=resolve)}};
const ctx={window:win,document:{getElementById:get,createElement:()=>new Node()},state:{expanded:false,layout:'notch',scenario:'media'},icon:v=>v,time:()=> '25:00',focusRemaining:1500,hoverTimer:0,clearTimeout(){},setInterval(){},toast:v=>errors.push(v)};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('dist/compact-media.js','utf8'),ctx);const sync=win.OpenSesameCompact.sync,click=id=>get(id).handlers.click({stopPropagation(){}});
assert.equal(get('compact-media-controls').hidden,false);assert.equal(get('compact-media-previous').hidden,true);assert.equal(get('compact-media-next').hidden,false);
await click('compact-media-play');assert.equal(calls[0],'toggle');assert.equal(get('compact-media-play').attrs['aria-label'],'Pause playback');assert.equal(ctx.state.expanded,false,'Transport must never expand the widget');
const pending=click('compact-media-next');assert.equal(get('compact-media-play').disabled,true);await click('compact-media-play');assert.equal(calls.length,2,'Ignore duplicate commands during an in-flight transition');release();await pending;assert.equal(get('compact-media-play').disabled,false);
playback.ready=false;sync();assert.equal(get('compact-media-play').disabled,true);ctx.state.expanded=true;sync();assert.equal(get('compact-media-controls').hidden,true);ctx.state.expanded=false;ctx.state.layout='menu';sync();assert.equal(get('compact-media-controls').hidden,true);
ctx.state.layout='notch';ctx.state.scenario='focus';sync();assert.equal(get('compact-left').children.at(-1).textContent,'25:00','Keep focus countdown visible during background playback');
win.OpenSesameMusic={snapshot:()=>({loaded:true,ready:true,playing:true,title:'Spotify'}),control:async()=>{throw Error('Disconnected')}};await click('compact-media-play');assert.equal(errors.at(-1),'Disconnected');assert.equal(get('compact-media-play').disabled,false,'Recover after provider errors');
for(const ratio of [5,8,12]){ctx.state.width=180;ctx.state.ratio=ratio;const size=win.OpenSesameCompact.geometry();assert.ok(size.width>=360&&size.height>=72);assert.ok(Math.abs(size.width/size.height-ratio)<.02,'Media minimum grows proportionally to the chosen notch ratio')}
console.log('Compact transport: no expansion, playback state, supported navigation, in-flight command protection, disabled/unavailable states, focus countdown, and error recovery passed with simulated providers.');
// Verify the shipped Spotify adapter against its SDK event contract. No account is used.
class MusicNode extends Node {constructor(id=''){super();this.id=id;this.value='';this.dataset={}}remove(){musicNodes.delete(this.id)}append(v){super.append(v);if(v.id)musicNodes.set(v.id,v)}pause(){}}
const musicNodes=new Map(),musicGet=id=>{if(!musicNodes.has(id))musicNodes.set(id,new MusicNode(id));return musicNodes.get(id)},musicWin=new Node();
const optional=new Set(['music-kit-player','music-provider-host','music-provider-frame']);
const musicDocument={getElementById:id=>optional.has(id)?musicNodes.get(id)||null:musicGet(id),createElement:()=>new MusicNode(),head:new Node()};
let paused=true,toggles=0,destroyed=0,sdkOptions;const listeners={};
const sdk={createController(host,options,done){sdkOptions=options;done({addListener:(event,fn)=>listeners[event]=fn,togglePlay(){toggles++;paused=!paused;listeners.playback_update({data:{isPaused:paused}})},destroy(){destroyed++}})}};
musicDocument.head.append=()=>queueMicrotask(()=>musicWin.onSpotifyIframeApiReady(sdk));musicWin.OpenSesameYouTube={clear(){}};
const musicCtx={window:musicWin,document:musicDocument,localStorage:{getItem(){return null},setItem(){}},OpenSesamePlaylist:{parseSource:()=>null},URL,renderCompact(){},toast(){},setTimeout:()=>1,clearTimeout(){},icon:v=>v};vm.createContext(musicCtx);vm.runInContext(fs.readFileSync('dist/music.js','utf8'),musicCtx);
musicGet('music-url').value='https://open.spotify.com/track/1234567890123456789012';await musicGet('music-source-form').handlers.submit({preventDefault(){}});
assert.equal(sdkOptions.uri,'spotify:track:1234567890123456789012');assert.equal(musicWin.OpenSesameMusic.snapshot().ready,false);listeners.ready();assert.equal(musicWin.OpenSesameMusic.snapshot().ready,true);
await musicWin.OpenSesameMusic.control('toggle');assert.equal(toggles,1);assert.equal(musicWin.OpenSesameMusic.snapshot().playing,true);await musicWin.OpenSesameMusic.control('toggle');assert.equal(musicWin.OpenSesameMusic.snapshot().playing,false);
musicWin.OpenSesameMusic.stop();listeners.playback_update({data:{isPaused:false}});assert.equal(musicWin.OpenSesameMusic.snapshot().loaded,false);assert.equal(musicWin.OpenSesameMusic.snapshot().ready,false);assert.equal(destroyed,1);
console.log('Spotify adapter: URI mapping, readiness, actual SDK toggle calls, playback event synchronization, destroy, and stale-event protection passed against a simulated SDK.');
