'use strict';
window.OpenSesameVNC=(()=>{
  const sessions=new Map(),limit=1048576;
  const bridge=(method,params)=>openSesameBridge.request(method,params);
  const active=s=>sessions.get(s.machine.id)===s&&!s.ended;
  const encode=bytes=>btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));

  class Channel {
    constructor(id){
      Object.assign(this,{id,token:'',readyState:0,binaryType:'arraybuffer',protocol:'',onopen:null,onclose:null,onerror:null,onmessage:null,queued:0,sending:false});
      this.pending=[];this.early=[];this.earlyBytes=0;
    }
    setToken(token){
      this.token=token;
      if(this.readyState===3){bridge('vnc.close',{id:this.id,token}).catch(()=>{});return}
      const early=this.early;this.early=[];this.earlyBytes=0;
      early.forEach(message=>this.receive(message));
    }
    receive(message){
      if(this.readyState===3)return;
      if(!this.token){
        this.earlyBytes+=(message.data?.length||0)+128;
        if(this.earlyBytes>limit){this.fail();return}
        this.early.push(message);return;
      }
      if(message.token!==this.token)return;
      if(message.event==='vnc.open'){this.readyState=1;this.onopen?.({});this.flush()}
      if(message.event==='vnc.data'){
        try{
          if(typeof message.data!=='string'||message.data.length>87384)throw Error('Invalid desktop data');
          const bytes=Uint8Array.from(atob(message.data),x=>x.charCodeAt(0));
          this.onmessage?.({data:bytes.buffer});
          bridge('vnc.ack',{id:this.id,token:this.token,bytes:bytes.length}).catch(()=>this.fail());
        }catch{this.fail()}
      }
      if(message.event==='vnc.error')this.fail();
      if(message.event==='vnc.close')this.close(false);
    }
    send(bytes){
      if(this.readyState!==1)return;
      const copy=new Uint8Array(bytes);
      if(this.queued+copy.length>limit){this.fail();return}
      this.queued+=copy.length;
      for(let i=0;i<copy.length;i+=65536)this.pending.push(copy.slice(i,i+65536));
      this.flush();
    }
    async flush(){
      if(this.sending)return;
      this.sending=true;
      try{
        while(this.pending.length&&this.readyState===1){
          const part=this.pending.shift();
          await bridge('vnc.write',{id:this.id,token:this.token,data:encode(part)});
          this.queued=Math.max(0,this.queued-part.length);
        }
      }catch{this.fail()}finally{this.sending=false}
    }
    fail(){this.onerror?.({});this.close(false)}
    close(clean=true){
      if(this.readyState===3)return;
      this.readyState=3;this.pending=[];this.early=[];this.earlyBytes=0;this.queued=0;
      if(this.token)bridge('vnc.close',{id:this.id,token:this.token}).catch(()=>{});
      this.onclose?.({code:clean?1000:1006,reason:clean?'Connection closed':'Connection ended',wasClean:clean});
    }
  }
  window.addEventListener('open-sesame-desktop-event',e=>{
    const message=e.detail;
    if(message?.event?.startsWith('vnc.'))sessions.get(message.id)?.channel?.receive(message);
  });

  function finish(s,label){
    if(s.ended)return;
    s.ended=true;
    if(sessions.get(s.machine.id)===s)sessions.delete(s.machine.id);
    clearTimeout(s.timer);s.pendingCredential=null;s.clipboard='';
    s.dialogs.forEach(sheet=>{sheet.querySelectorAll('input,textarea').forEach(input=>input.value='');sheet.remove()});s.dialogs.clear();
    s.rfb?.disconnect();s.channel?.close();
    s.update(label);
    s.toolbar?.querySelectorAll('button').forEach(b=>b.disabled=b.textContent!=='Reconnect');
  }
  function deadline(s){
    clearTimeout(s.timer);
    s.timer=setTimeout(()=>{if(active(s))finish(s,'Connection timed out')},30000);
  }
  function sheet(s,label){
    const node=document.createElement('form');node.className='vnc-auth';
    node.setAttribute('aria-label',label);s.dialogs.add(node);
    const remove=()=>{node.querySelectorAll('input,textarea').forEach(input=>input.value='');node.remove();s.dialogs.delete(node)};
    return {node,remove};
  }
  async function credentials(s,event,endpoint){
    if(!active(s))return;
    clearTimeout(s.timer);s.update('Authentication required');
    const version=++s.authVersion,dialog=sheet(s,'Desktop authentication'),fields={};
    for(const type of event.detail.types){
      const label=document.createElement('label');label.textContent=type;
      const input=document.createElement('input');input.type=type==='password'?'password':'text';input.autocomplete='off';
      label.append(input);dialog.node.append(label);fields[type]=input;
    }
    const remember=document.createElement('input');remember.type='checkbox';
    if(window.__OPEN_SESAME_NATIVE__){
      const label=document.createElement('label');label.append(remember,document.createTextNode('Remember in Keychain'));dialog.node.append(label);
      try{
        const saved=await bridge('vnc.credential.read',{id:s.machine.id,endpoint});
        if(!active(s)||version!==s.authVersion){dialog.remove();return}
        if(saved){const values=JSON.parse(saved);Object.entries(fields).forEach(([key,input])=>input.value=typeof values[key]==='string'?values[key]:'')}
      }catch{if(active(s))s.update('Unlock Keychain or enter credentials')}
    }
    if(!active(s)||version!==s.authVersion){dialog.remove();return}
    const submit=document.createElement('button');submit.textContent='Connect';
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';cancel.onclick=()=>finish(s,'Disconnected');
    dialog.node.append(submit,cancel);s.container.append(dialog.node);Object.values(fields)[0]?.focus();
    dialog.node.onsubmit=event=>{
      event.preventDefault();
      if(!active(s)||version!==s.authVersion){dialog.remove();return}
      const values=Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,input.value]));
      s.pendingCredential=remember.checked?values:null;dialog.remove();s.rfb.sendCredentials(values);deadline(s);
    };
  }
  async function verifyServer(s,event){
    if(!active(s))return;
    clearTimeout(s.timer);s.update('Verify server identity');
    try{
      const digest=await crypto.subtle.digest('SHA-256',event.detail.publickey);
      if(!active(s))return;
      const dialog=sheet(s,'Verify desktop identity'),text=document.createElement('p');
      text.textContent='Verify this '+event.detail.type+' server SHA-256 fingerprint with its administrator: '+Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join(':');
      const approve=document.createElement('button'),cancel=document.createElement('button');
      approve.textContent='Trust for this session';cancel.type='button';cancel.textContent='Cancel';
      dialog.node.onsubmit=e=>{e.preventDefault();if(!active(s))return;dialog.remove();s.rfb.approveServer();deadline(s)};
      cancel.onclick=()=>finish(s,'Disconnected');dialog.node.append(text,approve,cancel);s.container.append(dialog.node);cancel.focus();
    }catch{if(active(s))finish(s,'Could not verify server identity')}
  }
  async function open(machine,container,status){
    if(sessions.has(machine.id))throw Error('This desktop is already open.');
    if(sessions.size>=4)throw Error('Disconnect a desktop before opening more than four sessions.');
    if(machine.kind==='direct'&&!window.__OPEN_SESAME_NATIVE__)throw Error('Direct VNC requires the Mac app. Choose a secure WebSocket gateway here.');
    const s={machine:{...machine},container,channel:null,rfb:null,clipboard:'',timer:null,pendingCredential:null,dialogs:new Set(),authVersion:0,ended:false};
    s.update=value=>{container.dataset.status=value;status(value)};
    sessions.set(machine.id,s);
    try{
      const {default:RFB}=await import('./vendor/novnc/rfb.js');
      if(!active(s))return;
      const toolbar=document.createElement('div');toolbar.className='vnc-controls';s.toolbar=toolbar;container.append(toolbar);
      const screen=document.createElement('div');screen.className='vnc-screen';container.append(screen);
      function button(label,action){const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',action);toolbar.append(b);return b}
      s.update('Connecting');
      s.channel=machine.kind==='direct'?new Channel(machine.id):null;
      const rfb=new RFB(screen,s.channel||machine.url,{shared:true});s.rfb=rfb;
      rfb.scaleViewport=true;rfb.resizeSession=false;deadline(s);
      const endpoint=machine.kind==='direct'?machine.host.toLowerCase()+':'+machine.port:machine.url;
      rfb.addEventListener('connect',async()=>{
        if(!active(s))return;
        clearTimeout(s.timer);s.update('Connected');
        const credential=s.pendingCredential;s.pendingCredential=null;
        if(credential)try{await bridge('vnc.credential.save',{id:machine.id,endpoint,value:JSON.stringify(credential)})}catch{if(active(s))toast('Connected, but credentials could not be saved.')}
      });
      rfb.addEventListener('disconnect',e=>{if(active(s))finish(s,e.detail.clean?'Disconnected':'Connection failed')});
      rfb.addEventListener('securityfailure',()=>{if(active(s))finish(s,'Authentication failed')});
      rfb.addEventListener('credentialsrequired',e=>credentials(s,e,endpoint));
      rfb.addEventListener('serververification',e=>verifyServer(s,e));
      rfb.addEventListener('clipboard',e=>{if(active(s))s.clipboard=e.detail.text.slice(0,1048576)});
      button('Reconnect',async()=>{finish(s,'Disconnected');container.replaceChildren();try{await open(s.machine,container,status)}catch(error){s.update(error.message)}});
      button('Disconnect',()=>finish(s,'Disconnected'));
      button('Fullscreen',()=>container.requestFullscreen().catch(()=>toast('Fullscreen unavailable')));
      button('Actual size',e=>{if(active(s)){rfb.scaleViewport=!rfb.scaleViewport;e.currentTarget.textContent=rfb.scaleViewport?'Actual size':'Fit'}});
      const viewOnly=button('View only',e=>{if(active(s)){rfb.viewOnly=!rfb.viewOnly;e.currentTarget.setAttribute('aria-pressed',String(rfb.viewOnly))}});viewOnly.setAttribute('aria-pressed','false');
      button('Ctrl Alt Del',()=>{if(active(s)&&!rfb.viewOnly)rfb.sendCtrlAltDel()});
      button('Clipboard',()=>{
        if(!active(s))return;
        const dialog=sheet(s,'Remote clipboard'),text=document.createElement('textarea'),send=document.createElement('button'),dismiss=document.createElement('button');
        text.setAttribute('aria-label','Remote clipboard');text.maxLength=1048576;text.value=s.clipboard;send.textContent='Send text';send.disabled=rfb.viewOnly;
        dismiss.type='button';dismiss.textContent='Close';dismiss.onclick=dialog.remove;dialog.node.append(text,send,dismiss);
        dialog.node.onsubmit=e=>{e.preventDefault();if(active(s)&&!rfb.viewOnly)rfb.clipboardPasteFrom(text.value.slice(0,1048576));dialog.remove()};container.append(dialog.node);text.focus();
      });
      screen.addEventListener('keydown',e=>e.stopPropagation());screen.addEventListener('keyup',e=>e.stopPropagation());
      if(s.channel){
        const result=await bridge('vnc.open',{id:machine.id,host:machine.host,port:machine.port});
        s.channel.setToken(result.token);
        if(!active(s))s.channel.close();
      }
    }catch(error){finish(s,'Connection failed');throw error}
  }
  function close(id){const s=sessions.get(id);if(s)finish(s,'Disconnected')}
  function blur(){sessions.forEach(s=>s.rfb?.blur())}
  window.addEventListener('blur',blur);window.addEventListener('open-sesame-view-changed',blur);
  window.addEventListener('pagehide',()=>[...sessions.keys()].forEach(close));
  window.addEventListener('open-sesame-desktop-disconnected',()=>[...sessions.keys()].forEach(close));
  return {open,close,blur};
})();
