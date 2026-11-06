'use strict';
(()=>{
  const catalog=[
    {id:'spotify',name:'Spotify',category:'media',logo:'spotify',description:'Your music, within reach.',detail:'Connect your Spotify account and open songs, albums, or playlists in Focus.',access:'Basic account profile. Embedded playback follows Spotify’s own sign-in and availability.',kind:'music'},
    {id:'apple',name:'Apple Music',category:'media',logo:'applemusic',description:'A soundtrack for your flow.',detail:'Authorize MusicKit to play your Apple Music selections inside Open Sesame.',access:'Apple Music account authorization. Full playback requires an eligible subscription.',kind:'music'},
    {id:'youtube',name:'YouTube',category:'media',logo:'youtube',description:'Videos, music, and playlists.',detail:'Connect with Google for read-only YouTube account access. Play a link in Focus without connecting.',access:'Read-only YouTube account access. Open Sesame does not publish or change your videos.',kind:'music'},
    {id:'claude',name:'Claude Code',category:'agents',logo:'claude',description:'Ask more of your transcript.',detail:'Use the Claude Code CLI on your Mac to answer questions about your Live transcript.',access:'Your question, recent transcript, and recent Q&A are sent only when you ask. Uses your terminal sign-in.',kind:'agent',docs:'https://code.claude.com/docs/en/setup'},
    {id:'codex',name:'Codex',category:'agents',logo:'openai',description:'A second mind for your notes.',detail:'Use the Codex CLI on your Mac to answer questions about your Live transcript.',access:'Your question, recent transcript, and recent Q&A are sent only when you ask. Uses your terminal sign-in.',kind:'agent',docs:'https://developers.openai.com/codex/cli/'},
    {id:'rss',name:'RSS & Atom',category:'reading',glyph:'rss',description:'Follow what matters to you.',detail:'Bring feeds and saved articles into Reader. Add a feed URL or discover one from a website.',access:'Fetches your subscribed feeds when refreshed. Subscriptions and read states stay on this device.',kind:'feeds'}
  ];
  function status(plugin,{music={},desktop=false,agents=null,error='',feedCount=0}={}){
    if(plugin.kind==='music'){const s=music[plugin.id]||{};return s.connected?{label:'Connected',tone:'connected',action:'Manage'}:s.busy||s.loading?{label:'Connecting',tone:'pending',action:'View'}:s.error||s.expired?{label:s.expired?'Session expired':'Needs attention',tone:'attention',action:'Reconnect'}:{label:s.configured?'Not connected':'Setup needed',tone:'idle',action:s.configured?'Connect':'Set up'};}
    if(plugin.kind==='agent')return !desktop?{label:'Desktop required',tone:'idle',action:'Set up'}:error?{label:'Check connection',tone:'attention',action:'Details'}:agents===null?{label:'Not checked',tone:'pending',action:'Check'}:agents[plugin.id]===true?{label:'CLI detected',tone:'detected',action:'Open'}:{label:'Not installed',tone:'idle',action:'Set up'};
    return {label:feedCount?feedCount+' feed'+(feedCount===1?'':'s'):'No feeds yet',tone:feedCount?'configured':'idle',action:feedCount?'Manage':'Add feed'};
  }
  function filter(items,query,category,connected,context){const q=query.trim().toLowerCase();return items.filter(p=>(category==='all'||p.category===category)&&(!q||(p.name+' '+p.description+' '+p.category).toLowerCase().includes(q))&&(!connected||['connected','detected','configured'].includes(status(p,context).tone)));}
  const api={catalog,status,filter};if(typeof module!=='undefined')module.exports=api;else window.OpenSesamePluginsModel=api;
})();
