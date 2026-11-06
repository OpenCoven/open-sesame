'use strict';
(()=>{
  const el=id=>document.getElementById(id),select=el('audio-source'),settings=el('live-options'),row=select.closest('.audio-source-row');row.hidden=true;
  const button=document.createElement('button');button.type='button';button.id='live-source-toggle';button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','live-source-menu');settings.querySelector('.audio-options').prepend(button);
  const menu=document.createElement('div');menu.id='live-source-menu';menu.hidden=true;menu.setAttribute('role','menu');menu.setAttribute('aria-label','Audio source');settings.append(menu);
  const choices=[['mic','Microphone','mic'],['system','Shared audio','monitor'],['both','Mic + shared audio','volume']];
  for(const [value,label,glyph]of choices){const option=document.createElement('button');option.type='button';option.dataset.source=value;option.setAttribute('role','menuitemradio');option.innerHTML=icon(glyph)+'<span>'+label+'</span>'+icon('check');option.addEventListener('click',()=>{if(select.disabled)return;select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));sync();close();});menu.append(option);}
  menu.append(el('audio-source-help'));
  function sync(){const choice=choices.find(c=>c[0]===select.value)||choices[0];button.innerHTML=icon(choice[2]);button.title='Audio source · '+choice[1];button.setAttribute('aria-label','Audio source: '+choice[1]);button.disabled=select.disabled;for(const option of menu.querySelectorAll('button'))option.setAttribute('aria-checked',option.dataset.source===select.value);if(button.disabled)close(false);}
  function close(focus=true){menu.hidden=true;button.setAttribute('aria-expanded','false');if(focus)button.focus({preventScroll:true});}
  button.addEventListener('click',()=>{if(!menu.hidden){close();return;}menu.hidden=false;button.setAttribute('aria-expanded','true');menu.querySelector('[aria-checked=true]').focus({preventScroll:true});});
  select.addEventListener('change',sync);new MutationObserver(sync).observe(select,{attributes:true,attributeFilter:['disabled']});new MutationObserver(()=>{if(settings.hidden)close(false);}).observe(settings,{attributes:true,attributeFilter:['hidden']});
  document.addEventListener('pointerdown',e=>{if(!menu.hidden&&!menu.contains(e.target)&&!button.contains(e.target))close(false);});
  document.addEventListener('keydown',e=>{if(menu.hidden)return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();}if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const options=[...menu.querySelectorAll('button')],i=options.indexOf(document.activeElement);options[e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowUp'?-1:1)+3)%3].focus();}if(e.key==='Tab')close(false);},true);sync();
})();
