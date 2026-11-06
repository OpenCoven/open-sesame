'use strict';
(()=>{
  const el=id=>document.getElementById(id),m=window.OpenSesameMusicAuthModel,api=window.OpenSesameMusicAuthProviders,KEY='open-sesame-music-apps-v1',PENDING='open-sesame-spotify-pkce-v1';
  const names={spotify:'Spotify',apple:'Apple Music',youtube:'YouTube Music'},docs={spotify:'https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow',apple:'https://developer.apple.com/musickit/',youtube:'https://developers.google.com/youtube/v3/guides/auth/client-side-web-apps'};
  let externalHost=null;
  const redirectURI=new URL('./',location.href).href,origin=location.origin;
  let config={...window.OpenSesameMusicAuthConfig},service=window.OpenSesameMusic?.service||'spotify',appleInstance=null;
  try{const saved=JSON.parse(localStorage.getItem(KEY)||'{}');for(const key of ['spotifyClientId','googleClientId'])if(typeof saved[key]==='string')config[key]=saved[key]}catch{}
  const states=Object.fromEntries(Object.keys(names).map(id=>[id,{session:null,error:'',busy:false,ready:false,loading:false,attempt:0,expired:false}])),scripts=new Map();
  const configKey=id=>id==='spotify'?'spotifyClientId':id==='youtube'?'googleClientId':'appleDeveloperToken';
  function configured(id){return id==='apple'?m.appleToken(config.appleDeveloperToken,origin):m.validClient(id,config[configKey(id)])}
  function setError(id,message){states[id].error=message;states[id].busy=false;render()}
  function render(){
    const s=states[service],name=names[service],hasConfig=configured(service),connected=!!s.session;
    el('music-account-toggle').classList.toggle('is-connected',connected);el('music-account-toggle').querySelector('span').textContent=connected?'Connected':s.busy?'Connecting…':'Connect';el('music-account-toggle').setAttribute('aria-label',name+' account'+(connected?' · '+s.session.name:''));
    el('music-account-title').textContent=name;el('music-account-state').textContent=connected?s.session.name:s.busy?'Connecting…':s.loading?'Preparing sign-in…':s.expired?'Session expired':hasConfig?'Not connected':'Setup needed';el('music-account-state').classList.toggle('is-connected',connected);
    el('music-account-copy').textContent=connected?'Connected to Open Sesame for this session. Player sign-in is handled separately by '+name+'.':service==='apple'?'Authorize your Apple Music account in Apple’s sign-in window.':service==='youtube'?'Continue with Google to grant read-only YouTube account access.':'Continue securely on Spotify, then return here automatically.';
    el('music-account-error').hidden=!s.error;el('music-account-error').textContent=s.error;
    el('music-account-connect').hidden=connected;el('music-account-connect').disabled=s.busy||s.loading;el('music-account-connect').textContent=!hasConfig?'Set up sign-in':s.loading?'Preparing…':s.busy?'Connecting…':service!=='spotify'&&!s.ready?'Retry sign-in':'Continue with '+(service==='youtube'?'Google':name);
    el('music-account-disconnect').hidden=!connected;el('music-account-disconnect').disabled=s.busy;
    el('music-account-config-label').textContent=service==='apple'?'Apple Music developer token':(service==='youtube'?'Google':name)+' OAuth client ID';
    el('music-account-config-help').textContent=service==='spotify'?'Create a Spotify app and register the exact redirect below. Use its public client ID.':service==='youtube'?'Create a Google web OAuth client, enable YouTube Data API v3, and register this JavaScript origin.':'Paste a signed MusicKit developer JWT for this origin. Kept in memory for this session. Keep your signing key on your server.';
    el('music-account-origin-label').textContent=service==='spotify'?'Redirect URI':'Website origin';el('music-account-origin').value=service==='spotify'?redirectURI:origin;el('music-account-docs').href=docs[service];
    el('music-account-session-note').textContent='Open Sesame access lasts for this tab. Each provider manages its own sign-in session.';
    window.dispatchEvent(new Event('open-sesame-music-account-changed'));
  }
  function script(url,test){
    if(test())return Promise.resolve();if(scripts.has(url))return scripts.get(url);
    const promise=new Promise((resolve,reject)=>{const tag=document.createElement('script');tag.src=url;tag.async=true;tag.referrerPolicy='strict-origin-when-cross-origin';const timer=setTimeout(()=>{tag.remove();reject(Error('Sign-in could not load. Check your connection and try again.'))},20000);tag.onload=()=>{clearTimeout(timer);test()?resolve():reject(Error('The sign-in service is unavailable. Please try again.'))};tag.onerror=()=>{clearTimeout(timer);tag.remove();reject(Error('Sign-in could not load. Check your connection and try again.'))};document.head.append(tag)}).catch(error=>{scripts.delete(url);throw error});scripts.set(url,promise);return promise;
  }
  async function prepare(id){
    const s=states[id];if(!configured(id)||s.ready||s.loading||id==='spotify')return;
    const attempt=s.attempt;s.loading=true;s.error='';render();
    try{
      if(id==='youtube')await script('https://accounts.google.com/gsi/client',()=>!!window.google?.accounts?.oauth2);
      else{await script('https://js-cdn.music.apple.com/musickit/v3/musickit.js',()=>!!window.MusicKit);if(attempt!==s.attempt)return;await window.MusicKit.configure({developerToken:config.appleDeveloperToken,app:{name:'Open Sesame',build:'1.0.0'}});appleInstance=window.MusicKit.getInstance()}
      if(attempt===s.attempt)s.ready=true;
    }catch(error){if(attempt===s.attempt)s.error=error.message}finally{if(attempt===s.attempt)s.loading=false;render()}
  }
  function open(){el('music-account-panel').hidden=false;el('music-account-toggle').setAttribute('aria-expanded','true');el('music-account-config-value').value=config[configKey(service)]||'';render();prepare(service);el('music-account-close').focus({preventScroll:true})}
  function close(focus=true){const panel=el('music-account-panel');panel.hidden=true;el('music-account-toggle').setAttribute('aria-expanded','false');const previous=externalHost;externalHost=null;if(previous){previous.parent.insertBefore(panel,previous.next?.parentNode===previous.parent?previous.next:null);panel.classList.remove('plugins-auth-panel');providerChanged(previous.service);if(focus)previous.returnFocus()?.focus({preventScroll:true});}else if(focus)el('music-account-toggle').focus({preventScroll:true});}
  function providerChanged(id){if(!Object.hasOwn(names,id))return;const changed=id!==service;service=id;if(changed){el('music-account-setup').open=false;el('music-account-config-value').value=config[configKey(service)]||''}render();if(!el('music-account-panel').hidden)prepare(service)}
  el('music-account-toggle').addEventListener('click',()=>el('music-account-panel').hidden?open():close());el('music-account-close').addEventListener('click',close);
  document.addEventListener('pointerdown',event=>{if(!el('music-account-panel').hidden&&!el('music-account-panel').contains(event.target)&&!el('music-account-toggle').contains(event.target)){close(false)}});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!el('music-account-panel').hidden){event.stopPropagation();event.preventDefault();close()}},true);
  el('music-account-copy-origin').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(service==='spotify'?redirectURI:origin);toast('OAuth address copied.')}catch{el('music-account-origin').focus();el('music-account-origin').select();toast('Select and copy the OAuth address.')}});
  el('music-account-config').addEventListener('submit',event=>{
    event.preventDefault();const value=el('music-account-config-value').value.trim(),id=service,s=states[id];
    if(!(id==='apple'?m.appleToken(value,origin):m.validClient(id,value))){setError(id,id==='apple'?'Use an unexpired signed developer JWT valid for this origin.':'Enter the public OAuth client ID from '+(id==='youtube'?'Google Cloud.':'your Spotify app.'));el('music-account-config-value').focus();return}
    s.attempt++;s.loading=false;s.ready=false;s.busy=false;s.session=null;s.error='';s.expired=false;config[configKey(id)]=value;
    try{localStorage.setItem(KEY,JSON.stringify({spotifyClientId:config.spotifyClientId,googleClientId:config.googleClientId}))}catch{toast('Setup is available for this tab only.')}
    el('music-account-setup').open=false;render();prepare(id);toast(names[id]+' app setup saved'+(id==='apple'?' for this session.':'.'));
  });
  el('music-account-connect').addEventListener('click',async()=>{
    const id=service,s=states[id];if(!configured(id)){el('music-account-setup').open=true;el('music-account-config-value').focus();return}if(s.busy||s.loading)return;if(id!=='spotify'&&!s.ready){await prepare(id);if(s.ready)el('music-account-connect').focus({preventScroll:true});return}
    s.error='';s.busy=true;s.expired=false;const attempt=++s.attempt;render();
    try{
      if(id==='spotify'){
        if(location.protocol!=='https:'||!crypto.subtle)throw Error('Open the private HTTPS Site to connect Spotify.');
        const proof=await m.pkce(),record={provider:id,clientId:config.spotifyClientId,redirectURI,...proof,createdAt:Date.now()};
        if(attempt!==s.attempt)return;try{sessionStorage.setItem(PENDING,JSON.stringify(record))}catch{throw Error('Allow session storage to finish Spotify sign-in.')}
        location.assign(m.spotifyURL(record.clientId,redirectURI,record.state,record.challenge));return;
      }
      const session=id==='youtube'?await api.googleAuthorize(window.google,config.googleClientId):await api.appleAuthorize(appleInstance);
      if(attempt!==s.attempt)return;s.session=session;s.busy=false;render();window.dispatchEvent(new Event('open-sesame-music-account-changed'));toast(names[id]+' connected.');
    }catch(error){if(attempt===s.attempt)setError(id,error.message||'Sign-in was not completed. Please try again.')}
  });
  el('music-account-disconnect').addEventListener('click',async()=>{
    const id=service,s=states[id],session=s.session;s.attempt++;s.session=null;s.error='';s.expired=false;s.busy=false;render();
    try{if(id==='apple')await appleInstance?.unauthorize();else if(id==='youtube'&&session?.accessToken)window.google.accounts.oauth2.revoke(session.accessToken,()=>{})}catch{}
    window.dispatchEvent(new Event('open-sesame-music-account-changed'));toast('Disconnected '+names[id]+' from Open Sesame.');
  });
  async function callback(){
    const url=new URL(location.href),state=url.searchParams.get('state');let record=null;try{record=JSON.parse(sessionStorage.getItem(PENDING)||'null')}catch{}
    if(!record||!state)return;const code=url.searchParams.get('code'),error=url.searchParams.get('error');if(!code&&!error)return;
    sessionStorage.removeItem(PENDING);for(const key of ['code','state','error','error_description'])url.searchParams.delete(key);history.replaceState(null,'',url.pathname+url.search+url.hash);
    service='spotify';window.OpenSesameMusic.choose('spotify');document.getElementById('tab-lockin')?.click();document.getElementById('lockin-music')?.click();open();
    const s=states.spotify;
    if(!m.validReturn(record,state,redirectURI)){setError('spotify','This sign-in return could not be verified. Please reconnect.');return}
    if(error){setError('spotify',error==='access_denied'?'Sign-in cancelled.':'Spotify could not authorize this app. Check app setup.');return}
    const attempt=++s.attempt;s.busy=true;s.error='';render();try{const session=await api.spotifyExchange(record,code);if(attempt===s.attempt){s.session=session;s.busy=false;render();toast('Spotify connected.')}}catch(error){if(attempt===s.attempt)setError('spotify',error.message||'Spotify could not connect. Please try again.')}
  }
  setInterval(()=>{let changed=false;for(const s of Object.values(states))if(s.session&&s.session.expiresAt<=Date.now()){s.session=null;s.expired=true;changed=true}if(changed)render()},15000);
  window.addEventListener('open-sesame-view-changed',()=>{if(externalHost&&state.scenario!=='plugins')close(false)});
  window.OpenSesameMusicAuth={providerChanged,snapshot(){return Object.fromEntries(Object.entries(states).map(([id,s])=>[id,{connected:!!s.session&&s.session.expiresAt>Date.now(),configured:configured(id),busy:s.busy,loading:s.loading,error:s.error,expired:s.expired,name:s.session?.name||''}]))},openFor(id,{host,returnFocus}){if(!Object.hasOwn(names,id))return;close(false);const panel=el('music-account-panel');externalHost={parent:panel.parentNode,next:panel.nextSibling,service,returnFocus};host.append(panel);panel.classList.add('plugins-auth-panel');providerChanged(id);open();},get applePlayer(){return states.apple.session&&appleInstance?.isAuthorized?appleInstance:null}};providerChanged(service);callback();
})();
