'use strict';
(()=>{
 const el=id=>document.getElementById(id),local=el('local-media');
 function control(id,label,parent){const b=document.createElement('button');b.id=id;b.type='button';b.className='media-popout-button';b.innerHTML=icon('popout');b.title=label;b.setAttribute('aria-label',label);parent.append(b);return b}
 let opening=false;const browserPlayers=new Set();
 const video=control('media-popout','Pop out media player',el('media-video-fullscreen').parentElement),youtube=control('youtube-popout','Pop out YouTube player',el('youtube-form')),music=control('music-popout','Pop out music player',el('music-source-form'));
 function sync(){
  const loaded=!!local.getAttribute('src');video.hidden=!loaded;video.disabled=!loaded||opening;video.title=opening?'Opening player…':'Pop out media player';
  youtube.hidden=!window.OpenSesameYouTube?.snapshot().loaded;music.hidden=!window.OpenSesameMusic?.snapshot().loaded&&!window.OpenSesameMusic?.youtubeActive;
  const detached=window.OpenSesameNativeSurfaces?.youtubePoppedOut;youtube.title=youtube.ariaLabel=detached?'Return YouTube player':'Pop out YouTube player';
 }
 async function popoutLocal(){
  if(opening)return;if(window.OpenSesameWidgetLifecycle?.isActive('local-media')===false)throw Error('Activate Local Media in Widgets first.');
  const handoff=OpenSesameLocalMedia.handoff(),entry=handoff.queue[handoff.index];if(!entry)throw Error('Load an audio or video file first.');
  const source=local.currentSrc||local.src,position=local.currentTime||0,playing=!local.paused&&!local.ended;opening=true;sync();let id;
  try{
   if(window.__OPEN_SESAME_NATIVE__){
    const metadata={name:entry.file?.name||entry.title||'Media',kind:entry.kind,position,playing};
    if(entry.file){
     ({id}=await openSesameBridge.request('media.player.begin',{...metadata,size:entry.file.size}));
     for(let offset=0;offset<entry.file.size;offset+=131072){const bytes=new Uint8Array(await entry.file.slice(offset,offset+131072).arrayBuffer());let binary='';for(let n=0;n<bytes.length;n+=8192)binary+=String.fromCharCode(...bytes.subarray(n,n+8192));await openSesameBridge.request('media.player.chunk',{id,offset,data:btoa(binary)})}
     await openSesameBridge.request('media.player.open',{id});
    }else await openSesameBridge.request('media.player.openURL',{...metadata,url:entry.url});
   }else{
    const popup=window.open('about:blank','_blank','popup,width=560,height='+ (entry.kind==='audio'?200:380));if(!popup)throw Error('Allow pop-ups to open a player.');popup.opener=null;
    const doc=popup.document;doc.title=entry.title||'Media';const style=doc.createElement('style');style.textContent='html,body{margin:0;height:100%;background:#101113;color:#d8d3df;font:13px system-ui}body{display:flex;align-items:center;justify-content:center}video,audio{width:100%;height:100%;object-fit:contain}audio{height:64px}';doc.head.append(style);
    const player=doc.createElement(entry.kind==='audio'?'audio':'video');player.controls=true;player.setAttribute('playsinline','');let url=entry.file?popup.URL.createObjectURL(entry.file):entry.url;player.src=url;doc.body.append(player);browserPlayers.add(popup);
    player.addEventListener('loadedmetadata',()=>{if(Number.isFinite(player.duration))player.currentTime=Math.min(position,player.duration);if(playing)player.play().catch(()=>{})},{once:true});
    popup.addEventListener('pagehide',()=>{player.pause();if(entry.file)popup.URL.revokeObjectURL(url);browserPlayers.delete(popup)},{once:true});
   }
   if((local.currentSrc||local.src)===source)local.pause();
  }catch(error){if(id)await openSesameBridge.request('media.player.cancel',{id}).catch(()=>{});throw error}finally{opening=false;sync()}
 }
 video.addEventListener('click',()=>popoutLocal().catch(error=>toast(error.message||'Could not open the player window.')));
 async function popoutYouTube(){if(window.OpenSesameWidgetLifecycle?.isActive('youtube')===false)throw Error('Activate YouTube in Widgets first.');if(window.__OPEN_SESAME_NATIVE__)await window.OpenSesameNativeSurfaces.popoutYouTube();else{const source=OpenSesameYouTube.snapshot(),parsed=OpenSesamePlaylist.parseSource(source.url);if(!parsed)throw Error('Load a YouTube video first.');const url=new URL('https://www.youtube-nocookie.com/embed/'+(source.id||'videoseries'));if(parsed.list)url.searchParams.set('list',parsed.list);url.searchParams.set('start',String(Math.floor(source.position||0)));window.open(url.href,'_blank','popup,width=640,height=400,noopener')}}
 youtube.addEventListener('click',()=>popoutYouTube().catch(error=>toast(error.message)));
 music.addEventListener('click',async()=>{try{if(OpenSesameMusic.youtubeActive){await popoutYouTube();return}const source=OpenSesameMusic.currentSource;if(!source?.embed)throw Error('Load a music link first.');if(window.OpenSesameWidgetLifecycle?.isActive(source.service)===false)throw Error('Activate this music service in Widgets first.');if(window.__OPEN_SESAME_NATIVE__){await OpenSesameNativeSurfaces.popoutMusic(source.embed);OpenSesameMusic.stop()}else window.open(source.embed,'_blank','popup,width=560,height=380,noopener');sync()}catch(error){toast(error.message||'Could not open the player window.')}});
 for(const name of ['loadedmetadata','play','pause','emptied','leavepictureinpicture','enterpictureinpicture'])local.addEventListener(name,sync);
 for(const name of ['open-sesame-view-changed','open-sesame-layout','open-sesame-media-popout-changed','open-sesame-youtube-cleared'])window.addEventListener(name,sync);sync();
 window.addEventListener('open-sesame-widgets-changed',event=>{const id=event.detail?.id;if(!id||window.OpenSesameWidgetLifecycle?.isActive(id)!==false)return;if(id==='local-media'){for(const popup of browserPlayers)popup.close();browserPlayers.clear();if(window.__OPEN_SESAME_NATIVE__)openSesameBridge.request('media.windows.close',{provider:id}).catch(()=>{});if(document.pictureInPictureElement===local)document.exitPictureInPicture().catch(()=>{});else if(local.webkitPresentationMode==='picture-in-picture')local.webkitSetPresentationMode('inline')}else if(window.__OPEN_SESAME_NATIVE__&&['youtube','spotify','apple'].includes(id))openSesameBridge.request('media.windows.close',{provider:id}).catch(()=>{})});
 window.OpenSesameMediaPopout={get localPip(){return document.pictureInPictureElement===local||local.webkitPresentationMode==='picture-in-picture'}};
})();
