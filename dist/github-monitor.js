'use strict';
(()=>{
  const el=id=>document.getElementById(id),pane=el('pane-plugins'),host=el('github-monitor'),bridge=window.openSesameBridge;
  const login='gh auth login --hostname github.com --web --git-protocol https';
  let account=null,selected='',snapshot=null,busy=false,error='',generation=0,timer=0,lastFocus=null;
  function make(tag,cls,text){const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node}
  function active(){return !host.hidden&&!pane.hidden&&state.expanded&&state.scenario==='plugins'&&document.visibilityState!=='hidden'}
  function clearTimer(){if(timer)clearTimeout(timer);timer=0}
  function announce(){window.dispatchEvent(new Event('open-sesame-github-changed'))}
  function later(){clearTimer();if(active())timer=setTimeout(()=>{timer=0;load(false)},60000)}
  function link(label,url,cls=''){const a=make('a',cls,label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a}
  function section(key,title,empty){
    const data=snapshot?.sections?.[key],card=make('section','github-section'),heading=make('header'),items=make('div','github-entries');heading.append(make('h3','',title),make('small','','Recent'));card.append(heading);
    if(data?.error)items.append(make('p','github-section-note',data.error));
    else if(!data?.entries?.length)items.append(make('p','github-section-note',empty));
    for(const entry of data?.entries||[]){
      // The host constructs links, and the UI still refuses untrusted origins.
      if(!/^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+\/(?:pull|issues|actions\/runs)\/[0-9]+$/.test(entry.url))continue;
      const a=link('',entry.url,'github-entry'),copy=make('span','github-entry-copy'),badge=make('span','github-run-state',entry.state.replaceAll('_',' '));
      copy.append(make('strong','',entry.title||'Untitled'),make('small','',(key==='runs'?'':('#'+entry.id+' · '))+entry.subtitle));badge.dataset.state=entry.state;a.append(copy,badge);items.append(a);
    }
    card.append(items);return card;
  }
  function draw(){
    host.setAttribute('aria-busy',String(busy));el('github-monitor-refresh').disabled=busy;el('github-monitor-add').disabled=busy||!account?.authenticated;el('github-monitor-repository-input').disabled=busy||!account?.authenticated;el('github-monitor-repository').disabled=busy||!account?.repositories?.length;el('github-monitor-remove').disabled=busy||!selected;
    el('github-monitor-account').textContent=account?.authenticated?'@'+account.account+' · Read only':'Read-only project monitor';
    el('github-monitor-setup').hidden=!!account?.authenticated;el('github-monitor-setup-copy').textContent=account?.error||'Use your existing GitHub CLI sign-in. Open Sesame reads repository metadata and never receives your token.';
    el('github-monitor-add-form').hidden=!account?.authenticated;el('github-monitor-repository').parentElement.hidden=!account?.repositories?.length;
    el('github-monitor-error').hidden=!error;el('github-monitor-error').textContent=error;
    const picker=el('github-monitor-repository'),signature=JSON.stringify(account?.repositories||[]);if(picker.dataset.repositories!==signature){picker.replaceChildren(...(account?.repositories||[]).map(repo=>{const option=make('option','',repo);option.value=repo;return option}));picker.dataset.repositories=signature}picker.value=selected;
    el('github-monitor-empty').hidden=!account?.authenticated||!!selected||busy;el('github-monitor-project').hidden=!snapshot;el('github-monitor-cards').hidden=!snapshot;
    if(snapshot){el('github-monitor-project-name').textContent=snapshot.repository;el('github-monitor-project-copy').textContent=[snapshot.private?'Private':'Public',snapshot.branch,snapshot.archived?'Archived':'',snapshot.description].filter(Boolean).join(' · ');el('github-monitor-project-open').href=snapshot.url;el('github-monitor-cards').replaceChildren(section('pulls','Pull requests','No recent open pull requests.'),section('issues','Issues','No recent open issues.'),section('runs','Workflow runs','No workflow runs yet.'));}
    el('github-monitor-updated').textContent=busy?'Refreshing GitHub…':snapshot?(snapshot.stale?'Saved snapshot · ':'Updated ')+new Date(snapshot.updatedAt*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'Refreshes every minute while this view is visible.';
  }
  async function load(force=false){
    if(busy||!active())return;const ticket=++generation;busy=true;error='';clearTimer();draw();
    try{
      const status=await bridge.request('github.status',{force});if(ticket!==generation)return;
      if(!status||!Array.isArray(status.repositories)||typeof status.authenticated!=='boolean')throw Error('Update the desktop app to connect GitHub.');
      const previous=account?.account;account=status;if(previous&&previous!==status.account)snapshot=null;
      if(!status.authenticated&&snapshot){snapshot={...snapshot,stale:true};error=status.error||'Could not refresh GitHub.'}
      if(!status.repositories.includes(selected)){selected=status.repositories[0]||'';snapshot=null}
      draw();if(selected&&status.authenticated){const result=await bridge.request('github.snapshot',{repository:selected,force});if(ticket!==generation)return;snapshot=result;error=result.error||''}
    }catch(e){if(ticket===generation){error=e.message||'Could not refresh GitHub.';if(snapshot)snapshot={...snapshot,stale:true}}}
    finally{if(ticket===generation){busy=false;draw();announce();later()}}
  }
  async function mutate(method,repository){
    if(busy)return;const ticket=++generation;busy=true;error='';clearTimer();draw();
    try{const result=await bridge.request(method,{repository});if(ticket!==generation)return;account={...account,repositories:result.repositories};selected=method==='github.add'?result.repository:result.repositories[0]||'';snapshot=null;if(method==='github.add')el('github-monitor-repository-input').value='';}
    catch(e){if(ticket===generation)error=e.message||'Could not update your monitored repositories.'}
    finally{if(ticket===generation){busy=false;draw();announce();if(!error)load(false);else later()}}
  }
  function close(focus=true){generation++;busy=false;clearTimer();host.hidden=true;pane.classList.remove('github-monitor-open');if(focus){const target=pane.querySelector?.('[data-plugin="github"]')||lastFocus;(target?.isConnected?target:el('plugins-search')).focus({preventScroll:true})}}
  function open(source){lastFocus=source||document.activeElement;host.hidden=false;pane.classList.add('github-monitor-open');el('github-monitor-back').focus({preventScroll:true});draw();if(!window.__OPEN_SESAME_NATIVE__||!bridge?.available){error='Open the Mac app to connect your local GitHub CLI account.';draw();return}load(false)}
  el('github-monitor-back').addEventListener('click',()=>close());el('github-monitor-refresh').addEventListener('click',()=>load(true));el('github-monitor-connect').addEventListener('click',()=>load(true));
  el('github-monitor-add-form').addEventListener('submit',event=>{event.preventDefault();const value=el('github-monitor-repository-input').value.trim();if(value)mutate('github.add',value)});
  el('github-monitor-repository').addEventListener('change',()=>{if(busy)return;generation++;selected=el('github-monitor-repository').value;snapshot=null;load(false)});
  el('github-monitor-remove').addEventListener('click',()=>{if(selected)mutate('github.remove',selected)});
  el('github-monitor-login-command').textContent=login;el('github-monitor-copy-login').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(login);toast('Copied. Run this in Terminal, then choose Connect.')}catch{toast('Copy is unavailable. Select the command and copy it.')}});
  document.addEventListener('keydown',event=>{if(!host.hidden&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close()}});
  document.addEventListener('visibilitychange',()=>{if(active())load(false);else clearTimer()});
  window.addEventListener('open-sesame-view-changed',()=>{if(state.scenario!=='plugins')close(false);else if(active())load(false)});
  window.addEventListener('open-sesame-layout',()=>{if(active())later();else clearTimer()});
  window.addEventListener('open-sesame-desktop-disconnected',()=>{generation++;busy=false;clearTimer();account=null;snapshot=null;error='Desktop connection closed. Reopen the app to reconnect.';draw();announce()});
  window.OpenSesameGitHubMonitor={open,close,snapshot:()=>({connected:!!account?.authenticated,count:account?.repositories?.length||0,error})};draw();
})();
