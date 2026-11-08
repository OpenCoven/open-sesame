'use strict';
(()=>{
  const version=typeof window.__OPEN_SESAME_VERSION__==='string'?window.__OPEN_SESAME_VERSION__:'Development',label=version==='Development'?'Development':'v'+version;
  function badge(className){const node=document.createElement('span');node.className=className;node.textContent=label;node.title='Open Sesame · '+label;node.setAttribute('aria-label','Open Sesame version '+version);return node}
  const rail=document.querySelector('#widget-panel>.panel-top');if(rail)rail.append(badge('app-version-badge'));
  const options=document.getElementById('widget-options');if(options){const header=document.createElement('div');header.className='app-version-heading';const name=document.createElement('strong');name.textContent='Open Sesame';header.append(name,badge('app-version-value'));options.prepend(header)}
  if(!rail)document.querySelector('main')?.append(badge('app-version-signin'));
})();
