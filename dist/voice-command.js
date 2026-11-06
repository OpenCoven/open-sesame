'use strict';
(()=>{
  const el=id=>document.getElementById(id),anchor=el('widget-anchor'),panel=el('widget-panel');
  const button=document.createElement('button');button.id='widget-voice-open';button.type='button';button.className='panel-window-button';button.setAttribute('aria-label','Voice commands and Live audio');button.title='Voice · hold the widget or Alt+Shift+V';button.innerHTML=icon('mic');el('capture-launcher-open').before(button);
  const sheet=document.createElement('section');sheet.id='voice-command-sheet';sheet.className='voice-command-sheet';sheet.hidden=true;sheet.setAttribute('role','dialog');sheet.setAttribute('aria-label','Speak to Open Sesame');
  sheet.innerHTML='<header><span>'+icon('mic')+'<strong>Speak to Open Sesame</strong></span><button type="button" id="voice-command-close" aria-label="Close voice commands">'+icon('close')+'</button></header><div class="voice-mode-actions"><button type="button" id="voice-command-talk">'+icon('mic')+'<span>Command<small>Speak, review, run</small></span></button><button type="button" id="voice-live-audio">'+icon('capture')+'<span>Live audio<small>Choose what to capture</small></span></button></div><p class="voice-command-hint">Hold to speak. Release to review. · Alt + Shift + V</p><label for="voice-command-draft">Your command<textarea id="voice-command-draft" rows="2" maxlength="20000" placeholder="Add a task, open Projects, start recording…"></textarea></label><div class="voice-command-review"><small id="voice-command-result" role="status">Try “focus for 30 minutes” or “computer volume 40”.</small><button type="button" id="voice-command-run" disabled>Run command '+icon('arrow-up-right')+'</button></div><small class="voice-command-footnote">Control volume, mute, or open Mac apps. Other computer requests open Coven for review.</small>';
  panel.append(sheet);
  let pointer=null,timer=0,holding=false,suppressUntil=0;
  function open(){window.OpenSesameLauncher?.close(true);setExpanded(true);sheet.hidden=false;el('voice-command-draft').focus({preventScroll:true})}
  function close(){window.OpenSesameVoice?.cancel();sheet.hidden=true;button.focus({preventScroll:true})}
  function interpret(){return window.openSesameCapture.interpret(OpenSesameVoiceModel.draft(el('voice-command-draft').value),'auto','')}
  function refresh(){const intent=interpret(),empty=!el('voice-command-draft').value.trim();el('voice-command-run').disabled=empty||intent.incomplete||['error','help'].includes(intent.kind);el('voice-command-result').textContent=empty?'Try “focus for 30 minutes” or “computer volume 40”.':intent.hint||'Save note';el('voice-command-run').firstChild.textContent=(intent.label||'Save note')+' '}
  function talk(hold=false){open();window.OpenSesameVoice.start({target:el('voice-command-draft'),button:el('voice-command-talk'),hold,onRecognized(text){el('voice-command-draft').value=text;refresh();el('voice-command-draft').focus({preventScroll:true})}})}
  function startAudio(mode){
    window.OpenSesameVoice.cancel();sheet.hidden=true;window.OpenSesameLauncher?.close(true);changeScenario('audio');
    if(audioSession.active||audioSession.starting||audioSession.stopping){toast('Your current audio session is already open.');return}
    window.OpenSesameLive?.endDemo();el('audio-source').value='mic';el('audio-source').dispatchEvent(new Event('change',{bubbles:true}));if(window.OpenSesameLiveCapture?.selectMode(mode))startAudioSession();
  }
  function startAudioSession(){el('audio-start').click()}
  button.addEventListener('click',open);el('voice-command-close').addEventListener('click',close);el('voice-command-talk').addEventListener('click',()=>window.OpenSesameVoice.active?window.OpenSesameVoice.stop():talk());el('voice-command-draft').addEventListener('input',refresh);
  el('voice-live-audio').addEventListener('click',()=>{window.OpenSesameVoice.cancel();sheet.hidden=true;window.OpenSesameLauncher?.close(true);changeScenario('audio');el('live-capture-mode').focus({preventScroll:true})});
  el('voice-command-run').addEventListener('click',()=>{
    const intent=interpret();if(el('voice-command-run').disabled)return;
    if(intent.kind==='computer'){window.OpenSesameComputer.run(intent.control);return}
    if(intent.kind==='item'){
      const capture=el('capture-input');if(capture.value.trim()){toast('Save or clear your current capture draft first. Your spoken command is kept here.');return}
      el('capture-type').value='auto';capture.value=OpenSesameVoiceModel.draft(el('voice-command-draft').value);capture.dispatchEvent(new Event('input',{bubbles:true}));sheet.hidden=true;el('capture-form').requestSubmit();
    }else if(window.openSesameCapture.execute(intent)===true)sheet.hidden=true;
  });
  el('voice-command-draft').addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)){event.preventDefault();el('voice-command-run').click()}});
  function reset(cancel=false){clearTimeout(timer);timer=0;pointer=null;if(holding){holding=false;anchor.classList.remove('voice-holding');suppressUntil=Date.now()+500;if(cancel)window.OpenSesameVoice.cancel();else window.OpenSesameVoice.stop()}}
  anchor.addEventListener('pointerdown',event=>{
    if(event.altKey||event.ctrlKey||event.metaKey||event.button!==0||!event.isPrimary||window.OpenSesameVoice.active||document.body.classList.contains('audio-active'))return;
    const target=event.target;if(!target.closest('#compact-widget')&&target.closest('button,a,input,textarea,select,[contenteditable],[role=slider],.frame-resize-edge,.voice-command-sheet,.widget-pane,.widget-capture-footer'))return;
    pointer={id:event.pointerId,x:event.clientX,y:event.clientY};timer=setTimeout(()=>{timer=0;holding=true;anchor.classList.add('voice-holding');talk(true)},450);
  });
  window.addEventListener('pointermove',event=>{if(pointer?.id===event.pointerId&&Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>12)reset(true)});
  window.addEventListener('pointerup',event=>{if(pointer?.id===event.pointerId)reset()});window.addEventListener('pointercancel',()=>reset(true));window.addEventListener('blur',()=>reset(true));
  anchor.addEventListener('click',event=>{if(Date.now()<suppressUntil){event.preventDefault();event.stopImmediatePropagation()}},true);
  anchor.addEventListener('contextmenu',event=>{if(holding)event.preventDefault()});
  document.addEventListener('keydown',event=>{if(event.altKey&&event.shiftKey&&event.code==='KeyV'&&!event.repeat){event.preventDefault();window.OpenSesameVoice.active?window.OpenSesameVoice.stop():talk()}else if(event.key==='Escape'&&!sheet.hidden&&!window.OpenSesameVoice.active){event.preventDefault();event.stopImmediatePropagation();close()}},true);
  window.addEventListener('open-sesame-view-changed',()=>{sheet.hidden=true});window.addEventListener('open-sesame-layout',()=>{if(!state.expanded){reset(true);sheet.hidden=true}});
  el('compact-widget').title='Click to open · hold to speak';window.OpenSesameVoiceCommand={open,startAudio};
})();
