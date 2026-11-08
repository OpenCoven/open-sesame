'use strict';
(()=>{
  const el=id=>document.getElementById(id),panel=el('widget-panel'),pane=el('pane-focus'),footer=panel.querySelector('.widget-capture-footer'),trigger=el('focus-duration-open');
  const dialog=document.createElement('section');dialog.id='focus-duration-dialog';dialog.className='focus-duration-dialog';dialog.hidden=true;dialog.setAttribute('role','dialog');dialog.setAttribute('aria-labelledby','focus-duration-title');
  dialog.innerHTML='<header><span><strong id="focus-duration-title">Make time for it.</strong><small>Choose your focus window</small></span><button type="button" id="focus-duration-close" aria-label="Close duration picker">'+icon('close')+'</button></header><div class="focus-duration-presets" role="group" aria-label="Session duration presets">'+[15,25,30,45,60,90].map(n=>'<button type="button" data-duration="'+n+'" aria-pressed="false">'+n+'<small>min</small></button>').join('')+'</div><form id="focus-duration-form"><div class="focus-custom-field"><label for="focus-duration-custom">Custom</label><button type="button" data-duration-step="-5" aria-label="Decrease duration by five minutes">−</button><input id="focus-duration-custom" type="number" min="15" max="1440" step="1" required aria-label="Custom session minutes"><span>min</span><button type="button" data-duration-step="5" aria-label="Increase duration by five minutes">'+icon('plus')+'</button></div><button type="submit">Apply</button></form><p id="focus-duration-summary" role="status"></p><small id="focus-duration-note"></small>';
  panel.append(dialog);
  const custom=el('focus-duration-custom');let returnTo=trigger;
  function preview(){
    const minutes=Number(custom.value),valid=OpenSesameFocusCalendarModel.validDuration(minutes),cap=topicLimit(minutes),fits=focusTopics.length<=cap;
    el('focus-duration-form').querySelector('[type=submit]').disabled=!valid||!fits||focusRunning;
    el('focus-duration-summary').textContent=!valid?'Choose 15–1440 whole minutes.':!fits?'This duration fits '+cap+' topics. Your plan has '+focusTopics.length+'.':minutes+' min across '+focusTopics.length+' '+(focusTopics.length===1?'topic':'topics')+' · Ends '+new Date(Date.now()+minutes*60000).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})+' if started now';
    el('focus-duration-note').textContent=focusRemaining<focusMinutes*60?'Changing duration restarts the timer and keeps your topics.':'Topic times adjust to fit your session.';
  }
  function close(restore=true){dialog.hidden=true;trigger.setAttribute('aria-expanded','false');if(restore)returnTo?.focus({preventScroll:true})}
  function open(from=trigger){if(focusRunning){toast('Pause your timer to adjust its duration.');return}returnTo=from;custom.value=focusMinutes;dialog.hidden=false;trigger.setAttribute('aria-expanded','true');sync();preview();(dialog.querySelector('[aria-pressed="true"]')||custom).focus({preventScroll:true})}
  function apply(minutes){if(setFocusDuration(minutes)){close();}else preview()}
  trigger.addEventListener('click',()=>dialog.hidden?open():close());el('focus-duration-close').addEventListener('click',()=>close());
  dialog.querySelectorAll('[data-duration]').forEach(button=>button.addEventListener('click',()=>apply(Number(button.dataset.duration))));
  dialog.querySelectorAll('[data-duration-step]').forEach(button=>button.addEventListener('click',()=>{custom.value=Math.max(15,Math.min(1440,(Number(custom.value)||focusMinutes)+Number(button.dataset.durationStep)));preview()}));
  custom.addEventListener('input',preview);el('focus-duration-form').addEventListener('submit',event=>{event.preventDefault();if(custom.checkValidity())apply(Number(custom.value))});
  document.addEventListener('pointerdown',event=>{if(!dialog.hidden&&!dialog.contains(event.target)&&!trigger.contains(event.target))close(false)});
  document.addEventListener('keydown',event=>{if(dialog.hidden)return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close()}else if(event.key==='Tab'){const buttons=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled)')],first=buttons[0],last=buttons.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}},true);

  // An agenda-specific composer occupies the same footer; general capture drafts stay intact.
  const form=document.createElement('form');form.id='agenda-capture-form';form.hidden=true;
  form.innerHTML='<div class="capture-input-wrap agenda-input-wrap"><span class="agenda-task-token" aria-label="Agenda task command">/task</span><label class="sr-only" for="agenda-capture-input">New agenda task</label><input id="agenda-capture-input" type="text" maxlength="66" placeholder="What’s next?" autocomplete="off" aria-describedby="agenda-capture-hint"><label class="agenda-minutes-field" title="Minutes for this topic"><input id="agenda-capture-minutes" type="number" min="0.1" step="0.1" value="5" required aria-label="New agenda task minutes"><span>min</span></label><button type="button" id="agenda-capture-voice" aria-label="Dictate agenda task" title="Dictate task">'+icon('mic')+'</button><button type="submit" id="agenda-capture-add" aria-label="Add task to agenda" title="Add task to agenda · Enter">'+icon('plus')+'</button></div><span id="agenda-capture-hint" class="sr-only" role="status">Append a topic to this agenda. Its minutes share the session duration.</span>';
  el('capture-form').after(form);
  const input=el('agenda-capture-input'),minutes=el('agenda-capture-minutes'),hint=el('agenda-capture-hint');
  el('topic-form').hidden=true;
  const taskName=()=>input.value.replace(/^\s*\/task(?:\s+|$)/i,'').trim();
  function composerSync(){
    const active=state.scenario==='focus'&&!state.focusOverview&&pane.dataset.focusView!=='calendar'&&!document.body.classList.contains('capture-launcher-open')&&!footer.classList.contains('capture-full');
    form.hidden=!active;footer.classList.toggle('agenda-composer-active',active);
    const capped=focusTopics.length>=topicLimit(),locked=focusRunning||capped;
    input.disabled=locked;minutes.disabled=locked;el('agenda-capture-voice').disabled=locked;
    input.placeholder=focusRunning?'Pause to add a task':capped?'Extend the session to add more tasks':'What’s next?';
    minutes.max=String(Math.floor((focusMinutes-(focusTopics.length/60))*10)/10);
    const name=taskName();el('agenda-capture-add').disabled=locked||!name||name.length>60||!minutes.validity.valid;
    hint.textContent=locked?input.placeholder:'Append a topic to this agenda. Its minutes share the session duration.';
  }
  input.addEventListener('input',composerSync);minutes.addEventListener('input',composerSync);
  form.addEventListener('submit',event=>{event.preventDefault();composerSync();if(el('agenda-capture-add').disabled)return;const name=taskName();if(name.startsWith('/')){toast('This input adds agenda tasks. Use /task followed by a title.');return}const count=focusTopics.length;el('topic-name').value=name;el('topic-minutes').value=minutes.value;el('topic-form').requestSubmit();if(focusTopics.length>count){input.value='';composerSync();hint.textContent='Added '+name+' to your agenda.';input.focus({preventScroll:true});requestAnimationFrame(fitFocusTopics)}});
  el('agenda-capture-voice').addEventListener('click',()=>window.OpenSesameVoice?.start({target:input,button:el('agenda-capture-voice'),onCommit:composerSync}));
  function sync(){
    el('focus-duration-value').textContent=focusMinutes+' min';trigger.setAttribute('aria-label','Adjust focus duration: '+focusMinutes+' minutes, '+focusTopics.length+' topics');trigger.disabled=focusRunning;more.disabled=focusRunning;
    dialog.querySelectorAll('[data-duration]').forEach(button=>{const n=Number(button.dataset.duration);button.setAttribute('aria-pressed',String(n===focusMinutes));button.disabled=focusRunning||focusTopics.length>topicLimit(n);button.title=button.disabled?'This duration supports '+topicLimit(n)+' topics':n+' minute session'});
    if(focusRunning&&!dialog.hidden)close(false);composerSync();
  }
  const viewChanged=()=>{close(false);sync()};
  window.addEventListener('open-sesame-view-changed',viewChanged);window.addEventListener('open-sesame-layout',sync);
  new MutationObserver(()=>{sync();if(pane.dataset.focusView==='calendar')close(false)}).observe(pane,{attributes:true,attributeFilter:['data-focus-view']});
  new MutationObserver(composerSync).observe(document.body,{attributes:true,attributeFilter:['class']});
  window.OpenSesameFocusControls={sync,open};sync();
})();
