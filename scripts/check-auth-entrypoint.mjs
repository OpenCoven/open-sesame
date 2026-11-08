import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import worker,{loginURL,nativeLogin,page,script} from '../web/auth-entrypoint/worker.mjs';
assert.equal(loginURL,'https://opensesame.computer/auth/login');assert.equal(nativeLogin,'opensesame://auth/login');
for(const path of ['/auth/login','/auth/login/','/auth/desktop-login.js','/auth/desktop-login.css']){
  const response=worker.fetch(new Request('https://opensesame.computer'+path+'?code=synthetic-private-value&next=https://untrusted.invalid'));
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  const body=await response.text();assert.ok(!body.includes('synthetic-private-value')&&!body.includes('untrusted.invalid'));
  const head=worker.fetch(new Request('https://opensesame.computer'+path,{method:'HEAD'}));assert.equal(head.status,200);assert.equal(await head.text(),'');
}
assert.equal(worker.fetch(new Request(loginURL,{method:'POST',body:'synthetic token'})).status,405);
assert.equal(worker.fetch(new Request('https://opensesame.computer/__openSesame/bridge')).status,404);
assert.equal(worker.fetch(new Request('https://opensesame.computer/downloads/private.zip')).status,404);
assert.equal(worker.fetch(new Request('https://opensesame.computer/')).headers.get('location'),loginURL);
const button=new EventTarget(),status={},navigation=[];
vm.runInNewContext(script,{window:{location:{replace:url=>navigation.push(url)}},document:{getElementById:id=>id==='open-app'?button:status}});
assert.deepEqual(navigation,[nativeLogin],'The entry initiates native PKCE rather than merely displaying a sign-in button');
button.dispatchEvent(new Event('click',{cancelable:true}));assert.deepEqual(navigation,[nativeLogin,nativeLogin]);
assert.ok(page.includes('href="opensesame://auth/login"'),'A browser/user-gesture fallback remains available');
const source=fs.readFileSync('desktop/OpenSesame.swift','utf8');assert.ok(source.includes('if url.path == "/login" { showPanel(); authentication.signIn() }'),'External login starts a fresh SDK flow even with an existing app session');
const config=JSON.parse(fs.readFileSync('web/auth-entrypoint/vercel.json','utf8'));assert.equal(config.outputDirectory,'dist');assert.equal(config.buildCommand,'node build.mjs');assert.equal(config.installCommand,'');assert.ok(config.rewrites.some(r=>r.source==='/auth/login'&&r.destination==='/auth/login/index.html'));
const auth=fs.readFileSync('desktop/Authentication.swift','utf8');assert.ok(auth.includes('if restoring { cancel() }'),'An external sign-in must not be swallowed by a background restore');
console.log('HTTPS login entry, fixed native handoff, automatic initiation and explicit fallback, query privacy, request methods and public route boundaries passed. Browser/OS navigation is simulated.');
