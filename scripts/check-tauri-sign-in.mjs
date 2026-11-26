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
// Takes comments out of Rust text (a nested block comment is misread, and so is `//` in a string).
const strip = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
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

// Quit waits for the sign-in controller, so a refresh that was already sent saves its replacement
// credential before the process ends (issue #94). This reads text, with comments taken out first
// (a nested block comment is misread): there is one arm for the exit event, with no attribute
// and no condition on it; its first statement is the call, made there and with no attribute;
// and the host's shutdown starts with the controller's. It cannot show that the arm runs: a way
// out that never reaches the exit event (a direct process exit), a return before the match, or
// a host whose sign-in state was never registered passes it.
{
  const host = read('src-tauri/src/auth.rs');
  const entry = strip(read('src-tauri/src/lib.rs'));
  assert.equal((entry.match(/RunEvent::Exit\b/g) || []).length, 1, 'The exit event has one arm');
  const exit = /[{,}]\s*RunEvent::Exit => \{([\s\S]*?)\n        \}/.exec(entry);
  assert.ok(exit, 'The application has an exit handler, with no attribute and no condition on its arm');
  assert.match(exit[1], /^\s*if let Some\(auth\) = app\.try_state::<Arc<auth::Auth>>\(\) \{\s*auth\.shutdown\(\);\s*\}/, 'The exit handler shuts the sign-in controller down itself, before anything else');
  assert.match(strip(host.slice(0, host.indexOf('#[cfg(test)]'))), /pub fn shutdown\(&self\) \{\s*self\.controller\.shutdown\(\);/, 'The host\'s shutdown starts with the controller\'s');
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
  //
  // What is held is the text of `setup` itself: with the comments taken out it begins with
  // exactly the question and the return, so nothing in `setup`, named below or not, can come
  // before them, and neither a comment that names them nor an attribute on the `if` passes for
  // them. It does not hold what a plugin's own setup does before `setup` runs, nor what a
  // function called later does.
  const lines = text => text.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('//'));
  const setup = lines(entry.slice(entry.indexOf('.setup(|app| {') + '.setup(|app| {'.length));
  const first = [
    'let arguments: Vec<String> = std::env::args_os()',
    '.map(|argument| argument.to_string_lossy().into_owned())',
    '.collect();',
    'if link::only_a_link(&arguments) {',
    'link::exit_without_window(app.handle());',
    'return Ok(());',
    '}',
  ];
  assert.deepEqual(setup.slice(0, first.length), first, 'setup begins with the link-only question and its return, and nothing else');
  const rest = setup.slice(first.length).join('\n');
  for (const later of ['Core::new(', 'data::start_storage(', 'Storage::open_in(', 'startup::Startup::start(', 'app.manage(', 'auth::start(', 'link::register(', 'window::create_main(', 'tray::create(', 'summon::start(']) {
    assert.ok(rest.includes(later), `setup still calls ${later}, after the link-only launch has returned`);
  }
  // One question and one way out: no second exit for a link further down, and no other place
  // in the entry file that ends the application.
  const entryCode = lines(entry.split('#[cfg(test)]')[0]).join('\n');
  for (const [once, why] of [['link::only_a_link(', 'The link-only question is asked once'], ['link::exit_without_window(', 'A link-only launch has one way out'], ['link::handed_over(', 'A second launch is asked about a link once']]) {
    assert.equal(entryCode.split(once).length - 1, 1, why);
  }
  assert.ok(!/\.exit\(|process::exit|std::process::abort/.test(entryCode), 'The entry file ends the application nowhere itself');
  // Only sign-in's two links end a launch or are taken from a second one. Any other address
  // on the scheme, the login page's "Open Open Sesame" among them, is an ordinary launch.
  const taken = read('src-tauri/src/link.rs').split('#[cfg(test)]')[0];
  assert.match(taken, /fn for_sign_in<S: AsRef<str>>\(arguments: &\[S\]\) -> Option<Url> \{\n\s+argument\(arguments\)\.filter\(\|url\| classify\(url\.as_str\(\)\) != Link::Other\)\n\}/);
  assert.match(taken, /pub fn only_a_link<S: AsRef<str>>\(arguments: &\[S\]\) -> bool \{\n\s+for_sign_in\(arguments\)\.is_some\(\)\n\}/);
  assert.match(taken, /pub fn handed_over<R: Runtime>\(app: &AppHandle<R>, arguments: &\[String\]\) -> bool \{\n\s+match for_sign_in\(arguments\) \{/);
  assert.match(read('src-tauri/src/link.rs'), /pub fn exit_without_window<R: Runtime>\(app: &AppHandle<R>\) \{\n(?:\s+(?:\/\/|#\[cfg|eprintln)[^\n]*\n)*\s+app\.exit\(0\);\n\}/);
  // A link the running application is handed brings the window forward only when it is one
  // of sign-in's, which is how the login page's address is ignored on macOS.
  assert.match(taken, /if brings_the_window\(kind\) \{\n\s+window::show\(app\);\n\s+\}/);
  assert.match(taken, /fn brings_the_window\(kind: Link\) -> bool \{\n\s+kind != Link::Other\n\}/);
  assert.equal(taken.split('window::show(').length - 1, 1, 'The window is shown for a link in one place');

  // One scheme, the one the WorkOS application already redirects to.
  assert.deepEqual(config.plugins['deep-link'], { desktop: { schemes: ['opensesame'] } });
  assert.match(read('crates/core/src/auth/mod.rs'), /pub const REDIRECT: &str = "opensesame:\/\/auth\/callback";/);
  // The Mac preview (#161, docs/mac-preview.md) is installed beside the Swift app, which owns
  // `com.perch.widgetstudio`, `Open Sesame.app` and the `opensesame` scheme. Its overlay gives it
  // its own identifier and name and registers no scheme, so the system never hands the Swift
  // app's sign-in callback to the preview; sign-in in the preview waits for #87 and #132.
  const preview = JSON.parse(read('src-tauri/preview.conf.json'));
  assert.equal(preview.identifier, 'org.opencoven.open-sesame.preview', 'The owner chose this identifier for the preview on 20 November 2026');
  assert.notEqual(preview.identifier, config.identifier);
  assert.notEqual(preview.identifier, 'com.perch.widgetstudio');
  assert.equal(preview.productName, 'Open Sesame Preview');
  assert.notEqual(preview.productName, 'Open Sesame', 'The preview cannot replace Open Sesame.app in /Applications');
  assert.deepEqual(preview.plugins['deep-link'], { desktop: { schemes: [] } }, 'The preview registers no URL scheme');
  assert.deepEqual(preview.bundle, { targets: ['app'] }, 'The preview is an unsigned application bundle and nothing else');
  assert.deepEqual(Object.keys(preview).sort(), ['bundle', 'identifier', 'plugins', 'productName']);
  assert.equal(JSON.parse(read('package.json')).scripts['build:preview'], 'cd src-tauri && cargo tauri build --config preview.conf.json --bundles app');

  // The page is granted neither plugin: it cannot register a scheme or open an address. The
  // opener plugin is registered for the file manager of issue #74, with no permission for the
  // page; sign-in calls the crate's function directly and nothing else in auth.rs opens anything.
  assert.deepEqual(capability.permissions, ['core:event:allow-listen', 'core:event:allow-unlisten', 'allow-bridge-request']);
  assert.deepEqual(capability.windows, ['main']);
  assert.ok(!capability.permissions.some(permission => /opener|deep-link|dialog|clipboard/.test(permission)));
  assert.equal(code.split('tauri_plugin_opener::').length - 1, 1, 'auth.rs opens an address in one place');

  // Every address handed to the browser has passed the origin check first.
  const production = code.split('#[cfg(test)]')[0];
  assert.equal(production.split('(self.browser)(').length - 1, 1, 'The browser is opened for sign-in in one place');
  assert.equal(production.split(' browser(&url)').length - 1, 1, 'and for ending the remote session in one more');
  assert.match(code, /if !\(may_open\(&url\) && \(self\.browser\)\(&url\)\)/);
  assert.match(code, /fn end_remote_session\(browser: &Browser, url: Option<String>\) \{\n\s+if let Some\(url\) = url\.filter\(\|url\| may_open\(url\)\) \{\n\s+let _ = browser\(&url\);/);
  assert.match(code, /pub fn may_open\(url: &str\) -> bool \{\n    url\.strip_prefix\(API\)\n        \.is_some_and\(\|rest\| rest\.starts_with\('\/'\)\)\n\}/);

  // The store is checked before the browser opens, so nobody signs in to a session that cannot
  // be kept, and the Linux sentence names what to install.
  assert.ok(code.indexOf('self.look_at_store()?') < code.indexOf('self.controller.begin_sign_in()'));
  // A request from the page is not held by the credential store (issue #130): a locked keyring
  // answers only when its unlock prompt is answered. This reads auth.rs as text, so what it
  // holds is that certain spellings occur and certain others do not; the same thing spelled
  // another way (through a local name, say) is not seen here, and the Rust tests are what
  // hold the behaviour. What is read:
  // - outside the tests the file has no `(self.store_check)()`, `self.controller.cancel()`,
  //   `self.controller.sign_out()` or `.sign_out()?`: the store question and the controller's
  //   waiting forms, as they would be written on the calling thread;
  // - Sign in asks the controller whether the store is held up before it looks, and looks in
  //   one place; the controller's answer asks about a call waited for first and a call given
  //   up second, the order in which a call that has been said to be waited for is seen by
  //   one of them until it returns;
  // - the look refuses while a look is out and younger than the limit, asks the store on a
  //   thread of its own, waits for it `self.soon` and answers a wait with the keychain
  //   sentence; a look given up neither ends the look after it nor has its answer kept; an
  //   answer is kept thirty seconds;
  // - Cancel answers through `cancel_now`, and a browser that will not open through
  //   `cancel_unasked`, which tries `cancel_now` first and otherwise leaves the cancel to a
  //   thread;
  // - Sign out's thread sends the address with its first word, and the request waits for that
  //   word without a time of its own, opens the address when the word says it began, and
  //   refuses when it says so;
  // - Sign in waits `STORE_SOON` three times at most (the look, the state, and the host's own
  //   cancel when the browser will not open), and that is below the page's default limit in
  //   ui/bridge.js, the shortest it gives any request (Sign in has a longer one of its own);
  // - the host takes its two times from the controller, whose own are `STORE_SOON` and
  //   `STORE_LIMIT` unless `store_limits` sets others, and the host calls that in one place,
  //   for the limits a test hands to `with_limits`; `new` hands it none, and outside the
  //   tests nothing else calls `with_limits`. So the number compared is the one the
  //   application's look waits.
  // The pieces read for shape (the handler, the look, the host's cancel, Sign out, the two
  // constructors and the controller) have their comments taken out first, so a rule left
  // behind as a comment is not read as kept. The spellings that must not occur, the thirty
  // seconds and the sentences are read with comments in, which refuses more and not less.
  // Not read: what the controller does behind `begin_sign_in`, `cancel_now` and `sign_out_now`,
  // which the core's tests hold; the fallback in `sign_out` for when no thread can be started,
  // which waits as long as the store does; that the thread `cancel_unasked` starts cancels the
  // attempt it was started for and not a later one; and the limits beyond that comparison.
  for (const waits of ['(self.store_check)()', 'self.controller.cancel()', 'self.controller.sign_out()', '.sign_out()?']) assert.ok(!production.includes(waits), `auth.rs does not call ${waits} outside its tests`);
  const handler = strip(code.slice(code.indexOf('pub fn handle('), code.indexOf('fn look_at_store(')));
  assert.match(handler, /if self\.controller\.store_busy\(\) \{\n\s+return Err\(BridgeError::from\(KEYCHAIN_WAITING\)\);\n\s+\}\n\s+if let Some\(problem\) = self\.look_at_store\(\)\? \{/);
  assert.match(handler, /AuthError::StoreBusy => KEYCHAIN_WAITING,/);
  assert.match(handler, /"auth\.cancel" => match self\.controller\.cancel_now\(\) \{\n\s+Ok\(\(\)\) => Ok\(Value::Bool\(true\)\),\n\s+Err\(_\) => Err\(BridgeError::from\(KEYCHAIN_WAITING\)\),/);
  assert.match(handler, /"auth\.signOut" => self\.sign_out\(\),/);
  assert.match(handler, /if !\(may_open\(&url\) && \(self\.browser\)\(&url\)\) \{\n\s+self\.cancel_unasked\(\);/);
  const look = strip(code.slice(code.indexOf('fn look_at_store('), code.indexOf('fn cancel_unasked(')));
  assert.match(look, /if look\.began\.is_some_and\(\|began\| began\.elapsed\(\) < self\.limit\) \{\n\s+return Err\(BridgeError::from\(KEYCHAIN_WAITING\)\);/);
  assert.match(look, /\.spawn\(move \|\| \{\n\s+let answer = catch_unwind\(AssertUnwindSafe\(\|\| check\(\)\)\);/);
  assert.match(look, /match told\.recv_timeout\(self\.soon\) \{/);
  assert.match(look, /Err\(RecvTimeoutError::Timeout\) => Err\(BridgeError::from\(KEYCHAIN_WAITING\)\),/);
  assert.match(look, /if look\.turn != turn \{\n\s+return;\n\s+\}\n\s+look\.began = None;\n\s+if let Ok\(answer\) = answer \{\n\s+look\.kept = Some\(\(Instant::now\(\), answer\)\);/);
  assert.match(look, /if came\.elapsed\(\) < LOOK_KEPT \{\n\s+return Ok\(answer\);/);
  assert.match(code, /^const LOOK_KEPT: Duration = Duration::from_secs\(30\);$/m);
  const unasked = strip(code.slice(code.indexOf('fn cancel_unasked('), code.indexOf('fn sign_out(&self)')));
  assert.match(unasked, /if self\.controller\.cancel_now\(\)\.is_err\(\) \{\n\s+let controller = Arc::clone\(&self\.controller\);\n\s+let _ = std::thread::Builder::new\(\)\n\s+\.name\("auth-cancel"\.into\(\)\)\n\s+\.spawn\(move \|\| controller\.cancel\(\)\);/);
  const signOut = strip(code.slice(code.indexOf('fn sign_out(&self)'), code.indexOf('/// An address the system handed over.')));
  assert.match(signOut, /match told\.recv\(\) \{\n\s+Ok\(SignOut::Began\(url\)\) => \{\n\s+end_remote_session\(&self\.browser, url\);\n\s+Ok\(Value::Bool\(true\)\)/);
  assert.match(signOut, /Ok\(SignOut::Refused\) => Err\(BridgeError::from\(KEYCHAIN_WAITING\)\),/);
  assert.ok(!signOut.includes('recv_timeout'), 'Sign out gives its first word no time of its own');
  assert.match(signOut, /let ended = controller\.sign_out_now\(move \|url\| \{\n\s+let _ = began\.send\(SignOut::Began\(url\)\);\n\s+\}\);/);
  const core = strip(read('crates/core/src/auth/controller.rs'));
  assert.equal(handler.split('self.look_at_store()').length - 1, 1, 'Sign in looks at the store in one place');
  assert.match(core, /pub fn store_busy\(&self\) -> bool \{\n\s+self\.store_waited_for\(\) \|\| self\.store_given_up\(\)\n\s+\}/);
  const made = strip(code.slice(code.indexOf('pub fn new(\n        api: Arc<dyn WorkosApi>,'), code.indexOf('pub fn authenticated(')));
  assert.ok(made.startsWith('pub fn new('), 'The host is made by `new`');
  assert.match(made, /\) -> \(Arc<Auth>, Wakes\) \{\n\s+Auth::with_limits\(api, store, marker, browser, store_check, None\)\n\s+\}/);
  assert.equal(strip(production).split('with_limits(').length - 1, 2, 'The limits are handed over in one place, by `new`');
  assert.match(made, /Some\(\(soon, limit\)\) => controller\.store_limits\(soon, limit\),\n\s+None => controller,/);
  assert.equal(strip(production).split('store_limits(').length - 1, 1, 'and set in one place');
  const soon = Number(core.match(/^const STORE_SOON: Duration = Duration::from_secs\((\d+)\);/m)?.[1]);
  assert.match(core, /store_soon: STORE_SOON,\n\s+store_limit: STORE_LIMIT,/);
  assert.match(core, /pub fn store_soon\(&self\) -> Duration \{\n\s+self\.store_soon\n\s+\}/);
  assert.match(core, /pub fn store_limit\(&self\) -> Duration \{\n\s+self\.store_limit\n\s+\}/);
  assert.match(strip(code.slice(code.indexOf('fn with_limits('), code.indexOf('pub fn authenticated('))), /let auth = Arc::new\(Auth \{\n\s+soon: controller\.store_soon\(\),\n\s+limit: controller\.store_limit\(\),/);
  const pageLimit = Number(read('ui/bridge.js').match(/^const DEFAULT_LIMIT = (\d+);/m)?.[1]);
  assert.ok(soon > 0 && pageLimit > 0, 'STORE_SOON and the page default limit are read');
  assert.ok(3 * soon * 1000 < pageLimit, `Sign in waits ${3 * soon} s at most, below the shortest limit the page gives, ${pageLimit} ms`);
  assert.match(code, /pub const KEYCHAIN_WAITING: &str = "[^"]*waiting for your system keychain[^"]*try again\."/);
  assert.match(code, /pub const NO_SECRET_SERVICE: &str = "[^"]*Secret Service[^"]*GNOME Keyring[^"]*works without signing in\."/);
  // On Linux the store is looked for again on every attempt (issue #116), so a keyring installed
  // or started later needs another press of Sign in, not a restart, and the sentence says so.
  assert.match(code, /pub const NO_SECRET_SERVICE: &str = "[^"]*then try again\.[^"]*"/);
  assert.doesNotMatch(code, /pub const NO_SECRET_SERVICE: &str = "[^"]*start it again[^"]*"/);
  // The Linux store is this file's own, opened again after a failure; the `keyring` crate's
  // store, which is opened once for the whole run, answers only on the other systems.
  assert.match(code, /#\[cfg\(target_os = "linux"\)\]\n    secrets: Reopening<Arc<zbus_secret_service_keyring_store::Store>>,/);
  assert.match(code, /Err\(keyring::Error::PlatformFailure\(_\)\) if !opened_now => \{/);
  assert.equal(code.split('keyring::Entry::store_status()').length - 1, 1, 'The once-per-run answer is used in one place');
  // At launch the store is asked on the restore thread, never in `start`, which runs on the main
  // thread before the window exists: a locked keyring answers only after its unlock prompt.
  const start = code.slice(code.indexOf('pub fn start<'));
  assert.equal(start.split('.available()').length - 1, 1, 'The store is asked in the restore closure only');
  assert.match(start, /let check = store_check\(&store\);/);
  // The look before Sign in is a closure that the host runs on a thread of its own; it asks for
  // the default collection only once the store has answered (issue #130 line 3).
  const check = strip(code.slice(code.indexOf('fn store_check('), code.indexOf('fn lock<T>(')));
  assert.match(check, /Arc::new\(move \|\| \{\n\s+let answered = probe\.available\(\);\n\s+store_problem\(\n\s+answered,\n\s+probe\.exists\(\),\n\s+!answered \|\| probe\.has_default_collection\(\),\n\s+\)\n\s+\}\)/);
  assert.match(code, /if answered \{\n\s+\(cfg!\(target_os = "linux"\) && !has_default\)\.then_some\(NO_DEFAULT_COLLECTION\)/);
  assert.match(code, /pub const NO_DEFAULT_COLLECTION: &str = "[^"]*no default keyring[^"]*then try again\.[^"]*works without signing in\."/);
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
  assert.match(linkPrinted[1][2], /"open-sesame: a launch with only a sign-in link exits"/);
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
