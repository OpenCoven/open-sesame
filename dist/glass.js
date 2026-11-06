'use strict';
(()=>{
  const anchor=document.getElementById('widget-anchor'),panel=document.getElementById('widget-panel');
  const surfaces='#widget-anchor,.widget-panel,.panel-top,.widget-pane,.lockin-workspace,.agents-workspace,.widget-capture-footer,.capture-list,.focus-pane,.focus-bottom,.reading-workspace,.reading-detail,.reading-rail,.terminal-workspace,.terminal-rail,.remote-workspace,.focus-calendar,.focus-calendar-grid,.focus-calendar-day,.coven-chat-surface,.coven-chat-log';
  const controls='button,a,input,textarea,select,iframe,video,audio,canvas,label,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="tab"],[role="dialog"],.frame-resize-layer,.xterm,.reading-article,.github-readme,.cm-preview,.bookmark-preview,.workspace-menu,.glass-popover,.glass-sheet';
  const reduced=window.matchMedia('(prefers-reduced-transparency: reduce)');
  const KEY='open-sesame-glass-v2',model=OpenSesameGlassModel;let saved={};try{saved=JSON.parse(localStorage.getItem(KEY)||'{}')||{}}catch{}
  let level=Number.isFinite(saved.level)?Math.max(0,Math.min(1,saved.level)):.13,direction=saved.direction===1?1:-1,press=null,delay=0,raf=0,lastNative=0;
  const sheen=document.createElement('div');sheen.className='glass-sheen';sheen.setAttribute('aria-hidden','true');anchor.prepend(sheen);
  panel.tabIndex=0;panel.setAttribute('aria-describedby','glass-instructions');
  const instructions=document.createElement('span');instructions.id='glass-instructions';instructions.className='sr-only';instructions.textContent='Hold an empty background area to speak. Alt-hold to cycle the glass transparency. Release to keep it. Hold again to reverse. With this panel focused, hold Space. Escape cancels.';panel.append(instructions);
  const value=document.createElement('output');value.className='glass-value';value.hidden=true;value.setAttribute('aria-hidden','true');anchor.append(value);
  function native(transient=false){if(window.__OPEN_SESAME_NATIVE__)window.openSesameBridge?.request('window.glass',{level,transient}).catch(()=>{})}
  function paint(){const material=model.material(reduced.matches?0:level);anchor.style.setProperty('--glass-opacity',String(material.opacity));anchor.style.setProperty('--glass-blur',material.blur+'px');value.textContent='Opacity '+Math.round(material.opacity*100)+'%'}
  function tick(now){if(!press?.held)return;const next=model.advance(level,direction,Math.min(64,Math.max(0,now-press.last))/1500);level=next.level;direction=next.direction;press.last=now;paint();if(now-lastNative>120){native(true);lastNative=now}raf=requestAnimationFrame(tick)}
  function finish(commit=false){
    if(!press)return;const previous=press;press=null;clearTimeout(delay);cancelAnimationFrame(raf);delay=raf=0;value.hidden=true;
    anchor.removeAttribute('data-glass-held');anchor.removeAttribute('data-glass-pressing');
    if(previous.held){if(commit){try{localStorage.setItem(KEY,JSON.stringify({level,direction}))}catch{toast('Glass changed for this session; device storage is full.')}}else{level=previous.level;direction=previous.direction}paint();native(false)}
    try{if(previous.id!==null&&anchor.hasPointerCapture(previous.id))anchor.releasePointerCapture(previous.id)}catch{}
  }
  function begin(id,x,y){
    if(press||!state.expanded||window.OpenSesameFrame?.dragging||reduced.matches)return false;
    const bounds=anchor.getBoundingClientRect();anchor.style.setProperty('--glass-x',Math.max(0,Math.min(100,(x-bounds.left)/bounds.width*100))+'%');anchor.style.setProperty('--glass-y',Math.max(0,Math.min(100,(y-bounds.top)/bounds.height*100))+'%');
    press={id,x,y,held:false,level,direction,context:state.layout+':'+state.size};anchor.setAttribute('data-glass-pressing','');
    if(id!==null)try{anchor.setPointerCapture(id)}catch{}
    delay=setTimeout(()=>{if(!press)return;press.held=true;direction=level>=.999?-1:level<=.001?1:-direction;press.last=performance.now();value.hidden=false;anchor.setAttribute('data-glass-held','');raf=requestAnimationFrame(tick)},320);return true;
  }
  anchor.addEventListener('pointerdown',event=>{
    if(press){if(event.pointerId!==press.id)finish();return}
    if(!event.altKey||event.button!==0||event.isPrimary===false||!event.target.matches?.(surfaces)||event.target.closest(controls)||window.getSelection()?.toString())return;
    if(begin(event.pointerId,event.clientX,event.clientY))event.preventDefault();
  });
  window.addEventListener('pointermove',event=>{if(press?.id===event.pointerId&&(event.buttons===0||Math.hypot(event.clientX-press.x,event.clientY-press.y)>8))finish()});
  for(const type of ['pointerup','pointercancel'])window.addEventListener(type,event=>{if(press?.id===event.pointerId)finish(type==='pointerup')});
  anchor.addEventListener('lostpointercapture',event=>{if(press?.id===event.pointerId)finish()});
  anchor.addEventListener('contextmenu',event=>{if(press){event.preventDefault();finish(false)}});
  panel.addEventListener('keydown',event=>{if(event.code==='Space'&&event.target===panel){event.preventDefault();if(!event.repeat){const r=anchor.getBoundingClientRect();begin(null,r.left+r.width/2,r.top)}}});
  window.addEventListener('keyup',event=>{if(event.code==='Space'&&press?.id===null){event.preventDefault();finish(true)}});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&press){event.preventDefault();event.stopImmediatePropagation();finish()}},true);
  for(const type of ['blur','pagehide','resize','open-sesame-view-changed'])window.addEventListener(type,()=>finish(false));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)finish()});
  document.addEventListener('focusin',event=>{if(press?.id===null&&event.target!==panel)finish()});
  window.addEventListener('open-sesame-layout',()=>{if(press&&(!state.expanded||window.OpenSesameFrame?.dragging||press.context!==state.layout+':'+state.size))finish()});
  reduced.addEventListener?.('change',()=>{finish(false);paint();native(false)});paint();native(false);
})();
