'use strict';
(()=>{
  const el=id=>document.getElementById(id),controls=el('compact-media-controls');let busy=false;
  function target(){
    const candidates=[[window.OpenSesameMusic,window.OpenSesameMusic?.service],[window.OpenSesameYouTube,'youtube'],[window.OpenSesameLocalMedia,'local-media']].filter(([p,id])=>typeof p?.snapshot==='function'&&window.OpenSesameWidgetLifecycle?.isActive(id)!==false).map(([p])=>p);
    return candidates.find(p=>p.snapshot().playing)||candidates.find(p=>p.snapshot().loaded)||null;
  }
  function geometry(){const capturing=typeof audioSession!=='undefined'&&(audioSession.active||audioSession.starting||audioSession.stopping),active=!capturing&&state.layout==='notch'&&(target()?.snapshot().loaded||['music','youtube','media'].includes(state.scenario)),ratio=Number(state.ratio)||8,width=Math.max(Number(state.width)||280,active?Math.max(360,72*ratio):0);return {width:Math.round(width),height:Math.round(width/ratio)}}

  const volume=window.OpenSesameVolume?.attach(el('compact-media-volume'),target,'Playback');let previousGeometry='';
  function sync(){
    const provider=target(),media=provider?.snapshot()||{},capturing=typeof audioSession!=='undefined'&&(audioSession.active||audioSession.starting||audioSession.stopping),visible=!capturing&&!state.expanded&&state.layout==='notch'&&(media.loaded||['music','youtube','media'].includes(state.scenario));
    controls.hidden=!visible;el('compact-media-volume').hidden=!visible;const anchor=el('widget-anchor');anchor.classList.toggle('has-compact-media',visible);
    const size=geometry(),key=size.width+'x'+size.height;anchor.style.setProperty('--notch-width',size.width+'px');anchor.style.setProperty('--notch-height',size.height+'px');
    el('dimension-note').textContent='Compact footprint · '+size.width+' × '+size.height+' px';
    if(!state.expanded&&state.layout==='notch')el('footprint').textContent=size.width+' × '+size.height+' px';
    if(key!==previousGeometry){previousGeometry=key;if(window.__OPEN_SESAME_NATIVE__&&!state.expanded)syncNativeWindow()}
    if(!visible){window.OpenSesameCompactIndicators?.sync(media);return;}volume?.sync();
    const label=state.scenario==='focus'?time(focusRemaining):media.title||window.OpenSesameMusic?.summary()||'Music';
    const left=el('compact-left');left.innerHTML=icon(state.scenario==='focus'?'focus':'music');const title=document.createElement('span');title.className='compact-song';title.textContent=label;left.append(title);el('compact-widget').title=label+' · Open player';
    const play=el('compact-media-play');play.innerHTML=icon(media.playing?'pause':'play');play.disabled=!media.ready||busy;play.setAttribute('aria-label',media.playing?'Pause playback':'Play');play.title=media.ready?(media.playing?'Pause':'Play'):(media.reason||'Load music to enable playback');
    for(const action of ['previous','next']){const button=el('compact-media-'+action);button.hidden=!media[action];button.disabled=busy||!media.ready}
    const width=30+(media.previous?32:0)+(media.next?32:0)+28;el('widget-anchor').style.setProperty('--compact-actions-width',width+'px');window.OpenSesameCompactIndicators?.sync(media);
  }
  for(const action of ['previous','play','next'])el('compact-media-'+action).addEventListener('click',async event=>{
    event.stopPropagation();const provider=target();if(!provider||busy)return;busy=true;sync();
    try{await provider.control(action==='play'?'toggle':action)}catch(error){toast(error.message||'Playback is unavailable. Try again in the player.')}finally{busy=false;sync()}
  });
  controls.addEventListener('pointerenter',()=>clearTimeout(hoverTimer));controls.addEventListener('focusin',()=>clearTimeout(hoverTimer));
  window.addEventListener('open-sesame-layout',sync);window.addEventListener('open-sesame-view-changed',sync);
  // Providers can change playback from their own embed or the system controls.
  setInterval(()=>{if(!state.expanded)sync()},700);
  window.OpenSesameCompact={sync,geometry};sync();
})();
