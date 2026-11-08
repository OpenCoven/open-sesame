'use strict';
(()=>{
  const el=id=>document.getElementById(id),panel=el('widget-panel'),projects=el('projects-overview');
  // The capture setup moves this single Start/Stop group beside its source controls.
  const controls=document.createElement('span');controls.id='live-input-controls';controls.setAttribute('role','group');controls.setAttribute('aria-label','Session recording');controls.append(el('audio-start'),el('audio-stop'));el('capture-voice').after(controls);
  el('audio-start').innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="9"/></svg>';
  const bar=panel.querySelector('.live-bar');bar.querySelector('.live-workspace-title').remove();bar.prepend(panel.querySelector('.live-status'));bar.append(el('live-sample'));el('pane-audio').prepend(bar);
  const station=el('live-station');station.append(el('audio-meter'));station.hidden=true;
  panel.querySelector('.live-status').prepend(el('audio-live-dot'));
  el('audio-meter').setAttribute('aria-hidden','true');
  for(const [id,label,glyph] of [['transcript-note','Save note','capture'],['transcript-copy','Copy','copy'],['transcript-download','Export .txt','download'],['audio-download','Audio','download'],['transcript-clear','Clear','trash']]){const action=el(id);action.innerHTML=icon(glyph)+'<span>'+label+'</span>';action.setAttribute('aria-label',label);action.title=label}
  let frame=0;
  const set=(node,key,value)=>{if(node.dataset[key]!==value)node.dataset[key]=value};
  function fit(){
    frame=0;
    set(panel,'short',panel.clientHeight<430?'true':'false');
    const live=state.scenario==='audio'&&!window.OpenSesameLauncher?.active;
    bar.hidden=controls.hidden=!live;panel.classList.remove('live-input-active');
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
  const observer=new ResizeObserver(schedule);[panel,projects].filter(Boolean).forEach(node=>observer.observe(node));
  if(projects)new MutationObserver(schedule).observe(projects,{childList:true,subtree:true});
  for(const event of ['open-sesame-layout','open-sesame-view-changed'])window.addEventListener(event,schedule);
  fit();
})();
