'use strict';
(()=>{
  const supported='speechSynthesis' in window&&'SpeechSynthesisUtterance' in window,button=document.getElementById('capture-speak'),input=document.getElementById('capture-input');let generation=0,owner='',utterance=null;
  function notify(){button.innerHTML=icon(owner==='capture'?'stop':'volume');button.disabled=!supported||(!input.value.trim()&&owner!=='capture');button.setAttribute('aria-label',!supported?'Read aloud unavailable in this browser':owner==='capture'?'Stop reading capture':'Read capture aloud');button.title=button.getAttribute('aria-label');window.dispatchEvent(new CustomEvent('open-sesame-speech',{detail:owner}))}
  function stop(){generation++;if(supported)speechSynthesis.cancel();owner='';utterance=null;notify()}
  function speak(text,source='capture'){
    if(window.OpenSesameVoice?.active)return false;
    text=String(text||'').trim();if(!supported||!text){if(!supported)toast('Read aloud is unavailable in this browser.');return false}stop();owner=source;const token=generation,chunks=text.match(/[^.!?\n]{1,220}(?:[.!?\n]+|$)|.{1,220}/g)||[text];let index=0;
    const next=()=>{if(token!==generation)return;if(index>=chunks.length){owner='';utterance=null;notify();return}const u=new SpeechSynthesisUtterance(chunks[index++]);utterance=u;u.lang=navigator.language||'en-US';const voices=speechSynthesis.getVoices(),local=voices.find(v=>v.localService&&v.lang.startsWith(u.lang.split('-')[0]));if(local)u.voice=local;u.onend=next;u.onerror=e=>{if(token!==generation)return;owner='';notify();if(!['interrupted','canceled'].includes(e.error))toast('Speech could not start. Check your device’s voice settings.')};speechSynthesis.speak(u)};next();notify();return true;
  }
  button.addEventListener('click',()=>owner==='capture'?stop():speak(input.value,'capture'));input.addEventListener('input',notify);window.addEventListener('pagehide',stop);
  window.openSesameSpeech={speak,stop,refresh:notify,get owner(){return owner},supported};notify();
})();
