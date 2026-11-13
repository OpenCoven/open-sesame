'use strict';
(()=>{
  const m=window.OpenSesameMusicAuthModel;
  async function json(url,options={}){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try{const response=await fetch(url,{...options,signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});if(!response.ok)throw Error(response.status===401?'Authorization expired. Please reconnect.':'The provider could not complete this connection. Check app setup and try again.');return await response.json()}
    catch(error){if(error.name==='AbortError')throw Error('The provider took too long to respond. Please try again.');throw error}finally{clearTimeout(timer)}
  }
  const expiry=seconds=>Date.now()+Math.max(0,Number(seconds)||0)*1000;
  async function spotifyExchange(record,code){
    const token=await json('https://accounts.spotify.com/api/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:record.redirectURI,client_id:record.clientId,code_verifier:record.verifier})});
    if(!token.access_token||!m.SPOTIFY_SCOPE.split(' ').every(scope=>String(token.scope||'').split(' ').includes(scope))||!(Number(token.expires_in)>0))throw Error('Spotify did not grant account access. Please reconnect.');
    const user=await json('https://api.spotify.com/v1/me',{headers:{Authorization:'Bearer '+token.access_token}});
    if(!user.id)throw Error('Spotify could not verify this account.');
    return {name:user.display_name||user.id,accessToken:token.access_token,expiresAt:expiry(token.expires_in)};
  }
  function spotifyArtwork(images){for(const image of Array.isArray(images)?images:[]){try{const u=new URL(image.url);if(u.href.length<=2048&&u.protocol==='https:'&&['i.scdn.co','mosaic.scdn.co'].includes(u.hostname)&&!u.username&&!u.password&&!u.port)return u.href}catch{}}return ''}
  async function spotifyLibrary(session,kind,offset=0){
    if(!session?.accessToken||session.expiresAt<=Date.now())throw Error('Authorization expired. Please reconnect.');
    if(!['tracks','playlists'].includes(kind)||!Number.isInteger(offset)||offset<0||offset>100000)throw Error('Invalid library page.');
    const data=await json('https://api.spotify.com/v1/me/'+kind+'?limit=50&offset='+offset,{headers:{Authorization:'Bearer '+session.accessToken},redirect:'error'});
    if(!Array.isArray(data.items))throw Error('Invalid library response.');
    const type=kind==='tracks'?'track':'playlist';
    const items=data.items.slice(0,50).flatMap(entry=>{const item=kind==='tracks'?entry?.track:entry;if(!item||item.is_local||!item.name||!/^[a-zA-Z0-9]{22}$/.test(item.id))return [];return [{id:item.id,name:String(item.name).slice(0,500),detail:kind==='tracks'?(item.artists||[]).map(a=>String(a.name||'')).join(', ').slice(0,500):String(item.owner?.display_name||'').slice(0,500),url:'https://open.spotify.com/'+type+'/'+item.id,image:spotifyArtwork(kind==='tracks'?item.album?.images:item.images)}]});
    return {items,nextOffset:data.next&&offset+50<=100000?offset+50:null};
  }
  function googleAuthorize(sdk,clientId){
    return new Promise((resolve,reject)=>{
      const client=sdk.accounts.oauth2.initTokenClient({client_id:clientId,scope:m.YOUTUBE_SCOPE,include_granted_scopes:true,
        callback:async token=>{try{if(token.error)throw Error(token.error==='access_denied'?'Sign-in cancelled.':'Google could not authorize this app. Check app setup.');if(!token.access_token||!(Number(token.expires_in)>0)||!sdk.accounts.oauth2.hasGrantedAllScopes(token,m.YOUTUBE_SCOPE))throw Error('YouTube account access was not granted.');const data=await json('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',{headers:{Authorization:'Bearer '+token.access_token}});resolve({name:data.items?.[0]?.snippet?.title||'YouTube account',accessToken:token.access_token,expiresAt:expiry(token.expires_in)})}catch(error){reject(error)}},
        error_callback:error=>reject(Error(error.type==='popup_closed'?'Sign-in cancelled.':error.type==='popup_failed_to_open'?'Allow the Google sign-in popup, then try again.':'Google sign-in could not open. Please try again.'))});
      client.requestAccessToken({prompt:''});
    });
  }
  async function appleAuthorize(instance){
    const token=await instance.authorize();
    if(!token||!instance.isAuthorized)throw Error('Apple Music sign-in was cancelled or access was not granted.');
    return {name:'Apple Music account',expiresAt:Infinity};
  }
  window.OpenSesameMusicAuthProviders={spotifyExchange,spotifyLibrary,googleAuthorize,appleAuthorize};
})();
