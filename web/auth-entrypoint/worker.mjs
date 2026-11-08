// Public login handoff only. The native app owns the WorkOS PKCE transaction and credentials.
export const loginURL='https://opensesame.computer/auth/login';
export const nativeLogin='opensesame://auth/login';
export const script=`'use strict';
(()=>{
  const target='${nativeLogin}',button=document.getElementById('open-app'),status=document.getElementById('handoff-status');
  function open(){status.textContent='Continue signing in in the Open Sesame app.';try{window.location.replace(target)}catch{status.textContent='Choose Open Open Sesame to continue in the app.'}}
  button.addEventListener('click',event=>{event.preventDefault();open()});
  open();
})();
`;
export const style=`:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#101113;color:#e8e6ec;font-synthesis:none;-webkit-font-smoothing:antialiased}*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center}main{display:flex;flex-direction:column;align-items:center;gap:15px;width:min(100%,520px);padding:40px 24px;text-align:center}.brand{width:44px;height:30px;color:#c6b8d9}.eyebrow{margin-top:3px;font-size:10px;letter-spacing:2px;color:#b8b4bf}h1{margin:0;font-size:28px;line-height:1.2;font-weight:450;letter-spacing:-.7px}p{margin:0;color:#b8b4bf;font-size:14px;line-height:1.6;max-width:390px}#open-app{display:inline-flex;align-items:center;justify-content:center;min-height:40px;margin:5px 0;padding:10px 20px;border:1px solid #c6b8d9;border-radius:8px;background:#c6b8d9;color:#1b1720;font-size:13px;font-weight:500;text-decoration:none}#open-app:hover{background:#d5c6e6}#open-app:focus-visible{outline:2px solid #e8e6ec;outline-offset:4px}small{color:#a09ba8;font-size:11px;line-height:1.7;max-width:370px}#handoff-status{font-size:12px;min-height:20px}noscript{font-size:12px;color:#b8b4bf}`;
export const page=`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'"><title>Continue to Open Sesame</title><link rel="canonical" href="${loginURL}"><link rel="stylesheet" href="/auth/desktop-login.css"><script src="/auth/desktop-login.js" defer></script></head><body><main><svg class="brand" viewBox="0 0 36 24" aria-hidden="true"><path d="M3 5c5 0 9 2 13 8C9 18 4 15 3 5Zm30 0c-5 0-9 2-13 8 7 5 12 2 13-8Z" fill="currentColor"/></svg><span class="eyebrow">OPEN SESAME</span><h1>Continue in your own space.</h1><p>Open Sesame will start secure sign-in with WorkOS.</p><a id="open-app" href="${nativeLogin}">Open Open Sesame</a><p id="handoff-status" role="status" aria-live="polite">Opening the desktop app…</p><small>Allow your browser to open Open Sesame. If the app does not open, install it on your Mac, then try again.</small><noscript>Choose Open Open Sesame to start sign-in.</noscript></main></body></html>
`;
const resources=new Map([
  ['/auth/login',['text/html; charset=utf-8',page]],
  ['/auth/login/',['text/html; charset=utf-8',page]],
  ['/auth/desktop-login.js',['text/javascript; charset=utf-8',script]],
  ['/auth/desktop-login.css',['text/css; charset=utf-8',style]],
]);
export default {
  fetch(request){
    const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"};
    if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{...headers,Allow:'GET, HEAD'}});
    const path=new URL(request.url).pathname;
    if(path==='/')return new Response(null,{status:302,headers:{...headers,Location:loginURL}});
    const resource=resources.get(path);
    if(!resource)return new Response(request.method==='HEAD'?null:'Not found',{status:404,headers});
    headers['Content-Type']=resource[0];
    return new Response(request.method==='HEAD'?null:resource[1],{headers});
  },
};
