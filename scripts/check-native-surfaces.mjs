import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class SurfaceElement {
  constructor(){this.isConnected=true;this.hidden=false;this.rect={left:10,top:20,width:500,height:300,right:510,bottom:320};}
  getBoundingClientRect(){return this.rect}
  getClientRects(){return this.hidden?[]:[this.rect]}
}
const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,new SurfaceElement());return elements.get(id)};
const win=new EventTarget(),doc=new EventTarget(),calls=[],messages=[];let overlays=[],next=0;
doc.hidden=false;doc.getElementById=element;doc.querySelectorAll=()=>overlays;
win.__OPEN_SESAME_NATIVE__=true;win.innerWidth=1000;win.innerHeight=700;
const jobs=new Map(),context={Event,window:win,document:doc,state:{expanded:true},getComputedStyle:()=>({visibility:'visible'}),openSesameBridge:{request:async(method,params)=>{calls.push({method,...params});return true}},toast:text=>messages.push(text),Date,ResizeObserver:class{observe(){}disconnect(){}},MutationObserver:class{observe(){}},requestAnimationFrame:fn=>{jobs.set(++next,fn);return next}};
vm.runInNewContext(fs.readFileSync('dist/native-surfaces.js','utf8'),context);
const flush=async()=>{await Promise.resolve();const pending=[...jobs.values()];jobs.clear();pending.forEach(fn=>fn());await Promise.resolve()};
const api=win.OpenSesameNativeSurfaces;
assert.equal(api.bookmark('https://first.example/',true),true);await flush();
assert.equal(calls.filter(c=>c.method==='webview.open').length,1);
assert.equal(calls.at(-1).y,20,'Top-down DOM coordinates must be sent unchanged to native layout');
assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).clip)),{x:10,y:20,width:500,height:300});
const parent=new SurfaceElement();parent.rect={left:30,top:50,right:490,bottom:280,width:460,height:230};
element('bookmark-embed-wrap').parentElement=parent;
context.getComputedStyle=node=>({visibility:'visible',overflowX:node===parent?'hidden':'visible',overflowY:node===parent?'auto':'visible'});
api.sync();await flush();assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).clip)),{x:30,y:50,width:460,height:230},'Native previews inherit ancestor scrolling/overflow clipping');
assert.equal(calls.at(-1).width,500,'Clipping must preserve the full browser content width');
parent.rect.top=400;api.sync();await flush();assert.equal(calls.at(-1).visible,false,'Completely scrolled-out previews are hidden');
element('bookmark-embed-wrap').parentElement=null;context.getComputedStyle=()=>({visibility:'visible'});
api.bookmark('https://first.example/',true);await flush();assert.equal(calls.filter(c=>c.method==='webview.open').length,1,'Repainting must not reload the bookmark');
api.bookmark('https://second.example/',true);await flush();assert.equal(calls.filter(c=>c.method==='webview.open').at(-1).url,'https://second.example/','Editing the URL navigates the existing WKWebView');
overlays=[{hidden:false,contains:()=>false,getClientRects:()=>[{}],getBoundingClientRect:()=>({left:0,top:0,right:600,bottom:400})}];
api.sync();await flush();assert.equal(calls.at(-1).visible,false,'Native pages must not cover app dialogs');overlays=[];
api.bookmark('',false);assert.equal(calls.at(-1).method,'webview.close');
let ready=0,changed=0,error=0;
const player=await api.youtube(element('youtube-stage'),{id:'TestVideo01'},{onReady:()=>ready++,onStateChange:()=>changed++,onError:e=>error=e.data});await flush();
const generation=calls.find(c=>c.method==='webview.open'&&c.id==='youtube').generation;
function event(token,type,snapshot={},code=null){win.dispatchEvent(Object.assign(new Event('open-sesame-desktop-event'),{detail:{event:'webview.youtube',id:'youtube',generation:token,payload:{type,snapshot,code}}}))}
event(generation,'ready',{playlist:['TestVideo01'],state:1,time:12,duration:90,volume:40,video:{video_id:'TestVideo01',title:'Actual title'}});
assert.equal(ready,1);assert.equal(player.getPlayerState(),1);assert.equal(player.getCurrentTime(),12);assert.equal(player.getVideoData().title,'Actual title');
event('stale','state',{time:999});assert.equal(player.getCurrentTime(),12);
event(generation,'error',{},153);assert.equal(error,153);
player.loadPlaylist(['TestVideo01'],0,2);assert.equal(calls.at(-1).action,'loadPlaylist');assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).args)),[['TestVideo01'],0,2]);
context.state.expanded=false;api.sync();await flush();assert.equal(calls.at(-1).visible,false);
await api.popoutYouTube();assert.equal(calls.at(-1).method,'webview.popout');win.dispatchEvent(Object.assign(new Event('open-sesame-desktop-event'),{detail:{event:'webview.popout',id:'youtube',generation,active:true}}));assert.equal(api.youtubePoppedOut,true);await api.popoutYouTube();assert.equal(calls.at(-1).method,'webview.dock');await api.popoutMusic('https://open.spotify.com/embed/track/1234567890123456789012');assert.equal(calls.at(-1).method,'webview.popout');assert.match(calls.at(-1).id,/^media-pip-/);
player.destroy();assert.equal(calls.at(-1).method,'webview.close');
event(generation,'ready');assert.equal(ready,1,'Closed players ignore late native events');

const html=fs.readFileSync('dist/native-youtube.html','utf8');
const code=html.match(/<script>\n([\s\S]*?)<\/script>/)[1].replace('__OPEN_SESAME_SOURCE__',JSON.stringify({id:'TestVideo01',list:'',start:5,origin:'https://com.perch.widgetstudio/',generation:'test'}));
let options;const nativeMessages=[],commands=[];
const mock={getPlayerState:()=>1,getCurrentTime:()=>5,getDuration:()=>60,getVolume:()=>50,isMuted:()=>false,getVideoData:()=>({title:'Video'}),getVideoUrl:()=>'',getPlaylist:()=>[],getPlaylistIndex:()=>0,playVideo:()=>commands.push('playVideo'),setVolume:v=>commands.push(v)};
const wrapper={window:{webkit:{messageHandlers:{youtubePlayer:{postMessage:m=>nativeMessages.push(m)}}}},YT:{Player:class{constructor(id,value){options=value;return mock}}},setInterval(){},console};
vm.runInNewContext(code,wrapper);wrapper.window.onYouTubeIframeAPIReady();options.events.onReady();
assert.equal(options.playerVars.origin,'https://com.perch.widgetstudio/');assert.equal(options.playerVars.autoplay,0);
wrapper.window.openSesamePlayerCommand({action:'setVolume',args:[500]});assert.equal(commands.at(-1),100);
wrapper.window.openSesamePlayerCommand({action:'arbitraryCode',args:['alert(1)']});assert.equal(commands.length,1);
assert.equal(nativeMessages[0].type,'ready');assert.equal(nativeMessages[0].generation,'test');
const swift=fs.readFileSync('desktop/EmbeddedWebSurface.swift','utf8');
assert.ok(swift.includes('view.loadHTMLString(')&&swift.includes('baseURL: identity'));
assert.ok(!swift.includes('name: "openSesame"'),'External previews must never receive the app bridge');
assert.ok(swift.includes('message.frameInfo.isMainFrame'));
console.log('Native bookmark navigation, preview occlusion/cleanup, YouTube state/commands and stale events, and isolated player wrapper passed with simulated WebKit transport.');
