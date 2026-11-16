// Headless shell contracts; browser and native resource traces are separate checks.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root = process.cwd();
const read = file => readFileSync(path.join(root, file), 'utf8');
const load = file => import(pathToFileURL(path.join(root, file)));
const {widgets, paletteIndex} = await load('ui/manifest.js');
const {searchCommands} = await load('ui/palette.js');
assert.deepEqual(widgets.filter(w => w.defaultOn).map(w => w.id), ['today','projects','focus','shells','agents']);
assert.equal(new Set(widgets.map(w => w.id)).size, widgets.length);
assert.equal(new Set(paletteIndex.map(c => c.id)).size, paletteIndex.length);
for (const entry of widgets) {
  assert(Object.isFrozen(entry));
  assert(entry.panel && entry.settings && Array.isArray(entry.commands));
  assert(!('module' in entry) && !('script' in entry), 'Metadata cannot request executable code');
  assert(paletteIndex.some(c => c.widget === entry.id));
}
assert(searchCommands(paletteIndex, 'github').some(c => c.widget === 'github'));
assert(searchCommands(paletteIndex, 'new shell').some(c => c.id === 'shells.new'));
assert.equal(searchCommands(paletteIndex, '<script>').length, 0);
assert(!/\bimport\s*\(/.test(read('ui/manifest.js')));
assert(!/\bwindow\b|globalThis/.test(read('ui/manifest.js')));
console.log('Manifest/palette: defaults, metadata-only discovery and scoped command identities pass.');

// No module in ui/ writes to a global object, so no widget can share state through one. A write is
// an assignment, update, delete or define on a member of window, globalThis, self or host (the
// name widgets receive the window under). Reading a global, or naming a local variable window,
// is not a write. The vendored terminal bundle lives in dist/vendor, outside this scan, and the
// browser fixture checks the one global it is allowed to add.
const GLOBALS = String.raw`(?<![\w$.])(?:window|globalThis|self|host)`;
const MEMBER = String.raw`(?:\s*(?:\??\.\s*[\w$]+|\[[^\]]*\]))+`;
const ASSIGN = String.raw`\s*(?:=(?![=>])|[-+*/%&|^]=|\*\*=|<<=|>>>?=|&&=|\|\|=|\?\?=|\+\+|--)`;
const globalWrites = [
  new RegExp(GLOBALS + MEMBER + ASSIGN, 'g'),
  new RegExp(String.raw`(?:\+\+|--|\bdelete)\s*` + GLOBALS + MEMBER, 'g'),
  new RegExp(String.raw`\b(?:Object\.(?:assign|defineProperty|defineProperties|setPrototypeOf)|Reflect\.(?:set|defineProperty|deleteProperty))\s*\(\s*` + GLOBALS + String.raw`\b`, 'g'),
];
const writesGlobal = source => globalWrites.flatMap(pattern => [...source.matchAll(pattern)].map(match => match[0].trim()));
for (const sample of ['window.shared = 1', 'globalThis["shared"] = 1', 'self.count += 1', 'host.OpenSesameXterm ??= {}', 'window.__TAURI__.core.x = 1',
  'window.count++', '++globalThis.count', 'delete window.shared', 'Object.assign(window, {a: 1})', 'Object.defineProperty(globalThis, "a", {})', 'Reflect.set(self, "a", 1)']) {
  assert.notDeepEqual(writesGlobal(sample), [], `the global-write scan must catch: ${sample}`);
}
for (const sample of ['const tauri = host.__TAURI__;', 'if (window.a === b) go();', 'let window = ""; window = window + "x";', 'request.host = value;',
  'host.setTimeout(() => {}, 1)', 'const f = x => window.a;', 'globalThis.crypto.randomUUID()']) {
  assert.deepEqual(writesGlobal(sample), [], `the global-write scan must allow: ${sample}`);
}
const modules = (function walk(directory) {
  return readdirSync(path.join(root, directory), {withFileTypes: true}).flatMap(entry => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? walk(file) : entry.name.endsWith('.js') ? [file] : [];
  });
})('ui');
assert(modules.includes('ui/widgets/shells.js') && modules.includes('ui/main.js'), 'the scan covers the shell and its widgets');
for (const file of modules) assert.deepEqual(writesGlobal(read(file)), [], `${file} writes to a global object`);
console.log(`Globals: no module in ui/ (${modules.length} files) writes to window, globalThis, self or host.`);

const {createLifecycle} = await load('ui/lifecycle.js');
const deferred = () => {let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise, resolve, reject};};
const tick = () => new Promise(resolve => setImmediate(resolve));
function rig(custom = {}) {
  const events = [], surfaces = [], links = [];
  const entries = [{id:'a',defaultOn:true},{id:'b',defaultOn:false}];
  const module = id => ({mount: async context => {
    events.push(`mount:${id}`);
    return {command: async action => events.push(`command:${id}:${action}`), dispose: async () => events.push(`dispose:${id}`)};
  }});
  const manager = createLifecycle({
    widgets: entries, loaders: {a:async()=>{events.push('load:a');return module('a');}, b:async()=>{events.push('load:b');return module('b');}},
    styles:{a:'./a.css',b:'./b.css'},
    createSurface: id => { const surface={id,hidden:true,remove(){this.removed=true;}};surfaces.push(surface);return surface; },
    loadStyle: async href => {const link={href,remove(){this.removed=true;}};links.push(link);return ()=>link.remove();},
    context:{}, ...custom,
  });
  return {manager,events,surfaces,links};
}
{
  const {manager,events,surfaces,links}=rig();
  assert.deepEqual(events, [], 'Construction imports nothing');
  await manager.show('a');
  assert.deepEqual(events,['load:a','mount:a','command:a:open']);
  assert.equal(surfaces[0].hidden,false);
  assert(!events.includes('load:b'), 'Off widgets load neither module nor style');
  await manager.show('b');
  assert.equal(manager.snapshot().on.b,true, 'A palette command can enable an off widget');
  assert.equal(surfaces[0].hidden,true);
  assert.equal(surfaces[1].hidden,false);
  await manager.setEnabled('b',false);
  assert.equal(surfaces[1].removed,true);
  assert.equal(links[1].removed,true);
  assert(events.includes('dispose:b'));
  await manager.show('b','new');
  assert.equal(events.filter(e=>e==='mount:b').length,2);
  await manager.dispose();
  assert(surfaces.every(s=>s.removed));
  assert(links.every(l=>l.removed));
  await assert.rejects(manager.show('a'), /closed/i);
}
// Disable while import is pending: never mount or add a stylesheet afterwards.
{
  const imported=deferred();let mounts=0;
  const {manager,links}=rig({loaders:{a:()=>imported.promise}});
  const opening=manager.show('a');await tick();
  const closing=manager.setEnabled('a',false);
  imported.resolve({mount:async()=>{mounts++;}});
  await Promise.all([opening,closing]);
  assert.equal(mounts,0);assert.equal(links.length,0);
}
// Disable while mount is pending: abort immediately, remove its surface, then dispose the late API.
{
  const mounted=deferred();let context,disposed=0;
  const {manager,surfaces,links}=rig({loaders:{a:async()=>({mount:ctx=>{context=ctx;return mounted.promise;}})}});
  const opening=manager.show('a');await tick();
  const closing=manager.setEnabled('a',false);
  assert(context.signal.aborted);assert(surfaces[0].removed);assert(links[0].removed);
  mounted.resolve({command:()=>{throw Error('Stale command ran');},dispose:async()=>{disposed++;}});
  await Promise.all([opening,closing]);assert.equal(disposed,1);
}
// Re-enable waits for asynchronous old teardown so two owners never touch the same resource.
{
  const done=deferred();let mounts=0;
  const {manager}=rig({loaders:{a:async()=>({mount:async()=>{mounts++;return {dispose:()=>done.promise};}})}});
  await manager.show('a');
  const off=manager.setEnabled('a',false);
  const on=manager.show('a');await tick();assert.equal(mounts,1);
  done.resolve();await Promise.all([off,on]);assert.equal(mounts,2);
  await manager.dispose();
}
// A failed stylesheet or mount does not poison a later retry or leave an owned surface behind.
{
  let attempts=0;
  const {manager,surfaces,links}=rig({loaders:{a:async()=>({mount:async()=>{if(++attempts===1)throw Error('mount failed');return {};}})}});
  await assert.rejects(manager.show('a'), /mount failed/);
  assert(surfaces[0].removed);assert(links[0].removed);
  await manager.show('a');assert.equal(attempts,2);await manager.dispose();
}
// Switching while a module is pending never steals focus or dispatches its stale palette command.
{
  const imported=deferred();const commands=[];
  const {manager,surfaces}=rig({loaders:{a:()=>imported.promise,b:async()=>({mount:async()=>({command:a=>commands.push('b:'+a)})})}});
  const opening=manager.show('a','new');await tick();await manager.show('b');
  imported.resolve({mount:async()=>({command:a=>commands.push('a:'+a)})});await opening;
  assert.deepEqual(commands,['b:open']);assert.equal(surfaces.find(s=>s.id==='a').hidden,true);
  await manager.dispose();
}
console.log('Lifecycle: selected-only loads, CSS ownership, disable/import/mount races, retry and async teardown pass.');
// An immediate off, before the import microtask starts, must not wait on its own teardown.
{
  const {manager}=rig();
  const opening=manager.show('a');const closing=manager.setEnabled('a',false);
  const finished=await Promise.race([Promise.all([opening,closing]).then(()=>true),tick().then(()=>false)]);
  assert.equal(finished,true,'Immediate disable must settle without a lifetime cycle');
}

const {createPreferences}=await load('ui/preferences.js');
{
 const calls=[];const errors=[];
 const bridge={request:async(method,params)=>{calls.push([method,params]);if(method==='settings.all')return {settings:{'shell.lastView':'shells'}};if(method==='widgets.list')return {widgets:{shells:'inactive',github:'active',today:'uninstalled'}};return {saved:true};}};
 const prefs=createPreferences(bridge,error=>errors.push(error));
 assert.deepEqual(await prefs.read(),{lastView:'shells',on:{shells:false,github:true,today:false}});
 await prefs.save({lastView:'github',on:{shells:true,github:false}});
 assert(calls.some(([m,p])=>m==='widgets.set'&&p.id==='shells'&&p.state==='active'));
 assert(calls.some(([m,p])=>m==='settings.set'&&p.key==='shell.lastView'&&p.value==='github'));
 assert.equal(errors.length,0);
}
{
 const errors=[];const prefs=createPreferences({request:async()=>{throw Error('Unsupported desktop action.');}},error=>errors.push(error));
 assert.deepEqual(await prefs.read(),{on:{},lastView:null});
 await prefs.save({lastView:'today',on:{today:true}});
 assert(errors.length>=2,'Unavailable host persistence is visible and never claimed as saved');
}
console.log('Preferences: typed host commands, two UI states and visible persistence failures pass.');

for(const malformed of [{broken:true},42,false,[], '']) {
 const calls=[],errors=[];const prefs=createPreferences({request:async(m,p)=>m==='settings.all'?{settings:{'shell.lastView':malformed}}:m==='widgets.list'?{widgets:{}}:(calls.push([m,p]),{saved:true})},e=>errors.push(e));
 await prefs.read();await prefs.save({lastView:'today',on:{today:true}});assert(errors.length);assert.equal(calls.length,0);
}
