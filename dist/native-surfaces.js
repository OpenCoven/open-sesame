'use strict';
(()=>{
  const records=new Map();let frame=0,sequence=0;
  const native=()=>window.__OPEN_SESAME_NATIVE__===true;
  const request=(method,record,params={})=>openSesameBridge.request(method,{id:record.id,generation:record.generation,...params});
  const intersects=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
  function geometry(record){
    const r=record.element.getBoundingClientRect(),style=getComputedStyle(record.element);
    let visible=record.element.isConnected&&record.element.getClientRects().length>0&&style.visibility!=='hidden'&&!document.hidden&&state.expanded===true&&!window.OpenSesameLauncher?.active;
    const clip={left:Math.max(0,r.left),top:Math.max(0,r.top),right:Math.min(window.innerWidth,r.right),bottom:Math.min(window.innerHeight,r.bottom)};
    // Native child views do not inherit CSS overflow clipping from their DOM placeholder.
    for(let parent=record.element.parentElement;parent;parent=parent.parentElement){
      const css=getComputedStyle(parent),bounds=parent.getBoundingClientRect();
      if(css.visibility==='hidden'||css.display==='none')visible=false;
      if(/^(hidden|clip|scroll|auto)$/.test(css.overflowX)){clip.left=Math.max(clip.left,bounds.left);clip.right=Math.min(clip.right,bounds.right)}
      if(/^(hidden|clip|scroll|auto)$/.test(css.overflowY)){clip.top=Math.max(clip.top,bounds.top);clip.bottom=Math.min(clip.bottom,bounds.bottom)}
    }
    visible=visible&&clip.right>clip.left&&clip.bottom>clip.top;
    if(visible)for(const overlay of document.querySelectorAll('dialog[open],[role=dialog],[role=listbox],[role=menu],.voice-popover,.glass-sheet,.glass-popover,.workspace-menu,.bookmark-batch,#capture-commands,.playlist-overlay #youtube-queue')){
      if(overlay.hidden||overlay.contains(record.element)||!overlay.getClientRects().length)continue;
      if(intersects(r,overlay.getBoundingClientRect())){visible=false;break}
    }
    return {x:r.left,y:r.top,width:r.width,height:r.height,clip:{x:clip.left,y:clip.top,width:Math.max(0,clip.right-clip.left),height:Math.max(0,clip.bottom-clip.top)},visible};
  }
  function sync(){
    frame=0;for(const record of records.values()){
      const value=geometry(record),key=JSON.stringify(value);if(key===record.frame)continue;record.frame=key;
      request('webview.frame',record,value).catch(()=>{});
    }
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(sync)}
  function remove(record){
    if(records.get(record.id)!==record)return;
    records.delete(record.id);record.observer.disconnect();request('webview.close',record).catch(()=>{});
  }
  function create(id,element){
    const previous=records.get(id);if(previous)remove(previous);
    const record={id,element,generation:'surface-'+Date.now().toString(36)+'-'+(++sequence),snapshot:{},frame:'',url:'',events:null,observer:new ResizeObserver(schedule)};
    records.set(id,record);record.observer.observe(element);return record;
  }
  function bookmark(url,visible,{id='bookmark',element=null}={}){
    if(!native())return false;
    let record=records.get(id);
    if(!visible||!url){if(record)remove(record);return true}
    element=element||document.getElementById('bookmark-embed-wrap');record=record||create(id,element);
    if(record.url!==url){record.url=url;request('webview.open',record,{url}).then(()=>{record.frame='';schedule()}).catch(error=>toast(error.message))}
    schedule();return true;
  }
  async function youtube(element,source,events){
    const record=create('youtube',element);record.events=events;
    await request('webview.open',record,{source:{id:source.id||'',list:source.list||'',start:source.start||0}});
    if(records.get('youtube')!==record){request('webview.close',record).catch(()=>{});throw Error('Player was closed.')}
    schedule();const command=(action,...args)=>request('webview.command',record,{action,args}).catch(error=>toast(error.message));
    return {
      destroy:()=>remove(record),getPlaylist:()=>record.snapshot.playlist||[],getPlaylistIndex:()=>record.snapshot.index||0,getVideoUrl:()=>record.snapshot.url||'',getVideoData:()=>record.snapshot.video||{},getCurrentTime:()=>record.snapshot.time||0,getDuration:()=>record.snapshot.duration||0,getVolume:()=>record.snapshot.volume??100,isMuted:()=>!!record.snapshot.muted,getPlayerState:()=>record.snapshot.state??-1,
      playVideo:()=>command('playVideo'),pauseVideo:()=>command('pauseVideo'),seekTo:value=>command('seekTo',value),setVolume:value=>command('setVolume',value),mute:()=>command('mute'),unMute:()=>command('unMute'),setShuffle:value=>command('setShuffle',value),loadPlaylist:(...args)=>command('loadPlaylist',...args),cuePlaylist:(...args)=>command('cuePlaylist',...args)
    };
  }
  window.addEventListener('open-sesame-desktop-event',event=>{
    const data=event.detail,record=records.get(data.id);
    if(!record||record.generation!==data.generation)return;
    if(data.event==='webview.youtube'){
      record.snapshot=data.payload.snapshot||{};const callbacks=record.events;
      if(data.payload.type==='ready')callbacks?.onReady?.();else if(data.payload.type==='error')callbacks?.onError?.({data:data.payload.code});else callbacks?.onStateChange?.();
    }else if(data.event==='webview.error')toast(data.message);
  });
  for(const event of ['resize','open-sesame-layout','open-sesame-view-changed','open-sesame-rails-changed'])window.addEventListener(event,schedule);
  document.addEventListener('visibilitychange',schedule);document.addEventListener('scroll',schedule,true);
  new MutationObserver(schedule).observe(document.getElementById('widget-panel'),{attributes:true,childList:true,subtree:true,attributeFilter:['hidden','class','style','open']});
  window.addEventListener('pagehide',()=>{for(const record of [...records.values()])remove(record)});
  window.OpenSesameNativeSurfaces={bookmark,youtube,sync:schedule};
})();
