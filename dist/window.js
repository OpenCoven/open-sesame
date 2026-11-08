'use strict';
/* One active workspace; browser handoffs stay in memory and on the same origin. */
(()=>{
  const el=id=>document.getElementById(id),root=document.documentElement,popout=el('panel-popout'),full=el('panel-fullscreen');
  const embedded=new URL(location.href).searchParams.get('open-sesame-window')==='1';
  let detached=embedded,nativeDetached=false,nativeMaximized=false,active=null,opening=false,collapsing=false,resizeFrame=0,owner=null,restoreSize='medium',lastFull=false,preferPopup=false;
  try{if(embedded)owner=window.parent.__openSesameOwner||null}catch{}
  const clone=data=>JSON.parse(JSON.stringify(data));
  function snapshot(){
    document.activeElement?.blur();if(window.OpenSesameNotes?.finish(false)===false)throw Error('Save the current note before moving it.');
    return {
      tools:window.OpenSesameTools?.handoff(),
      state:{...state},items:clone(items),projects:clone(projects),
      view:{libraryOpen,detailFullWidth,selectedItemId,projectFilter,categoryFilter,itemsArchive,itemsView,itemsPage,libraryQuery,categories:[...expandedCategories]},
      draft:{text:el('capture-input').value,type:el('capture-type').value,project:el('capture-project').value,attachedUrl,ignoredInlineUrl},
      focus:{focusMinutes,focusRemaining,focusRunning,focusEnd,focusElapsedMs,focusStartedAt,focusTopics:clone(focusTopics),focusPage},
      reader:window.openSesameReading?.handoff(),calendar:window.OpenSesameFocusCalendar?.handoff(),live:window.OpenSesameLive?.handoff(),
      transcript:transcriptEditor.get(),media:window.OpenSesameLocalMedia?.handoff()
    };
  }
  function accept(data){
    if(!data)return;
    window.OpenSesameTools?.handoff(data.tools);
    const size=state.size,layout=state.layout;Object.assign(state,data.state,{size,layout,expanded:true});
    items=clone(data.items);projects=clone(data.projects);
    ({libraryOpen,detailFullWidth,selectedItemId,projectFilter,categoryFilter,itemsArchive,itemsView,itemsPage,libraryQuery}=data.view);
    expandedCategories.clear();data.view.categories.forEach(c=>expandedCategories.add(c));el('library-search').value=libraryQuery;
    ({focusMinutes,focusRemaining,focusRunning,focusEnd,focusElapsedMs,focusStartedAt,focusTopics,focusPage}=clone(data.focus));
    if(focusRunning)focusRemaining=Math.max(0,Math.ceil((focusEnd-Date.now())/1000));
    window.OpenSesameFocusCalendar?.handoff(data.calendar);window.openSesameReading?.handoff(data.reader);
    transcriptEditor.set(data.transcript);audioSession.final=data.transcript;window.OpenSesameLive?.handoff(data.live);
    renderAgendaList();renderFocus();render();
    el('capture-input').value=data.draft.text;el('capture-type').value=data.draft.type;el('capture-project').value=data.draft.project;
    attachedUrl=data.draft.attachedUrl;ignoredInlineUrl=data.draft.ignoredInlineUrl;renderDraft();
    window.OpenSesameLocalMedia?.handoff(data.media);window.dispatchEvent(new CustomEvent('open-sesame-view-changed'));
  }
  function pausePlayback(){
    for(const provider of [window.OpenSesameMusic,window.OpenSesameYouTube,window.OpenSesameLocalMedia]){
      if(provider?.snapshot?.().playing)Promise.resolve(provider.control('toggle')).catch(()=>{});
    }
    document.querySelectorAll('audio,video').forEach(media=>media.pause());window.openSesameSpeech?.stop();
  }
  function busy(){return audioSession.active||audioSession.starting||(window.OpenSesameLive?.busy||window.OpenSesameCovenClient?.busy)||window.OpenSesameVoice?.active}
  function sync(){
    const edge=detached||state.expanded&&state.size==='full';root.classList.toggle('open-sesame-edge-to-edge',edge);root.classList.toggle('open-sesame-detached',detached);
    if(edge){
      const rect=expandedFrame();el('widget-anchor').style.setProperty('--panel-width',rect.width+'px');el('widget-anchor').style.setProperty('--panel-height',rect.height+'px');
      el('widget-anchor').style.setProperty('--expanded-scale',window.innerWidth<560?'1':'1.2');
    }
    el('frame-resize-layer').hidden=detached||!state.expanded;el('panel-close').title=el('panel-close').ariaLabel=detached?'Dock widget':'Collapse widget';
    full.setAttribute('aria-pressed',String(nativeMaximized||!!document.fullscreenElement||!detached&&state.size==='full'));
    full.title=full.ariaLabel=(nativeMaximized||document.fullscreenElement||!detached&&state.size==='full')?'Restore window size':'Fill screen';
    popout.title=popout.ariaLabel=detached?'Dock widget':active?'Show floating window':'Pop out widget';
    popout.setAttribute('aria-pressed',String(detached||!!active));
    if(!detached&&state.size!=='full')restoreSize=state.size;
    const changed=lastFull!==edge;lastFull=edge;if(changed)requestAnimationFrame(()=>{fit();window.dispatchEvent(new Event('open-sesame-layout'))});
  }
  async function fullscreen(){
    if(window.__OPEN_SESAME_NATIVE__){if(nativeDetached){const result=await openSesameBridge.request('window.fullscreen');nativeMaximized=result?.fullscreen===true;sync();return}window.OpenSesameFrame.toggleFull();return}
    if(document.fullscreenElement){await document.exitFullscreen();return}
    if(!detached&&state.size==='full'){state.size=restoreSize;render();return}
    if(!detached){restoreSize=state.size;state.size='full';state.expanded=true;render()}
    try{if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();else if(detached)toast('Use your window’s maximize control to fill the display.')}catch{toast('Filling this window. Your browser did not allow full screen.')}sync();
  }
  function dock(force=false,{focus=true}={}){
    if(active){
      const current=active;let data=current.latest||current.initial;
      try{if((!force||!current.latest)&&current.frame.contentWindow.OpenSesameWindow){if(!force&&current.frame.contentWindow.OpenSesameWindow.busy()){toast('Stop recording or finish the current answer before docking.');current.host.focus();return}data=current.frame.contentWindow.OpenSesameWindow.snapshot()}}catch{}
      active=null;clearInterval(current.poll);el('window-away').hidden=true;document.querySelector('.app-body').inert=false;
      accept(data);current.host.close();sync();popout.focus({preventScroll:true});return;
    }
    if(owner?.OpenSesameWindow?.owns(window)){owner.OpenSesameWindow.dock();return}
    if(nativeDetached){
      return openSesameBridge.request('window.detach',{detached:false,focus}).then(()=>{nativeDetached=false;nativeMaximized=false;detached=false;state.size=restoreSize;render();return true}).catch(error=>{toast(error.message);return false});
    }
    if(embedded){const url=new URL(location.href);url.searchParams.delete('open-sesame-window');location.replace(url.href)}
  }
  async function collapse({outside=false,focus=false}={}){
    if(collapsing||active||embedded||outside&&(state.pinned||window.OpenSesameFrame?.dragging||document.querySelector('dialog[open]')))return false;
    if(!state.expanded&&!detached&&!window.OpenSesameLauncher?.active)return false;
    collapsing=true;
    try{
      if(document.fullscreenElement)await document.exitFullscreen();
      if(nativeDetached&&await dock(false,{focus})===false)return false;
      if(window.OpenSesameLauncher?.active)window.OpenSesameLauncher.close(false);
      if(state.size==='full')state.size=restoreSize;
      setExpanded(false,{focus});return true;
    }catch(error){toast(error.message||'Could not collapse the widget.');return false}finally{collapsing=false}
  }
  function ready(child){
    if(!active||child!==active.frame.contentWindow)return;
    child.OpenSesameWindow.accept(active.initial);
    child.document.getElementById('panel-popout').title='Return to original tab';
    if(active.kind==='window')child.document.getElementById('panel-popout').title='Dock widget · This browser window is not always on top';
  }
  async function open(){
    if(detached){dock();return}if(active){active.host.focus();return}if(opening)return;
    if(window.__OPEN_SESAME_NATIVE__){
      restoreSize=state.size==='full'?'medium':state.size;
      try{await openSesameBridge.request('window.detach',{detached:true,aspectRatio:window.OpenSesameFrameModel.ratio});nativeDetached=detached=true;state.expanded=true;render()}catch(error){toast(error.message)}return;
    }
    if(busy()){toast('Stop recording or finish the current answer before popping out.');return}
    let initial;try{initial=snapshot()}catch{toast('Could not move this workspace. Your current window is unchanged.');return}let width=el('widget-anchor').getBoundingClientRect().width;
    try{const saved=JSON.parse(localStorage.getItem('open-sesame-floating-size')||'null');if(Number.isFinite(saved?.width)&&saved.width>=360)width=saved.width}catch{}
    const size=window.OpenSesameFrameModel.floating(width,screen.availWidth,screen.availHeight);
    opening=true;let host,kind='window';
    try{
      if(!preferPopup&&window.documentPictureInPicture&&window===window.top){host=await window.documentPictureInPicture.requestWindow(size);kind='pip'}
      else host=window.open('','open-sesame-floating','popup=yes,resizable=yes,scrollbars=yes,width='+size.width+',height='+size.height);
      if(!host)throw Error('Allow pop-ups for Open Sesame, then try again.');
      host.__openSesameOwner=window;host.document.title='Open Sesame · Floating workspace';
      const style=host.document.createElement('style');style.textContent='html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#0d0e10}iframe{display:block;width:100%;height:100%;border:0}';host.document.head.append(style);
      const frame=host.document.createElement('iframe'),url=new URL(location.href);url.searchParams.set('open-sesame-window','1');
      frame.title='Open Sesame floating workspace';frame.allow='autoplay; fullscreen; microphone; camera; display-capture; clipboard-write';frame.allowFullscreen=true;frame.src=url.href;
      active={host,frame,kind,initial,poll:0};pausePlayback();focusRunning=false;clearTimeout(hoverTimer);
      document.querySelector('.app-body').inert=true;el('window-away').hidden=false;
      el('window-away-description').textContent=kind==='pip'?'Always on top · Drag the window edges to resize. Keep this tab open.':'Drag the window edges to resize. Always on top is unavailable in this browser; the Mac companion supports it.';
      host.addEventListener('resize',()=>{try{localStorage.setItem('open-sesame-floating-size',JSON.stringify({width:host.innerWidth,height:host.innerHeight}))}catch{}});
      host.addEventListener('pagehide',()=>{if(active?.host===host)dock(true)},{once:true});
      host.document.body.replaceChildren(frame);active.poll=setInterval(()=>{if(active?.host===host&&host.closed)dock(true)},750);sync();
    }catch(error){if(host&&!active)host.close();if(window.documentPictureInPicture&&!preferPopup){preferPopup=true;toast('Always-on-top mode was unavailable. Click Pop out again for a standard window.')}else toast(error.message||'Could not open a floating window. Try from Open Sesame in its own browser tab.')}finally{opening=false}
  }
  popout.addEventListener('click',open);full.addEventListener('click',()=>fullscreen().catch(error=>toast(error.message)));
  el('window-focus').addEventListener('click',()=>active?.host.focus());el('window-return').addEventListener('click',()=>dock());
  // Docking is distinct from collapsing: a detached window always uses its available area.
  el('panel-close').addEventListener('click',event=>{if(detached){event.preventDefault();event.stopImmediatePropagation();dock()}},true);
  document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&!detached&&state.size==='full')state.size=restoreSize;render()});
  document.addEventListener('pointerdown',event=>{
    if(![0,1,2].includes(event.button))return;
    if(event.composedPath().some(node=>['widget-anchor','menu-trigger','desktop-notification','open-sesame-select-menu'].includes(node.id)))return;
    void collapse({outside:true});
  });
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||event.defaultPrevented||document.querySelector('dialog[open]')||event.target.closest('input,textarea,select,[contenteditable],.terminal-native'))return;
    if(!detached&&state.size==='full'&&!document.fullscreenElement){event.preventDefault();event.stopImmediatePropagation();state.size=restoreSize;render()}
  },true);
  window.addEventListener('resize',()=>{if(!detached&&state.size!=='full')return;cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{sync();window.dispatchEvent(new Event('open-sesame-layout'))})});
  window.addEventListener('pagehide',()=>{if(active){active=null;/* Browser closes PiP; a regular pop-out can continue independently. */}});
  function show(){if(window.OpenSesameLauncher?.active)window.OpenSesameLauncher.close(true);else setExpanded(true,{focus:true})}
  function toggle(){if(state.expanded||window.OpenSesameLauncher?.active)return collapse({focus:true});show()}
  window.OpenSesameWindow={sync,open,dock,collapse,show,toggle,ready,snapshot,accept,busy,owns(child){return active?.frame.contentWindow===child},checkpoint(child,data){if(active?.frame.contentWindow===child)active.latest=data},get detached(){return detached}};
  window.addEventListener('beforeunload',()=>{try{if(owner?.OpenSesameWindow?.owns(window))owner.OpenSesameWindow.checkpoint(window,snapshot())}catch{}});
  if(embedded){state.expanded=true;document.title='Open Sesame · Floating workspace';render();if(owner?.OpenSesameWindow)owner.OpenSesameWindow.ready(window)}else sync();
})();
