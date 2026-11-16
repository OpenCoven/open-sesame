// The account control of the new shell and the sign-in wiring behind it (issue #72). Loads
// ui/account.js against stand-in elements and a stand-in bridge and verifies what a person is
// told in each state, that the control follows the host's status event without a reload, and
// that a failure is shown and leaves the control usable. It also reads the Rust sources and the
// Tauri configuration as text for the rules a reviewer is asked to look for. It runs no Rust,
// opens no browser, reads no credential and signs nobody in: those are separate evidence.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
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

  // Single-instance is registered before every other plugin, so a callback that starts a second
  // process on Windows or Linux reaches the running one and the second process exits without a
  // window. It is built without its deep-link feature: that feature hands the arguments to the
  // deep-link plugin, which announces the link as a `deep-link://new-url` event that every page
  // listener receives, code and state included (issue #116). The running application takes the
  // link out of the arguments itself, in link.rs, before summon sees them.
  const plugins = [...entry.matchAll(/\.plugin\(\s*([a-z_:]+)/g)].map(match => match[1]);
  assert.equal(plugins[0], 'tauri_plugin_single_instance::init', `single-instance is first: ${plugins}`);
  assert.match(manifest, /^tauri-plugin-single-instance = "2"$/m, 'single-instance is built without its deep-link feature');
  const lockPackage = name => read('Cargo.lock').split('\n[[package]]\n').find(block => block.startsWith(`name = "${name}"\n`));
  assert.ok(lockPackage('tauri-plugin-single-instance'), 'single-instance is in the lockfile');
  assert.ok(!lockPackage('tauri-plugin-single-instance').includes('"tauri-plugin-deep-link'), 'single-instance cannot reach the deep-link plugin');
  assert.match(entry, /tauri_plugin_single_instance::init\(\|app, arguments, _\| \{\n\s+if !link::handed_over\(app, &arguments\) \{\n\s+summon::launched_again\(app, &arguments\);/);
  // The deep-link plugin is registered only where it is used: to register the scheme in a
  // development build on Windows and Linux, where it announces a link only while it starts,
  // before any page exists. On macOS it would announce every link the system opens, so there
  // the application takes `RunEvent::Opened` itself.
  assert.match(entry, /#\[cfg\(all\(debug_assertions, any\(windows, target_os = "linux"\)\)\)\]\n    let builder = builder\.plugin\(tauri_plugin_deep_link::init\(\)\);/);
  assert.equal(entry.split('tauri_plugin_deep_link::init').length - 1, 1, 'The deep-link plugin is registered in one place');
  assert.match(entry, /#\[cfg\(target_os = "macos"\)\]\n\s+RunEvent::Opened \{ urls \} => link::opened\(app, urls\),/);
  // Nothing in the application listens for the plugin's event or asks it to announce a link.
  for (const file of readdirSync(path.join(root, 'src-tauri/src')).filter(name => name.endsWith('.rs'))) {
    // Code only: the comments may say why the event is not used.
    const text = read(`src-tauri/src/${file}`).split('#[cfg(test)]')[0].split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
    for (const forbidden of ['on_open_url', 'handle_cli_arguments', 'deep-link://']) assert.ok(!text.includes(forbidden), `src-tauri/src/${file} does not use ${forbidden}`);
  }
  // A launch that carries only one of sign-in's links has nothing to show: it exits before
  // the window exists, which is what holds on a Linux session with no session bus, where the
  // running application cannot be found (issue #116). It also exits before anything is opened
  // or started: such a launch manages no state, so the exit handler would shut nothing down,
  // and storage opened before the question would be left open.
  const setup = entry.slice(entry.indexOf('.setup(|app| {'));
  assert.ok(setup.includes('link::only_a_link('), 'setup asks whether the launch carries only a link');
  assert.match(setup, /if link::only_a_link\(&arguments\) \{\n\s+link::exit_without_window\(app\.handle\(\)\);\n\s+return Ok\(\(\)\);\n\s+\}/);
  const asked = setup.indexOf('return Ok(());', setup.indexOf('link::only_a_link('));
  for (const later of ['Core::new(', 'data::start_storage(', 'Storage::open_in(', 'startup::Startup::start(', 'app.manage(', 'auth::start(', 'link::register(', 'window::create_main(', 'tray::create(', 'summon::start(']) {
    assert.ok(setup.includes(later), `setup still calls ${later}`);
    assert.ok(asked < setup.indexOf(later), `the link-only launch has returned before ${later}`);
  }
  // Only sign-in's two links end a launch or are taken from a second one. Any other address
  // on the scheme, the login page's "Open in app" among them, is an ordinary launch.
  const taken = read('src-tauri/src/link.rs').split('#[cfg(test)]')[0];
  assert.match(taken, /fn for_sign_in<S: AsRef<str>>\(arguments: &\[S\]\) -> Option<Url> \{\n\s+argument\(arguments\)\.filter\(\|url\| classify\(url\.as_str\(\)\) != Link::Other\)\n\}/);
  assert.match(taken, /pub fn only_a_link<S: AsRef<str>>\(arguments: &\[S\]\) -> bool \{\n\s+for_sign_in\(arguments\)\.is_some\(\)\n\}/);
  assert.match(taken, /pub fn handed_over<R: Runtime>\(app: &AppHandle<R>, arguments: &\[String\]\) -> bool \{\n\s+match for_sign_in\(arguments\) \{/);
  assert.match(read('src-tauri/src/link.rs'), /pub fn exit_without_window<R: Runtime>\(app: &AppHandle<R>\) \{\n(?:\s+(?:\/\/|#\[cfg|eprintln)[^\n]*\n)*\s+app\.exit\(0\);\n\}/);

  // One scheme, the one the WorkOS application already redirects to.
  assert.deepEqual(config.plugins['deep-link'], { desktop: { schemes: ['opensesame'] } });
  assert.match(read('crates/core/src/auth/mod.rs'), /pub const REDIRECT: &str = "opensesame:\/\/auth\/callback";/);

  // The page is granted neither plugin: it cannot register a scheme or open an address. The
  // opener plugin is registered for the file manager of issue #74, with no permission for the
  // page; sign-in calls the crate's function directly and nothing else in auth.rs opens anything.
  assert.deepEqual(capability.permissions, ['core:event:allow-listen', 'core:event:allow-unlisten', 'allow-bridge-request']);
  assert.deepEqual(capability.windows, ['main']);
  assert.ok(!capability.permissions.some(permission => /opener|deep-link|dialog|clipboard/.test(permission)));
  assert.equal(code.split('tauri_plugin_opener::').length - 1, 1, 'auth.rs opens an address in one place');

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
  // The store is opened once per run, so a keyring installed later needs a restart, not a retry.
  assert.match(code, /pub const NO_SECRET_SERVICE: &str = "[^"]*start it again[^"]*"/);
  // At launch the store is asked on the restore thread, never in `start`, which runs on the main
  // thread before the window exists: a locked keyring answers only after its unlock prompt.
  const start = code.slice(code.indexOf('pub fn start<'));
  assert.equal(start.split('.available()').length - 1, 2, 'The store is asked in two closures only');
  assert.match(start, /Arc::new\(move \|\| store_problem\(probe\.available\(\), KeychainStore::exists\(\)\)\);/);
  assert.match(start, /auth\.restore\(move \|\| !cfg!\(target_os = "linux"\) \|\| saved\.available\(\)\);/);
  // A refresh that is due before the next attempt is allowed is waited for, not spun on.
  assert.match(code, /recv_timeout\(pause\(due, allowed_in\)\)/);

  // Nothing in the wiring prints or logs: a URL carries the state and a reply carries tokens.
  // The exceptions are in development builds only and print no address, name or credential:
  // the status in auth.rs, and in link.rs the kind of a link and that a link-only launch ended.
  const links = read('src-tauri/src/link.rs').split('#[cfg(test)]')[0];
  const prints = text => [...text.matchAll(/(#\[cfg\(debug_assertions\)\]\n\s+)?eprintln!\(([^;]*)\);/g)];
  const printed = prints(code), linkPrinted = prints(links);
  for (const [file, text] of [['auth.rs', code], ['link.rs', links]]) for (const printer of [' println!', 'dbg!', 'log::', 'tracing::']) assert.ok(!text.includes(printer), `${file} does not use ${printer}`);
  assert.equal(printed.length, 1);
  assert.equal(linkPrinted.length, 2);
  for (const [, guard, body] of [...printed, ...linkPrinted]) {
    assert.ok(guard, 'A print is compiled into development builds only');
    assert.ok(!/url|token|email|name\b|state\b|verifier|code\b/.test(body.replace('open-sesame: sign-in', '')), body);
  }
  assert.match(printed[0][2], /status\["authenticated"\], status\["busy"\], status\["message"\]/);
  assert.match(linkPrinted[0][2], /"open-sesame: link \{kind:\?\}"/);
  assert.match(linkPrinted[1][2], /"open-sesame: a launch with only a link exits"/);
  // No token, address, state or verifier is in what the page is sent.
  assert.match(code, /emit\(json!\(\{"event": CHANGED_EVENT, "status": status\}\)\);/);

  // The saved credential is not the installed Swift app's: a refresh token is replaced on each
  // use, so two applications sharing one entry would sign each other out.
  const swift = read('desktop/Authentication.swift').match(/keychainService = "([^"]+)"/)[1];
  const service = code.match(/format!\("\{identifier\}([^"]+)"\)/)[1];
  assert.notEqual(`${config.identifier}${service}`, swift);
  assert.equal(service, '.tauri.workos.production');

  // The scheme is registered at run time only in a development build on Windows and Linux.
  assert.match(links, /#\[cfg\(all\(debug_assertions, any\(windows, target_os = "linux"\)\)\)\]\npub fn register<R: Runtime>\(app: &AppHandle<R>\) \{\n    use tauri_plugin_deep_link::DeepLinkExt;\n    let _ = app\.deep_link\(\)\.register_all\(\);\n\}/);
  assert.match(entry, /#\[cfg\(all\(debug_assertions, any\(windows, target_os = "linux"\)\)\)\]\n\s+link::register\(app\.handle\(\)\);/);
  assert.equal(code.split('register_all').length + links.split('register_all').length - 2, 1);

  // Only a development build can be pointed at a stand-in, and only at this machine.
  assert.match(code, /fn workos_api\(\) -> HttpApi \{\n    #\[cfg\(debug_assertions\)\]\n    if let Ok\(value\) = std::env::var\("OPEN_SESAME_DEV_AUTH_API"\)/);
  assert.equal(code.split('OPEN_SESAME_DEV_AUTH_API').length - 1, 2, 'The variable is read in one place and named in its comment');
  assert.match(code, /#\[cfg\(any\(debug_assertions, test\)\)\]\npub fn dev_api_base/);

  // The HTTP client never follows a redirect and never waits longer than the core allows.
  assert.match(code, /\.max_redirects\(0\)/);
  assert.match(code, /const TIMEOUT: Duration = Duration::from_secs\(20\);/);
}

console.log('PASS Tauri sign-in checks (account control states, host events, refusals, and the wiring rules read from source).');
