'use strict';
(()=>{
  if(!window.__OPEN_SESAME_NATIVE__)return;
  const menu=document.getElementById('widget-options'),button=document.createElement('button'),label=document.createElement('span');
  button.id='widget-display';button.type='button';button.setAttribute('role','menuitem');button.tabIndex=-1;button.innerHTML=icon('monitor');button.append(label);menu.insertBefore(button,document.getElementById('widget-pin').nextSibling);
  let pending=false;
  function paint(status){button.disabled=false;label.textContent=status.pinned?'Display · '+(status.name||'Pinned display')+(status.available?'':' (unavailable)'):'Display · Follow pointer';button.title=status.detached?'Display choice applies when the widget is docked':status.pinned&&!status.available?'Following the pointer until your pinned display reconnects':'Choose a screen for the docked widget';button.setAttribute('aria-label',label.textContent);button.setAttribute('aria-haspopup','menu')}
  async function refresh(){try{paint(await openSesameBridge.request('window.display.status'))}catch{label.textContent='Display controls unavailable';button.disabled=true}}
  button.addEventListener('click',async()=>{if(pending)return;pending=true;menu.hidden=true;document.getElementById('widget-options-toggle').setAttribute('aria-expanded','false');try{await openSesameBridge.request('window.display.choose')}catch{toast('Could not open display controls.')}finally{pending=false}});
  window.addEventListener('open-sesame-desktop-event',event=>{if(event.detail?.event==='window.display.changed')paint(event.detail.status)});
  paint({pinned:false,available:true});openSesameBridge.ready.then(refresh);
})();
