// The Tauri bridge transport (issue #70). Loads ui/bridge.js against a fake window and verifies
// the request, reply, event and rejection paths, then reads the shell page and the Tauri
// configuration as text for the rules that keep third-party script out of the main document.
// It runs no Rust and opens no window: `cargo test` and a launched app are separate evidence.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFileSync(path.join(root, file), 'utf8');
const { createBridge, COMMAND, MESSAGE_EVENT, UNAVAILABLE, NO_RESPONSE } = await import(pathToFileURL(path.join(root, 'ui/bridge.js')));

assert.equal(COMMAND, 'bridge_request');
assert.equal(MESSAGE_EVENT, 'open-sesame-message');

// A fake window: manual timers, a recorded invoke whose calls the test settles, and a recorded listen.
function fakeHost({ native = true, tauri = true } = {}) {
  const timers = new Map(), invokes = [], listens = [], order = [];
  let nextTimer = 0;
  const host = {
    crypto: { randomUUID: () => 'page' },
    setTimeout: (run, delay) => { timers.set(++nextTimer, { run, delay }); return nextTimer; },
    clearTimeout: id => { timers.delete(id); },
  };
  if (native) host.__OPEN_SESAME_NATIVE__ = true;
  if (tauri) host.__TAURI__ = {
    core: { invoke: (command, args) => new Promise((resolve, reject) => { order.push('invoke'); invokes.push({ command, args, resolve, reject }); }) },
    event: { listen: (name, handler) => { order.push('listen'); listens.push({ name, handler }); return Promise.resolve(() => {}); } },
  };
  return { host, timers, invokes, listens, order };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

// Starts a native bridge and answers its first system.info so `ready` is settled.
async function connected() {
  const fake = fakeHost();
  const bridge = createBridge(fake.host);
  await settle();
  const first = fake.invokes[0];
  first.resolve({ requestId: first.args.message.requestId, result: { platform: 'linux', authenticated: false } });
  await bridge.ready;
  return { ...fake, bridge };
}

// 1. Without the host there is no transport: nothing is invoked and requests fail with a sentence.
for (const options of [{ tauri: false }, { native: false }, { native: false, tauri: false }]) {
  const { host, invokes, listens } = fakeHost(options);
  const bridge = createBridge(host);
  assert.deepEqual(await bridge.ready, { available: false });
  assert.equal(bridge.available, false);
  await assert.rejects(bridge.request('system.info'), { message: UNAVAILABLE });
  assert.equal(invokes.length + listens.length, 0, 'A page outside the app never calls the host');
}

// 2. On start the bridge listens for host messages first, then asks system.info through the one command.
{
  const { host, invokes, listens, order } = fakeHost();
  const bridge = createBridge(host);
  await settle();
  assert.deepEqual(order, ['listen', 'invoke'], 'The listener is registered before the first request');
  assert.deepEqual(listens.map(entry => entry.name), ['open-sesame-message']);
  assert.equal(invokes.length, 1);
  assert.equal(invokes[0].command, 'bridge_request');
  const { message } = invokes[0].args;
  assert.deepEqual(Object.keys(invokes[0].args), ['message']);
  assert.deepEqual(Object.keys(message).sort(), ['method', 'params', 'requestId']);
  assert.equal(message.method, 'system.info');
  assert.deepEqual(message.params, {});
  assert.equal(typeof message.requestId, 'string');
  assert.equal(bridge.available, false, 'Not available until the host answers');
  invokes[0].resolve({ requestId: message.requestId, result: { platform: 'linux', authenticated: false } });
  assert.deepEqual(await bridge.ready, { available: true, platform: 'linux', authenticated: false });
  assert.equal(bridge.available, true);
}

// 3. A failed first request leaves the bridge unavailable and reports why, without rejecting `ready`.
{
  const { host, invokes } = fakeHost();
  const bridge = createBridge(host);
  await settle();
  invokes[0].reject('boom');
  assert.deepEqual(await bridge.ready, { available: false, error: 'boom' });
  assert.equal(bridge.available, false);
}

// 4. Request and reply: the envelope carries the parameters, ids are unique, and a result resolves.
{
  const { bridge, invokes, timers } = await connected();
  const one = bridge.request('window.size', { width: 900, height: 600 });
  const two = bridge.request('window.focus');
  await settle();
  const [, first, second] = invokes;
  assert.deepEqual(first.args.message.params, { width: 900, height: 600 });
  assert.deepEqual(second.args.message.params, {});
  assert.notEqual(first.args.message.requestId, second.args.message.requestId);
  second.resolve({ requestId: second.args.message.requestId, result: true });
  first.resolve({ requestId: first.args.message.requestId, result: { ok: 1 } });
  assert.equal(await two, true);
  assert.deepEqual(await one, { ok: 1 });
  assert.equal(timers.size, 0, 'Every settled request clears its timer');
}

// 5. Rejection paths: an error reply, a rejected invoke, a dropped request and a mismatched reply.
{
  const { bridge, invokes, timers } = await connected();
  const refused = bridge.request('speech.start');
  const thrown = bridge.request('window.size');
  const failed = bridge.request('window.size');
  const dropped = bridge.request('window.size');
  const mismatched = bridge.request('window.size');
  const empty = bridge.request('window.size');
  await settle();
  const id = index => invokes[index].args.message.requestId;
  invokes[1].resolve({ requestId: id(1), error: 'This feature is not available in this version of Open Sesame.' });
  invokes[2].reject('boom');
  invokes[3].reject(new Error('host failed'));
  invokes[4].reject(null);
  invokes[5].resolve({ requestId: 'someone-else', result: true });
  invokes[6].resolve(undefined);
  await assert.rejects(refused, { name: 'Error', message: 'This feature is not available in this version of Open Sesame.' });
  await assert.rejects(thrown, { name: 'Error', message: 'boom' });
  await assert.rejects(failed, { name: 'Error', message: 'host failed' });
  await assert.rejects(dropped, { name: 'Error', message: NO_RESPONSE });
  await assert.rejects(mismatched, { name: 'Error', message: NO_RESPONSE });
  await assert.rejects(empty, { name: 'Error', message: NO_RESPONSE });
  assert.equal(timers.size, 0);
}

// 6. A request the host never answers fails after its limit, and a late answer changes nothing.
{
  const { bridge, invokes, timers } = await connected();
  let outcome = 'pending';
  const slow = bridge.request('window.size').then(() => { outcome = 'resolved'; }, error => { outcome = error.message; });
  const picker = bridge.request('project.chooseFolder').catch(() => {});
  await settle();
  const [[, quick], [, long]] = [...timers];
  assert.equal(quick.delay, 15000);
  assert.equal(long.delay, 180000, 'A native dialog waits for the person, not for 15 seconds');
  quick.run();
  await slow;
  assert.equal(outcome, NO_RESPONSE);
  invokes[1].resolve({ requestId: invokes[1].args.message.requestId, result: true });
  await settle();
  assert.equal(outcome, NO_RESPONSE, 'A late reply does not settle the request twice');
  long.run();
  await picker;
}

// 7. Events: host messages with an `event` key reach every subscriber, in order, until it unsubscribes.
{
  const { bridge, listens } = await connected();
  const seen = [], other = [];
  const unsubscribe = bridge.subscribe(message => seen.push(message));
  bridge.subscribe(() => { throw new Error('a broken subscriber'); });
  bridge.subscribe(message => other.push(message.event));
  const emit = listens[0].handler;
  const data = { event: 'terminal.data', id: 'p', data: '' };
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    emit({ payload: data });
    emit({ payload: { requestId: 'r', result: true } });
    emit({ payload: null });
    emit({ payload: 'terminal.data' });
    emit({});
    emit({ payload: { event: 'terminal.exit', id: 'p' } });
    unsubscribe();
    emit({ payload: { event: 'terminal.data', id: 'q', data: '' } });
  } finally { console.error = original; }
  assert.deepEqual(seen, [data, { event: 'terminal.exit', id: 'p' }]);
  assert.deepEqual(other, ['terminal.data', 'terminal.exit', 'terminal.data'], 'A throwing subscriber does not stop the others');
  assert.equal(errors.length, 3, 'A subscriber failure is reported, not swallowed');
  assert.throws(() => bridge.subscribe('nope'), TypeError);
}

// 8. The bridge is one frozen object and adds no global.
{
  const { host } = fakeHost();
  const before = Object.keys(host).sort();
  const bridge = createBridge(host);
  assert(Object.isFrozen(bridge));
  assert.deepEqual(Object.keys(host).sort(), before, 'The bridge defines nothing on window');
}

// 9. Source rules. The window label is not an isolation boundary: any script in the main document
// has the whole bridge, so the shell may load only its own files.
const uiFiles = [];
(function walk(directory) {
  for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) walk(relative); else uiFiles.push(relative);
  }
})('ui');
assert(uiFiles.includes('ui/index.html') && uiFiles.includes('ui/bridge.js'));
for (const file of uiFiles.filter(name => /\.(?:js|html|css)$/.test(name))) {
  const text = read(file);
  assert(!/messageHandlers|@tauri-apps|\beval\(|new Function\(/.test(text), `${file} uses only the global Tauri object and no dynamic code`);
  assert(!/(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(text.replace(/<!--[\s\S]*?-->|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')), `${file} names no remote address`);
  if (file.endsWith('.js')) {
    for (const match of text.matchAll(/\bimport\s*(?:[^'"()]*?\bfrom\s*)?\(?\s*(['"])([^'"]+)\1/g)) assert(/^\.\.?\//.test(match[2]), `${file} imports only relative modules, not ${match[2]}`);
  }
}
const page = read('ui/index.html');
const scripts = [...page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
assert(scripts.length > 0);
for (const [, attributes, body] of scripts) {
  assert(/\btype="module"/.test(attributes) && /\bsrc="\.\/[^"]+"/.test(attributes), 'Every script is a relative ES module');
  assert.equal(body.trim(), '', 'The page has no inline script');
}
assert(!/\son[a-z]+\s*=|<iframe|<object|<embed|javascript:/i.test(page), 'The page has no inline handler or embedded document');
for (const [, href] of page.matchAll(/<link\b[^>]*\bhref="([^"]+)"/gi)) assert(/^\.\//.test(href), 'Every stylesheet is a bundled file');

// 10. Tauri configuration: the global object without an npm dependency, the new shell as the
// front end, the window created in Rust, a policy that admits only bundled script, and the
// command granted to the main window alone.
const config = JSON.parse(read('src-tauri/tauri.conf.json'));
assert.equal(config.build.frontendDist, '../ui');
assert.equal(config.build.devUrl, undefined, 'No dev server: the app always serves the bundled files');
assert.equal(config.app.withGlobalTauri, true);
assert.deepEqual(config.app.windows, [], 'The main window is created in Rust so the flags precede every page script');
const csp = config.app.security.csp;
const directive = name => (typeof csp === 'string' ? Object.fromEntries(csp.split(';').map(part => part.trim().split(/\s+/)).filter(part => part[0]).map(([key, ...values]) => [key, values])) : csp)[name];
assert.deepEqual([].concat(directive('default-src')), ["'self'"]);
assert.deepEqual([].concat(directive('script-src')), ["'self'"], 'Only bundled script runs in the main document');
assert(!JSON.stringify(csp).includes('unsafe'), 'The policy allows no inline or evaluated code');
assert.notEqual(config.app.security.dangerousDisableAssetCspModification, true);
const capabilities = readdirSync(path.join(root, 'src-tauri/capabilities')).filter(name => name.endsWith('.json')).map(name => JSON.parse(read(`src-tauri/capabilities/${name}`)));
assert.equal(capabilities.length, 1);
assert.deepEqual(capabilities[0].windows, ['main']);
assert.equal(capabilities[0].webviews, undefined);
assert.equal(capabilities[0].remote, undefined, 'No remote page is granted the bridge');
assert(capabilities[0].permissions.includes('allow-bridge-request'));
assert(/MAIN_WINDOW: &str = "main"/.test(read('crates/core/src/gate.rs')), 'The gate serves the same label the capability names');
assert(/AppManifest::new\(\)\.commands\(&\["bridge_request"\]\)/.test(read('src-tauri/build.rs')), 'bridge_request is a declared command, so only a granted window can call it');

// 11. No npm runtime dependency.
const manifest = JSON.parse(read('package.json'));
assert.equal(manifest.dependencies, undefined);

console.log('Tauri bridge transport: request, reply, event and rejection paths and the shell loading rules passed.');
