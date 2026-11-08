'use strict';
(()=>{
  const el=id=>document.getElementById(id),footer=document.querySelector('.widget-capture-footer');
  let active=false,previous=null,lastGeometry='';
  const bar=document.createElement('div');bar.id='launcher-statusbar';bar.hidden=true;bar.innerHTML='<span class="launcher-brand">Open Sesame</span><span class="launcher-keys"><kbd>↑</kbd><kbd>↓</kbd> navigate</span><button id="launcher-primary" type="button">Open <kbd>↵</kbd></button><button id="launcher-return" type="button">Full widget <span aria-hidden="true">↗</span></button>';footer.append(bar);
  function nativeFrame(){const [width,height]=frameScreen();return {width:Math.max(1,Math.min(760,width-24)),height:Math.max(1,Math.min(500,height-64))}}
  function actions(){
    const field=el('capture-input'),intent=window.openSesameCapture?.interpret?.(field.value,el('capture-type').value),calculation=el('capture-commands').hidden&&intent?.kind==='calculation'?intent.calculation:null,selected=field.getAttribute('aria-activedescendant'),option=!el('capture-commands').hidden&&selected?el(selected):null;
    const label=calculation?(calculation.error?'Finish calculation':'Copy result'):option?(option.dataset.actionLabel||'Open'):intent?.label||(intent?.kind==='error'?'Review command':'Save note');
    el('launcher-primary').textContent=label+' ↵';el('launcher-primary').disabled=!!calculation?.error||!option&&(!!intent?.incomplete||intent?.kind==='error'||!field.value.trim());
  }
  function sync(){
    if(!active)return;
    if(!state.expanded){close(false);return}
    el('frame-resize-layer').hidden=true;if(!window.__OPEN_SESAME_NATIVE__)fit();
    el('capture-input').placeholder='Search commands, calculate, or capture a thought…';actions();
    if(window.__OPEN_SESAME_NATIVE__){const size=nativeFrame(),key=size.width+'x'+size.height;if(key!==lastGeometry){lastGeometry=key;syncNativeWindow()}}
  }
  function open(){
    if(active){el('capture-input').focus({preventScroll:true});return;}
    previous={expanded:state.expanded,size:state.size,type:el('capture-type').value,placeholder:el('capture-input').placeholder,label:el('capture-input').getAttribute('aria-label')};
    window.OpenSesameComposer?.fullscreen(false);window.openSesameCapture?.hide();
    active=true;document.body.classList.add('capture-launcher-open');
    state.expanded=true;if(state.size==='full')state.size='medium';el('capture-type').value='auto';
    bar.hidden=false;el('capture-launcher-exit').hidden=false;render();renderDraft();sync();footer.setAttribute('role','dialog');footer.setAttribute('aria-modal','true');footer.setAttribute('aria-label','Open Sesame command palette');el('capture-input').setAttribute('aria-label','Search Open Sesame commands');window.openSesameCapture?.refresh();el('capture-input').focus({preventScroll:true});
  }
  function close(expand=previous?.expanded){
    if(!active)return;
    window.openSesameCapture?.hide();active=false;lastGeometry='';document.body.classList.remove('capture-launcher-open');
    bar.hidden=true;el('capture-launcher-exit').hidden=true;footer.removeAttribute('role');footer.removeAttribute('aria-modal');footer.setAttribute('aria-label','Quick capture');
    if(previous){state.size=previous.size;el('capture-type').value=previous.type;el('capture-input').placeholder=previous.placeholder;if(previous.label)el('capture-input').setAttribute('aria-label',previous.label);else el('capture-input').removeAttribute('aria-label')}
    state.expanded=!!expand;previous=null;render();renderDraft();
    if(state.expanded)el('capture-input').focus({preventScroll:true});
  }
  function toggle(){active?close():open()}
  el('capture-launcher-open').addEventListener('click',open);
  el('capture-launcher-exit').addEventListener('click',()=>close(true));
  el('launcher-return').addEventListener('click',()=>close(true));
  el('launcher-primary').addEventListener('click',()=>{if(!el('capture-commands').hidden&&window.openSesameCapture?.choose?.())return;el('capture-form').requestSubmit()});
  el('capture-input').addEventListener('input',()=>{if(active)requestAnimationFrame(actions)});
  document.addEventListener('keydown',event=>{
    if(window.OpenSesameTools?.active)return;
    if(event.code==='Space'&&event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.repeat){event.preventDefault();event.stopImmediatePropagation();if(!window.__OPEN_SESAME_GLOBAL_SHORTCUT__)toggle();return}
    if(active&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();if(!window.openSesameCapture?.back?.())close()}
  },true);
  window.addEventListener('open-sesame-view-changed',()=>{if(active)close(true)});
  window.addEventListener('open-sesame-layout',sync);
  new ResizeObserver(sync).observe(footer);
  new MutationObserver(sync).observe(el('capture-commands'),{attributes:true,childList:true,subtree:true,attributeFilter:['hidden','aria-selected']});
  window.OpenSesameLauncher={open,close,toggle,sync,nativeFrame,get active(){return active}};
})();
