'use strict';
(()=>{
  const el=id=>document.getElementById(id),anchor=el('widget-anchor'),model=window.OpenSesameFrameModel;
  const handles=[...document.querySelectorAll('[data-frame-edge]')],slider=el('frame-resize-bottom'),hud=el('frame-size-hud');
  let previousSize='medium';
  try{const saved=localStorage.getItem('open-sesame-previous-frame-size');if(model.keys.includes(saved)&&saved!=='full')previousSize=saved}catch{}
  let drag=null,raf=0,hideTimer=0,lastNative=0,context='';
  const sizes=()=>model.presets(...frameScreen());
  const frame=()=>({width:parseFloat(anchor.style.getPropertyValue('--panel-width')),height:parseFloat(anchor.style.getPropertyValue('--panel-height'))});
  function label(size){return `${size.name} · ${size.width} × ${size.height}`}
  function describe(size){slider.setAttribute('aria-valuenow',model.keys.indexOf(size.key)+1);slider.setAttribute('aria-valuetext',label(size));hud.querySelector('span').textContent=label(size);hud.style.setProperty('--size-step',model.keys.indexOf(size.key))}
  function show(){clearTimeout(hideTimer);hud.hidden=false}
  function hide(){clearTimeout(hideTimer);hideTimer=setTimeout(()=>{hud.hidden=true},900)}
  function announce(size){el('frame-announcement').textContent='Widget size: '+label(size)}
  function paint(value){
    anchor.style.setProperty('--panel-width',value.width+'px');anchor.style.setProperty('--panel-height',value.height+'px');
    el('footprint').textContent=`${value.width} × ${value.height} px`;
    if(window.__OPEN_SESAME_NATIVE__&&performance.now()-lastNative>80){lastNative=performance.now();syncNativeWindow()}
    window.dispatchEvent(new Event('open-sesame-layout'));
  }
  function sync(){
    const next=[state.layout,...frameScreen()].join(':'),interrupted=drag&&(!state.expanded||next!==context||!anchor.classList.contains('frame-resizing'));if(interrupted)finish(false);
    if(state.size!=='full'&&previousSize!==state.size){previousSize=state.size;try{localStorage.setItem('open-sesame-previous-frame-size',previousSize)}catch{}}
    anchor.classList.toggle('frame-full',state.size==='full');
    context=next;const size=sizes().find(s=>s.key===state.size)||sizes()[1];describe(size);
    if(interrupted){paint(size);fit();syncNativeWindow()}
    el('size-preset-note').textContent=`${size.width} × ${size.height} · ${size.key==='full'?'Full desktop':'4:3'} · drag an outer edge`;
    el('frame-resize-layer').hidden=!state.expanded;
  }
  function finish(commit){
    if(!drag)return;cancelAnimationFrame(raf);raf=0;
    const session=drag;drag=null;anchor.classList.remove('frame-resizing');document.body.classList.remove('frame-dragging');
    try{if(session.handle.hasPointerCapture(session.id))session.handle.releasePointerCapture(session.id)}catch{}
    const chosen=commit&&session.moved?model.nearest(session.next.width,session.sizes):session.original;
    // Apply only the geometry. Do not remount editors, terminals, iframes, or media.
    state.size=chosen.key;paint(chosen);fit();persist();syncNativeWindow();sync();window.OpenSesameWindow?.sync();
    document.querySelectorAll('[data-widget-size]').forEach(b=>{const active=b.dataset.widgetSize===state.size;b.setAttribute('aria-pressed',active);b.classList.toggle('selected',active)});
    if(commit&&session.moved)announce(chosen);show();hide();
  }
  function start(event){
    if(event.button!==0||!state.expanded||drag||window.OpenSesameWindow?.detached)return;
    const handle=event.currentTarget,edge=handle.dataset.frameEdge;
    if(state.layout==='menu'&&edge.includes('right'))return;
    event.preventDefault();event.stopPropagation();clearTimeout(hoverTimer);
    // A topic's change handler commits its draft before fitted pagination replaces rows.
    if(document.activeElement?.closest?.('.focus-topic'))document.activeElement.blur();
    const options=sizes(),start=frame(),scale=anchor.getBoundingClientRect().width/start.width;
    drag={id:event.pointerId,handle,edge,x:event.clientX,y:event.clientY,scale:Math.max(.1,scale),start,next:start,sizes:options,original:options.find(s=>s.key===state.size),moved:false};
    context=[state.layout,...frameScreen()].join(':');handle.setPointerCapture(event.pointerId);anchor.classList.add('frame-resizing');document.body.classList.add('frame-dragging');show();
  }
  function move(event){
    if(!drag||drag.id!==event.pointerId)return;event.preventDefault();
    const dx=(event.clientX-drag.x)/drag.scale,dy=(event.clientY-drag.y)/drag.scale;
    if(!drag.moved&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<4)return;
    drag.moved=true;drag.next=model.resize(drag.start,drag.edge,dx,dy,{centered:state.layout==='notch',min:drag.sizes[0].width,max:drag.sizes.at(-1).width});
    const regular=drag.sizes[3],full=drag.sizes.at(-1);
    if(drag.next.width>regular.width){const t=(drag.next.width-regular.width)/(full.width-regular.width);drag.next.height=Math.round(regular.height+t*(full.height-regular.height))}
    if(!raf)raf=requestAnimationFrame(()=>{raf=0;if(drag){paint(drag.next);describe(model.nearest(drag.next.width,drag.sizes))}});
  }
  handles.forEach(handle=>{
    handle.addEventListener('pointerdown',start);handle.addEventListener('pointermove',move);
    handle.addEventListener('pointerup',event=>{if(drag?.id===event.pointerId){event.preventDefault();finish(true)}});
    handle.addEventListener('pointercancel',event=>{if(drag?.id===event.pointerId)finish(false)});
    handle.addEventListener('lostpointercapture',()=>{if(drag?.handle===handle)finish(false)});
  });
  slider.addEventListener('keydown',event=>{
    const i=model.keys.indexOf(state.size);let index;
    if(['ArrowRight','ArrowUp'].includes(event.key))index=Math.min(model.keys.length-1,i+1);
    if(['ArrowLeft','ArrowDown'].includes(event.key))index=Math.max(0,i-1);
    if(event.key==='Home')index=0;if(event.key==='End')index=model.keys.length-1;
    if(index===undefined)return;event.preventDefault();event.stopPropagation();if(drag)finish(false);
    state.size=model.keys[index];render();announce(sizes()[index]);show();
  });
  slider.addEventListener('focus',show);slider.addEventListener('blur',hide);
  document.addEventListener('keydown',event=>{if(drag&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();finish(false)}},true);
  window.addEventListener('blur',()=>finish(false));window.addEventListener('pagehide',()=>finish(false));
  window.addEventListener('resize',()=>{if(!window.__OPEN_SESAME_NATIVE__)return;const next=[state.layout,...frameScreen()].join(':');if(next!==context){finish(false);render()}});
  window.OpenSesameFrame={sync,toggleFull(){state.size=state.size==='full'?previousSize:'full';render();announce(sizes().find(s=>s.key===state.size))},get dragging(){return !!drag}};sync();
})();
