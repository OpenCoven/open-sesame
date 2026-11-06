'use strict';
(() => {
  function capability({native=false,speech=false,track=false,microphone=false,shared=false,recorder=false,mixing=false},mode,source) {
    if(native && source==='mic')return {available:true,reason:''};
    if(source!=='mic'&&!shared)return {available:false,reason:'Shared tab or screen audio is unavailable here. Choose Microphone, or open the web app in a browser that supports audio sharing.'};
    if(source!=='system'&&!microphone)return {available:false,reason:'Microphone capture is unavailable here.'};
    if(!mixing)return {available:false,reason:'Audio capture is unavailable in this browser.'};
    if(mode==='record'&&!recorder)return {available:false,reason:'Audio recording is unavailable in this browser.'};
    if(mode==='transcribe'&&(!speech||(source!=='mic'&&!track)))return {available:false,reason:source==='mic'?'Speech recognition is unavailable here. Use the Mac app to transcribe your microphone.':'Shared-audio transcription needs desktop Chrome 135 or later. You can record shared audio in supported browsers.'};
    return {available:true,reason:''};
  }
  const sources={mic:'Microphone',system:'Shared tab or screen audio',both:'Microphone + shared audio'};
  window.OpenSesameLiveCaptureModel={capability,sources};
})();
