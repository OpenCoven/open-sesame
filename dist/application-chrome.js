'use strict';
(()=>{
  const el=id=>document.getElementById(id),panel=el('widget-panel'),rail=panel.querySelector('.panel-top');
  const make=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls;if(text)n.textContent=text;return n};
  const bar=make('header','application-toolbar'),identity=make('div','application-identity'),logo=make('img',''),title=make('strong','','Open Sesame'),page=make('span','application-page');
  logo.src='assets/open-sesame-logo.png';logo.alt='';identity.append(logo,title,page);bar.append(identity);panel.prepend(bar);
  const controls=make('div','workspace-window-controls');controls.setAttribute('role','group');controls.setAttribute('aria-label','Window controls');
  function button(id,name,glyph,fn){const b=make('button','');b.id=id;b.type='button';b.title=name;b.setAttribute('aria-label',name);b.innerHTML=icon(glyph);b.append(make('span','',name));b.addEventListener('click',fn);controls.append(b);return b}
  const pin=button('window-keep-open','Keep widget open','pin',()=>el('widget-pin').click());
  // Use the same native display menu and status as the overflow action.
  const display=button('window-display','Pin to display','monitor',()=>el('widget-display')?.click());display.hidden=!window.__OPEN_SESAME_NATIVE__;display.setAttribute('aria-haspopup','menu');
  const dock=button('window-dock','Dock to notch','popout',()=>window.OpenSesameWindow?.dock());dock.className='application-only';
  button('window-maximize','Fill screen','expand',()=>el('panel-fullscreen').click()).className='application-only';
  let displayStatus={};
  function sync(){
    const detached=window.OpenSesameWindow?.detached===true,full=document.documentElement.classList.contains('open-sesame-edge-to-edge'),app=detached||full;
    bar.hidden=!app;panel.classList.toggle('application-layout',app);controls.classList.toggle('application-controls',app);
    const parent=app?bar:rail;if(controls.parentElement!==parent)parent.insertBefore(controls,app?null:el('widget-options-toggle'));
    pin.innerHTML=el('widget-pin').querySelector('svg').outerHTML;pin.append(make('span','',detached?'Keep on top':'Keep open'));pin.setAttribute('aria-pressed',String(state.pinned===true));pin.title=pin.ariaLabel=detached?(state.pinned?'Keep on top · On':'Keep on top · Off'):(state.pinned?'Keep widget open · On · click to allow outside dismissal':'Keep widget open · Off · click to pin');
    dock.hidden=!detached;const maximize=el('window-maximize'),nativeFull=el('panel-fullscreen');maximize.title=maximize.ariaLabel=nativeFull.getAttribute('aria-label');maximize.setAttribute('aria-pressed',nativeFull.getAttribute('aria-pressed')||'false');maximize.querySelector('span').textContent=maximize.title;
    const current=({focus:'Agenda',music:'Media',youtube:'Media',media:'Media',items:'Projects',terminal:'Console',familiars:'Console','agent-monitor':'Console','computer-agent':'Console',remote:'Console',reading:'Reader',audio:'Live',plugins:'Widgets'})[state.scenario]||'';page.textContent=current;
    for(const b of el('activity-menu').querySelectorAll('button')){const span=b.querySelector('span');if(span)span.classList.toggle('sr-only',!app)}
    display.title=display.ariaLabel=displayStatus.pinned?'Pinned to '+(displayStatus.name||'display')+(displayStatus.available===false?' · disconnected':''):'Pin to display · '+(detached?'Move freely':'Following pointer');display.setAttribute('aria-pressed',String(displayStatus.pinned===true));
  }
  window.addEventListener('open-sesame-desktop-event',e=>{if(e.detail?.event==='window.display.changed'){displayStatus=e.detail.status;sync()}});
  window.addEventListener('open-sesame-layout',sync);window.addEventListener('open-sesame-view-changed',sync);window.addEventListener('open-sesame-pin-changed',sync);
  if(window.__OPEN_SESAME_NATIVE__)openSesameBridge.ready.then(()=>openSesameBridge.request('window.display.status')).then(s=>{displayStatus=s;sync()}).catch(()=>{});
  new MutationObserver(sync).observe(el('panel-fullscreen'),{attributes:true,attributeFilter:['aria-label','aria-pressed']});
  sync();
})();
