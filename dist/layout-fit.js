'use strict';
(()=>{
  const el=id=>document.getElementById(id),panel=el('widget-panel'),home=el('focus-overview'),projects=el('projects-overview');
  // Keep recording on the input, and session metadata in the existing top toolbar.
  const controls=document.createElement('span');controls.id='live-input-controls';controls.setAttribute('role','group');controls.setAttribute('aria-label','Session recording');controls.append(el('audio-start'),el('audio-stop'));el('capture-voice').after(controls);
  el('audio-start').innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="9"/></svg>';
  const bar=panel.querySelector('.live-bar');bar.querySelector('.live-workspace-title').remove();bar.prepend(panel.querySelector('.live-status'));bar.append(el('live-sample'));el('pane-audio').prepend(bar);
  const station=el('live-station');station.append(el('audio-meter'));station.hidden=true;
  panel.querySelector('.live-status').prepend(el('audio-live-dot'));
  el('audio-meter').setAttribute('aria-hidden','true');
  for(const [id,label,glyph] of [['transcript-note','Save note','capture'],['transcript-copy','Copy','copy'],['transcript-download','Export .txt','download'],['audio-download','Audio','download'],['transcript-clear','Clear','trash']]){const action=el(id);action.innerHTML=icon(glyph)+'<span>'+label+'</span>';action.setAttribute('aria-label',label);action.title=label}
  // Agenda entry and calendar scheduling use a small overlay, leaving the bento intact.
  const topicForm=el('bento-topic-form'),topicSheet=document.createElement('section');topicSheet.id='bento-topic-sheet';topicSheet.hidden=true;topicSheet.setAttribute('role','dialog');topicSheet.setAttribute('aria-label','New agenda topic');topicSheet.innerHTML='<header><strong>New agenda topic</strong><button type="button" aria-label="Close new topic">'+icon('close')+'</button></header>';topicSheet.append(topicForm,el('bento-topic-help'));panel.append(topicSheet,el('bento-event-form'));
  el('bento-event-form').setAttribute('role','dialog');el('bento-event-form').setAttribute('aria-label','Schedule focus session');
  const closeTopic=()=>{topicSheet.hidden=true;el('bento-agenda-new').focus({preventScroll:true})};
  topicSheet.querySelector('header button').addEventListener('click',closeTopic);
  el('bento-agenda-new').addEventListener('click',()=>{topicSheet.hidden=false;el('bento-topic-name').focus({preventScroll:true})});
  topicForm.addEventListener('submit',()=>{if(!el('bento-topic-name').value)closeTopic()});
  el('bento-agenda-open').addEventListener('click',()=>{changeScenario('focus');window.OpenSesameFocusCalendar.choose('agenda')});
  el('bento-calendar-heading').addEventListener('click',()=>el('bento-calendar-open').click());
  document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;if(!topicSheet.hidden){event.preventDefault();closeTopic()}if(!el('bento-event-form').hidden){event.preventDefault();el('bento-event-cancel').click()}});
  let frame=0;
  const set=(node,key,value)=>{if(node.dataset[key]!==value)node.dataset[key]=value};
  function fit(){
    frame=0;
    set(panel,'short',panel.clientHeight<430?'true':'false');
    const live=state.scenario==='audio'&&!window.OpenSesameLauncher?.active;
    bar.hidden=controls.hidden=!live;panel.classList.toggle('live-input-active',live);
    if(!home.hidden){
      const w=home.clientWidth,h=home.clientHeight;
      set(home,'layout',w>=720&&h>=300?'wide':w>=1000&&h<300?'strip':'quad');
      home.querySelectorAll('.focus-tile').forEach(card=>set(card,'density',card.clientHeight<170?'tight':card.clientHeight<270?'compact':'roomy'));
    }
    if(projects&&!projects.hidden){
      projects.querySelectorAll('.project-tile').forEach(card=>{
        set(card,'density',card.clientHeight<175?'tight':card.clientHeight<260?'compact':'roomy');
        const list=card.querySelector('.project-preview-list'),rows=[...list.querySelectorAll('.project-preview-item')];
        const height=card.dataset.density==='tight'?28:44,capacity=Math.max(1,Math.floor((list.clientHeight+5)/(height+5)));
        rows.forEach((row,i)=>row.hidden=i>=capacity);
      });
    }
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(fit)}
  const observer=new ResizeObserver(schedule);[panel,home,projects].filter(Boolean).forEach(node=>observer.observe(node));
  new MutationObserver(schedule).observe(projects,{childList:true,subtree:true});
  for(const event of ['open-sesame-layout','open-sesame-view-changed'])window.addEventListener(event,schedule);
  window.addEventListener('open-sesame-view-changed',()=>{topicSheet.hidden=true;el('bento-event-form').hidden=true});
  fit();
})();
