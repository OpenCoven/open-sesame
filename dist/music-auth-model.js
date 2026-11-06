'use strict';
(()=>{
  const SPOTIFY_SCOPE='user-read-private',YOUTUBE_SCOPE='https://www.googleapis.com/auth/youtube.readonly';
  const validClient=(provider,value)=>typeof value==='string'&&(provider==='spotify'?/^[a-f0-9]{32}$/i.test(value):provider==='youtube'?/^\d+-[a-z0-9-]+\.apps\.googleusercontent\.com$/i.test(value):false);
  function appleToken(value,origin,now=Date.now()){try{if(typeof value!=='string'||value.length>8192||!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(value))return false;const payload=JSON.parse(atob(value.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));return Number.isFinite(payload.exp)&&payload.exp*1000>now+60000&&(!payload.origin||(Array.isArray(payload.origin)?payload.origin:[payload.origin]).includes(origin))}catch{return false}}
  const base64url=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  async function pkce(){const verifier=base64url(crypto.getRandomValues(new Uint8Array(48))),state=base64url(crypto.getRandomValues(new Uint8Array(24))),challenge=base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));return {verifier,state,challenge};}
  function spotifyURL(clientId,redirectURI,state,challenge){if(!validClient('spotify',clientId)||!/^https:\/\//.test(redirectURI))throw Error('Use a configured HTTPS Spotify redirect.');const url=new URL('https://accounts.spotify.com/authorize');url.search=new URLSearchParams({client_id:clientId,response_type:'code',redirect_uri:redirectURI,state,scope:SPOTIFY_SCOPE,code_challenge_method:'S256',code_challenge:challenge});return url.href;}
  function validReturn(record,state,redirectURI,now=Date.now()){return !!record&&record.provider==='spotify'&&record.state===state&&typeof record.state==='string'&&record.state.length>=24&&typeof record.verifier==='string'&&record.verifier.length>=43&&record.redirectURI===redirectURI&&validClient('spotify',record.clientId)&&Number.isFinite(record.createdAt)&&now-record.createdAt>=0&&now-record.createdAt<600000;}
  window.OpenSesameMusicAuthModel={SPOTIFY_SCOPE,YOUTUBE_SCOPE,validClient,appleToken,pkce,spotifyURL,validReturn};
})();
