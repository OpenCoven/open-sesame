'use strict';
(()=>{
  const el=id=>document.getElementById(id),workspace=el('familiars-workspace'),rail=el('familiar-rail'),key='open-sesame-familiar-rail-width-v1';
  const handle=document.createElement('div');handle.id='familiar-rail-resize';handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');handle.setAttribute('aria-controls','familiar-rail');handle.setAttribute('aria-label','Resize familiar list');handle.title='Drag to resize or close · Double-click to reset · Arrow keys resize';workspace.append(handle);
  let preferred=null,drag=null;
  try{const saved=JSON.parse(localStorage.getItem(key)||'null');if(Number.isFinite(saved)&&saved>=132&&saved<=420)preferred=saved}catch{}
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  function limits(){return {min:132,max:Math.max(132,Math.min(420,workspace.clientWidth*.55,workspace.clientWidth-220))}}
  function defaultWidth(){const w=workspace.clientWidth;return w<=420?132:w<=650?152:clamp(w*.216,168,248)}
  const open=()=>!workspace.classList.contains('rail-collapsed');
  function paint(value=preferred??defaultWidth()){
    const {min,max}=limits(),width=clamp(value,min,max);workspace.style.setProperty('--familiar-rail-width',width+'px');handle.setAttribute('aria-valuemin','0');handle.setAttribute('aria-valuemax',String(Math.round(max)));handle.setAttribute('aria-valuenow',String(open()?Math.round(width):0));handle.setAttribute('aria-valuetext',open()?Math.round(width)+' pixels. Drag left to close.':'Collapsed. Drag right or press Enter to open.');return width;
  }
  function save(){try{if(preferred===null)localStorage.removeItem(key);else localStorage.setItem(key,JSON.stringify(preferred))}catch{}}
  function finish(commit){
    const current=drag;if(!current)return;drag=null;workspace.classList.remove('rail-resizing','rail-collapse-ready');
    if(!commit){preferred=current.previous;window.OpenSesameRails.set('familiars',current.open)}
    else if(current.width<80){preferred=current.previous;window.OpenSesameRails.set('familiars',false)}
    else if(current.moved){preferred=paint(current.width);window.OpenSesameRails.set('familiars',true);save()}
    paint();if(handle.hasPointerCapture(current.id))handle.releasePointerCapture(current.id);window.dispatchEvent(new Event('open-sesame-layout'));
  }
  handle.addEventListener('pointerdown',event=>{
    if(event.button!==0||drag)return;event.preventDefault();handle.focus({preventScroll:true});
    const wasOpen=open(),bounds=workspace.getBoundingClientRect();drag={id:event.pointerId,x:event.clientX,start:wasOpen?paint():0,width:wasOpen?paint():0,scale:bounds.width/workspace.clientWidth||1,previous:preferred,open:wasOpen,moved:false};handle.setPointerCapture(event.pointerId);workspace.classList.add('rail-resizing');
  });
  handle.addEventListener('pointermove',event=>{
    if(!drag||drag.id!==event.pointerId)return;const delta=(event.clientX-drag.x)/drag.scale;if(Math.abs(delta)<3&&!drag.moved)return;drag.moved=true;drag.width=Math.max(0,Math.min(limits().max,drag.start+delta));
    if(!open()&&drag.width>12)window.OpenSesameRails.set('familiars',true);paint(drag.width);workspace.classList.toggle('rail-collapse-ready',drag.width<80);
  });
  handle.addEventListener('pointerup',event=>{if(drag?.id===event.pointerId)finish(drag.moved)});
  for(const name of ['pointercancel','lostpointercapture'])handle.addEventListener(name,()=>finish(false));
  handle.addEventListener('dblclick',event=>{event.preventDefault();finish(false);preferred=null;save();window.OpenSesameRails.set('familiars',true);paint()});
  handle.addEventListener('keydown',event=>{
    if(event.metaKey||event.ctrlKey||event.altKey)return;
    if(event.key==='Escape'&&drag){event.preventDefault();event.stopImmediatePropagation();finish(false);return}
    if(!['ArrowLeft','ArrowRight','Home','End','Enter',' '].includes(event.key))return;event.preventDefault();event.stopPropagation();
    if(event.key==='Home'){window.OpenSesameRails.set('familiars',false);paint();return}
    if(['Enter',' '].includes(event.key)){window.OpenSesameRails.toggle('familiars');paint();return}
    const width=event.key==='End'?limits().max:(open()?paint():limits().min)+(event.key==='ArrowLeft'?-1:1)*(event.shiftKey?40:16);
    if(width<limits().min)window.OpenSesameRails.set('familiars',false);else{preferred=paint(width);save();window.OpenSesameRails.set('familiars',true)}paint();
  });
  window.addEventListener('blur',()=>finish(false));window.addEventListener('pagehide',()=>finish(false));
  window.addEventListener('open-sesame-view-changed',()=>{finish(false);if(!workspace.closest('[hidden]'))paint()});window.addEventListener('open-sesame-rails-changed',()=>paint(drag?.width));
  new ResizeObserver(()=>{if(drag)finish(false);paint()}).observe(workspace);
  paint();
})();
