'use strict';
(() => {
  function capability({native=false,speech=false,track=false,microphone=false,shared=false,recorder=false,mixing=false},mode,source) {
    if(native && ['mic','system','both'].includes(source))return {available:true,reason:''};
    if(source!=='mic'&&!shared)return {available:false,reason:'Shared tab or screen audio is unavailable here. Choose Microphone, or open the web app in a browser that supports audio sharing.'};
    if(source!=='system'&&!microphone)return {available:false,reason:'Microphone capture is unavailable here.'};
    if(!mixing)return {available:false,reason:'Audio capture is unavailable in this browser.'};
    if(mode==='record'&&!recorder)return {available:false,reason:'Audio recording is unavailable in this browser.'};
    if(mode==='transcribe'&&(!speech||(source!=='mic'&&!track)))return {available:false,reason:source==='mic'?'Speech recognition is unavailable here. Use the Mac app to transcribe your microphone.':'Shared-audio transcription needs desktop Chrome 135 or later. You can record shared audio in supported browsers.'};
    return {available:true,reason:''};
  }
  const sources=window.__OPEN_SESAME_NATIVE__?{mic:'Microphone',system:'System audio',both:'Microphone + system audio'}:{mic:'Microphone',system:'Shared tab or screen audio',both:'Microphone + shared audio'};
  function inputStatus(source,activity={}) {
    if(!activity||typeof activity!=='object')activity={};
    const label=(name,state)=>state==='detected'?name+' detected':state==='silent'?name+' is silent':'Waiting for '+name.toLowerCase();
    if(source==='both')return label('System audio',activity.system)+' · '+label('Microphone',activity.mic);
    return source==='system'?label('System audio',activity.system):label('Microphone',activity.mic);
  }
  window.OpenSesameLiveCaptureModel={capability,sources,inputStatus};
})();
