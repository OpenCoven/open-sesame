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

// Issue #77: Today, Projects and Focus replace their pending loaders, and nothing else does. The
// palette captures a note or a task into Today and shows calculator and world-clock answers,
// which invoke no command.
{
  const loaders = read('ui/widget-loaders.js');
  for (const id of ['today', 'projects', 'focus']) {
    assert.match(loaders, new RegExp(String.raw`\b${id}: \(\) => import\('\./widgets/${id}\.js'\)`), `${id} loads its port`);
    assert.match(loaders, new RegExp(String.raw`\b${id}: '\./widgets/views\.css'`), `${id} loads the views' style`);
  }
  for (const id of ['agents', 'reader', 'github', 'familiars', 'local-media', 'desktops', 'transcription']) {
    assert.match(loaders, new RegExp(String.raw`'?${id}'?: \(\) => import\('\./widgets/pending\.js'\)`), `${id} is still pending`);
  }
  const today = widgets.find(widget => widget.id === 'today');
  assert.deepEqual(today.commands.map(command => [command.id, command.label, command.action]), [
    ['today.open', 'Open Today', 'open'], ['today.capture-note', 'Capture a note', 'capture-note'], ['today.capture-task', 'Capture a task', 'capture-task'],
  ]);
  const {paletteView, captureCommands, draftAction} = await load('ui/palette.js');
  const at = {now: new Date('2026-11-16T04:00:00Z'), localZone: 'Europe/London'};
  assert.deepEqual(paletteView(paletteIndex, '', at), {answer: null, commands: searchCommands(paletteIndex, ''), captureOnEnter: true});
  const capture = query => paletteView(paletteIndex, query, at).commands.filter(command => command.id.endsWith('.text')).map(command => [command.id, command.label, command.widget, command.group, command.action]);
  assert.deepEqual(capture('buy milk'), [
    ['today.capture-note.text', 'Capture note: buy milk', 'today', 'Today', 'capture-note:buy milk'],
    ['today.capture-task.text', 'Capture task: buy milk', 'today', 'Today', 'capture-task:buy milk'],
  ]);
  assert.deepEqual(capture('  task:  call Sam '), [['today.capture-task.text', 'Capture task: call Sam', 'today', 'Today', 'capture-task:call Sam']]);
  assert.deepEqual(capture('TODO: call Sam').map(row => row[4]), ['capture-task:call Sam']);
  assert.deepEqual(capture('Note: idea').map(row => row[4]), ['capture-note:idea']);
  for (const query of ['note:', 'task:   ', '/new', '!ls', '   ']) assert.deepEqual(capture(query), [], `nothing to capture for ${JSON.stringify(query)}`);
  const long = 'x'.repeat(100);
  assert.equal(capture(long)[0][1], `Capture note: ${'x'.repeat(59)}…`, 'a long draft is shortened in its label');
  assert.equal(capture(long)[0][4], `capture-note:${long}`, 'but captured in full');
  // Commands that match come before the captures, so Enter on a command's name opens it.
  const shell = paletteView(paletteIndex, 'new shell', at).commands;
  assert.equal(shell[0].id, 'shells.new');
  assert.deepEqual(shell.slice(-2).map(command => command.id), ['today.capture-note.text', 'today.capture-task.text']);
  // An answer replaces the captures: Enter never turns a sum or a time question into a note.
  const sum = paletteView(paletteIndex, '2+2', at);
  assert.equal(sum.answer.kind, 'calculation');
  assert.equal(sum.answer.result, '4');
  assert.deepEqual(sum.commands, []);
  const time = paletteView(paletteIndex, 'time in Tokyo', at);
  assert.deepEqual([time.answer.kind, time.answer.result, time.answer.timeZone], ['time', '1:00:00 PM GMT+9', 'Asia/Tokyo']);
  assert.deepEqual(time.commands.filter(command => command.id.endsWith('.text')), []);
  assert.equal(paletteView(paletteIndex, '(1+', at).answer.error, 'Finish the expression to calculate.');
  // An answer that is only an error, such as for a phone number, leaves the capture offers, but
  // Enter does not choose them; the person picks one by clicking or with the arrow keys.
  const phone = paletteView(paletteIndex, '(555) 123-4567', at);
  assert.equal(phone.answer.error, 'Finish the expression to calculate.');
  assert.deepEqual(phone.commands.filter(command => command.capture).map(command => command.action), ['capture-note:(555) 123-4567', 'capture-task:(555) 123-4567']);
  assert.equal(phone.captureOnEnter, false);
  assert.equal(sum.captureOnEnter, false);
  assert.equal(paletteView(paletteIndex, 'buy milk', at).captureOnEnter, true);
  // A capture names the palette's draft, so a retry of the same capture, edited or not, keeps
  // its client ID and the core keeps one row.
  assert.equal(draftAction('capture-note:buy milk', 'p1'), 'capture-note@p1:buy milk');
  assert.equal(draftAction('capture-task:a: b@c', 'p-2'), 'capture-task@p-2:a: b@c');
  for (const [action, draft] of [['capture-note:x', 'a b'], ['capture-note:x', ''], ['capture-note:x', 'x'.repeat(65)], ['open', 'p1'], ['capture-note', 'p1']])
    assert.throws(() => draftAction(action, draft), TypeError, `${action} ${draft}`);
  assert.deepEqual(captureCommands('note: x').map(command => [Object.isFrozen(command), command.capture]), [[true, true]]);
  assert(!paletteIndex.some(command => command.capture), 'only typed drafts are captures');
  assert(!/\b(?:window|globalThis|document|localStorage|fetch)\b/.test(read('ui/palette.js')), 'The palette is pure');
}
console.log('Views (#77): Today, Projects and Focus replace only their loaders; the palette captures a note or a task and shows answers that invoke nothing.');

// No module in ui/ writes to a global object, so no widget can share state through one. A write is
// an assignment, update, delete or define on a member of window, globalThis, self, top, frames or
// host (the name widgets receive the window under), also when reached as a member such as
// context.host. Reading a global, or naming a local variable window, is not a write. The scan is
// textual: an alias (const g = globalThis; g.x = 1), a parenthesised object, a computed key with
// nested brackets or a destructuring target escapes it, and the browser fixture's comparison of
// the window's own keys catches those that run. The vendored terminal bundle lives in
// dist/vendor, outside this scan, and the browser fixture checks the one global it may add.
const GLOBALS = String.raw`(?<![\w$])(?:window|globalThis|self|top|frames|host)`;
const MEMBER = String.raw`(?:\s*(?:\??\.\s*[\w$]+|\[[^\]]*\]))+`;
const ASSIGN = String.raw`\s*(?:=(?![=>])|[-+*/%&|^]=|\*\*=|<<=|>>>?=|&&=|\|\|=|\?\?=|\+\+|--)`;
const globalWrites = [
  new RegExp(GLOBALS + MEMBER + ASSIGN, 'g'),
  new RegExp(String.raw`(?:\+\+|--|\bdelete)\s*` + GLOBALS + MEMBER, 'g'),
  new RegExp(String.raw`\b(?:Object\.(?:assign|defineProperty|defineProperties|setPrototypeOf)|Reflect\.(?:set|defineProperty|deleteProperty|setPrototypeOf))\s*\(\s*(?:[\w$]+\s*\.\s*)*` + GLOBALS + String.raw`\b`, 'g'),
];
const writesGlobal = source => globalWrites.flatMap(pattern => [...source.matchAll(pattern)].map(match => match[0].trim()));
for (const sample of ['window.shared = 1', 'globalThis["shared"] = 1', 'self.count += 1', 'host.OpenSesameXterm ??= {}', 'window.__TAURI__.core.x = 1',
  'window.count++', '++globalThis.count', 'delete window.shared', 'Object.assign(window, {a: 1})', 'Object.defineProperty(globalThis, "a", {})', 'Reflect.set(self, "a", 1)',
  'context.host.shared = 1', 'Object.defineProperty(context.host, "k", {value: 1})', 'top.shared = 1', 'frames.shared = 1', 'Reflect.setPrototypeOf(window, null)']) {
  assert.notDeepEqual(writesGlobal(sample), [], `the global-write scan must catch: ${sample}`);
}
for (const sample of ['const tauri = host.__TAURI__;', 'if (window.a === b) go();', 'let window = ""; window = window + "x";', 'request.host = value;',
  'host.setTimeout(() => {}, 1)', 'const f = x => window.a;', 'globalThis.crypto.randomUUID()', 'element.style.top = "1px";',
  'const {top} = rect;', 'Object.assign(options, {host})']) {
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
console.log(`Globals: no module in ui/ (${modules.length} files) writes to window, globalThis, self, top, frames or host.`);

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
  imported.resolve({mount:async()=>({command:a=>commands.push('a:'+a)})});
  assert.equal(await opening,undefined,'An overtaken show resolves with nothing');
  assert.deepEqual(commands,['b:open']);assert.equal(surfaces.find(s=>s.id==='a').hidden,true);
  await manager.dispose();
}
// show() resolves with the command's own result, so a caller can tell a command that ran from one
// that another show overtook (issue #77: a palette capture is cleared only once it is saved).
{
  const {manager}=rig({loaders:{a:async()=>({mount:async()=>({command:async action=>({ran:action})})})}});
  assert.deepEqual(await manager.show('a','capture'),{ran:'capture'});
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
