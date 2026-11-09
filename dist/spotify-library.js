'use strict';
(()=>{
  const el=id=>document.getElementById(id),panel=el('spotify-library');
  let identity='',kind='tracks',epoch=0,busy=false,nextOffset=null,items=[],message='';
  const active=()=>window.OpenSesameMusic?.service==='spotify'&&window.OpenSesameWidgetLifecycle?.isActive('spotify')!==false;
  function render(){
    panel.hidden=!active()||!identity;
    panel.setAttribute('aria-busy',String(busy));
    for(const button of panel.querySelectorAll('[data-spotify-library]'))button.setAttribute('aria-pressed',String(button.dataset.spotifyLibrary===kind));
    el('spotify-library-refresh').disabled=busy;
    el('spotify-library-status').textContent=message||(busy?'Loading your '+(kind==='tracks'?'liked songs':'playlists')+'…':items.length?'':'No '+(kind==='tracks'?'liked songs':'playlists')+' in this account yet.');
    el('spotify-library-more').hidden=nextOffset===null;el('spotify-library-more').disabled=busy;
  }
  function renderItems(){
    const list=el('spotify-library-items');list.replaceChildren();
    for(const item of items){
      const button=document.createElement('button'),title=document.createElement('span'),detail=document.createElement('small');
      button.type='button';button.className='spotify-library-item';title.textContent=item.name;detail.textContent=item.detail;button.append(title,detail);button.title='Open '+item.name+' in the Spotify player';
      button.addEventListener('click',()=>{if(!identity||!active())return;el('music-url').value=item.url;el('music-source-form').requestSubmit()});list.append(button);
    }
  }
  async function load(offset=0){
    if(!identity||!active()||busy)return;
    const ticket=epoch;busy=true;message='';render();
    try{
      const page=await window.OpenSesameMusicAuth.spotifyLibrary(kind,offset);
      if(ticket!==epoch)return;
      const seen=new Set(offset?items.map(item=>item.id):[]);
      const incoming=(page.items||[]).filter(item=>{const parsed=window.OpenSesameMusic.parse(item.url);if(!parsed||parsed.service!=='spotify'||seen.has(item.id))return false;seen.add(item.id);return true});
      items=offset?[...items,...incoming]:incoming;nextOffset=Number.isInteger(page.nextOffset)&&page.nextOffset>offset?page.nextOffset:null;renderItems();
    }catch{if(ticket===epoch)message='Could not load your library. Reconnect Spotify to grant library access, or refresh to retry.'}
    finally{if(ticket===epoch){busy=false;render()}}
  }
  function reset(){epoch++;busy=false;items=[];nextOffset=null;message='';renderItems()}
  function sync(){
    const account=window.OpenSesameMusicAuth?.snapshot().spotify;
    const value=active()&&account?.connected?account.name+':'+account.expiresAt:'';
    if(value!==identity){reset();identity=value;render();if(identity)load()}else render();
  }
  for(const button of panel.querySelectorAll('[data-spotify-library]'))button.addEventListener('click',()=>{if(kind===button.dataset.spotifyLibrary)return;kind=button.dataset.spotifyLibrary;reset();render();load()});
  el('spotify-library-refresh').addEventListener('click',()=>{reset();load()});
  el('spotify-library-more').addEventListener('click',()=>{if(nextOffset!==null)load(nextOffset)});
  for(const event of ['open-sesame-music-account-changed','open-sesame-widgets-changed'])window.addEventListener(event,sync);
  window.addEventListener('pagehide',()=>{identity='';reset();render()});
  sync();
})();
