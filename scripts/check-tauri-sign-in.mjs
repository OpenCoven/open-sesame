// The account control of the new shell and the sign-in wiring behind it (issue #72). Loads
// ui/account.js against stand-in elements and a stand-in bridge and verifies what a person is
// told in each state, that the control follows the host's status event without a reload, and
// that a failure is shown and leaves the control usable. It also reads the Rust sources and the
// Tauri configuration as text for the rules a reviewer is asked to look for. It runs no Rust,
// opens no browser, reads no credential and signs nobody in: those are separate evidence.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFileSync(path.join(root, file), 'utf8');
const { describe, mountAccount, CHANGED_EVENT, LOCAL } = await import(pathToFileURL(path.join(root, 'ui/account.js')));

const element = () => {
  const listeners = new Map();
  return {
    hidden: true, disabled: false, textContent: '', dataset: {},
    addEventListener: (name, run) => { listeners.set(name, [...(listeners.get(name) || []), run]); },
    fire: (name, event = {}) => { for (const run of listeners.get(name) || []) run(event); },
  };
};
const parts = () => ({ section: element(), title: element(), detail: element(), signIn: element(), cancel: element(), signOut: element() });
const settle = () => new Promise(resolve => setImmediate(resolve));
const SIGNED_OUT = { authenticated: false, busy: false, message: '', name: '', email: '' };

// A stand-in host: it keeps a status, records every request, answers from `answers` when a
// method has an entry there, and can send the page a host message.
function fakeBridge(status, answers = {}) {
  const calls = [];
  const subscribers = new Set();
  const state = { status: { ...SIGNED_OUT, ...status } };
  const request = async (method, params = {}) => {
    calls.push({ method, params });
    if (answers[method]) return answers[method](state);
    if (method === 'auth.status') return state.status;
    throw new Error(`Unexpected ${method}`);
  };
  const subscribe = run => { subscribers.add(run); return () => subscribers.delete(run); };
  const send = message => { for (const run of [...subscribers]) run(message); };
  return { request, subscribe, send, calls, state };
}

// 1. What a person is told in each state. Signed out is a normal state, not an error.
{
  assert.deepEqual(describe(SIGNED_OUT),
    { state: 'signed-out', title: 'Not signed in', detail: LOCAL, warn: false, signIn: true, cancel: false, signOut: false });
  assert.match(LOCAL, /works without an account/);
  assert.deepEqual(describe({ ...SIGNED_OUT, busy: true, message: 'Finish signing in in your browser.' }),
    { state: 'signing-in', title: 'Signing in', detail: 'Finish signing in in your browser.', warn: false, signIn: false, cancel: true, signOut: false });
  // Signed in, the title says it all; the host's "Signed in." or "Refreshing sign-in…" is not repeated.
  assert.deepEqual(describe({ authenticated: true, busy: true, message: 'Refreshing sign-in…', name: 'Ada', email: 'ada@example.com' }),
    { state: 'signed-in', title: 'Signed in as ada@example.com', detail: '', warn: false, signIn: false, cancel: false, signOut: true });
  assert.equal(describe({ authenticated: true, busy: false, message: '', name: 'Ada', email: '' }).title, 'Signed in as Ada');
  assert.equal(describe({ authenticated: true, busy: false, message: '', name: '', email: '' }).title, 'Signed in');
  // A message while signed out is the reason the last attempt ended, shown with the local note.
  const failed = describe({ ...SIGNED_OUT, message: 'Could not complete sign-in. Check your connection and try again.' });
  assert.equal(failed.state, 'signed-out');
  assert.equal(failed.signIn, true);
  assert.equal(failed.detail, `Could not complete sign-in. Check your connection and try again. ${LOCAL}`);
  // A reply that is not a status is treated as signed out, never as signed in.
  for (const odd of [null, undefined, 'yes', 7, { authenticated: 'true' }, { authenticated: 1 }]) assert.equal(describe(odd).state, 'signed-out');
}

// 2. The control appears with what the host reports, and stays hidden when the host has no sign-in.
{
  const bridge = fakeBridge({});
  const ui = parts();
  await mountAccount(bridge, ui);
  assert.equal(ui.section.hidden, false);
  assert.equal(ui.section.dataset.state, 'signed-out');
  assert.equal(ui.title.textContent, 'Not signed in');
  assert.equal(ui.signIn.hidden, false);
  assert.equal(ui.cancel.hidden, true);
  assert.equal(ui.signOut.hidden, true);
  assert.deepEqual(bridge.calls, [{ method: 'auth.status', params: {} }]);

  const none = parts();
  await mountAccount({ request: async () => { throw new Error('Unsupported desktop action.'); }, subscribe: () => () => {} }, none);
  assert.equal(none.section.hidden, true, 'No sign-in methods, no control');
}

// 3. Sign in asks the host once, and the control then follows the host's events: waiting in the
//    browser, then signed in, without the page asking again or reloading.
{
  const bridge = fakeBridge({}, {
    'auth.signIn': state => { state.status = { ...SIGNED_OUT, busy: true, message: 'Finish signing in in your browser.' }; return true; },
  });
  const ui = parts();
  await mountAccount(bridge, ui);
  ui.signIn.fire('click');
  ui.signIn.fire('click');
  await settle();
  assert.equal(bridge.calls.filter(call => call.method === 'auth.signIn').length, 1, 'A second press while the first is in flight sends nothing');
  assert.equal(ui.section.dataset.state, 'signing-in');
  assert.equal(ui.detail.textContent, 'Finish signing in in your browser.');
  assert.equal(ui.signIn.hidden, true);
  assert.equal(ui.cancel.hidden, false);

  const before = bridge.calls.length;
  bridge.send({ event: CHANGED_EVENT, status: { authenticated: true, busy: false, message: '', name: '', email: 'ada@example.com' } });
  assert.equal(ui.section.dataset.state, 'signed-in');
  assert.equal(ui.title.textContent, 'Signed in as ada@example.com');
  assert.equal(ui.signOut.hidden, false);
  assert.equal(ui.cancel.hidden, true);
  assert.equal(bridge.calls.length, before, 'An event is shown as it arrives');

  // Other host messages, and an event with no status, change nothing.
  bridge.send({ event: 'terminal.exit', status: SIGNED_OUT });
  bridge.send({ event: CHANGED_EVENT });
  bridge.send({ event: CHANGED_EVENT, status: 'signed out' });
  assert.equal(ui.section.dataset.state, 'signed-in');

  // The session lapsing, for example with the network away, is one more event.
  bridge.send({ event: CHANGED_EVENT, status: { ...SIGNED_OUT, message: 'Your session expired. Sign in again to use your account.' } });
  assert.equal(ui.section.dataset.state, 'signed-out');
  assert.equal(ui.signIn.hidden, false);
}

// 4. Cancel and sign out each ask the host once and show what it then reports.
{
  const bridge = fakeBridge({ busy: true, message: 'Finish signing in in your browser.' }, {
    'auth.cancel': state => { state.status = { ...SIGNED_OUT, message: 'Sign-in cancelled.' }; return true; },
    'auth.signOut': state => { state.status = { ...SIGNED_OUT, message: 'Signed out on this computer.' }; return true; },
  });
  const ui = parts();
  await mountAccount(bridge, ui);
  assert.equal(ui.section.dataset.state, 'signing-in');
  ui.cancel.fire('click');
  await settle();
  assert.deepEqual(bridge.calls.map(call => call.method), ['auth.status', 'auth.cancel', 'auth.status']);
  assert.equal(ui.section.dataset.state, 'signed-out');
  assert.ok(ui.detail.textContent.startsWith('Sign-in cancelled.'));

  bridge.state.status = { authenticated: true, busy: false, message: '', name: 'Ada', email: '' };
  bridge.send({ event: CHANGED_EVENT, status: bridge.state.status });
  ui.signOut.fire('click');
  await settle();
  assert.equal(bridge.calls.at(-2).method, 'auth.signOut');
  assert.equal(ui.section.dataset.state, 'signed-out');
  assert.ok(ui.detail.textContent.startsWith('Signed out on this computer.'));
}

// 5. A refusal is shown as the host's sentence, as a warning, and the control stays usable.
{
  const sentence = 'Open Sesame keeps your sign-in in the system keyring, and none is available.';
  const bridge = fakeBridge({}, { 'auth.signIn': () => { throw new Error(sentence); } });
  const ui = parts();
  await mountAccount(bridge, ui);
  ui.signIn.fire('click');
  await settle();
  assert.equal(ui.section.dataset.state, 'signed-out');
  assert.equal(ui.detail.textContent, sentence);
  assert.equal(ui.detail.dataset.warn, 'true');
  assert.equal(ui.signIn.hidden, false);
  assert.equal(ui.signIn.disabled, false, 'The button can be pressed again');
  ui.signIn.fire('click');
  await settle();
  assert.equal(bridge.calls.filter(call => call.method === 'auth.signIn').length, 2);
}

// 6. The page's methods and event are the host's, and the page is given no way round the host.
{
  const page = read('ui/account.js');
  const host = read('src-tauri/src/auth.rs');
  const gate = read('crates/core/src/gate.rs');
  for (const method of ['auth.status', 'auth.signIn', 'auth.cancel', 'auth.signOut']) {
    assert.ok(page.includes(`'${method}'`), `${method} is used by the page`);
    assert.ok(host.includes(`"${method}" =>`), `${method} is answered by the host`);
    assert.ok(gate.includes(`"${method}"`), `${method} is in the gate`);
  }
  assert.equal(host.match(/pub const CHANGED_EVENT: &str = "([^"]+)";/)[1], CHANGED_EVENT);
  // The page never handles an address, a code or a token: it has no navigation and no storage.
  for (const forbidden of ['location', 'window.open', 'fetch(', 'localStorage', 'sessionStorage', 'cookie', 'token', 'href']) assert.ok(!page.includes(forbidden), `ui/account.js does not use ${forbidden}`);
  // Sign-in is an account control in the workspace, not a page in front of it (issue #60).
  const markup = read('ui/index.html');
  assert.match(markup, /<section class="account" data-account hidden/);
  assert.ok(markup.indexOf('data-account') > markup.indexOf('data-status'), 'The account control is part of the shell, after its status line');
  assert.match(gate, /pub const ACCOUNT_BACKED: &\[&str\] = &\[\];/, 'No method in this version needs a session');
  // The core's sentences describe the session; none tells a person to sign in to carry on.
  const sentences = [...read('crates/core/src/auth/controller.rs').matchAll(/^const [A-Z_]+: &str =\s*"([^"]*)";/gm)].map(match => match[1]);
  assert.ok(sentences.length >= 12, `${sentences.length} sentences read`);
  for (const sentence of sentences) assert.ok(!/to continue|to use Open Sesame/.test(sentence), sentence);
}

// 7. Rules a reviewer is asked to look for, read from the sources and the configuration.
{
  const host = read('src-tauri/src/auth.rs');
  const code = host.slice(0, host.indexOf('#[cfg(test)]'));
  const entry = read('src-tauri/src/lib.rs');
  const manifest = read('src-tauri/Cargo.toml');
  const config = JSON.parse(read('src-tauri/tauri.conf.json'));
  const capability = JSON.parse(read('src-tauri/capabilities/default.json'));

  // Single-instance is registered before every other plugin and has its deep-link feature, so
  // a callback that starts a second process on Windows or Linux reaches the running one and the
  // second process exits without a window.
  const plugins = [...entry.matchAll(/\.plugin\(\s*([a-z_:]+)/g)].map(match => match[1]);
  assert.equal(plugins[0], 'tauri_plugin_single_instance::init', `single-instance is first: ${plugins}`);
  assert.ok(plugins.includes('tauri_plugin_deep_link::init'));
  assert.match(manifest, /tauri-plugin-single-instance = \{ version = "2", features = \["deep-link"\] \}/);
  assert.ok(entry.indexOf('tauri_plugin_single_instance::init') < entry.indexOf('tauri_plugin_deep_link::init'));

  // One scheme, the one the WorkOS application already redirects to.
  assert.deepEqual(config.plugins['deep-link'], { desktop: { schemes: ['opensesame'] } });
  assert.match(read('crates/core/src/auth/mod.rs'), /pub const REDIRECT: &str = "opensesame:\/\/auth\/callback";/);

  // The page is granted neither plugin: it cannot register a scheme, read a link or open an
  // address. The opener plugin is not even registered; the host calls its function directly.
  assert.deepEqual(capability.permissions, ['core:event:allow-listen', 'core:event:allow-unlisten', 'allow-bridge-request']);
  assert.deepEqual(capability.windows, ['main']);
  assert.ok(!entry.includes('tauri_plugin_opener::init') && !entry.includes('tauri_plugin_opener::Builder'));

  // Every address handed to the browser has passed the origin check first.
  const opens = code.split('(self.browser)(').length - 1;
  assert.equal(opens, 2, 'The browser is opened for sign-in and for ending the remote session');
  assert.match(code, /if !\(may_open\(&url\) && \(self\.browser\)\(&url\)\)/);
  assert.match(code, /if may_open\(&url\) \{\n\s+let _ = \(self\.browser\)\(&url\);/);
  assert.match(code, /pub fn may_open\(url: &str\) -> bool \{\n    url\.strip_prefix\(API\)\n        \.is_some_and\(\|rest\| rest\.starts_with\('\/'\)\)\n\}/);

  // The store is checked before the browser opens, so nobody signs in to a session that cannot
  // be kept, and the Linux sentence names what to install.
  assert.ok(code.indexOf('(self.store_check)()') < code.indexOf('self.controller.begin_sign_in()'));
  assert.match(code, /pub const NO_SECRET_SERVICE: &str = "[^"]*Secret Service[^"]*GNOME Keyring[^"]*works without signing in\."/);

  // Nothing in the wiring prints or logs: a URL carries the state and a reply carries tokens.
  for (const printer of ['println!', 'eprintln!', 'dbg!', 'log::', 'tracing::']) assert.ok(!code.includes(printer), `auth.rs does not use ${printer}`);
  // No token, address, state or verifier is in what the page is sent.
  assert.match(code, /emit\(json!\(\{"event": CHANGED_EVENT, "status": status\}\)\);/);

  // The saved credential is not the installed Swift app's: a refresh token is replaced on each
  // use, so two applications sharing one entry would sign each other out.
  const swift = read('desktop/Authentication.swift').match(/keychainService = "([^"]+)"/)[1];
  const service = code.match(/format!\("\{identifier\}([^"]+)"\)/)[1];
  assert.notEqual(`${config.identifier}${service}`, swift);
  assert.equal(service, '.tauri.workos.production');

  // The scheme is registered at run time only in a development build on Windows and Linux.
  assert.match(code, /#\[cfg\(all\(debug_assertions, any\(windows, target_os = "linux"\)\)\)\]\n    let _ = app\.deep_link\(\)\.register_all\(\);/);
  assert.equal(code.split('register_all').length - 1, 1);

  // Only a development build can be pointed at a stand-in, and only at this machine.
  assert.match(code, /fn workos_api\(\) -> HttpApi \{\n    #\[cfg\(debug_assertions\)\]\n    if let Ok\(value\) = std::env::var\("OPEN_SESAME_DEV_AUTH_API"\)/);
  assert.equal(code.split('OPEN_SESAME_DEV_AUTH_API').length - 1, 2, 'The variable is read in one place and named in its comment');
  assert.match(code, /#\[cfg\(any\(debug_assertions, test\)\)\]\npub fn dev_api_base/);

  // The HTTP client never follows a redirect and never waits longer than the core allows.
  assert.match(code, /\.max_redirects\(0\)/);
  assert.match(code, /const TIMEOUT: Duration = Duration::from_secs\(20\);/);
}

console.log('PASS Tauri sign-in checks (account control states, host events, refusals, and the wiring rules read from source).');
