import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync('dist/native-youtube.html','utf8'),source=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
function fixture(input){
  const calls=[],events=[],timers=[],window={webkit:{messageHandlers:{youtubePlayer:{postMessage:value=>events.push(value)}}}};let options,player;
  const YT={Player:function(id,value){options=value;player={getVideoData:()=>({video_id:'TestVideo01'}),getPlayerState:()=>5,getCurrentTime:()=>0,getDuration:()=>100,getVolume:()=>60,isMuted:()=>false,getVideoUrl:()=>'',getPlaylist:()=>['TestVideo01','TestVideo02'],getPlaylistIndex:()=>0,cuePlaylist:(...args)=>calls.push(['cue',...args]),loadPlaylist:(...args)=>calls.push(['load',...args]),playVideo:()=>calls.push(['play'])};return player}};
  vm.runInNewContext(source.replace('__OPEN_SESAME_SOURCE__',JSON.stringify({...input,generation:'fixture',origin:'https://com.perch.widgetstudio/'})),{window,YT,setInterval:fn=>timers.push(fn),Number,Array,Math,String});window.onYouTubeIframeAPIReady();return {window,calls,events,timers,options};
}
let f=fixture({list:'PLfixture1234567890',id:'',start:12});assert.equal(f.options.playerVars.listType,'playlist');f.options.events.onReady();assert.equal(f.calls[0][0],'cue');assert.equal(f.calls[0][1].list,'PLfixture1234567890');assert.equal(f.calls[0][1].startSeconds,12);assert.ok(!f.calls.some(c=>c[0]==='play'||c[0]==='load'),'Opening a playlist must not autoplay');assert.equal(f.events[0].snapshot.playlist.length,2);
f.window.openSesamePlayerCommand({action:'cuePlaylist',args:[['TestVideo02','TestVideo01'],1,0]});assert.equal(f.calls.at(-1)[1][0],'TestVideo02');
const count=f.calls.length;f.window.openSesamePlayerCommand({action:'cuePlaylist',args:[['invalid']]});assert.equal(f.calls.length,count,'Reject malformed playlist commands');
f=fixture({list:'PLfixture1234567890',id:'TestVideo01'});f.options.events.onReady();assert.equal(f.calls.length,0,'Preserve an explicit selected video in its playlist');
console.log('Native YouTube: explicit playlist type, playlist-only cueing, no autoplay, explicit video preservation, snapshots, ordered commands and malformed ID rejection passed with an IFrame API fixture.');
const controller=fs.readFileSync('dist/youtube.js','utf8'),begin=controller.indexOf('  function adaptRail(){'),end=controller.indexOf('\n',begin);
class Node{constructor(){this.clientWidth=320;this.clientHeight=180;this.hidden=false;this.attrs={};this.classes=new Set();this.classList={toggle:(key,on)=>on?this.classes.add(key):this.classes.delete(key)};this.span={}}setAttribute(k,v){this.attrs[k]=String(v)}getAttribute(k){return this.attrs[k]}querySelector(){return this.span}contains(){return false}focus(){}}
const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id)};
const layout={el:get,source:{list:'PLfixture1234567890'},queue:{entries:[{},{}]},railPreference:null,window:{},document:{activeElement:null},icon:()=>'<svg></svg>',closeSort(){}};vm.createContext(layout);vm.runInContext(controller.slice(begin,end),layout);
layout.adaptRail();assert.equal(get('youtube-queue-toggle').hidden,false,'A compact layout always keeps playlist access visible');assert.equal(get('youtube-queue').hidden,true);
layout.railPreference=true;layout.adaptRail();assert.equal(get('youtube-queue').hidden,false);assert.ok(get('youtube-workspace').classes.has('playlist-overlay'));
get('youtube-workspace').clientWidth=1200;get('youtube-workspace').clientHeight=700;layout.adaptRail();assert.ok(!get('youtube-workspace').classes.has('playlist-overlay'));
get('youtube-workspace').clientHeight=220;layout.adaptRail();assert.ok(get('youtube-workspace').classes.has('playlist-overlay'),'Short windows get the same overlay as narrow windows');
layout.railPreference=false;layout.adaptRail();assert.equal(get('youtube-queue').hidden,true);assert.equal(get('youtube-queue-toggle').attrs['aria-label'],'Open playlist');

assert.ok(controller.includes("toolbar=el(music?'music-source-form':'youtube-form')"),'Playlist access must live outside the native player hit area in both hosts');
