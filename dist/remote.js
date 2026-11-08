'use strict';
(()=>{
  const el=id=>document.getElementById(id),key='open-sesame-remote-machines-v1',form=el('remote-connect-form');
  function viewerUrl(raw){try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&u.origin!==location.origin?u.href:''}catch{return ''}}
  function fittedUrl(raw){const u=new URL(raw);if(/\/vnc(?:_lite)?\.html$/.test(u.pathname)){u.searchParams.set('resize','scale');u.searchParams.set('view_clip','false')}return u.href}
  function gatewayUrl(raw){try{const u=new URL(raw);return u.protocol==='wss:'&&!u.username&&!u.password?u.href:''}catch{return ''}}
  let saved={};try{saved=JSON.parse(localStorage.getItem(key)||'{}')||{}}catch{}
  let machines=Array.isArray(saved.machines)?saved.machines.filter(m=>m&&typeof m.id==='string'&&typeof m.name==='string').map(m=>({id:m.id,name:m.name.slice(0,40)||'Machine',network:['tailnet','local','other'].includes(m.network)?m.network:'tailnet',kind:['direct','gateway'].includes(m.kind)?m.kind:'viewer',host:typeof m.host==='string'?m.host:'',port:Number(m.port)||5900,url:m.kind==='gateway'?gatewayUrl(m.url):viewerUrl(m.url)})):[{id:newId(),name:'Mac mini',network:'tailnet',url:''}];
  let selected=machines.some(m=>m.id===saved.selected)?saved.selected:machines[0]?.id||'',returnFocus=null,draft=null,railPage=0,pendingRemove=null;
  const mounted=new Map(),current=()=>machines.find(m=>m.id===selected),save=()=>{try{localStorage.setItem(key,JSON.stringify({version:2,machines,selected}))}catch{toast('Remote machine settings could not be saved.')}};
  function syncViewerActions(){
    const frame=mounted.get(selected),url=current()?.url;
    form.querySelector('.remote-toolbar').hidden=!!draft||(!frame&&!url);
    el('remote-fullscreen').hidden=!frame;el('remote-disconnect').hidden=!frame;
    el('remote-external').hidden=!url;el('remote-external').href=url||'#';
  }
  function render(){
    window.OpenSesameRails?.apply('remote',{available:true,defaultOpen:true});renderMachineRail();syncViewerActions();
    el('remote-empty').hidden=mounted.has(selected);el('remote-status').textContent=mounted.get(selected)?.dataset.status||(mounted.has(selected)?'Viewer open':'Not connected');
    mounted.forEach((frame,id)=>{frame.hidden=id!==selected;frame.tabIndex=id===selected?0:-1});
    el('remote-server-suggestions').replaceChildren(...[...new Set(machines.map(m=>m.url).filter(Boolean))].map(url=>option(url,url)));save();
  }
  function settings(){
    returnFocus=document.activeElement;pendingRemove=null;
    if(!draft&&!current())draft={kind:'direct',id:newId(),name:'',network:'tailnet',url:''};
    const m=draft||current();el('remote-connect-title').textContent=draft?'New machine':'Desktop connection';
    el('remote-connect-subtitle').textContent=draft?'A desktop, within reach.':m.name;
    el('remote-connect-submit').innerHTML=(draft?'Add and open desktop':'Open desktop')+icon('arrow-up-right');
    el('remote-kind').value=m.kind||'viewer';el('remote-host').value=m.host||'';el('remote-port').value=m.port||5900;syncKind();
    el('remote-name').value=m.name;el('remote-network').value=m.network;syncNetwork();el('remote-url').value=m.url;
    el('remote-connect-error').hidden=true;el('remote-url').removeAttribute('aria-invalid');syncViewerActions();form.hidden=false;
    (draft&&!m.name?el('remote-name'):el('remote-url')).focus({preventScroll:true});
  }
  function close(){draft=null;form.hidden=true;const focus=returnFocus?.isConnected?returnFocus:el('remote-machine-'+selected)||el('remote-rail-add');focus?.focus({preventScroll:true})}
  window.addEventListener('open-sesame-home',e=>{if(e.detail==='remote'){draft=null;pendingRemove=null;form.hidden=true;render()}});
  window.addEventListener('open-sesame-view-changed',()=>{if(state.scenario!=='remote'){draft=null;pendingRemove=null;form.hidden=true}});
  ['remote-settings','remote-connect-open'].forEach(id=>el(id).addEventListener('click',()=>{draft=null;settings()}));
  el('remote-connect-cancel').addEventListener('click',close);
  el('remote-url').addEventListener('input',()=>{el('remote-connect-error').hidden=true;el('remote-url').removeAttribute('aria-invalid')});
  el('remote-new-machine-form').addEventListener('submit',e=>{e.preventDefault();e.stopPropagation();draft={kind:'direct',id:newId(),name:el('remote-new-machine-name').value.trim().slice(0,40),network:'tailnet',url:''};settings()});
  function syncNetwork(){
    const network=el('remote-network').value;document.querySelectorAll('[data-remote-network]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.remoteNetwork===network)));
    el('remote-url').placeholder={tailnet:'https://machine.tailnet.ts.net/vnc.html',local:'https://desktop.local/vnc.html',other:'https://your-viewer.example/vnc.html'}[network];
    el('remote-connection-help').textContent=(network==='local'?'Your browser must be on the same network. ':'Use a web VNC gateway such as noVNC. ')+'Sign in securely in your viewer.';
  }
  document.querySelectorAll('[data-remote-network]').forEach(b=>b.addEventListener('click',()=>{el('remote-network').value=b.dataset.remoteNetwork;syncNetwork()}));
  form.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close()}
    if(e.key==='Tab'){const nodes=[...form.querySelectorAll('button,input,select,textarea,a[href]')].filter(n=>!n.disabled&&n.getClientRects().length),first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}
  });
  function syncKind(){const kind=el('remote-kind').value;el('remote-direct-fields').hidden=kind!=='direct';el('remote-url').closest('.remote-field').hidden=kind==='direct';el('remote-url').type='text';el('remote-url').placeholder=kind==='gateway'?'wss://gateway.example/websockify':'https://viewer.example/vnc.html';el('remote-connection-help').textContent=kind==='direct'?'Connect to a reachable VNC server. Ordinary TCP VNC does not encrypt the desktop stream.':kind==='gateway'?'Enter the secure WebSocket endpoint, not the viewer page.':'Sign in within your HTTPS web viewer.'}
  el('remote-kind').addEventListener('change',syncKind);
  form.addEventListener('submit',async e=>{
    e.preventDefault();const kind=el('remote-kind').value,host=el('remote-host').value.trim(),port=Number(el('remote-port').value),url=kind==='gateway'?gatewayUrl(el('remote-url').value.trim()):viewerUrl(el('remote-url').value.trim());
    if(kind==='direct'?(!host||/[\s/]/.test(host)||!Number.isInteger(port)||port<1||port>65535):!url){el('remote-connect-error').textContent='Enter a valid host and port, secure WebSocket endpoint, or HTTPS viewer URL.';el('remote-connect-error').hidden=false;el(kind==='direct'?'remote-host':'remote-url').setAttribute('aria-invalid','true');el(kind==='direct'?'remote-host':'remote-url').focus({preventScroll:true});return}
    el('remote-url').removeAttribute('aria-invalid');const m=draft||current();
    if(draft){machines.push(draft);selected=draft.id;draft=null;el('remote-new-machine-name').value='';railPage=Math.floor((machines.length-1)/OpenSesameAgentsLayout.capacity(el('remote-rail')))}
    m.name=el('remote-name').value.trim().slice(0,40)||'Machine';m.network=el('remote-network').value;
    if(m.url!==url||m.kind!==kind||m.host!==host||m.port!==port){if(window.__OPEN_SESAME_NATIVE__&&m.kind&&m.kind!=='viewer')try{await openSesameBridge.request('vnc.credential.delete',{id:m.id,endpoint:m.kind==='direct'?m.host.toLowerCase()+':'+m.port:m.url})}catch{toast('Unlock Keychain before changing this connection.');return}OpenSesameVNC.close(m.id);mounted.get(m.id)?.remove();mounted.delete(m.id)}m.url=url;m.kind=kind;m.host=host;m.port=port;
    if(kind!=='viewer'){
      if(!mounted.has(m.id)){const stage=document.createElement('div');stage.className='remote-viewer vnc-container';el('remote-viewers').append(stage);mounted.set(m.id,stage);try{await OpenSesameVNC.open(m,stage,value=>{stage.dataset.status=value;el('remote-status').textContent=value})}catch(error){stage.remove();mounted.delete(m.id);toast(error.message);render();return}}
      close();render();return;
    }
    if(!mounted.has(m.id)){const frame=document.createElement('iframe');frame.className='remote-viewer';frame.title=m.name+' VNC viewer';frame.referrerPolicy='no-referrer';frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms allow-popups');frame.allowFullscreen=true;frame.src=fittedUrl(url);el('remote-viewers').append(frame);mounted.set(m.id,frame)}
    mounted.get(m.id).title=m.name+' VNC viewer';close();render();mounted.get(m.id).focus({preventScroll:true});
  });
  el('remote-disconnect').addEventListener('click',()=>{OpenSesameVNC.close(selected);mounted.get(selected)?.remove();mounted.delete(selected);render();el('remote-connect-submit').focus({preventScroll:true})});
  el('remote-fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await el('remote-stage').requestFullscreen()}catch{toast('Fullscreen is unavailable in this browser.')}});
  document.addEventListener('fullscreenchange',()=>{el('remote-fullscreen').setAttribute('aria-label',document.fullscreenElement?'Exit remote desktop fullscreen':'Enter remote desktop fullscreen');el('remote-fullscreen').title=document.fullscreenElement?'Exit fullscreen':'Fullscreen'});
  function selectMachine(id){OpenSesameVNC.blur();draft=null;pendingRemove=null;selected=id;form.hidden=true;render()}
  function rowAction(label,glyph,action){const b=document.createElement('button');b.type='button';b.className='remote-row-action';b.setAttribute('aria-label',label);b.title=label;b.innerHTML=icon(glyph);b.addEventListener('click',action);return b}
  function cancelRemove(id){pendingRemove=null;renderMachineRail();el('remote-machine-'+id)?.focus({preventScroll:true})}
  async function removeMachine(id){
    const index=machines.findIndex(m=>m.id===id);if(index<0)return;
    OpenSesameVNC.close(id);const removed=machines.find(m=>m.id===id);if(removed&&window.__OPEN_SESAME_NATIVE__)try{await openSesameBridge.request('vnc.credential.delete',{id,endpoint:removed.kind==='direct'?removed.host.toLowerCase()+':'+removed.port:removed.url})}catch{toast('Could not remove saved credential; unlock Keychain.');return}
    mounted.get(id)?.remove();mounted.delete(id);machines.splice(index,1);pendingRemove=null;
    if(selected===id)selected=machines[Math.min(index,machines.length-1)]?.id||'';
    railPage=Math.max(0,Math.floor(machines.findIndex(m=>m.id===selected)/OpenSesameAgentsLayout.capacity(el('remote-rail'))));
    render();(el('remote-machine-'+selected)||el('remote-rail-add')).focus({preventScroll:true});toast('Machine removed from Open Sesame.');
  }
  function renderMachineRail(){
    const list=el('remote-rail-list'),focused=document.activeElement?.id;list.replaceChildren();
    const perPage=OpenSesameAgentsLayout.capacity(el('remote-rail')),pages=Math.max(1,Math.ceil(machines.length/perPage));railPage=Math.max(0,Math.min(railPage,pages-1));
    for(const machine of machines.slice(railPage*perPage,(railPage+1)*perPage)){
      const row=document.createElement('div');row.className='remote-machine-row';row.setAttribute('role','presentation');
      const b=document.createElement('button');b.type='button';b.id='remote-machine-'+machine.id;b.setAttribute('role','tab');b.setAttribute('aria-selected',machine.id===selected);b.tabIndex=machine.id===selected?0:-1;b.innerHTML=icon('monitor');
      const name=document.createElement('span'),dot=document.createElement('i');name.textContent=machine.name;dot.className='machine-dot'+(mounted.has(machine.id)?' open':'');
      b.title=machine.name+' · '+(mounted.has(machine.id)?'Viewer open':machine.url?'Ready':'Set up connection');b.append(name,dot);b.addEventListener('click',()=>selectMachine(machine.id));
      b.addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();const index=machines.indexOf(machine),next=e.key==='Home'?0:e.key==='End'?machines.length-1:(index+(e.key==='ArrowUp'?-1:1)+machines.length)%machines.length;railPage=Math.floor(next/perPage);selectMachine(machines[next].id);el('remote-machine-'+selected)?.focus({preventScroll:true})}});
      const actions=document.createElement('div');actions.className='remote-row-actions';
      const preferences=rowAction('Preferences for '+machine.name,'sliders',()=>{selected=machine.id;draft=null;render();settings()});preferences.id='remote-preferences-'+machine.id;
      const remove=rowAction('Remove '+machine.name,'trash',()=>{pendingRemove=machine.id;renderMachineRail();el('remote-remove-cancel-'+machine.id)?.focus({preventScroll:true})});remove.id='remote-remove-'+machine.id;remove.classList.add('remote-row-remove');
      actions.append(preferences,remove);row.append(b,actions);list.append(row);
      if(pendingRemove===machine.id){
        row.classList.add('confirming');b.hidden=true;actions.hidden=true;
        const prompt=document.createElement('div');prompt.className='remote-remove-prompt';prompt.setAttribute('role','group');prompt.setAttribute('aria-label','Remove '+machine.name+' from Open Sesame?');prompt.title='Removes this saved connection and closes its viewer.';
        const label=document.createElement('span');label.textContent='Remove?';
        const cancel=rowAction('Keep '+machine.name,'close',()=>cancelRemove(machine.id));cancel.id='remote-remove-cancel-'+machine.id;
        const confirm=rowAction('Confirm remove '+machine.name,'check',()=>removeMachine(machine.id));prompt.append(label,cancel,confirm);prompt.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancelRemove(machine.id)}});row.append(prompt);
      }
    }
    if(!machines.length){const empty=document.createElement('p');empty.className='remote-rail-empty';empty.textContent='Add your first machine above.';list.append(empty)}
    el('remote-rail-pages').hidden=pages<=1;el('remote-rail-page').textContent=(railPage+1)+' / '+pages;el('remote-rail-prev').disabled=railPage===0;el('remote-rail-next').disabled=railPage>=pages-1;
    if(focused&&el(focused)?.closest('#remote-rail-list'))el(focused).focus({preventScroll:true});
  }
  el('remote-rail-prev').addEventListener('click',()=>{pendingRemove=null;railPage--;renderMachineRail()});el('remote-rail-next').addEventListener('click',()=>{pendingRemove=null;railPage++;renderMachineRail()});
  window.addEventListener('open-sesame-rails-changed',()=>{if(state.scenario==='remote')render()});new ResizeObserver(()=>{if(state.scenario==='remote'&&state.expanded&&!el('remote-rail').hidden)renderMachineRail()}).observe(el('remote-workspace'));
  // Saved connections persist; opening a viewer always requires an explicit action.
  render();
})();
