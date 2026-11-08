'use strict';
window.OpenSesameVNC=(()=>{
 const sessions=new Map(), bridge=(method,params)=>openSesameBridge.request(method,params);
 class Channel {
  constructor(id){Object.assign(this,{id,token:'',readyState:0,binaryType:'arraybuffer',protocol:'',onopen:null,onclose:null,onerror:null,onmessage:null,queued:0});this.pending=[]}
  send(bytes){const copy=new Uint8Array(bytes);if(this.queued+copy.length>1048576){this.close();return}this.queued+=copy.length;for(let i=0;i<copy.length;i+=65536){const part=copy.slice(i,i+65536);this.pending.push(part)}this.flush()}
  async flush(){if(this.sending)return;this.sending=true;try{while(this.pending.length&&this.readyState===1){const part=this.pending.shift();await bridge('vnc.write',{id:this.id,token:this.token,data:btoa(String.fromCharCode(...part))});this.queued-=part.length}}catch{this.onerror?.({});this.close()}finally{this.sending=false}}
  close(){if(this.readyState===3)return;this.readyState=3;this.pending=[];if(this.token)bridge('vnc.close',{id:this.id,token:this.token}).catch(()=>{});this.onclose?.({code:1000,reason:'Connection closed',wasClean:true})}
 }
 window.addEventListener('open-sesame-desktop-event',e=>{const m=e.detail,s=sessions.get(m.id),c=s?.channel;if(!c||m.token!==c.token)return;if(m.event==='vnc.open'){c.readyState=1;c.onopen?.({})}if(m.event==='vnc.data'){const bytes=Uint8Array.from(atob(m.data),x=>x.charCodeAt(0));try{c.onmessage?.({data:bytes.buffer})}finally{bridge('vnc.ack',{id:m.id,token:c.token,bytes:bytes.length}).catch(()=>c.close())}}if(m.event==='vnc.error')c.onerror?.({});if(m.event==='vnc.close')c.close()});
 async function open(machine,container,status){
  if(sessions.has(machine.id))throw Error('This desktop is already open.');
  if(sessions.size>=4)throw Error('Disconnect a desktop before opening more than four sessions.');
  if(machine.kind==='direct'&&!window.__OPEN_SESAME_NATIVE__)throw Error('Direct VNC requires the Mac app. Choose a secure WebSocket gateway here.');
  const session={machine,channel:null,rfb:null,clipboard:'',timer:null,pendingCredential:null};sessions.set(machine.id,session);
  let RFB;try{({default:RFB}=await import('./vendor/novnc/rfb.js'))}catch(error){close(machine.id);throw error}
  if(sessions.get(machine.id)!==session)return;
  const toolbar=document.createElement('div');toolbar.className='vnc-controls';container.append(toolbar);
  const screen=document.createElement('div');screen.className='vnc-screen';container.append(screen);
  function button(label,action){const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',action);toolbar.append(b);return b}
  let rfb;
  const endpoint=machine.kind==='direct'?machine.host.toLowerCase()+':'+machine.port:machine.url;
  const update=value=>{status(value);container.dataset.status=value};
  const timeout=()=>{clearTimeout(session.timer);session.timer=setTimeout(()=>{update('Connection timed out');rfb?.disconnect();session.channel?.close()},30000)};
  try{
   update('Connecting');
   let target=machine.url;
   if(machine.kind==='direct'){
    const c=new Channel(machine.id);session.channel=c;target=c;
    // Attach handlers before asking the host to start the stream.
    rfb=new RFB(screen,c,{shared:true});session.rfb=rfb;
    const result=await bridge('vnc.open',{id:machine.id,host:machine.host,port:machine.port});c.token=result.token;
   }else{rfb=new RFB(screen,target,{shared:true});session.rfb=rfb}
   rfb.scaleViewport=true;rfb.resizeSession=false;timeout();
   rfb.addEventListener('connect',async()=>{clearTimeout(session.timer);update('Connected');if(session.pendingCredential){try{await bridge('vnc.credential.save',{id:machine.id,endpoint,value:JSON.stringify(session.pendingCredential)})}catch{toast('Connected, but credentials could not be saved.')}session.pendingCredential=null}});
   rfb.addEventListener('disconnect',e=>{clearTimeout(session.timer);update(e.detail.clean?'Disconnected':'Connection failed');session.channel?.close();sessions.delete(machine.id);toolbar.querySelectorAll('button').forEach(b=>b.disabled=b.textContent!=='Reconnect')});
   rfb.addEventListener('securityfailure',()=>update('Authentication failed'));
   rfb.addEventListener('credentialsrequired',async e=>{
    clearTimeout(session.timer);update('Authentication required');
    const sheet=document.createElement('form');sheet.className='vnc-auth';sheet.setAttribute('aria-label','Desktop authentication');
    const fields={};for(const type of e.detail.types){const label=document.createElement('label');label.textContent=type;const input=document.createElement('input');input.type=type==='password'?'password':'text';input.autocomplete='off';label.append(input);sheet.append(label);fields[type]=input}
    const remember=document.createElement('input');remember.type='checkbox';if(window.__OPEN_SESAME_NATIVE__){const label=document.createElement('label');label.append(remember,document.createTextNode('Remember in Keychain'));sheet.append(label);try{const saved=await bridge('vnc.credential.read',{id:machine.id,endpoint});if(saved){const values=JSON.parse(saved);Object.entries(fields).forEach(([k,input])=>input.value=values[k]||'')}}catch{update('Unlock Keychain or enter credentials')}}
    const submit=document.createElement('button');submit.textContent='Connect';const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';cancel.onclick=()=>{sheet.remove();close(machine.id)};sheet.append(submit,cancel);container.append(sheet);Object.values(fields)[0]?.focus();
    sheet.onsubmit=async ev=>{ev.preventDefault();const values=Object.fromEntries(Object.entries(fields).map(([k,input])=>[k,input.value]));if(remember.checked)session.pendingCredential=values;Object.values(fields).forEach(input=>input.value='');sheet.remove();rfb.sendCredentials(values);timeout()};
   });
   rfb.addEventListener('serververification',async e=>{
    clearTimeout(session.timer);update('Verify server identity');
    const sheet=document.createElement('div');sheet.className='vnc-auth';
    const digest=await crypto.subtle.digest('SHA-256',e.detail.publickey);
    const text=document.createElement('p');text.textContent='Verify this '+e.detail.type+' server SHA-256 fingerprint with its administrator: '+Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join(':');
    const approve=document.createElement('button'),cancel=document.createElement('button');approve.textContent='Trust for this session';cancel.textContent='Cancel';approve.onclick=()=>{sheet.remove();rfb.approveServer();timeout()};cancel.onclick=()=>{sheet.remove();close(machine.id)};sheet.append(text,approve,cancel);container.append(sheet);cancel.focus();
   });
   rfb.addEventListener('clipboard',e=>{session.clipboard=e.detail.text});
   button('Reconnect',async()=>{close(machine.id);container.replaceChildren();try{await open(machine,container,status)}catch(error){update(error.message)}});
   button('Disconnect',()=>close(machine.id));
   button('Fullscreen',()=>container.requestFullscreen().catch(()=>toast('Fullscreen unavailable')));
   button('Actual size',e=>{rfb.scaleViewport=!rfb.scaleViewport; e.currentTarget.textContent=rfb.scaleViewport?'Actual size':'Fit'});
   button('View only',e=>{rfb.viewOnly=!rfb.viewOnly;e.currentTarget.setAttribute('aria-pressed',String(rfb.viewOnly))});
   button('Ctrl Alt Del',()=>{if(!rfb.viewOnly)rfb.sendCtrlAltDel()});
   button('Clipboard',()=>{const panel=document.createElement('form'),text=document.createElement('textarea'),send=document.createElement('button'),dismiss=document.createElement('button');panel.className='vnc-auth';text.setAttribute('aria-label','Remote clipboard');text.value=session.clipboard;send.textContent='Send text';send.disabled=rfb.viewOnly;dismiss.type='button';dismiss.textContent='Close';dismiss.onclick=()=>panel.remove();panel.append(text,send,dismiss);panel.onsubmit=e=>{e.preventDefault();if(!rfb.viewOnly)rfb.clipboardPasteFrom(text.value);panel.remove()};container.append(panel);text.focus()});
   screen.addEventListener('keydown',e=>e.stopPropagation());screen.addEventListener('keyup',e=>e.stopPropagation());
  }catch(error){close(machine.id);throw error}
 }
 function close(id){const s=sessions.get(id);if(!s)return;s.pendingCredential=null;clearTimeout(s.timer);s.rfb?.disconnect();s.channel?.close();sessions.delete(id)}
 function blur(){sessions.forEach(s=>s.rfb?.blur())}
 window.addEventListener('blur',blur);window.addEventListener('open-sesame-view-changed',blur);window.addEventListener('pagehide',()=>[...sessions.keys()].forEach(close));window.addEventListener('open-sesame-desktop-disconnected',()=>[...sessions.keys()].forEach(close));
 return {open,close,blur};
})();
