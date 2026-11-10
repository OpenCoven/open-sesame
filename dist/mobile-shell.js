'use strict';
/* Responsive presentation over the mounted renderer. No identity, provider or persistence authority. */
(()=>{
  if(window.OpenSesameMobile)return;
  const el=id=>document.getElementById(id),root=document.documentElement,panel=el('widget-panel'),footer=panel.querySelector('.widget-capture-footer');
  const query=matchMedia('(max-width: 1024px)'),M=OpenSesameMobileModel;
  const make=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n};
  let active=false,today=true,previousExpanded=false,previousFocus=null,scheduled=0;
  const inertBefore=new Map();
  const header=make('header','mobile-header'),brand=make('strong','','Open Sesame'),capture=make('button','','Capture');
  capture.type='button';capture.id='mobile-capture';capture.setAttribute('aria-haspopup','dialog');
  const lockup=make('span','mobile-brand'),mark=document.createElementNS('http://www.w3.org/2000/svg','svg');
  mark.setAttribute('viewBox','0 0 212 212');mark.setAttribute('aria-hidden','true');
  mark.innerHTML='<use href="assets/mobile/opencoven-mark.svg?v=3cc1d06c3f95#mark"/>';
  const period=make('span','mobile-brand-period','.');period.setAttribute('aria-hidden','true');brand.append(period);lockup.append(mark,brand);header.append(lockup,capture);
  const home=make('section','mobile-today');home.id='mobile-today';home.tabIndex=-1;home.setAttribute('aria-label','Today');
  const greeting=make('header','mobile-greeting'),meta=make('p','mobile-greeting-meta'),date=make('span'),maker=make('span','','OpenCoven');meta.append(date,maker);
  const heading=make('h1'),line=make('span','','Your space,'),accent=make('em','','within reach.');heading.append(line,accent);
  const doorway=make('span','mobile-doorway');doorway.setAttribute('aria-hidden','true');
  doorway.innerHTML='<svg viewBox="0 0 64 84" fill="none" stroke="currentColor"><path d="M10 78V35a22 22 0 0 1 44 0v43M18 78V36a14 14 0 0 1 28 0v42M5 78h54"/><path class="mobile-aperture" d="m32 38 4 6-4 6-4-6z"/></svg>';
  greeting.append(meta,heading,doorway);
  const homeCapture=make('button','mobile-capture-entry');homeCapture.type='button';homeCapture.setAttribute('aria-haspopup','dialog');homeCapture.innerHTML=icon('plus');homeCapture.append(make('span','','Capture a thought…'));homeCapture.addEventListener('click',openCapture);
  const essentials=make('h2','mobile-section-title','Your essentials'),cards=make('div','mobile-today-cards');home.append(greeting,homeCapture,essentials,cards);
  function card(label,action){const b=make('button','mobile-card'),title=make('strong','',label),detail=make('span','');b.type='button';b.append(title,detail);b.addEventListener('click',action);cards.append(b);return {button:b,title,detail}}
  const focus=card('Focus',()=>{if(!available('agenda','Agenda'))return;if(navigate('focus'))panel.querySelector('button[data-focus-view=agenda]').click()});focus.button.classList.add('mobile-focus-card');const focusFooter=make('small','mobile-focus-footer'),focusHint=make('span'),focusGlyph=make('i');focusFooter.append(focusHint,focusGlyph);focus.button.append(focusFooter);
  const note=card('Latest note',()=>{const n=source().latest;if(!available('notes','Notes'))return;if(!n){openCapture({currentTarget:note.button});return}if(navigate('projects')){el('projects-note').click();openItem(n.id)}});note.button.classList.add('mobile-note-card');
  const noteProject=make('small','');note.button.append(noteProject);
  const tasks=card('Tasks',()=>{if(!available('task-manager','Tasks'))return;if(navigate('projects'))window.OpenSesamePageWidgets.open('builtin-task-manager')});tasks.button.classList.add('mobile-summary-link');
  const taskSection=make('section','mobile-task-section'),taskList=make('div','mobile-task-list');taskSection.setAttribute('aria-label','Today’s tasks');taskSection.append(tasks.button,taskList);home.append(taskSection);
  const familiar=make('button','mobile-familiar-entry'),familiarSeal=make('span','mobile-familiar-seal'),familiarCopy=make('span'),familiarTitle=make('strong','','A familiar, by your side.'),familiarStatus=make('small');familiar.type='button';familiarSeal.setAttribute('aria-hidden','true');familiarCopy.append(familiarTitle,familiarStatus);familiar.append(familiarSeal,familiarCopy);familiar.addEventListener('click',()=>{if(!available('coven','Coven'))return;if(navigate('console')){el('agents-familiars').click();el('agents-familiars').focus({preventScroll:true})}});home.append(familiar);
  const reader=card('Reading',()=>{if(!available('reader','Reader'))return;if(window.OpenSesameNotes?.finish(false)===false)return;remember();today=false;changeScenario('reading');const later=panel.querySelector('[data-reading-scope=later]');later.click();window.openSesameReading?.openSaved(source().reading.links?.[0]?.id);sync();later.focus({preventScroll:true})});reader.button.classList.add('mobile-summary-link','mobile-reading-link');home.append(reader.button);
  const nav=make('nav','mobile-navigation');nav.setAttribute('aria-label','Mobile destinations');
  const buttons=new Map();
  for(const [id,label,glyph] of [['today','Today','compass'],['projects','Projects','items'],['widgets','Widgets','plugins'],['focus','Focus','focus'],['console','Console','terminal']]){
    const b=make('button','');b.type='button';b.innerHTML=id==='console'?mark.outerHTML:icon(glyph);b.append(make('span','',label));b.dataset.mobileDestination=id;b.addEventListener('click',()=>navigate(id));nav.append(b);buttons.set(id,b);
  }
  panel.prepend(header);panel.append(home,nav);
  const itemsBack=make('button','mobile-items-back','Back to items');itemsBack.id='mobile-items-back';itemsBack.type='button';itemsBack.hidden=true;
  itemsBack.addEventListener('click',()=>{
    if(window.OpenSesameProjects.closeDetails()){sync();el('capture-list').focus({preventScroll:true})}
  });
  el('note-detail').prepend(itemsBack);
  function available(id,label){if(window.OpenSesameWidgetLifecycle.isActive(id)||id==='reader'&&window.OpenSesameWidgetLifecycle.isActive('rss'))return true;if(navigate('widgets')){if(el('plugins-connected').getAttribute('aria-pressed')==='true')el('plugins-connected').click();el('plugins-category').value='all';el('plugins-category').dispatchEvent(new Event('change'));const search=el('plugins-search');search.value=label;search.dispatchEvent(new Event('input',{bubbles:true}));search.focus({preventScroll:true})}return false}
  function source(){return M.today({items:items.filter(n=>inProject(n)),workflow:OpenSesameItemWorkflow,focus:{remaining:focusRemaining,running:focusRunning},reading:window.openSesameReading?.summary()||{count:0}})}
  let taskSignature='';
  function updateToday(){
    const data=source();date.textContent=new Intl.DateTimeFormat(undefined,{weekday:'long',month:'short',day:'numeric'}).format(new Date());
    note.detail.textContent=data.latest?(OpenSesameItemWorkflow.excerpt(data.latest.body)||thoughtTitle(data.latest)):'What’s on your mind?';note.button.disabled=false;note.button.setAttribute('aria-label',data.latest?'Latest note: '+thoughtTitle(data.latest):'Capture your first note');noteProject.textContent=data.latest?projectName(data.latest.projectId):'Your next idea';
    tasks.detail.textContent=data.tasks.open+' open · '+data.tasks.done+' completed';
    focus.detail.textContent=time(data.focus.remaining);focusHint.textContent=data.focus.running?'In your own rhythm':'Make space to begin';focusGlyph.innerHTML=icon(data.focus.running?'pause':'play');focus.button.setAttribute('aria-label','Focus · '+(data.focus.running?'In progress · ':'Ready · ')+time(data.focus.remaining));
    reader.detail.textContent=data.reading.count+' saved for later'+(data.reading.links?.[0]?' · '+data.reading.links[0].title:' · Open Reader');
    const f=window.OpenSesameFamiliars?.snapshot(),selected=f?.connected?f.selected:null,seal=M.seal(selected);
    familiarSeal.textContent=seal.initial||'◇';familiarSeal.dataset.sealShape=seal.shape;familiarStatus.textContent=!window.OpenSesameWidgetLifecycle.isActive('coven')?'Activate Coven in Widgets':selected?selected.displayName+' · Open conversation':f?.connected?'Choose a familiar':'Desktop not connected';
    const taskActive=window.OpenSesameWidgetLifecycle.isActive('task-manager');
    const signature=JSON.stringify([taskActive,data.tasks.entries.map(n=>[n.id,thoughtTitle(n),n.projectId,projectName(n.projectId)])]);
    if(signature!==taskSignature){
      const focused=taskList.contains(document.activeElement);taskSignature=signature;taskList.replaceChildren();
      for(const n of data.tasks.entries){
        const row=make('div','mobile-task-row'),check=make('button','mobile-task-check'),open=make('button','mobile-task-open'),title=make('span','',thoughtTitle(n)),project=make('small','',projectName(n.projectId));
        check.type=open.type='button';check.disabled=open.disabled=!taskActive;check.setAttribute('aria-label','Complete task: '+thoughtTitle(n));check.setAttribute('aria-pressed','false');check.innerHTML=icon('check');
        check.addEventListener('click',()=>{try{window.OpenSesameTaskStore.update(n.id,{completed:true})}catch(error){toast(error.message)}});
        open.addEventListener('click',()=>{if(navigate('projects')){window.OpenSesamePageWidgets.open('builtin-task-manager');window.OpenSesameTaskManager.openTask(n.id)}});open.append(title,project);row.append(check,open);taskList.append(row);
      }
      if(focused)tasks.button.focus({preventScroll:true});
    }
  }
  // Remember actual nodes and scroll offsets; switching never clones or reparents a pane.
  const positions=new Map();let current=null;
  function remember(){if(!current)return;positions.set(current,[...panel.querySelectorAll('.widget-pane, .widget-pane *')].filter(n=>n.scrollTop||n.scrollLeft).map(n=>[n,n.scrollTop,n.scrollLeft]))}
  function navigate(id){
    if(!active||window.OpenSesameNotes?.finish(false)===false)return false;
    if(id==='today')window.OpenSesameContentFocus?.exit({restoreFocus:false});remember();today=id==='today';
    if(!today)changeScenario(({projects:'items',widgets:'plugins',focus:'focus',console:'agents'})[id]);
    sync();for(const [node,top,left] of positions.get(id)||[]){node.scrollTop=top;node.scrollLeft=left}
    buttons.get(id)?.focus({preventScroll:true});return true;
  }
  function openCapture(event){previousFocus=event?.currentTarget||capture;window.OpenSesameLauncher.open();sync()}
  function captureClosed(){sync();if(active)(previousFocus?.isConnected&&previousFocus.getClientRects().length?previousFocus:capture).focus({preventScroll:true});previousFocus=null}
  capture.addEventListener('click',openCapture);
  function sync(){
    const next=query.matches&&!window.__OPEN_SESAME_NATIVE__;
    if(next!==active){active=next;root.classList.toggle('open-sesame-mobile',active);if(active){previousExpanded=state.expanded;state.expanded=true;today=true;render()}else{today=false;state.expanded=previousExpanded;render()}}
    if(active&&!state.expanded){state.expanded=true;render()}
    header.hidden=nav.hidden=!active;home.hidden=!active||!today;
    const modal=active&&window.OpenSesameLauncher?.active;
    root.classList.toggle('mobile-today-open',active&&today);root.classList.toggle('mobile-capture-open',!!modal);
    if(modal){
      for(const n of [header,home,nav,el('activity-menu')?.parentElement,...panel.querySelectorAll(':scope > .widget-pane,:scope > #agents-workspace,:scope > #lockin-workspace')].filter(Boolean)){
        if(!inertBefore.has(n))inertBefore.set(n,n.inert);n.inert=true;
      }
    }else{for(const [n,inert] of inertBefore)n.inert=inert;inertBefore.clear()}
    capture.setAttribute('aria-expanded',String(!!modal));homeCapture.setAttribute('aria-expanded',String(!!modal));
    current=today?'today':M.destination(state.scenario);
    for(const [id,b] of buttons){if(id===current)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')}
    const narrowDetail=active&&innerWidth<=600&&state.scenario==='items'&&!window.OpenSesamePageWidgets?.active&&libraryOpen&&!!currentItem();
    root.classList.toggle('mobile-project-detail',narrowDetail);itemsBack.hidden=!narrowDetail;
    if(narrowDetail)itemsBack.textContent='Back to '+({note:'notes',task:'tasks',bookmark:'bookmarks'})[itemKind(currentItem())];
    if(state.scenario==='familiars')window.OpenSesameRails?.apply('familiars',{defaultOpen:!(active&&innerWidth<=600&&innerHeight<=420)});
    el('familiar-list').setAttribute('aria-orientation',active&&innerWidth<=600?'horizontal':'vertical');
    if(active)updateToday();
  }
  function schedule(){if(!scheduled)scheduled=requestAnimationFrame(()=>{scheduled=0;sync()})}
  function viewport(){if(!active)return;const v=window.visualViewport;root.style.setProperty('--mobile-height',(v?.height||innerHeight)+'px');root.style.setProperty('--mobile-top',(v?.offsetTop||0)+'px');schedule()}
  footer.addEventListener('keydown',event=>{
    if(!active||!window.OpenSesameLauncher?.active||event.key!=='Tab')return;
    const nodes=[...footer.querySelectorAll('button,input,textarea,select,[tabindex="0"]')].filter(n=>!n.disabled&&n.getClientRects().length);
    if(!nodes.length)return;const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  });
  for(const event of ['open-sesame-layout','open-sesame-items-changed','open-sesame-projects-changed','open-sesame-reading-changed','open-sesame-focus-tick','open-sesame-familiars-changed','open-sesame-widgets-changed'])window.addEventListener(event,schedule);
  window.addEventListener('open-sesame-view-changed',()=>{const fromHome=home.contains(document.activeElement);today=false;sync();if(active&&fromHome)(buttons.get(M.destination(state.scenario))||capture).focus({preventScroll:true})});
  query.addEventListener('change',()=>{sync();viewport()});window.addEventListener('resize',viewport);window.visualViewport?.addEventListener('resize',viewport);window.visualViewport?.addEventListener('scroll',viewport);
  window.OpenSesameMobile={navigate,openCapture,captureClosed,get active(){return active}};
  sync();viewport();
})();
