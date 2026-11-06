'use strict';
(()=>{
  const el=id=>document.getElementById(id),main=el('capture-voice'),Engine=window.SpeechRecognition||window.webkitSpeechRecognition,native=!!window.__OPEN_SESAME_NATIVE__,supported=native||!!Engine;let session=null;
  const sheet=document.createElement('aside');sheet.className='voice-popover';sheet.hidden=true;sheet.setAttribute('aria-label','Voice input');
  sheet.innerHTML='<div><i class="voice-indicator" aria-hidden="true"></i><strong id="voice-state" role="status">Listening…</strong><button id="voice-cancel" class="voice-dismiss" type="button">Cancel</button><button id="voice-finish" type="button">Use speech</button></div><output id="voice-transcript"></output><small>Speech uses your browser or macOS speech service. Review the draft before sending or running a command.</small>';
  document.querySelector('.widget-capture-footer').append(sheet);
  function update(){main.disabled=!supported;main.innerHTML=icon(session?'stop':'mic');main.setAttribute('aria-pressed',!!session);main.setAttribute('aria-label',!supported?'Voice input unavailable in this browser':session?'Finish voice input':'Dictate or speak a command');main.title=main.getAttribute('aria-label');if(session?.button!==main)session?.button?.setAttribute('aria-pressed','true')}
  function clean(){const old=session;if(!old)return;session=null;clearTimeout(old.timeout);clearTimeout(old.finishTimeout);old.target.removeEventListener('input',cancel);old.button?.setAttribute('aria-pressed','false');sheet.hidden=true;if(native)window.openSesameBridge.request('speech.stop',{id:old.id,cancel:true}).catch(()=>{});else try{old.recognizer?.abort()}catch{}update();return old}
  function cancel(){clean()}
  function complete(){
    const old=clean();if(!old)return;const text=old.text.trim();if(!text){toast('No speech detected. Try again.');return}
    if(old.onRecognized){old.onRecognized(text);return}
    if(old.target.value!==old.original||!old.target.isConnected){toast('Your draft changed. Voice input was not inserted.');return}
    try{const draft=old.search||!old.original.trim()?OpenSesameVoiceModel.draft(text,{chat:!!window.OpenSesameCovenChat?.isActive(),search:old.search}):text;const result=OpenSesameVoiceModel.insert(old.original,old.start,old.end,draft,old.target.maxLength>0?old.target.maxLength:20000);old.target.value=result.value;old.target.dispatchEvent(new Event('input',{bubbles:true}));old.target.focus({preventScroll:true});old.target.setSelectionRange(result.cursor,result.cursor);old.onCommit?.();if(!old.search)toast('Voice draft ready. Review and press Enter.')}catch(error){toast(error.message)}
  }
  function fail(message){if(!session)return;if(session.text.trim()){complete();toast(message+' Captured speech was kept in your draft.')}else{clean();toast(message)}}
  function stop(){if(!session)return;if(session.phase==='requesting'){cancel();return}if(session.phase==='finishing')return;session.phase='finishing';el('voice-state').textContent='Finishing…';clearTimeout(session.timeout);session.finishTimeout=setTimeout(complete,1800);if(native)window.openSesameBridge.request('speech.stop',{id:session.id,cancel:false}).catch(()=>complete());else try{session.recognizer.stop()}catch{complete()}}
  function listening(){if(!session||session.phase==='finishing')return;clearTimeout(session.timeout);session.phase='listening';el('voice-state').textContent=session.search?'Listening for a search…':'Listening…';session.timeout=setTimeout(stop,30000)}
  function start({target=el('capture-input'),button=main,search=false,onCommit=null,onRecognized=null,hold=false}={}){
    if(session){if(session.target===target){stop();return}cancel()}
    if(!supported){toast('Voice input is unavailable here. Use a speech-enabled browser or the rebuilt desktop companion.');return}
    if(document.body.classList.contains('audio-active') || (typeof audioSession!=='undefined' && (audioSession.starting||audioSession.stopping))){toast('Stop Live audio before starting voice input.');return}
    window.openSesameSpeech?.stop();const id='voice-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);session={id,target,button,search,onCommit,onRecognized,hold,original:target.value,start:target.selectionStart??target.value.length,end:target.selectionEnd??target.value.length,text:'',phase:'requesting'};target.addEventListener('input',cancel);sheet.hidden=false;el('voice-state').textContent='Starting microphone…';el('voice-transcript').textContent=hold?'Keep holding to speak. Release to review your command.':search?'Say what to find in this conversation.':'Speak a message, “search chat for…”, or “open reading”.';update();
    if(native){window.openSesameBridge.request('speech.start',{id,locale:navigator.language||'en-US'}).then(()=>{if(session?.id===id)listening()}).catch(error=>{if(session?.id===id)fail(error.message)});return}
    const r=OpenSesameRecognition.create({Engine,lang:navigator.language||'en-US',continuous:hold,
      onStatus(status){if(session?.id!==id)return;if(status==='listening')listening();else if(status==='reconnecting')el('voice-state').textContent='Reconnecting speech service…'},
      onText({final,interim}){if(session?.id!==id)return;session.text=[final,interim].filter(Boolean).join(' ').slice(0,20000);el('voice-transcript').textContent=session.text},
      onError(error){if(session?.id===id)session.error=OpenSesameRecognition.message(error)},
      onEnd(){if(session?.id!==id)return;session.error?fail(session.error):complete()}
    });session.recognizer=r;r.start();
  }
  window.addEventListener('open-sesame-desktop-event',event=>{const data=event.detail;if(!session||data.id!==session.id)return;if(data.event==='voice.result'){session.text=String(data.text||'').slice(0,20000);el('voice-transcript').textContent=session.text;if(data.final)complete()}else if(data.event==='voice.error')fail(data.message||'Voice input stopped.');else if(data.event==='voice.end')complete()});
  main.addEventListener('click',()=>session?stop():start());el('voice-cancel').addEventListener('click',cancel);el('voice-finish').addEventListener('click',stop);
  document.addEventListener('keydown',event=>{if(session&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();cancel()}},true);
  for(const type of ['pagehide','open-sesame-view-changed','open-sesame-chat-changed'])window.addEventListener(type,cancel);
  window.addEventListener('blur',()=>{if(session?.phase==='listening')cancel()});document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel()});window.addEventListener('open-sesame-layout',()=>{if(!state.expanded)cancel()});
  window.OpenSesameVoice={start,stop,cancel,get target(){return session?.target},get active(){return !!session}};update();
})();
