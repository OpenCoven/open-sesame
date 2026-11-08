'use strict';
(()=>{
  const el=id=>document.getElementById(id),dialog=el('share-privacy'),native=window.__OPEN_SESAME_NATIVE__===true;
  let status={available:false,active:false,starting:false,windowOpen:false,displays:[],revision:-1,error:''},action='',serial=0;
  const bridge=()=>window.openSesameBridge;
  function apply(value){if(!value||!Number.isSafeInteger(value.revision)||value.revision<status.revision)return;status={...value,displays:Array.isArray(value.displays)?value.displays:[]};paint()}
  function paint(){
    const running=status.active||status.starting;
    el('share-privacy-native').hidden=!native;el('share-privacy-browser').hidden=native;
    el('share-privacy-state').textContent=!native?'Available in the installed Mac app':status.active?'Share window ready · choose it in Meet':status.starting||action==='start'?'Preparing your share window…':status.available?'Ready when you are':'Checking desktop connection…';
    el('share-privacy-status').dataset.active=String(status.active===true);
    el('share-privacy-error').textContent=status.error||'';el('share-privacy-error').hidden=!status.error;
    const select=el('share-privacy-display'),selected=running&&status.displayID!=null?String(status.displayID):select.value||(status.preferredDisplayID!=null?String(status.preferredDisplayID):'');
    select.replaceChildren(...status.displays.map(display=>{const option=document.createElement('option');option.value=String(display.id);option.textContent=`${display.name} · ${display.width} × ${display.height}`;return option}));
    if(status.displays.some(display=>String(display.id)===selected))select.value=selected;
    select.disabled=running||Boolean(action);
    el('share-privacy-start').hidden=running||action==='start';el('share-privacy-start').disabled=!status.available||!status.displays.length||Boolean(action);
    el('share-privacy-stop').hidden=!running&&action!=='start';el('share-privacy-stop').disabled=action==='stop';el('share-privacy-stop').textContent=status.active?'Stop share window':'Cancel preparation';
    el('share-privacy-show').hidden=!status.windowOpen;el('share-privacy-show').disabled=Boolean(action);
    for(const id of ['privacy-hide','panel-privacy']){const button=el(id);button.setAttribute('aria-pressed',String(status.active===true));button.title=status.active?'Protected Share window ready · share that window in Meet':'Screen-share privacy · Option Shift P'}
  }
  async function refresh(){if(!native)return;try{apply(await bridge().request('privacy.status'))}catch{status={...status,available:false,active:false,starting:false,windowOpen:false,error:'Desktop privacy controls are unavailable. Reopen the app before sharing.'};paint()}}
  async function run(method){
    const ticket=++serial;action=method==='privacy.start'?'start':method==='privacy.stop'?'stop':'show';status.error='';paint();
    try{const result=await bridge().request(method,method==='privacy.start'?{displayID:Number(el('share-privacy-display').value)}:{});if(ticket===serial)apply(result)}
    catch(error){if(ticket===serial){status={...status,error:error.message||'The share window could not be prepared.'};if(method==='privacy.start')status.active=false}}
    finally{if(ticket===serial){action='';paint();if(method!=='privacy.show')refresh()}}
  }
  function show(){const guide=el('guide');if(guide.open)guide.close();if(native&&typeof setExpanded==='function')setExpanded(true,{focus:false});if(!dialog.open)dialog.showModal();window.OpenSesameNativeSurfaces?.sync();refresh()}
  dialog.addEventListener('close',()=>window.OpenSesameNativeSurfaces?.sync());
  ['privacy-hide','panel-privacy'].forEach(id=>el(id).addEventListener('click',show));
  ['share-privacy-close','share-privacy-done'].forEach(id=>el(id).addEventListener('click',()=>dialog.close()));
  el('share-privacy-start').addEventListener('click',()=>run('privacy.start'));el('share-privacy-stop').addEventListener('click',()=>run('privacy.stop'));el('share-privacy-show').addEventListener('click',()=>run('privacy.show'));
  document.addEventListener('keydown',event=>{if(event.altKey&&event.shiftKey&&event.code==='KeyP'){event.preventDefault();dialog.open?dialog.close():show()}});
  window.addEventListener('open-sesame-desktop-event',event=>{if(event.detail?.event==='privacy.changed')apply(event.detail.status)});
  window.addEventListener('open-sesame-desktop-disconnected',()=>{serial++;action='';status={...status,available:false,active:false,starting:false,windowOpen:false,error:'Desktop connection closed. Do not share an entire screen.'};paint()});
  paint();
  if(native)bridge()?.ready.then(refresh);
})();
