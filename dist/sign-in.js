'use strict';
(()=>{
  const button=document.getElementById('sign-in'),cancel=document.getElementById('sign-in-cancel'),status=document.getElementById('sign-in-status'),native=window.__OPEN_SESAME_NATIVE__===true;
  let busy=false;
  async function sync(){
    if(!native){status.textContent='Open the desktop app to sign in and use your tools.';button.textContent='Open Open Sesame';return}
    try{const state=await openSesameBridge.request('auth.status');busy=state.busy===true;button.disabled=busy;cancel.hidden=!busy;button.textContent=busy?'Signing in…':'Sign in';status.textContent=state.message||'Sign in to continue.'}
    catch{button.disabled=false;busy=false;status.textContent='The desktop connection is unavailable. Reopen Open Sesame.'}
  }
  button.addEventListener('click',async()=>{
    if(!native){location.href='opensesame://auth/login';return}
    if(busy)return;busy=true;button.disabled=true;status.textContent='Opening secure sign-in…';
    try{await openSesameBridge.request('auth.signIn');await sync()}catch{busy=false;button.disabled=false;status.textContent='Sign-in could not open. Try again.'}
  });
  cancel.addEventListener('click',async()=>{try{await openSesameBridge.request('auth.cancel');await sync()}catch{status.textContent='Reopen Open Sesame to cancel sign-in.'}});
  window.addEventListener('open-sesame-auth-changed',sync);openSesameBridge.ready.then(sync);
})();
