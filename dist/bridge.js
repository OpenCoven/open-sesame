'use strict';
(()=>{
  const pending=new Map();let next=0,send=null,available=false;
  window.__openSesameReceive=message=>{
    if(message.requestId&&pending.has(message.requestId)){const task=pending.get(message.requestId);pending.delete(message.requestId);clearTimeout(task.timer);message.error?task.reject(new Error(message.error)):task.resolve(message.result);return}
    if(message.event)window.dispatchEvent(new CustomEvent('open-sesame-desktop-event',{detail:message}));
  };
  const request=(method,params={})=>new Promise((resolve,reject)=>{
    if(!send){reject(new Error('Open Open Sesame on your desktop to connect to this machine.'));return}
    const requestId='request-'+(++next),timer=setTimeout(()=>{pending.delete(requestId);reject(new Error('The desktop connection did not respond.'))},['project.chooseFolder','reading.saveEPUB','reading.saveRSS','speech.start','live.ask','reading.pdf'].includes(method)?180000:15000);pending.set(requestId,{resolve,reject,timer});try{send({requestId,method,params})}catch(error){clearTimeout(timer);pending.delete(requestId);reject(error)};
  });
  let ready;
  if(window.__OPEN_SESAME_NATIVE__&&window.webkit?.messageHandlers?.openSesame){send=message=>window.webkit.messageHandlers.openSesame.postMessage(message);document.documentElement.classList.add('native-desktop');ready=request('system.info').then(info=>{available=true;return info})}
  else if(window.__OPEN_SESAME_DEV_BRIDGE__&&window===window.top){ready=new Promise(resolve=>{const socket=new WebSocket((location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+'/__openSesame/bridge');socket.onopen=()=>{send=message=>socket.send(JSON.stringify(message));request('system.info').then(info=>{available=true;resolve(info)}).catch(()=>resolve({available:false}))};socket.onmessage=event=>{try{window.__openSesameReceive(JSON.parse(event.data))}catch{}};socket.onerror=()=>resolve({available:false});socket.onclose=()=>{available=false;send=null;window.dispatchEvent(new CustomEvent('open-sesame-desktop-disconnected'));resolve({available:false})}})}
  else ready=Promise.resolve({available:false});
  ready=ready.catch(error=>({available:false,error:error.message}));
  window.openSesameBridge=Object.freeze({request,ready,get available(){return available}});
  window.addEventListener('open-sesame-desktop-disconnected',()=>{available=false;send=null;pending.forEach(task=>{clearTimeout(task.timer);task.reject(new Error('The desktop connection closed.'))});pending.clear()});
  ready.then(info=>window.dispatchEvent(new CustomEvent('open-sesame-desktop-ready',{detail:info})));
})();
