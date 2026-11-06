'use strict';
(function(root){
  const apps={finder:'Finder',safari:'Safari',notes:'Notes',calendar:'Calendar',music:'Music',terminal:'Terminal',calculator:'Calculator','system settings':'System Settings'};
  function parse(value){
    const text=String(value||'').trim().replace(/[.!?]+$/,'').replace(/^(?:computer|mac)\s*:?\s*/i,'').toLowerCase();let m;
    if(m=text.match(/^(?:set )?(?:the )?volume(?: to)? (\d{1,3})(?:\s*(?:%|percent))?$/)){const volume=Number(m[1]);return volume<=100?{action:'volume',value:volume,label:'Set Mac volume to '+volume+'%'}:null}
    if(/^(?:mute|unmute)(?: (?:my |the )?(?:mac|computer|audio|sound))?$/.test(text)){const muted=text.startsWith('mute');return {action:'mute',value:muted,label:muted?'Mute Mac audio':'Unmute Mac audio'}}
    if((m=text.match(/^(?:open|launch) (.+)$/))&&apps[m[1]])return {action:'open',value:m[1],label:'Open '+apps[m[1]]};
    return null;
  }
  let busy=false;
  async function run(command){
    if(busy)return;
    if(!root.openSesameBridge?.available){toast('Computer controls need the updated Open Sesame desktop companion. Your command is kept here.');return}
    busy=true;try{await root.openSesameBridge.request('computer.control',{action:command.action,value:command.value});toast(command.label+' · done')}catch(error){toast(error.message)}finally{busy=false}
  }
  root.OpenSesameComputer={parse,run};
})(typeof window==='undefined'?globalThis:window);
