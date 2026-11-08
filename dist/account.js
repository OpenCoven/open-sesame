'use strict';
(()=>{
  if(!window.__OPEN_SESAME_NATIVE__)return;
  const section=document.createElement('div'),identity=document.createElement('span'),signOut=document.createElement('button');
  section.className='account-session';signOut.type='button';signOut.textContent='Sign out';signOut.setAttribute('aria-label','Sign out of Open Sesame');section.append(identity,signOut);document.getElementById('widget-options').append(section);
  openSesameBridge.ready.then(()=>openSesameBridge.request('auth.status')).then(status=>{identity.textContent=status.email||status.name||'Signed in';identity.title=identity.textContent}).catch(()=>{identity.textContent='Account unavailable'});
  signOut.addEventListener('click',async()=>{signOut.disabled=true;try{await openSesameBridge.request('auth.signOut')}catch{signOut.disabled=false;toast('Could not sign out. Try the menu bar account control.')}});
})();
