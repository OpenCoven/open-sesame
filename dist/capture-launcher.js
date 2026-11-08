'use strict';
(()=>{
  const el=id=>document.getElementById(id),footer=document.querySelector('.widget-capture-footer');
  let active=false,previous=null,lastGeometry='';
  function nativeFrame(){const menu=el('capture-commands'),input=document.querySelector('.capture-input-wrap'),content=Math.max(56,input?.scrollHeight||56)+(menu.hidden?0:Math.min(440,menu.scrollHeight||0));return {width:Math.min(720,frameScreen()[0]-32),height:Math.min(frameScreen()[1]-80,Math.ceil(content)+18)}}
  function sync(){
    if(!active)return;
    if(!state.expanded){close(false);return}
    el('frame-resize-layer').hidden=true;if(!window.__OPEN_SESAME_NATIVE__)fit();
    if(window.__OPEN_SESAME_NATIVE__){const size=nativeFrame(),key=size.width+'x'+size.height;if(key!==lastGeometry){lastGeometry=key;syncNativeWindow()}}
  }
  function open(){
    if(active){el('capture-input').focus({preventScroll:true});return;}
    previous={expanded:state.expanded,size:state.size,type:el('capture-type').value};
    window.OpenSesameComposer?.fullscreen(false);window.openSesameCapture?.hide();
    active=true;document.body.classList.add('capture-launcher-open');
    state.expanded=true;if(state.size==='full')state.size='medium';el('capture-type').value='auto';
    el('capture-launcher-exit').hidden=false;render();renderDraft();sync();footer.setAttribute('role','dialog');footer.setAttribute('aria-label','Open Sesame launcher');window.openSesameCapture?.openMenu();el('capture-input').focus({preventScroll:true});
  }
  function close(expand=previous?.expanded){
    if(!active)return;
    window.openSesameCapture?.hide();active=false;lastGeometry='';document.body.classList.remove('capture-launcher-open');
    el('capture-launcher-exit').hidden=true;footer.removeAttribute('role');footer.setAttribute('aria-label','Quick capture');
    if(previous){state.size=previous.size;el('capture-type').value=previous.type}
    state.expanded=!!expand;previous=null;render();renderDraft();
    if(state.expanded)el('capture-input').focus({preventScroll:true});
  }
  function toggle(){active?close():open()}
  el('capture-launcher-open').addEventListener('click',open);
  el('capture-launcher-exit').addEventListener('click',()=>close(true));
  document.addEventListener('keydown',event=>{
    if(event.code==='Space'&&event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.repeat){event.preventDefault();event.stopImmediatePropagation();if(!window.__OPEN_SESAME_GLOBAL_SHORTCUT__)toggle();return}
    if(active&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close()}
  },true);
  window.addEventListener('open-sesame-view-changed',()=>{if(active)close(true)});
  window.addEventListener('open-sesame-layout',sync);
  new ResizeObserver(sync).observe(footer);
  new MutationObserver(sync).observe(el('capture-commands'),{attributes:true,attributeFilter:['hidden']});
  window.OpenSesameLauncher={open,close,toggle,sync,nativeFrame,get active(){return active}};
})();
