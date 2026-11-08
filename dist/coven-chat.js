'use strict';
// The pinned Coven runtime interface now uses the app's real, allowlisted host transport.
(()=>{
  function createClient(bridge,subscribe){
    const pending=new Map();
    const request=(method,params)=>bridge.request(method,params).catch(error=>{throw Error(String(error?.message||error||'Local Coven operation failed.').slice(0,2048))});
    const unsubscribe=subscribe(message=>{const entry=pending.get(message.runId);if(message.event==='coven.event'&&entry&&message.familiarId===entry.familiarId&&message.conversationId===entry.conversationId)entry.channel.onmessage?.(message.payload)});
    const runtime=OpenSesameCovenRuntime.create({available:()=>bridge.available,invoke:async(command,args={})=>{
      if(command==='coven_runtime_status')return request('coven.status');
      if(command==='coven_runtime_familiars')return request('coven.familiars');
      if(command==='coven_runtime_cancel')return request('coven.cancel',{runId:args.runId});
      if(command!=='coven_runtime_send')throw Error('Unsupported Coven operation in this application.');
      const input=args.input;
      if(pending.has(input.runId))throw Error('This reply is already running.');
      pending.set(input.runId,{channel:args.onEvent,familiarId:input.familiarId,conversationId:input.conversationId});
      try{return await request('coven.send',input)}finally{pending.delete(input.runId)}
    }});
    return {
      status:()=>bridge.available?runtime.status():Promise.resolve({available:false,error:'Open Open Sesame Desktop, or its local development preview, to connect to your Coven familiars.'}),
      listFamiliars:()=>runtime.listFamiliars(),
      setAvatar:(familiarId,png)=>request('coven.avatar.set',{familiarId,png}),
      command:(familiarId,name)=>request('coven.command',{familiarId,name}),
      openConversation:familiarId=>request('coven.open',{familiarId}),
      sendMessage:(input,onEvent)=>runtime.send(input,onEvent),cancel:runId=>runtime.cancel(runId),
      get busy(){return pending.size>0},
      close(){for(const runId of pending.keys())runtime.cancel(runId).catch(()=>{});unsubscribe?.()}
    };
  }
  window.OpenSesameCreateCovenClient=createClient;
  if(window.openSesameBridge)window.OpenSesameCovenClient=createClient(window.openSesameBridge,listener=>{const callback=event=>listener(event.detail);window.addEventListener('open-sesame-desktop-event',callback);return()=>window.removeEventListener('open-sesame-desktop-event',callback)});
  // Old saved Shells panes redirect to Familiars instead of fabricating replies.
  window.OpenSesameCovenChat={activate(){},isActive:()=>false,send:()=>false,search:query=>window.OpenSesameFamiliars?.search(query)||false};
  window.addEventListener('pagehide',()=>window.OpenSesameCovenClient?.close());
})();
