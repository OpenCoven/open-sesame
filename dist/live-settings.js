'use strict';
(()=>{
  const details=document.getElementById('live-recognition-details'),settings=document.getElementById('live-options');
  document.addEventListener('pointerdown',event=>{if(details.open&&!details.contains(event.target))details.open=false});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&details.open){event.preventDefault();event.stopImmediatePropagation();details.open=false;details.querySelector('summary').focus()}},true);
  new MutationObserver(()=>{if(settings.hidden)details.open=false}).observe(settings,{attributes:true,attributeFilter:['hidden']});
})();
