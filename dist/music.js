'use strict';
(()=>{
  const el=id=>document.getElementById(id),names={spotify:'Spotify',apple:'Apple Music',youtube:'YouTube Music'},KEY='open-sesame-music-services-v1';
  let stored={};try{const data=JSON.parse(localStorage.getItem(KEY)||'{}');if(data&&typeof data==='object')stored=data}catch{}
  let service=Object.hasOwn(names,stored.service)?stored.service:'spotify',activeService='',lastLinks=stored.links&&typeof stored.links==='object'?stored.links:{};
  function parse(raw){
    const value=String(raw||'').trim(),uri=value.match(/^spotify:(track|album|playlist|artist|episode|show):([A-Za-z0-9]{22})$/);if(uri)return spotify(uri[1],uri[2]);
    try{const u=new URL(/^[a-z][a-z0-9+.-]*:/i.test(value)?value:'https://'+value);if(u.protocol!=='https:'||u.username||u.password||u.port)return null;
      if(u.hostname==='open.spotify.com'){const parts=u.pathname.split('/').filter(Boolean).filter(part=>!/^intl-[a-z-]+$/i.test(part));if(parts[0]==='embed')parts.shift();if(parts.length===2&&/^(track|album|playlist|artist|episode|show)$/.test(parts[0])&&/^[A-Za-z0-9]{22}$/.test(parts[1]))return spotify(parts[0],parts[1]);return null}
      if(['music.apple.com','embed.music.apple.com'].includes(u.hostname)){const parts=u.pathname.split('/').filter(Boolean);if(!/^[a-z]{2}$/i.test(parts[0])||!['album','playlist','song','music-video','station'].includes(parts[1])||parts.length<3||parts.length>4||! /^[A-Za-z0-9.-]+$/.test(parts.at(-1)))return null;const canonical=new URL('https://music.apple.com'+u.pathname),embed=new URL('https://embed.music.apple.com'+u.pathname);const song=u.searchParams.get('i');if(song&&/^\d+$/.test(song)){canonical.searchParams.set('i',song);embed.searchParams.set('i',song)}embed.searchParams.set('theme','dark');return {service:'apple',url:canonical.href,embed:embed.href}}
      const youtube=OpenSesamePlaylist.parseSource(value);if(youtube)return {service:'youtube',url:youtube.url.replace('www.youtube.com','music.youtube.com'),youtube};return null;
    }catch{return null}
  }
  function spotify(type,id){return {service:'spotify',url:'https://open.spotify.com/'+type+'/'+id,embed:'https://open.spotify.com/embed/'+type+'/'+id+'?theme=0'}}
  function save(){try{localStorage.setItem(KEY,JSON.stringify({service,links:lastLinks}))}catch{toast('Music preferences could not be saved.')}}
  let controller=null,spotifyAPI=null,spotifyPromise=null,transportReady=false,playing=false,position=0,duration=0,generation=0,applePlayer=null,appleChanged=null;
  function stop(){generation++;transportReady=false;playing=false;position=0;duration=0;try{controller?.destroy()}catch{}controller=null;try{applePlayer?.pause();if(appleChanged)applePlayer?.removeEventListener('playbackStateDidChange',appleChanged)}catch{}applePlayer=null;appleChanged=null;el('music-kit-player')?.remove();el('music-provider-host')?.remove();const youtube=activeService==='youtube';activeService='';if(youtube)window.OpenSesameYouTube.clear();el('music-youtube-stage').hidden=true;el('music-provider-stage').hidden=false;el('music-provider-frame')?.remove();activeService='';el('music-empty').hidden=false;el('music-unload').hidden=true;el('music-external').hidden=true;renderCompact()}
  function render(){window.OpenSesameMusicAuth?.providerChanged(service);el('music-service-select').value=service;el('music-provider').dataset.service=service;el('music-url').placeholder=service==='youtube'?'Paste a YouTube Music video or playlist…':'Paste a '+names[service]+' song, album or playlist…';el('music-url').value=typeof lastLinks[service]==='string'?lastLinks[service].slice(0,2048):'';el('music-empty-title').textContent='Your music. Your flow.';el('music-empty-copy').textContent=service==='youtube'?'Open a YouTube Music video or playlist with the embedded YouTube player.':'Paste '+(service==='apple'?'an ':'a ')+names[service]+' link to load its player here.';el('music-service-note').textContent=service==='youtube'?'YouTube Music opens in the YouTube player with your Open Sesame queue.':'Playback and sign-in are handled by '+names[service]+'. Availability and previews depend on your account.';el('music-error').hidden=true;renderCompact()}
  function choose(value){if(!Object.hasOwn(names,value)||service===value)return;stop();service=value;save();render()}
  el('music-service-select').addEventListener('change',event=>choose(event.target.value));
  el('music-source-form').addEventListener('submit',async event=>{
    event.preventDefault();const parsed=parse(el('music-url').value);if(!parsed){el('music-error').hidden=false;el('music-error').textContent='Paste a Spotify, Apple Music, or YouTube Music link.';return}
    stop();service=parsed.service;lastLinks[service]=parsed.url;save();render();
    if(service==='youtube'){el('youtube-url').value=parsed.url;window.OpenSesameYouTube.open(parsed.youtube,'music');activeService='youtube';el('music-empty').hidden=true;el('music-unload').hidden=false;el('music-external').hidden=false;el('music-external').href=parsed.url;renderCompact();return}
    window.OpenSesameYouTube.clear();el('local-media').pause();activeService=service;el('music-empty').hidden=true;el('music-unload').hidden=false;el('music-external').hidden=false;el('music-external').href=parsed.url;const token=generation;renderCompact();if(service==='spotify')await mountSpotify(parsed,token);else if(window.OpenSesameMusicAuth?.applePlayer)await mountApple(parsed,token);else embed(parsed);renderCompact();
  });

  function embed(parsed){const frame=document.createElement('iframe');frame.id='music-provider-frame';frame.title=names[parsed.service]+' music player';frame.src=parsed.embed;frame.allow='autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';frame.allowFullscreen=true;frame.referrerPolicy='strict-origin-when-cross-origin';el('music-provider-stage').append(frame)}
  function loadSpotify(){
    if(spotifyAPI)return Promise.resolve(spotifyAPI);if(spotifyPromise)return spotifyPromise;
    spotifyPromise=new Promise((resolve,reject)=>{
      const tag=document.createElement('script'),previous=window.onSpotifyIframeApiReady;
      const timer=setTimeout(()=>reject(Error('Spotify controls could not connect.')),14000);
      window.onSpotifyIframeApiReady=api=>{try{previous?.(api)}catch{}clearTimeout(timer);spotifyAPI=api;resolve(api)};
      tag.src='https://open.spotify.com/embed/iframe-api/v1';tag.async=true;tag.onerror=()=>{clearTimeout(timer);reject(Error('Spotify controls could not load.'))};document.head.append(tag);
    }).catch(error=>{spotifyPromise=null;throw error});return spotifyPromise;
  }
  async function mountSpotify(parsed,token){
    try{
      const api=await loadSpotify();if(token!==generation)return;
      const host=document.createElement('div');host.id='music-provider-host';el('music-provider-stage').append(host);
      const uri='spotify:'+new URL(parsed.url).pathname.split('/').filter(Boolean).join(':');
      api.createController(host,{uri,width:'100%',height:'100%',theme:'dark'},value=>{
        if(token!==generation){value.destroy();return}controller=value;
        value.addListener('ready',()=>{if(token!==generation)return;transportReady=true;renderCompact()});
        value.addListener('playback_update',event=>{if(token!==generation)return;transportReady=true;playing=!event.data.isPaused;position=Number(event.data.position||0)/1000;duration=Number(event.data.duration||0)/1000;renderCompact()});
      });
    }catch(error){if(token!==generation)return;embed(parsed);el('music-service-note').textContent='Use the Spotify player controls while the compact connection is unavailable.'}
  }
  async function mountApple(parsed,token){
    try{
      const kit=window.OpenSesameMusicAuth?.applePlayer;if(!kit){embed(parsed);return}
      await kit.setQueue({url:parsed.url});if(token!==generation)return;applePlayer=kit;transportReady=true;appleChanged=()=>{snapshot();renderCompact()};kit.addEventListener('playbackStateDidChange',appleChanged);
      el('music-provider-frame')?.remove();el('music-kit-player')?.remove();
      const panel=document.createElement('div');panel.id='music-kit-player';panel.className='music-kit-player';
      panel.innerHTML=icon('music')+'<strong></strong><small>Apple Music</small><div></div>';
      for(const [action,name,glyph] of [['previous','Previous track','previous'],['toggle','Play','play'],['next','Next track','next']]){
        const button=document.createElement('button');button.type='button';button.dataset.action=action;button.setAttribute('aria-label',name);button.title=name;button.innerHTML=icon(glyph);button.addEventListener('click',()=>control(action).catch(error=>toast(error.message)));panel.querySelector('div').append(button);
      }
      el('music-provider-stage').append(panel);el('music-service-note').textContent='Playback stays connected when you collapse Open Sesame.';renderCompact();
    }catch(error){if(token!==generation)return;transportReady=false;applePlayer=null;if(!el('music-provider-frame'))embed(parsed);el('music-service-note').textContent='MusicKit playback is unavailable. Use the embedded player.'}
  }
  function snapshot(){
    const kit=applePlayer,queue=kit?.queue,position=kit?.nowPlayingItemIndex??queue?.position??0,count=queue?.items?.length||0;
    const result={position:kit?.currentPlaybackTime??position,duration:kit?.currentPlaybackDuration??duration,loaded:!!activeService&&activeService!=='youtube',ready:transportReady,playing:kit?!!kit.isPlaying:playing,title:kit?.nowPlayingItem?.attributes?.name||names[activeService||service],previous:!!kit&&position>0,next:!!kit&&position<count-1,reason:activeService==='apple'?'Connect Apple Music, then reload a song for compact controls':'Player controls are connecting'};
    const panel=el('music-kit-player');if(panel){panel.querySelector('strong').textContent=result.title;const play=panel.querySelector('[data-action=toggle]');play.innerHTML=icon(result.playing?'pause':'play');play.setAttribute('aria-label',result.playing?'Pause':'Play');panel.querySelector('[data-action=previous]').disabled=!result.previous;panel.querySelector('[data-action=next]').disabled=!result.next}
    return result;
  }
  async function control(action){
    if(!transportReady)return;
    if(controller&&action==='toggle')controller.togglePlay();
    if(applePlayer){if(action==='toggle'){if(applePlayer.isPlaying)applePlayer.pause();else await applePlayer.play()}else if(action==='previous')await applePlayer.skipToPreviousItem();else if(action==='next')await applePlayer.skipToNextItem()}
    renderCompact();
  }
  window.addEventListener('open-sesame-music-account-changed',()=>{if(applePlayer&&!window.OpenSesameMusicAuth?.applePlayer){stop();return}if(activeService==='apple'&&!applePlayer&&window.OpenSesameMusicAuth?.applePlayer){const parsed=parse(lastLinks.apple);if(parsed)mountApple(parsed,generation)}});
  window.addEventListener('open-sesame-youtube-cleared',()=>{if(activeService==='youtube'){activeService='';stop()}});el('music-unload').addEventListener('click',stop);window.addEventListener('open-sesame-youtube-start',stop);el('local-media').addEventListener('play',stop);window.addEventListener('pagehide',stop);
  window.OpenSesameMusic={parse,stop,choose,snapshot,control,getVolume(){const audio=applePlayer?.player||applePlayer;return audio&&Number.isFinite(audio.volume)?audio.volume*100:null},setVolume(value){const audio=applePlayer?.player||applePlayer;if(audio&&Number.isFinite(audio.volume))audio.volume=Math.max(0,Math.min(100,Number(value)))/100},get service(){return service},get youtubeActive(){return activeService==='youtube'},summary:()=>names[activeService||service]};render();
})();
