'use strict';
// Every surface controls the same provider. Unsupported embeds expose an honest disabled state.
window.OpenSesameVolume={attach(host,provider,label){
  host.classList.add('media-volume');
  const mute=document.createElement('button'),slider=document.createElement('input'),value=document.createElement('output');
  mute.type='button';mute.innerHTML=icon('volume');mute.setAttribute('aria-label','Mute '+label);
  slider.type='range';slider.min='0';slider.max='100';slider.step='1';slider.value='100';slider.setAttribute('aria-label',label+' volume');
  value.setAttribute('aria-hidden','true');host.append(mute,slider,value);
  let lastAudible=70,changing=false;
  function sync(){
    const player=provider(),media=player?.snapshot()||{},level=player?.getVolume?.(),available=media.loaded&&Number.isFinite(level)&&typeof player?.setVolume==='function';
    const hint=!media.loaded?'Load media to adjust volume':!available?'Adjust volume in the provider player':'Volume';
    slider.disabled=!available;mute.disabled=!available;host.title=hint;
    if(!changing)slider.value=available?String(Math.round(Math.max(0,Math.min(100,level)))):'0';
    slider.setAttribute('aria-valuetext',available?slider.value+' percent':hint);
    slider.style.setProperty('--fill',slider.value+'%');value.textContent=available?slider.value+'%':media.loaded?'Player':'—';
    const muted=available&&Number(slider.value)===0;mute.setAttribute('aria-label',(muted?'Unmute ':'Mute ')+label);mute.title=available?(muted?'Unmute':'Mute'):hint;mute.classList.toggle('is-muted',muted);
    if(available&&level>0)lastAudible=level;
  }
  function set(level){try{provider()?.setVolume?.(level);sync()}catch(error){toast(error.message||'Volume could not be changed.')}}
  slider.addEventListener('pointerdown',event=>{event.stopPropagation();changing=true});
  slider.addEventListener('input',event=>{event.stopPropagation();set(Number(slider.value))});
  for(const name of ['change','pointerup','pointercancel','blur'])slider.addEventListener(name,()=>{changing=false;sync()});
  mute.addEventListener('click',event=>{event.stopPropagation();set(Number(slider.value)>0?0:lastAudible)});
  host.addEventListener('pointerenter',()=>clearTimeout(hoverTimer));host.addEventListener('focusin',()=>clearTimeout(hoverTimer));
  sync();return {sync};
}};
