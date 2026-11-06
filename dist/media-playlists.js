'use strict';
(() => {
  const el=id=>document.getElementById(id),deck=el('media-carousel'),library=el('media-library');
  let view='rail',api=null,dbPromise,selectedId='',currentName='',saveBusy=false,previousIndex=-1,signature='',deleteId='';
  try{view=localStorage.getItem('open-sesame-media-view')==='carousel'?'carousel':'rail'}catch{}
  function database(){
    if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
      const r=indexedDB.open('open-sesame-media-playlists',1);
      r.onupgradeneeded=()=>r.result.createObjectStore('playlists',{keyPath:'id'});
      r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
    }).catch(error=>{dbPromise=null;throw error});
    return dbPromise;
  }
  async function store(mode,action){
    const db=await database();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('playlists',mode),r=action(tx.objectStore('playlists'));
      tx.oncomplete=()=>resolve(r.result);tx.onabort=tx.onerror=()=>reject(tx.error||Error('Device storage is unavailable.'));
    });
  }
  async function list(){
    const target=el('media-saved-lists');target.replaceChildren();
    let saved;try{saved=await store('readonly',s=>s.getAll())}catch{el('media-save-status').textContent='Device storage is unavailable. You can still use the current queue.';return}
    if(library.hidden)return;
    target.replaceChildren();saved.sort((a,b)=>b.updated-a.updated);
    if(!saved.length){const empty=document.createElement('p');empty.textContent='No saved playlists yet.';target.append(empty)}
    for(const record of saved){
      const row=document.createElement('div'),open=document.createElement('button'),remove=document.createElement('button');
      open.type=remove.type='button';open.textContent=record.name;const count=document.createElement('small');count.textContent=record.entries.length+' tracks';open.append(count);
      open.addEventListener('click',()=>{selectedId=record.id;currentName=record.name;api.adopt(record.entries,record.name,false);hide()});
      remove.setAttribute('aria-label','Delete '+record.name);remove.textContent=deleteId===record.id?'Confirm':'×';
      remove.addEventListener('click',async()=>{
        if(deleteId!==record.id){deleteId=record.id;await list();return}
        try{await store('readwrite',s=>s.delete(record.id));if(selectedId===record.id)reset();deleteId='';await list()}catch{el('media-save-status').textContent='Could not delete this playlist.'}
      });
      row.append(open,remove);target.append(row);
    }
  }
  function reset(){selectedId='';currentName=''}
  function hide(){library.hidden=true;deleteId='';el('media-file-open').focus({preventScroll:true})}
  el('media-library-open').addEventListener('click',()=>{
    api.closeMenu();deleteId='';library.hidden=false;const {queue,index}=api.state();
    el('media-playlist-name').value=currentName||queue[index]?.title?.replace(/\.[^.]+$/,'')||'';
    el('media-save-status').textContent='';el('media-save-row').hidden=!queue.length;el('media-save-scope').value='queue';
    list();(queue.length?el('media-playlist-name'):el('media-library-close')).focus({preventScroll:true});
  });
  el('media-library-close').addEventListener('click',hide);
  library.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();hide()}});
  document.addEventListener('pointerdown',e=>{if(!library.hidden&&!e.target.closest('#media-library,#media-library-open,#open-sesame-select-menu'))library.hidden=true});
  el('media-save-list').addEventListener('click',async()=>{
    if(saveBusy)return;
    const {queue,index}=api.state(),one=el('media-save-scope').value==='one';
    const name=el('media-playlist-name').value.trim();
    if(!name||!queue[index]){el('media-save-status').textContent='Add a name and at least one track.';return}
    const entries=one?[queue[index]]:[...queue];
    const id=!one&&name===currentName&&selectedId?selectedId:newId();
    saveBusy=true;el('media-save-list').disabled=true;
    try{
      await store('readwrite',s=>s.put({id,name,entries,updated:Date.now()}));
      if(api.state().queue===queue && api.state().index===index){selectedId=id;currentName=name;api.adopt(entries,name,true)}
      el('media-save-status').textContent='Saved on this device.';await list();
    }catch{el('media-save-status').textContent='Could not save on this device. Your queue is still open.'}
    finally{saveBusy=false;el('media-save-list').disabled=false}
  });

  function paint(queue,index){
    const toggle=el('media-view-toggle');
    toggle.hidden=!queue.length;toggle.setAttribute('aria-label',view==='rail'?'Show carousel':'Show side rail');toggle.title=toggle.getAttribute('aria-label');
    toggle.innerHTML=icon(view==='rail'?'items':'rail-right');
    deck.hidden=!queue.length||view!=='carousel';
    el('media-append').hidden=!queue.length;
    const full=state.size==='full';
    el('media-full').innerHTML=icon(full?'collapse':'expand');el('media-full').setAttribute('aria-label',full?'Return to previous size':'Enter Full size');el('media-full').title=el('media-full').getAttribute('aria-label');
    el('media-full').setAttribute('aria-pressed',String(full));
    if(deck.hidden){signature='';return}
    const slice=queue.slice(Math.max(0,index-1),index+2),key=JSON.stringify([index,queue.length,slice.map(e=>e.key||e.url)]);
    if(key===signature)return;
    signature=key;
    const direction=index>=previousIndex?1:-1;previousIndex=index;
    deck.replaceChildren();
    for(let offset=-1;offset<=1;offset++){
      const pos=index+offset,entry=queue[pos];
      if(!entry){const space=document.createElement('span');space.className='media-card-spacer';deck.append(space);continue}
      const card=document.createElement('button'),copy=document.createElement('span'),name=document.createElement('strong'),detail=document.createElement('small');
      card.type='button';card.className='media-card '+(offset<0?'before':offset>0?'after':'front');card.title=entry.title;
      const hue=Array.from(entry.title).reduce((sum,ch)=>(sum*31+ch.codePointAt(0))%360,240);
      card.style.setProperty('--card-hue',String(hue));card.innerHTML=icon(entry.kind==='audio'?'music':'play');
      name.textContent=entry.title.replace(/\.[^.]+$/,'');detail.textContent=(pos+1)+' / '+queue.length+' · '+(entry.kind==='audio'?'Audio':'Video');
      copy.append(name,detail);card.append(copy);card.setAttribute('aria-label',(offset?'Play ':'Current track: ')+entry.title);
      if(!offset)card.setAttribute('aria-current','true');
      card.addEventListener('click',()=>{if(pos!==api.state().index)api.select(pos,true)});
      deck.append(card);
    }
    if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)for(const card of deck.querySelectorAll('.media-card')){
      card.animate?.([{translate:(14*direction)+'px 0',opacity:.65},{translate:'0 0',opacity:1}],{duration:190,easing:'ease-out'});
    }
  }
  function change(delta){
    const {queue,index}=api.state(),next=index+delta;
    if(next<0||next>=queue.length)return;api.select(next,true);deck.focus({preventScroll:true});
  }
  deck.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();e.stopPropagation();change(e.key==='ArrowLeft'?-1:1)}});
  let touch;
  deck.addEventListener('touchstart',e=>{touch=e.touches[0].clientX},{passive:true});
  deck.addEventListener('touchend',e=>{if(touch===undefined)return;const dx=e.changedTouches[0].clientX-touch;touch=undefined;if(Math.abs(dx)>40)change(dx<0?1:-1)});
  el('media-view-toggle').addEventListener('click',()=>{
    view=view==='rail'?'carousel':'rail';try{localStorage.setItem('open-sesame-media-view',view)}catch{}
    api.render();if(view==='rail')window.OpenSesameRails.set('media',true);
  });
  el('media-full').addEventListener('click',()=>{window.OpenSesameFrame.toggleFull();api.render()});
  window.addEventListener('open-sesame-view-changed',()=>{library.hidden=true});
  window.OpenSesameMediaPlaylists={paint,reset,attach(value){api=value},get rail(){return view==='rail'}};
})();
