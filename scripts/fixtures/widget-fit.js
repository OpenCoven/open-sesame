'use strict';
(async()=>{
  const frame=document.getElementById('viewport'),receipt=document.getElementById('receipt');let last={width:280,height:35},errors=[],screen={width:1280,height:800};
  function show(){receipt.textContent=JSON.stringify({lastNativeRequest:last,errors},null,2)}
  window.addEventListener('message',event=>{if(event.source!==frame.contentWindow)return;const value=event.data;if(value?.kind==='native-size'){last=value.params;frame.style.width=last.width+'px';frame.style.height=last.height+'px';show()}if(value?.kind==='fixture-error'){errors.push(value.message);show()}if(value?.kind==='fixture-layout'){receipt.textContent=JSON.stringify({lastNativeRequest:last,errors,layout:value.layout},null,2)}});
  const bootstrap=`<base href="${location.origin}/dist/"><script>
  window.__OPEN_SESAME_NATIVE__=true;window.__OPEN_SESAME_VERSION__='Fit fixture';window.__OPEN_SESAME_SCREEN__=${JSON.stringify(screen)};window.__OPEN_SESAME_GLOBAL_SHORTCUT__=false;
  window.addEventListener('error',e=>parent.postMessage({kind:'fixture-error',message:e.message+' '+(e.error?.stack||'')},'*'));
  window.addEventListener('unhandledrejection',e=>parent.postMessage({kind:'fixture-error',message:String(e.reason?.message||e.reason)+' '+(e.reason?.stack||'')},'*'));
  window.webkit={messageHandlers:{openSesame:{postMessage(message){let result=true;const m=message.method;if(m==='system.info')result={available:true,platform:'darwin'};else if(m==='window.size')parent.postMessage({kind:'native-size',params:message.params},'*');else if(m==='live.agents')result={claude:false,codex:false};else if(m==='agents.snapshot')result={agents:[],available:false};else if(m==='coven.status')result={available:false,error:'Isolated fixture: no providers.'};else if(m==='music.spotify.status')result={connected:false,clientId:'000d9575abe844d9a0c258ddc9c0bc09'};else if(m==='window.display.status')result={pinned:false,available:true,detached:false};else if(m==='privacy.status')result={active:false};queueMicrotask(()=>window.__openSesameReceive({requestId:message.requestId,result}));}}}};
  document.addEventListener('DOMContentLoaded',()=>{state.scenario='focus';state.lockinView='focus';state.expanded=false;state.size='small';render();});
  window.__fitCheck=action=>{if(!window.OpenSesameLauncher)return;
    if(action==='launcher')OpenSesameLauncher.open();
    if(action==='slash'||action==='math'){const input=document.getElementById('capture-input');input.value=action==='slash'?'/':'2-2';input.dispatchEvent(new Event('input',{bubbles:true}));}
    if(action==='focus')openSesameCapture.execute(openSesameCapture.interpret('/focus'));
    if(action==='live'){OpenSesameLauncher.close(true);changeScenario('audio');document.getElementById('live-questions-tab').click()}
    if(action==='collapse')OpenSesameWindow.collapse();
    if(action==='small'){window.__OPEN_SESAME_SCREEN__={width:390,height:320};window.dispatchEvent(new Event('open-sesame-display-changed'));}
    requestAnimationFrame(()=>requestAnimationFrame(()=>{const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};const commands=document.getElementById('capture-commands'),list=document.getElementById('capture-command-list');parent.postMessage({kind:'fixture-layout',layout:{anchor:rect('widget-anchor'),panel:rect('widget-panel'),input:rect('capture-input'),menu:rect('capture-commands'),footer:rect('launcher-statusbar'),calculationHidden:document.getElementById('capture-calculation').hidden,menuOverflow:getComputedStyle(commands).overflowY,listOverflow:getComputedStyle(list).overflowY,expanded:state.expanded,launcher:OpenSesameLauncher.active}},'*')}));
  };
  window.addEventListener('message',event=>{if(event.source===window.parent)window.__fitCheck(event.data?.check)});
  window.__fitReport=()=>{if(!window.OpenSesameLauncher)return;const ids=['widget-panel','capture-form','launcher-statusbar','capture-calculation'];const layout={};for(const id of ids){const node=document.getElementById(id),box=node.getBoundingClientRect(),css=getComputedStyle(node);layout[id]={y:box.y,height:box.height,display:css.display,flex:css.flex,heightCSS:css.height,minHeight:css.minHeight,maxHeight:css.maxHeight}};const node=document.querySelector('.widget-capture-footer'),box=node.getBoundingClientRect(),css=getComputedStyle(node);layout.footer={y:box.y,height:box.height,flex:css.flex,heightCSS:css.height,maxHeight:css.maxHeight};parent.postMessage({kind:'fixture-layout',layout},'*')};setInterval(window.__fitReport,500);
  <\/script>`;
  const html=await (await fetch('/dist/index.html',{cache:'no-store'})).text();frame.srcdoc=html.replace('<head>','<head>'+bootstrap);show();
  document.querySelectorAll('[data-check]').forEach(button=>button.addEventListener('click',()=>frame.contentWindow.__fitCheck?.(button.dataset.check)));
})();
