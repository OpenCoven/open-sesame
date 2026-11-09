'use strict';
(()=>{
  const el=id=>document.getElementById(id),pane=el('pane-plugins'),host=el('github-monitor'),bridge=window.openSesameBridge;
  const M=window.OpenSesameGitHubMonitorModel;
  const login='gh auth login --hostname github.com --web --git-protocol https';
  let account=null,selected='',snapshot=null,busy=false,error='',generation=0,timer=0,lastFocus=null,scope=null;
  let view='all',preferences={query:'',filter:'all',sort:'updated'};
  try{const saved=JSON.parse(localStorage.getItem('open-sesame-github-view-v1')||'{}');if(['all','pulls','issues','runs'].includes(saved.view))view=saved.view;if(['updated','created','title','state'].includes(saved.sort))preferences.sort=saved.sort}catch{}
  function make(tag,cls,text){const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node}
  function active(){return !host.hidden&&(scope?scope():!pane.hidden&&state.expanded&&state.scenario==='plugins')&&document.visibilityState!=='hidden'}
  function clearTimer(){if(timer)clearTimeout(timer);timer=0}
  function announce(){window.dispatchEvent(new Event('open-sesame-github-changed'))}
  function later(){clearTimer();if(active())timer=setTimeout(()=>{timer=0;load(false)},60000)}
  function link(label,url,cls=''){const a=make('a',cls,label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a}
  function section(key,title,empty){
    const data=snapshot?.sections?.[key],card=make('section','github-section'),heading=make('header'),items=make('div','github-entries'),rows=M.entries(data,preferences);card.dataset.collection=key;
    card.hidden=view!=='all'&&view!==key;
    heading.append(make('h3','',title),make('small','',data?.error?'Unavailable':rows.length+' / '+(data?.entries?.filter(e=>M.safeLink(e.url)).length||0)+' recent'));card.append(heading);
    if(data?.error)items.append(make('p','github-section-note',data.error));
    else if(!rows.length)items.append(make('p','github-section-note',data?.entries?.length?'No activity matches these filters.':empty));
    for(const entry of rows){
      const a=link('',entry.url,'github-entry'),copy=make('span','github-entry-copy'),badge=make('span','github-run-state',String(entry.state||'unknown').replaceAll('_',' '));
      const title=make('strong','',entry.title||'Untitled');title.title=entry.title||'Untitled';
      const meta=[key==='runs'?entry.workflow:'#'+entry.id,entry.subtitle,entry.event,M.relative(entry.updatedAt)].filter(Boolean).join(' · '),small=make('small','',meta);small.title=meta;
      copy.append(title,small);badge.dataset.state=entry.state;a.append(copy,badge);items.append(a);
    }
    card.append(items);return card;
  }
  function drawCollections(){
    const cards=el('github-monitor-cards'),focused=document.activeElement?.closest?.('.github-entry')?.href,scroll=host.scrollTop;
    cards.dataset.view=view;cards.replaceChildren(section('pulls','Pull requests','No recent open pull requests.'),section('issues','Issues','No recent open issues.'),section('runs','Actions','No workflow runs yet.'));
    if(focused)[...cards.querySelectorAll('a')].find(a=>a.href===focused)?.focus({preventScroll:true});host.scrollTop=scroll;
    for(const b of document.querySelectorAll('[data-github-collection]')){const key=b.dataset.githubCollection,yes=view===key;b.setAttribute('aria-selected',String(yes));b.tabIndex=yes?0:-1;const count=b.querySelector('span');if(count)count.textContent=snapshot?.sections?.[key]?.error?'—':String(snapshot?.sections?.[key]?.entries?.filter(e=>M.safeLink(e.url)).length||0)}
    el('github-monitor-clear').hidden=!preferences.query&&preferences.filter==='all';
  }
  function draw(){
    host.setAttribute('aria-busy',String(busy));el('github-monitor-refresh').disabled=busy;el('github-monitor-add').disabled=busy||!account?.authenticated;el('github-monitor-repository-input').disabled=busy||!account?.authenticated;el('github-monitor-repository').disabled=busy||!account?.repositories?.length;el('github-monitor-remove').disabled=busy||!selected;
    el('github-monitor-account').textContent=account?.authenticated?'@'+account.account+' · Read only':'Read-only project monitor';
    el('github-monitor-setup').hidden=!!account?.authenticated;el('github-monitor-setup-copy').textContent=account?.error||'Use your existing GitHub CLI sign-in. Open Sesame reads repository metadata and never receives your token.';
    el('github-monitor-add-form').hidden=!account?.authenticated;el('github-monitor-repository').parentElement.hidden=!account?.repositories?.length;
    el('github-monitor-error').hidden=!error;el('github-monitor-error').textContent=error;
    const picker=el('github-monitor-repository'),signature=JSON.stringify(account?.repositories||[]);if(picker.dataset.repositories!==signature){picker.replaceChildren(...(account?.repositories||[]).map(repo=>{const option=make('option','',repo);option.value=repo;return option}));picker.dataset.repositories=signature}picker.value=selected;
    el('github-monitor-empty').hidden=!account?.authenticated||!!selected||busy;el('github-monitor-project').hidden=!snapshot;el('github-monitor-cards').hidden=!snapshot;el('github-monitor-collections').hidden=!snapshot;el('github-monitor-filters').hidden=!snapshot;el('github-monitor-manage').hidden=!account?.authenticated;
    if(snapshot){el('github-monitor-project-name').textContent=snapshot.repository;el('github-monitor-project-copy').textContent=[snapshot.private?'Private':'Public',snapshot.branch,snapshot.archived?'Archived':'',snapshot.description].filter(Boolean).join(' · ');el('github-monitor-project-open').href=(/^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(snapshot.url)?snapshot.url:'https://github.com/');drawCollections();}
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
  function pause(){generation++;busy=false;clearTimer()}
  function close(focus=true){if(scope){pause();window.OpenSesamePageWidgets?.close();return}pause();host.hidden=true;pane.classList.remove('github-monitor-open');if(focus){const target=pane.querySelector?.('[data-plugin="github"]')||lastFocus;(target?.isConnected?target:el('plugins-search')).focus({preventScroll:true})}}
  function open(source){if(window.OpenSesamePageWidgets){window.OpenSesamePageWidgets.github();return}lastFocus=source||document.activeElement;host.hidden=false;pane.classList.add('github-monitor-open');el('github-monitor-back').focus({preventScroll:true});draw();if(!window.__OPEN_SESAME_NATIVE__||!bridge?.available){error='Open the Mac app to connect your local GitHub CLI account.';draw();return}load(false)}
  el('github-monitor-back').addEventListener('click',()=>close());el('github-monitor-refresh').addEventListener('click',()=>load(true));el('github-monitor-connect').addEventListener('click',()=>load(true));
  el('github-monitor-add-form').addEventListener('submit',event=>{event.preventDefault();const value=el('github-monitor-repository-input').value.trim();if(value)mutate('github.add',value)});
  el('github-monitor-repository').addEventListener('change',()=>{if(busy)return;generation++;selected=el('github-monitor-repository').value;snapshot=null;load(false)});
  el('github-monitor-remove').addEventListener('click',()=>{if(selected)mutate('github.remove',selected)});
  el('github-monitor-login-command').textContent=login;el('github-monitor-copy-login').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(login);toast('Copied. Run this in Terminal, then choose Connect.')}catch{toast('Copy is unavailable. Select the command and copy it.')}});
  document.addEventListener('keydown',event=>{if(!scope&&!host.hidden&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close()}});
  document.addEventListener('visibilitychange',()=>{if(active())load(false);else clearTimer()});
  window.addEventListener('open-sesame-view-changed',()=>{if(scope){if(!active())pause();else load(false)}else if(state.scenario!=='plugins')close(false);else if(active())load(false)});
  window.addEventListener('open-sesame-layout',()=>{if(active()){if(!timer&&!busy)load(false)}else pause()});
  window.addEventListener('open-sesame-desktop-disconnected',()=>{generation++;busy=false;clearTimer();account=null;snapshot=null;error='Desktop connection closed. Reopen the app to reconnect.';draw();announce()});
  for(const b of document.querySelectorAll('[data-github-collection]'))b.addEventListener('click',()=>{view=b.dataset.githubCollection;storePreferences();drawCollections()});
  el('github-monitor-views').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const buttons=[...document.querySelectorAll('[data-github-collection]')],i=buttons.indexOf(document.activeElement);if(i<0)return;e.preventDefault();const b=buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowLeft'?-1:1)+buttons.length)%buttons.length];b.click();b.focus()});
  function storePreferences(){try{localStorage.setItem('open-sesame-github-view-v1',JSON.stringify({view,sort:preferences.sort}))}catch{}}
  for(const field of ['search','filter','sort']){const input=el('github-monitor-'+field);if(field==='sort')input.value=preferences.sort;input.addEventListener(field==='search'?'input':'change',()=>{preferences[field==='search'?'query':field]=input.value;storePreferences();drawCollections()})}
  el('github-monitor-clear').addEventListener('click',()=>{preferences.query='';preferences.filter='all';el('github-monitor-search').value='';el('github-monitor-filter').value='all';drawCollections();el('github-monitor-search').focus()});
  el('github-monitor-uninstall').addEventListener('click',()=>{if(confirm('Remove the GitHub tab from Projects? Your saved repositories remain on this Mac.'))window.OpenSesamePageWidgets?.removeGithub()});
  window.OpenSesameGitHubMonitor={open,close,pause,mount(isActive){pause();scope=isActive;host.hidden=false;pane.classList.remove('github-monitor-open');el('github-monitor-back').hidden=true;draw()},activate(){if(!window.__OPEN_SESAME_NATIVE__||!bridge?.available){error='Open the Mac app to connect your local GitHub CLI account.';draw();return}load(false)},snapshot:()=>({visible:active(),pending:busy,connected:!!account?.authenticated,count:account?.repositories?.length||0,error})};draw();
})();
