import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const migration=fs.readFileSync('dist/storage-migration.js','utf8');
function storage(entries){
  const values=new Map(entries);
  return {values,get length(){return values.size},key:index=>[...values.keys()][index]??null,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value))};
}
const local=storage([['perch-items-v1','legacy notes'],['perch-settings-v1','old settings'],['open-sesame-settings-v1','new settings'],['unrelated','keep']]);
const session=storage([['perch-spotify-pkce-v1','pending sign-in']]);
const context={window:{localStorage:local,sessionStorage:session}};
vm.runInNewContext(migration,context);
assert.equal(local.getItem('open-sesame-items-v1'),'legacy notes');
assert.equal(local.getItem('open-sesame-settings-v1'),'new settings');
assert.equal(local.getItem('perch-items-v1'),'legacy notes');
assert.equal(local.getItem('unrelated'),'keep');
assert.equal(session.getItem('open-sesame-spotify-pkce-v1'),'pending sign-in');
const size=local.length;
vm.runInNewContext(migration,context);
assert.equal(local.length,size,'Migration must be idempotent');
const restricted={get localStorage(){throw Error('Storage denied')},sessionStorage:storage([])};
assert.doesNotThrow(()=>vm.runInNewContext(migration,{window:restricted}));

const html=fs.readFileSync('dist/index.html','utf8');
assert.ok(html.indexOf('storage-migration.js')<html.indexOf('bridge.js'));
assert.match(html,/<title>Open Sesame/);
assert.match(html,/<strong>Open Sesame<\/strong>/);
const build=fs.readFileSync('desktop/build-macos.sh','utf8');
assert.ok(build.includes('build/Open Sesame.app'));
assert.ok(build.includes('/MacOS/OpenSesame'));
assert.ok(build.includes('<key>CFBundleExecutable</key><string>OpenSesame</string>'));
assert.ok(build.includes('<key>CFBundleDisplayName</key><string>Open Sesame</string>'));
assert.ok(fs.existsSync('desktop/OpenSesame.swift'));
assert.ok(fs.readFileSync('desktop/OpenSesame.swift','utf8').includes('["-B", "-u", resources.appendingPathComponent("bridge.py").path, "--stdio"]'),'The bundled helper must not write bytecode into the signed app');
assert.ok(build.includes("info['CFBundleShortVersionString'] = sys.argv[2]"));
assert.ok(!fs.existsSync('desktop/Perch.swift'));
const controller={window:{}};
vm.runInNewContext(fs.readFileSync('dist/controller-model.js','utf8'),controller);
for(const command of ['open sesame status','Open Sesame: status','perch: status'])assert.equal(controller.window.OpenSesameControllerModel.parse(command).action,'status');
for(const command of ['open sesames status','perchance status'])assert.throws(()=>controller.window.OpenSesameControllerModel.parse(command));
console.log('Open Sesame identity, native executable metadata, legacy storage migration, and command compatibility passed.');
