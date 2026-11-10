'use strict';
/* Only an explicit Generate submits a prompt to the account-owned image tool. */
(()=>{
  const el=id=>document.getElementById(id),host=el('image-generation');
  const prompt=el('image-prompt'),shape=el('image-shape'),preview=el('image-preview');
  let visible=()=>false,serial=0,running=null,checking=false,configured=false,result=null,saving=false;
  const active=()=>window.OpenSesameWidgetLifecycle?.isActive('image-generation')&&visible()&&!host.hidden&&document.visibilityState!=='hidden';
  const native=()=>!!window.openSesameBridge?.available;
  const key='open-sesame-image-draft-v1';
  try{const d=JSON.parse(localStorage.getItem(key)||'{}');if(typeof d.prompt==='string'&&d.prompt.length<=4000)prompt.value=d.prompt;if(['square','landscape','portrait'].includes(d.shape))shape.value=d.shape}catch{}
  function message(text){el('image-status').textContent=text}
  function saveDraft(){try{localStorage.setItem(key,JSON.stringify({prompt:prompt.value,shape:shape.value}))}catch{message('Could not save your draft. Keep this window open and free device storage.')}}
  function update(){
    const on=active();host.setAttribute('aria-busy',String(!!running||checking));
    el('image-generate').disabled=!on||!native()||!configured||!!running||checking||saving||!prompt.value.trim();
    el('image-stop').hidden=!running;el('image-save').disabled=!on||!native()||!result||!!running||saving;
    el('image-connect').disabled=!on||!native()||!!running||checking;el('image-refresh').disabled=!on||!native()||!!running||checking;
    prompt.disabled=!!running;shape.disabled=!!running;
    el('image-account').textContent=!native()?'Open the Mac app to connect ChatGPT.':configured?'ChatGPT connected through Codex':'Connect your ChatGPT account through Codex.';
    el('image-connect').textContent=configured?'Check ChatGPT sign-in':'Connect ChatGPT';
  }
  function stop(){
    const id=running;serial++;running=null;checking=false;
    if(id){window.openSesameBridge?.request('image.cancel',{id}).catch(()=>{});message('Generation stopped. Your prompt is kept; the service may still count work already started.')}
    update();
  }
  async function refresh(){
    if(!active()||!native()||running||checking){update();return}
    const ticket=++serial;checking=true;update();
    try{const s=await openSesameBridge.request('image.status');if(ticket!==serial||!active())return;configured=s.configured===true;message(configured?'Ready when you are. Generate uses your ChatGPT/Codex usage limits.':s.message||'Sign in with ChatGPT through Codex, then refresh.');}
    catch{if(ticket===serial){configured=false;message('Could not check ChatGPT sign-in. Update Codex, then refresh.')}}
    finally{if(ticket===serial){checking=false;update()}}
  }
  prompt.addEventListener('input',()=>{saveDraft();update()});shape.addEventListener('change',saveDraft);
  el('image-form').addEventListener('submit',async event=>{
    event.preventDefault();if(!active()||!native()||!configured||running||checking||saving||!prompt.value.trim())return;
    saveDraft();const ticket=++serial,id=crypto.randomUUID();running=id;message('Generating your image… This can take a few minutes.');update();
    try{
      const value=await openSesameBridge.request('image.generate',{id,prompt:prompt.value,shape:shape.value});
      if(ticket!==serial||!active())return;
      if(value?.id!==id||typeof value.image!=='string'||value.image.length>11200000||!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value.image))throw Error('The image response could not be verified.');
      result=value.image;preview.src=result;preview.hidden=false;el('image-empty').hidden=true;message('Your image is ready. Save a PNG to keep it.');
    }catch(error){if(ticket===serial)message(error.message||'Generation could not finish. Your prompt is kept.')}
    finally{if(ticket===serial){running=null;update()}}
  });
  el('image-stop').addEventListener('click',stop);el('image-refresh').addEventListener('click',refresh);
  el('image-connect').addEventListener('click',async()=>{
    if(!active()||!native()||running||checking)return;
    const ticket=++serial;checking=true;update();
    try{const target=await openSesameBridge.request('computer.login',{provider:'codex'});if(ticket!==serial||!active())return;if(target.kind!=='account-ready')await window.openSesameAccountTerminal(target);if(ticket===serial)message('Complete ChatGPT sign-in in your browser, then choose Refresh connection.');}
    catch(error){if(ticket===serial)message(error.message)}
    finally{if(ticket===serial){checking=false;update();refresh()}}
  });
  el('image-save').addEventListener('click',async()=>{
    if(!active()||!native()||!result||running||saving)return;
    const ticket=serial;saving=true;update();
    try{const saved=await openSesameBridge.request('image.save',{image:result});if(ticket===serial&&active())message(saved.saved?'PNG saved.': 'Save cancelled. Your preview is kept.');}
    catch(error){if(ticket===serial&&active())message(error.message)}
    finally{saving=false;update()}
  });
  const retire=()=>{if(!active())stop();else update()};
  for(const event of ['open-sesame-view-changed','open-sesame-layout','open-sesame-widgets-changed'])window.addEventListener(event,retire);
  document.addEventListener('visibilitychange',retire);window.addEventListener('pagehide',stop);
  window.addEventListener('open-sesame-desktop-disconnected',()=>{configured=false;stop()});
  window.OpenSesameImageGeneration={mount(predicate){visible=predicate;host.hidden=false;update();refresh()},pause(){visible=()=>false;stop()},refresh,get busy(){return !!running||saving}};
  update();
})();
