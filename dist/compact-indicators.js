'use strict';
(()=>{
  const el=id=>document.getElementById(id),anchor=el('widget-anchor');
  const bars=()=>{const node=document.createElement('span');node.className='compact-wave';node.setAttribute('aria-hidden','true');for(let i=0;i<7;i++){const bar=document.createElement('b');bar.style.setProperty('--bar',String(i));node.append(bar)}return node};
  function sync(media={}){
    const active=audioSession.active||audioSession.starting||audioSession.stopping,record=el('audio-record').checked,source=el('audio-source').value;
    const label=source==='system'?'System audio':source==='both'?'Microphone + system audio':'Microphone',phase=audioSession.starting?'Starting':audioSession.stopping?'Finishing':record?'REC':'Transcribing';
    anchor.classList.toggle('compact-capturing',!!active);anchor.classList.toggle('compact-recording',!!active&&record);anchor.classList.toggle('compact-playing',!active&&!!media.playing);
    if(active){
      if(!el('compact-right').querySelector('.compact-wave')){
        const text=document.createElement('span');text.className='compact-capture-label';text.textContent=phase;
        el('compact-right').replaceChildren(text,bars());
      }
      el('compact-left').innerHTML=source==='both'?'<span class="compact-dual-source">'+icon('monitor')+icon('mic')+'</span>':icon(source==='system'?'monitor':'mic');
      el('compact-right').querySelector('.compact-capture-label').textContent=phase;
      const value=Math.max(0,Math.min(100,Number(el('audio-meter').getAttribute('aria-valuenow'))||0));anchor.style.setProperty('--capture-level',String(value/100));
      el('compact-widget').title=label+' · '+phase+' · '+el('audio-elapsed').textContent;el('compact-widget').setAttribute('aria-label','Open '+label+' · '+phase);el('compact-left').setAttribute('aria-label',label);
    }else{
      el('compact-left').removeAttribute('aria-label');
      const left=el('compact-left'),wave=left.querySelector('.compact-playback-wave');
      if(media.playing&&!wave){const node=bars();node.classList.add('compact-playback-wave');left.append(node)}else if(!media.playing)wave?.remove();
    }
  }
  new MutationObserver(()=>{if(audioSession.active)sync()}).observe(el('audio-meter'),{attributes:true,attributeFilter:['aria-valuenow']});
  window.OpenSesameCompactIndicators={sync};window.OpenSesameCompact?.sync();
})();
