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
  capture.type='button';capture.id='mobile-capture';capture.setAttribute('aria-haspopup','dialog');header.append(brand,capture);
  const home=make('section','mobile-today');home.id='mobile-today';home.tabIndex=-1;home.setAttribute('aria-label','Today');
  const heading=make('h1','','Today'),intro=make('p','','A little room for what matters.'),cards=make('div','mobile-today-cards');home.append(heading,intro,cards);
  function card(label,action){const b=make('button','mobile-card'),title=make('strong','',label),detail=make('span','');b.type='button';b.append(title,detail);b.addEventListener('click',action);cards.append(b);return {button:b,title,detail}}
  const note=card('Latest note',()=>{const n=source().latest;if(n){navigate('projects');openItem(n.id)}});
  const tasks=card('Tasks',()=>navigate('projects'));
  const focus=card('Focus',()=>navigate('focus'));
  const reader=card('Reading',()=>{today=false;changeScenario('reading');sync()});
  const nav=make('nav','mobile-navigation');nav.setAttribute('aria-label','Mobile destinations');
  const buttons=new Map();
  for(const [id,label,glyph] of [['today','Today','compass'],['projects','Projects','items'],['widgets','Widgets','plugins'],['focus','Focus','focus'],['console','Console','terminal']]){
    const b=make('button','');b.type='button';b.innerHTML=icon(glyph);b.append(make('span','',label));b.dataset.mobileDestination=id;b.addEventListener('click',()=>navigate(id));nav.append(b);buttons.set(id,b);
  }
  panel.prepend(header);panel.append(home,nav);
  function source(){return M.today({items:items.filter(n=>inProject(n)),workflow:OpenSesameItemWorkflow,focus:{remaining:focusRemaining,running:focusRunning},reading:window.openSesameReading?.summary()||{count:0}})}
  function updateToday(){
    const data=source();note.detail.textContent=data.latest?thoughtTitle(data.latest):'Your next thought starts here.';note.button.disabled=!data.latest;
    tasks.detail.textContent=data.tasks.open+' open · '+data.tasks.done+' completed';
    focus.detail.textContent=(data.focus.running?'In progress · ':'Ready · ')+time(data.focus.remaining);
    reader.detail.textContent=data.reading.count+' saved for later · Open Reader';
  }
  // Remember actual nodes and scroll offsets; switching never clones or reparents a pane.
  const positions=new Map();let current=null;
  function remember(){if(!current)return;positions.set(current,[...panel.querySelectorAll('.widget-pane, .widget-pane *')].filter(n=>n.scrollTop||n.scrollLeft).map(n=>[n,n.scrollTop,n.scrollLeft]))}
  function navigate(id){
    if(!active)return;if(window.OpenSesameNotes?.finish(false)===false)return;
    remember();today=id==='today';
    if(!today)changeScenario(({projects:'items',widgets:'plugins',focus:'focus',console:'agents'})[id]);
    sync();for(const [node,top,left] of positions.get(id)||[]){node.scrollTop=top;node.scrollLeft=left}
    buttons.get(id)?.focus({preventScroll:true});
  }
  function openCapture(){previousFocus=capture;window.OpenSesameLauncher.open();sync()}
  function captureClosed(){sync();if(active)(previousFocus?.isConnected?previousFocus:capture).focus({preventScroll:true});previousFocus=null}
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
    capture.setAttribute('aria-expanded',String(!!modal));
    current=today?'today':M.destination(state.scenario);
    for(const [id,b] of buttons){if(id===current)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')}
    if(active)updateToday();
  }
  function schedule(){if(!scheduled)scheduled=requestAnimationFrame(()=>{scheduled=0;sync()})}
  function viewport(){if(!active)return;const v=window.visualViewport;root.style.setProperty('--mobile-height',(v?.height||innerHeight)+'px');root.style.setProperty('--mobile-top',(v?.offsetTop||0)+'px');schedule()}
  footer.addEventListener('keydown',event=>{
    if(!active||!window.OpenSesameLauncher?.active||event.key!=='Tab')return;
    const nodes=[...footer.querySelectorAll('button,input,textarea,select,[tabindex="0"]')].filter(n=>!n.disabled&&n.getClientRects().length);
    if(!nodes.length)return;const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  });
  for(const event of ['open-sesame-layout','open-sesame-items-changed','open-sesame-projects-changed','open-sesame-reading-changed','open-sesame-focus-tick'])window.addEventListener(event,schedule);
  window.addEventListener('open-sesame-view-changed',()=>{today=false;sync()});
  query.addEventListener('change',()=>{sync();viewport()});window.addEventListener('resize',viewport);window.visualViewport?.addEventListener('resize',viewport);window.visualViewport?.addEventListener('scroll',viewport);
  window.OpenSesameMobile={navigate,openCapture,captureClosed,get active(){return active}};
  sync();viewport();
})();
