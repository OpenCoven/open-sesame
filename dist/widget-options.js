'use strict';
(()=>{
  const el=id=>document.getElementById(id),panel=el('widget-panel'),header=panel.querySelector('.panel-top');
  const toggle=document.createElement('button');toggle.id='widget-options-toggle';toggle.type='button';toggle.setAttribute('aria-label','Widget options');toggle.setAttribute('aria-haspopup','menu');toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls','widget-options');toggle.title='Widget options';toggle.innerHTML=icon('more');header.append(toggle);
  const menu=document.createElement('div');menu.id='widget-options';menu.hidden=true;menu.setAttribute('role','menu');menu.setAttribute('aria-label','Widget options');panel.append(menu);
  const labels={'widget-voice-open':'Speak to Open Sesame','capture-launcher-open':'Open launcher','panel-privacy':'Screen-share privacy'};
  for(const id of ['widget-voice-open','capture-launcher-open','panel-popout','panel-fullscreen','panel-privacy']){
    const button=el(id),label=document.createElement('span');button.setAttribute('role','menuitem');button.tabIndex=-1;button.append(label);menu.append(button);
    const syncLabel=()=>{label.textContent=labels[id]||button.getAttribute('aria-label')};syncLabel();new MutationObserver(syncLabel).observe(button,{attributes:true,attributeFilter:['aria-label']});
    button.addEventListener('click',()=>close(false));
  }
  const pin=document.createElement('button');pin.id='widget-pin';pin.type='button';pin.setAttribute('role','menuitemcheckbox');pin.tabIndex=-1;pin.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 3 5 5-4 1-4 4v4l-2 2-6-6 2-2h4l4-4 1-4ZM5 19l-2 2"/></svg><span>Pin open</span><i>'+icon('check')+'</i>';menu.prepend(pin);
  el('panel-close').hidden=true;
  function sync(){pin.setAttribute('aria-checked',String(state.pinned===true));toggle.classList.toggle('is-pinned',state.pinned===true);toggle.title=state.pinned?'Widget options · pinned open':'Widget options';if(!state.expanded)close(false)}
  function close(restore=true){menu.hidden=true;toggle.setAttribute('aria-expanded','false');if(restore)toggle.focus({preventScroll:true})}
  function open(){menu.hidden=false;toggle.setAttribute('aria-expanded','true');pin.focus({preventScroll:true})}
  toggle.addEventListener('click',()=>menu.hidden?open():close());
  pin.addEventListener('click',()=>{state.pinned=!state.pinned;persist();sync();close();toast(state.pinned?'Widget pinned open.':'Widget closes when you click outside.');});
  document.addEventListener('pointerdown',event=>{if(!menu.hidden&&!menu.contains(event.target)&&!toggle.contains(event.target))close(false)});
  document.addEventListener('keydown',event=>{
    if(menu.hidden)return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();return}
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const nodes=[...menu.querySelectorAll('button:not(:disabled)')],index=nodes.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?nodes.length-1:(index+(event.key==='ArrowDown'?1:-1)+nodes.length)%nodes.length;nodes[next].focus()}
    if(event.key==='Tab')close(false);
  },true);
  window.addEventListener('open-sesame-layout',sync);window.addEventListener('open-sesame-view-changed',()=>close(false));sync();
})();
