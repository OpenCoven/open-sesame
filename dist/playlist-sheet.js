'use strict';
(()=>{
  const panel=document.getElementById('widget-panel'),records=new Map();let active=null,muted=[];
  function restore(){for(const [node,inert] of muted)node.inert=inert;muted=[]}
  function closeAll(){active?.close()}
  const visible=record=>!!record.home.parentElement?.getClientRects().length;
  function retire(record){
    if(active!==record)return;
    active=null;restore();record.rail.classList.remove('playlist-sheet');record.rail.removeAttribute('role');record.rail.removeAttribute('aria-modal');record.home.after(record.rail);
  }
  function set(id,rail,sheet,close){
    let record=records.get(id);
    if(!record){
      const home=document.createComment(id+' playlist home'),button=document.createElement('button');rail.before(home);button.type='button';button.className='playlist-sheet-close';button.setAttribute('aria-label','Close playlist');button.title='Close playlist';button.innerHTML=icon('close');rail.querySelector('.playlist-rail-heading').append(button);button.addEventListener('click',()=>record.close());
      record={id,rail,home,button,close};records.set(id,record);
    }
    record.close=close;rail.dataset.short=String(panel.clientHeight<260);
    // Background resize/player callbacks cannot promote a hidden pane into a modal.
    sheet=sheet&&visible(record);
    if(sheet){
      if(active===record)return;
      closeAll();restore();active=record;panel.append(rail);rail.classList.add('playlist-sheet');rail.setAttribute('role','dialog');rail.setAttribute('aria-modal','true');
      for(const child of panel.children)if(child!==rail){muted.push([child,child.inert]);child.inert=true}
      (rail.querySelector('input[type=search]')||record.button).focus({preventScroll:true});
    }else retire(record);
  }
  document.addEventListener('keydown',event=>{
    if(!active||event.defaultPrevented||event.isComposing)return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeAll();return}
    if(event.key==='Tab'&&!event.ctrlKey&&!event.metaKey){
      const nodes=[...active.rail.querySelectorAll('button,input')].filter(node=>!node.disabled&&node.getClientRects().length),first=nodes[0],last=nodes.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
    }
  },true);
  window.addEventListener('open-sesame-view-changed',()=>{if(active&&!visible(active))retire(active)});
  new ResizeObserver(()=>{if(active)active.rail.dataset.short=String(panel.clientHeight<260)}).observe(panel);
  window.OpenSesamePlaylistSheet={set,closeAll};
})();
