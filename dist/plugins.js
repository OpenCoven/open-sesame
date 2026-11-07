'use strict';
(()=>{
  const el=id=>document.getElementById(id),pane=el('pane-plugins'),M=OpenSesamePluginsModel;
  let agents=null,error='',checking=false,page=0,capacity=6,selected=null,lastFocus=null,generation=0;
  const context=()=>({music:window.OpenSesameMusicAuth?.snapshot()||{},desktop:!!window.openSesameBridge?.available,agents,error,feedCount:window.openSesameReading?.listFeeds().length||0,familiars:window.OpenSesameFamiliars?.snapshot()||{}});
  function make(tag,cls,text){const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;}
  function mark(p){const n=make('span','plugin-logo');if(p.logo){const img=new Image();img.src='assets/plugins/'+p.logo+'.svg';img.alt='';img.width=img.height=26;n.append(img);}else n.innerHTML=icon(p.glyph);return n;}
  const features={coven:['Familiar roster','Streaming chat'],spotify:['Songs & albums','Playlists'],apple:['MusicKit','In-app playback'],youtube:['Videos','Playlists'],claude:['Transcript Q&A','Local CLI'],codex:['Transcript Q&A','Local CLI'],rss:['RSS & Atom','Saved articles']};
  function card(p,c){
    const s=M.status(p,c),button=make('button','plugin-card');button.type='button';button.dataset.plugin=p.id;button.setAttribute('aria-label',p.name+' · '+s.label+' · '+s.action);
    const copy=make('span','plugin-copy');copy.append(make('strong','',p.name),make('small','',p.description));
    const destination=make('span','plugin-destination',p.kind==='music'?'Focus':p.kind==='agent'?'Live':p.kind==='familiars'?'Console':'Reader');destination.setAttribute('aria-hidden','true');
    const overview=make('span','plugin-overview'),tags=make('span','plugin-features');for(const feature of features[p.id]||[])tags.append(make('span','',feature));overview.append(make('span','plugin-description',p.detail),tags);
    const footer=make('span','plugin-card-foot'),status=make('span','plugin-state',s.label);status.dataset.tone=s.tone;footer.append(status,make('span','plugin-action',s.action+' ›'));
    button.append(mark(p),destination,copy,overview,footer);button.addEventListener('click',()=>show(p,button));return button;
  }
  function render(){
    const c=context(),shown=M.filter(M.catalog,el('plugins-search').value,el('plugins-category').value,el('plugins-connected').getAttribute('aria-pressed')==='true',c),pages=Math.max(1,Math.ceil(shown.length/capacity));page=Math.min(page,pages-1);
    const focused=document.activeElement?.dataset.plugin,visible=shown.slice(page*capacity,(page+1)*capacity);el('plugins-grid').dataset.count=visible.length;el('plugins-grid').replaceChildren(...visible.map(p=>card(p,c)));if(focused)pane.querySelector('[data-plugin="'+focused+'"]')?.focus({preventScroll:true});
    el('plugins-empty').hidden=shown.length>0;el('plugins-grid').hidden=!shown.length;el('plugins-count').textContent=shown.length+' plugin'+(shown.length===1?'':'s');el('plugins-page').textContent=(page+1)+' / '+pages;el('plugins-prev').disabled=page===0;el('plugins-next').disabled=page>=pages-1;el('plugins-pages').hidden=pages===1;
    el('plugins-refresh').disabled=checking;el('plugins-refresh').classList.toggle('is-refreshing',checking);
    el('plugins-desktop-state').textContent=c.desktop?'Desktop connected':'Bring your Mac along';el('plugins-desktop-copy').textContent=c.desktop?'Local agents are available to check.':'Build the macOS companion to use local agents.';el('plugins-desktop-action').textContent=c.desktop?'Agents':'Get Mac source';
    el('plugins-status').textContent=error||'';el('plugins-status').hidden=!error;
    if(selected)drawDetail();
  }
  function close(focus=true){el('plugin-detail').hidden=true;selected=null;if(focus){const target=lastFocus?.dataset.plugin?pane.querySelector('[data-plugin="'+lastFocus.dataset.plugin+'"]'):lastFocus;(target?.isConnected?target:el('plugins-search')).focus({preventScroll:true});}}
  function show(p,source){selected=p;lastFocus=source;drawDetail();el('plugin-detail').hidden=false;el('plugin-detail-close').focus({preventScroll:true});}
  function drawDetail(){
    const p=selected,c=context(),s=M.status(p,c),setup=M.setup(p,c);
    el('plugin-detail-logo').replaceChildren(mark(p));el('plugin-detail-title').textContent=p.name;el('plugin-detail-state').textContent=s.label;el('plugin-detail-state').dataset.tone=s.tone;
    el('plugin-detail-copy').textContent=p.detail;el('plugin-detail-access').textContent=p.access;el('plugin-detail-note').textContent=setup.note;
    el('plugin-detail-steps').replaceChildren(...setup.steps.map(text=>make('li','',text)));el('plugin-detail-repair').textContent=setup.repair;
    el('plugin-detail-main').textContent=p.kind==='familiars'?'Connect Coven':p.kind==='music'?(c.music[p.id]?.supported===false?'View account requirements':s.action+' account'):p.kind==='feeds'?'Add a feed':c.desktop&&agents?.[p.id]?'Use in Live':'Check again';
    el('plugin-detail-main').hidden=['agent','familiars'].includes(p.kind)&&!c.desktop;el('plugin-detail-main').disabled=checking;
    el('plugin-detail-open').textContent=p.kind==='music'?'Open in Focus':p.kind==='feeds'?'Open Reader':p.kind==='familiars'?'Open Familiars':'View agents';
    el('plugin-detail-docs').hidden=!p.docs;if(p.docs)el('plugin-detail-docs').href=p.docs;el('plugin-detail-download').hidden=!['agent','familiars'].includes(p.kind)||c.desktop;
  }
  async function refresh(){if(checking)return;const token=++generation;error='';if(!openSesameBridge.available){agents=null;render();return;}checking=true;render();try{const result=await openSesameBridge.request('live.agents');if(token!==generation)return;if(!result||typeof result.claude!=='boolean'||typeof result.codex!=='boolean')throw Error('Update the desktop companion, then check again.');agents={claude:result.claude,codex:result.codex};}catch(e){if(token===generation){agents=null;error='Could not check local agents. Reopen the desktop companion, then refresh.';}}finally{if(token===generation){checking=false;render();}}}
  el('plugin-detail-close').addEventListener('click',()=>close());el('plugin-detail-main').addEventListener('click',()=>{const p=selected;if(p.kind==='familiars'){close(false);changeScenario('familiars');window.OpenSesameFamiliars?.connect();}else if(p.kind==='music'){close(false);window.OpenSesameMusicAuth.openFor(p.id,{host:pane,returnFocus:()=>pane.querySelector('[data-plugin="'+p.id+'"]')});}else if(p.kind==='feeds'){close(false);changeScenario('reading');el('reading-follow-new').click();}else if(openSesameBridge.available&&agents?.[p.id]){close(false);changeScenario('audio');el('live-agent').value=p.id;el('live-agent').dispatchEvent(new Event('change',{bubbles:true}));el('capture-input').focus();}else refresh();});
  el('plugin-detail-open').addEventListener('click',()=>{const p=selected;close(false);if(p.kind==='music'){changeScenario(p.id==='youtube'?'youtube':'music');if(p.id!=='youtube')OpenSesameMusic.choose(p.id);}else changeScenario(p.kind==='feeds'?'reading':p.kind==='familiars'?'familiars':'agent-monitor');});
  el('plugins-desktop-action').addEventListener('click',()=>{if(openSesameBridge.available)changeScenario('agent-monitor');else{el('plugins-desktop-download').click();}});
  el('plugins-refresh').addEventListener('click',refresh);el('plugins-search').addEventListener('input',()=>{page=0;render();});el('plugins-category').addEventListener('change',()=>{page=0;render();});el('plugins-connected').addEventListener('click',()=>{const b=el('plugins-connected');b.setAttribute('aria-pressed',b.getAttribute('aria-pressed')!=='true');page=0;render();});el('plugins-reset').addEventListener('click',()=>{el('plugins-search').value='';el('plugins-category').value='all';el('plugins-connected').setAttribute('aria-pressed','false');page=0;render();});
  el('plugins-prev').addEventListener('click',()=>{page--;render();});el('plugins-next').addEventListener('click',()=>{page++;render();});
  document.addEventListener('pointerdown',e=>{if(selected&&!el('plugin-detail').contains(e.target)&&!e.target.closest('[data-plugin]'))close(false);});
  document.addEventListener('keydown',e=>{if(!selected)return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();}if(e.key==='Tab'){const nodes=[...el('plugin-detail').querySelectorAll('button,a')].filter(n=>!n.hidden&&!n.disabled&&n.getClientRects().length);if(e.shiftKey&&document.activeElement===nodes[0]){e.preventDefault();nodes.at(-1).focus();}else if(!e.shiftKey&&document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0].focus();}}},true);
  function fit(){
    if(pane.hidden)return;const area=el('plugins-results'),wide=area.clientWidth>=1000&&area.clientHeight>=460,columns=area.clientWidth>=760?3:2;
    const next=wide?6:Math.max(columns,Math.min(6,Math.floor((area.clientHeight||240)/92)*columns)),layout=wide?'bento':columns===3?'wide':'compact';
    pane.dataset.layout=layout;pane.dataset.density=area.clientHeight<580?'compact':'comfortable';if(next!==capacity){capacity=next;page=0;render();}
  }
  new ResizeObserver(fit).observe(el('plugins-results'));window.addEventListener('open-sesame-view-changed',()=>{if(state.scenario==='plugins'){render();fit();if(agents===null)refresh();}else close(false);});window.addEventListener('open-sesame-music-account-changed',render);window.addEventListener('open-sesame-familiars-changed',render);window.addEventListener('open-sesame-desktop-ready',refresh);window.addEventListener('open-sesame-desktop-disconnected',()=>{generation++;checking=false;agents=null;error='';render();});
  window.OpenSesamePlugins={refresh};render();
})();
