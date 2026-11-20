'use strict';
/* Installation is independent of account connection and saved user content. */
(()=>{
  const key='open-sesame-widget-lifecycle-v2',legacyKey='open-sesame-widget-lifecycle-v1',ids=['github','coven','spotify','apple','youtube','claude','codex','rss','task-manager','agenda','local-media','shells','reader','transcribe','notes','bookmarks','processes','computer','desktops','image-generation'];
  const defaults=['agenda','local-media','task-manager','shells'];
  let states={},error=false;
  function validate(value){if(!value||Array.isArray(value)||typeof value!=='object'||Object.entries(value).some(([id,s])=>!ids.includes(id)||!['active','inactive','uninstalled'].includes(s)))throw Error('Invalid widget states');return value}
  try{
    const raw=(window.OpenSesameWorkspaceData||localStorage).getItem(key)??(window.OpenSesameWorkspaceData||localStorage).getItem(legacyKey);
    if(raw!==null){states=Object.fromEntries(defaults.map(id=>[id,'active']));Object.assign(states,validate(JSON.parse(raw)))}
    else{
      for(const id of ids)states[id]=defaults.includes(id)?'active':'uninstalled';
      if(JSON.parse((window.OpenSesameWorkspaceData||localStorage).getItem('open-sesame-builtin-widgets-v1')||'[]').includes('github'))states.github='active';
      const reading=JSON.parse((window.OpenSesameWorkspaceData||localStorage).getItem('open-sesame-reading-v1')||'{}');
      if(Array.isArray(reading.feeds)&&reading.feeds.length)states.rss='active';
    }
  }catch{error=true;states={}}
  const status=id=>ids.includes(id)?(states[id]||'uninstalled'):'uninstalled';
  function reflect(){if(typeof document!=='undefined')document.documentElement.dataset.widgetRss=status('rss')==='active'?'on':'off'}
  reflect();
  async function set(id,value){
    if(error)throw Error('Saved widget states need recovery. Original storage is preserved.');
    if(!ids.includes(id)||!['active','inactive','uninstalled'].includes(value))throw Error('Invalid widget state');
    const next={...states,[id]:value};await (window.OpenSesameWorkspaceData||localStorage).setItem(key,JSON.stringify(next));states=next;reflect();
    window.dispatchEvent(new CustomEvent('open-sesame-widgets-changed',{detail:{id,state:value}}));
  }
  window.addEventListener?.('storage',event=>{
    if(window.OpenSesameWorkspaceData)return; // IndexedDB generations own this scene; legacy events cannot replace them.
    if(event.key!==key&&event.key!==legacyKey&&event.key!==null)return;
    if(event.key===legacyKey&&(window.OpenSesameWorkspaceData||localStorage).getItem(key)!==null)return;
    const before=states;
    try{states=Object.fromEntries(defaults.map(id=>[id,'active']));Object.assign(states,validate(JSON.parse(event.newValue||'{}')));error=false}catch{states={};error=true}
    reflect();
    for(const id of ids)if((before[id]||'uninstalled')!==status(id))window.dispatchEvent(new CustomEvent('open-sesame-widgets-changed',{detail:{id,state:status(id)}}));
  });
  window.OpenSesameWidgetLifecycle={ids:Object.freeze([...ids]),defaults:Object.freeze([...defaults]),status,isActive:id=>status(id)==='active',set,get error(){return error}};
})();
