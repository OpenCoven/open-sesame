import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const id='0123456789ABCDEFGHIJKL',requests=[];
const context={window:{},URL,URLSearchParams,AbortController,setTimeout,clearTimeout,fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({items:[{track:{id,name:'<script>song</script>',artists:[{name:'Artist'}],album:{images:[{url:'https://i.scdn.co/image/fixture'}]}}},{track:null},{track:{id:'local',name:'Local',is_local:true}}],next:'https://malicious.example/next'})}}};
vm.createContext(context);for(const file of ['music-auth-model.js','music-auth-providers.js'])vm.runInContext(fs.readFileSync('dist/'+file,'utf8'),context);
const api=context.window.OpenSesameMusicAuthProviders,session={accessToken:'fixture-token',expiresAt:Date.now()+60000};
let page=await api.spotifyLibrary(session,'tracks');assert.equal(page.items.length,1);assert.equal(page.items[0].url,'https://open.spotify.com/track/'+id);assert.equal(page.nextOffset,50);assert.equal(page.items[0].image,'https://i.scdn.co/image/fixture');
await api.spotifyLibrary(session,'tracks',50);assert.equal(requests[1].url,'https://api.spotify.com/v1/me/tracks?limit=50&offset=50');assert.equal(requests[0].options.headers.Authorization,'Bearer fixture-token');assert.equal(requests[0].options.redirect,'error');assert.equal(requests[0].options.credentials,'omit');
for(const [kind,offset] of [['https://malicious.example',0],['tracks',-1],['tracks',1.2],['tracks',100001]])await assert.rejects(api.spotifyLibrary(session,kind,offset));
await assert.rejects(api.spotifyLibrary({...session,expiresAt:0},'tracks'),/expired/);
context.fetch=async()=>({ok:true,json:async()=>({items:[{id,name:'Private playlist',owner:{display_name:'Owner'}}],next:null})});page=await api.spotifyLibrary(session,'playlists');assert.equal(page.items[0].url,'https://open.spotify.com/playlist/'+id);assert.equal(page.items[0].detail,'Owner');assert.equal(page.nextOffset,null);
context.fetch=async()=>({ok:false,status:403});await assert.rejects(api.spotifyLibrary(session,'playlists'),/provider/);
context.fetch=async()=>({ok:true,json:async()=>({items:null})});await assert.rejects(api.spotifyLibrary(session,'tracks'),/Invalid/);
// Old profile-only grants cannot produce a connected session with missing library scopes.
context.fetch=async()=>({ok:true,json:async()=>({access_token:'fixture',scope:'user-read-private',expires_in:3600})});await assert.rejects(api.spotifyExchange({clientId:'fixture',verifier:'fixture',redirectURI:'https://app.example/'},'code'),/grant/);

class Element{
 constructor(){this.children=[];this.handlers={};this.dataset={};this.hidden=false;this.textContent='';this.attrs={}}
 setAttribute(k,v){this.attrs[k]=v}addEventListener(k,f){(this.handlers[k]??=[]).push(f)}emit(k){for(const f of this.handlers[k]||[])f()}
 append(...nodes){this.children.push(...nodes)}replaceChildren(){this.children=[]}querySelectorAll(){return filters}
}
const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)},filters=['tracks','playlists'].map(kind=>{const e=new Element();e.dataset.spotifyLibrary=kind;return e});
const window=new Element(),calls=[];let account={name:'First',expiresAt:1,connected:true},enabled=true,resolvers=[],submitted=0;
window.OpenSesameWidgetLifecycle={isActive:()=>enabled};window.OpenSesameMusic={service:'spotify',parse:url=>url.startsWith('https://open.spotify.com/')?{service:'spotify'}:null};window.OpenSesameMusicAuth={snapshot:()=>({spotify:account}),spotifyLibrary:(kind,offset)=>{calls.push({kind,offset});return new Promise((resolve,reject)=>resolvers.push({resolve,reject}))}};
el('music-source-form').requestSubmit=()=>submitted++;
vm.runInNewContext(fs.readFileSync('dist/spotify-library.js','utf8'),{window,URL,document:{getElementById:el,createElement:()=>new Element()}});
const flush=()=>new Promise(resolve=>setImmediate(resolve)),item={id,name:'<script>song</script>',detail:'Artist',url:'https://open.spotify.com/track/'+id};
assert.equal(el('music-provider').dataset.library,'true','Connected library owns the main music surface');assert.equal(calls[0].kind,'tracks');resolvers.shift().resolve({items:[item],nextOffset:50});await flush();assert.equal(el('spotify-library-items').children.length,1);assert.equal(el('spotify-library-items').children[0].children[0].textContent,item.name);el('spotify-library-items').children[0].emit('click');assert.equal(submitted,1);assert.equal(el('music-url').value,item.url);
el('spotify-library-more').emit('click');assert.equal(calls.at(-1).offset,50);resolvers.shift().resolve({items:[item],nextOffset:null});await flush();assert.equal(el('spotify-library-items').children.length,1,'Pagination deduplicates');assert.equal(el('spotify-library-more').hidden,true);
filters[1].emit('click');assert.equal(calls.at(-1).kind,'playlists');resolvers.shift().resolve({items:[],nextOffset:null});await flush();assert.match(el('spotify-library-status').textContent,/No playlists/);
el('spotify-library-refresh').emit('click');resolvers.shift().reject(Error('private diagnostic'));await flush();assert.match(el('spotify-library-status').textContent,/Reconnect/);assert.equal(el('spotify-library-status').textContent.includes('private diagnostic'),false);
el('spotify-library-refresh').emit('click');const stale=resolvers.shift();account={name:'Second',expiresAt:2,connected:true};window.emit('open-sesame-music-account-changed');stale.resolve({items:[item],nextOffset:null});await flush();assert.equal(el('spotify-library-items').children.length,0,'Old account results retired');resolvers.shift().resolve({items:[],nextOffset:null});await flush();
el('spotify-library-refresh').emit('click');const pending=resolvers.shift();enabled=false;window.emit('open-sesame-widgets-changed');pending.resolve({items:[item],nextOffset:null});await flush();assert.equal(el('spotify-library').hidden,true);assert.equal(el('spotify-library-items').children.length,0);
enabled=true;window.emit('open-sesame-widgets-changed');resolvers.shift().resolve({items:[item],nextOffset:null});await flush();account={connected:false};window.emit('open-sesame-music-account-changed');assert.equal(el('spotify-library-items').children.length,0);assert.equal(el('spotify-library').hidden,true);
console.log('Spotify library: scopes, fixed-origin pagination, malformed/unavailable items, read failures, selection, empty state, account switch, disconnect and widget retirement pass with synthetic accounts.');
