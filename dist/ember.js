'use strict';
(()=>{
  const el=id=>document.getElementById(id),anchor=el('widget-anchor'),enabled=el('ember-enabled'),preview=el('ember-preview');
  const glow=document.createElement('div');glow.className='open-sesame-ember';glow.setAttribute('aria-hidden','true');anchor.append(glow);
  const status=document.createElement('span');status.className='sr-only';status.id='ember-state';status.setAttribute('role','status');anchor.append(status);
  const labels={idle:'At rest',focus:'Focus timer running',working:'Agent process active',present:'Agents connected',listening:'Voice or recording active',attention:'Agent process stopped, blocked or exited'};
  let agents=[],fresh=false,previewTimer=0,last='';
  try{enabled.checked=localStorage.getItem('open-sesame-ember-enabled')!=='false'}catch{}
  function sync(){
    let next='idle';
    if(focusRunning)next='focus';
    if(fresh&&agents.length)next=agents.some(a=>a.state==='running')?'working':'present';
    if(fresh&&agents.some(a=>['stopped','blocked','exited'].includes(a.state)))next='attention';
    if(window.OpenSesameVoice?.active||document.body.classList.contains('audio-active'))next='listening';
    const simulated=preview.value!=='auto';if(simulated)next=preview.value;
    anchor.dataset.ember=enabled.checked?next:'off';anchor.dataset.emberPreview=String(simulated);
    const text=enabled.checked?(simulated?'Glow preview: ':'')+labels[next]:'Ember glow off';
    if(text!==last){status.textContent=text;glow.title=text;last=text}
  }
  enabled.addEventListener('change',()=>{try{localStorage.setItem('open-sesame-ember-enabled',String(enabled.checked))}catch{}preview.disabled=!enabled.checked;sync()});
  preview.addEventListener('change',()=>{clearTimeout(previewTimer);sync();if(preview.value!=='auto')previewTimer=setTimeout(()=>{preview.value='auto';sync()},12000)});
  window.addEventListener('open-sesame-agents-updated',event=>{agents=event.detail.agents;fresh=event.detail.fresh;sync()});
  for(const event of ['open-sesame-layout','open-sesame-view-changed'])window.addEventListener(event,sync);
  new MutationObserver(sync).observe(document.body,{attributes:true,attributeFilter:['class']});
  setInterval(()=>{if(!document.hidden)sync()},1000);
  document.addEventListener('visibilitychange',()=>{anchor.dataset.emberPaused=String(document.hidden);sync()});
  preview.disabled=!enabled.checked;sync();
})();
