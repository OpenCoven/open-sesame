// The shortcut settings section of the new shell (issue #71). Loads ui/summon.js against
// stand-in elements and a stand-in bridge and verifies what a person is told for each state the
// host can report, that a change takes effect from the host's answer without a reload, that a
// refusal is shown and leaves the saved shortcut in place, and that the page reports a drag.
// It also reads the Rust sources as text for the rules a reviewer is asked to look for. It runs
// no Rust, registers no shortcut and opens no window: those are separate evidence.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFileSync(path.join(root, file), 'utf8');
const { describe, mountSummon, holdDuringDrag, EXAMPLE } = await import(pathToFileURL(path.join(root, 'ui/summon.js')));

const element = () => {
  const listeners = new Map();
  return {
    hidden: true, textContent: '', value: '', checked: false, dataset: {},
    addEventListener: (name, run) => { listeners.set(name, [...(listeners.get(name) || []), run]); },
    fire: (name, event = {}) => { for (const run of listeners.get(name) || []) run(event); },
  };
};
const parts = () => ({ section: element(), hint: element(), form: element(), input: element(), message: element(), blur: element() });
const settle = () => new Promise(resolve => setImmediate(resolve));

// A stand-in host: it keeps a status, records every request, and answers from `answers` when a
// method has an entry there (a function of the params that returns a status or throws).
function fakeBridge(status, answers = {}) {
  const calls = [];
  const state = { status: { defaultShortcut: 'Control+Alt+Shift+Space', toggleCommand: 'open-sesame --toggle', message: '', hideOnBlur: false, ...status } };
  const request = async (method, params = {}) => {
    calls.push({ method, params });
    if (answers[method]) return (state.status = answers[method](params, state.status));
    if (method === 'summon.status') return state.status;
    throw new Error(`Unexpected ${method}`);
  };
  return { request, calls, state };
}

// 1. What a person is told for each state.
{
  const base = { toggleCommand: 'open-sesame --toggle', message: '' };
  assert.deepEqual(describe({ ...base, session: 'macos', shortcut: 'Control+Alt+Shift+Space', registered: true }),
    { editable: true, warn: false, hint: EXAMPLE, message: 'Press Control+Alt+Shift+Space anywhere to show or hide Open Sesame.' });
  assert.deepEqual(describe({ ...base, session: 'x11', shortcut: '', registered: false }),
    { editable: true, warn: false, hint: EXAMPLE, message: 'No shortcut is set.' });
  const refused = 'Open Sesame could not register Alt+Space. Another application may already use it. Choose a different shortcut.';
  assert.deepEqual(describe({ ...base, session: 'windows', shortcut: 'Alt+Space', registered: false, message: refused }),
    { editable: true, warn: true, hint: EXAMPLE, message: refused });
  // Wayland: no field to fill in, and the exact command to bind.
  const wayland = describe({ ...base, session: 'wayland', shortcut: 'Control+Alt+Shift+Space', registered: false, message: 'ignored here' });
  assert.equal(wayland.editable, false);
  assert.equal(wayland.warn, false);
  assert.ok(wayland.hint.endsWith('open-sesame --toggle'), wayland.hint);
  assert.equal(wayland.message, '');
}

// 2. The section appears with what the host reports, and stays hidden when the host has no summon.
{
  const bridge = fakeBridge({ session: 'x11', shortcut: 'Control+Alt+Shift+Space', registered: true, hideOnBlur: true });
  const ui = parts();
  await mountSummon(bridge, ui);
  assert.equal(ui.section.hidden, false);
  assert.equal(ui.form.hidden, false);
  assert.equal(ui.input.value, 'Control+Alt+Shift+Space');
  assert.equal(ui.blur.checked, true);
  assert.equal(ui.message.textContent, 'Press Control+Alt+Shift+Space anywhere to show or hide Open Sesame.');
  assert.equal(ui.message.dataset.warn, 'false');
  assert.deepEqual(bridge.calls, [{ method: 'summon.status', params: {} }]);

  const none = parts();
  await mountSummon({ request: async () => { throw new Error('Unsupported desktop action.'); } }, none);
  assert.equal(none.section.hidden, true, 'No summon methods, no section');

  const wayland = parts();
  await mountSummon(fakeBridge({ session: 'wayland', shortcut: 'Control+Alt+Shift+Space', registered: false }), wayland);
  assert.equal(wayland.section.hidden, false);
  assert.equal(wayland.form.hidden, true, 'Wayland offers no shortcut field');
  assert.ok(wayland.hint.textContent.endsWith('open-sesame --toggle'));
}

// 3. Saving sends the trimmed text once and shows the host's answer; nothing is reloaded.
{
  const bridge = fakeBridge({ session: 'macos', shortcut: 'Control+Alt+Shift+Space', registered: true }, {
    'summon.setShortcut': ({ shortcut }, status) => ({ ...status, shortcut, registered: Boolean(shortcut) }),
  });
  const ui = parts();
  await mountSummon(bridge, ui);
  let prevented = 0;
  ui.input.value = '  Control+Alt+K ';
  ui.form.fire('submit', { preventDefault: () => { prevented += 1; } });
  await settle();
  assert.equal(prevented, 1, 'The form never navigates');
  assert.deepEqual(bridge.calls.at(-1), { method: 'summon.setShortcut', params: { shortcut: 'Control+Alt+K' } });
  assert.equal(ui.input.value, 'Control+Alt+K');
  assert.equal(ui.message.textContent, 'Press Control+Alt+K anywhere to show or hide Open Sesame.');

  // An empty field means none.
  ui.input.value = '';
  ui.form.fire('submit', {});
  await settle();
  assert.deepEqual(bridge.calls.at(-1), { method: 'summon.setShortcut', params: { shortcut: '' } });
  assert.equal(ui.message.textContent, 'No shortcut is set.');
}

// 4. A conflict shows the host's sentence as a warning, keeps what was typed for correction, and
//    the saved shortcut is still the working one.
{
  const refused = 'Open Sesame could not register Alt+Space. Another application may already use it. Choose a different shortcut.';
  const bridge = fakeBridge({ session: 'windows', shortcut: 'Control+Alt+Shift+Space', registered: true }, {
    'summon.setShortcut': () => { throw new Error(refused); },
  });
  const ui = parts();
  await mountSummon(bridge, ui);
  ui.input.value = 'Alt+Space';
  ui.form.fire('submit', {});
  await settle();
  assert.equal(ui.message.textContent, refused);
  assert.equal(ui.message.dataset.warn, 'true');
  assert.equal(ui.input.value, 'Alt+Space', 'What was typed stays for correction');
  assert.deepEqual(bridge.calls.map(call => call.method), ['summon.status', 'summon.setShortcut', 'summon.status']);
  assert.equal(bridge.state.status.shortcut, 'Control+Alt+Shift+Space');
  assert.equal(bridge.state.status.registered, true);
}

// 5. The checkbox sends its state, and a failure puts it back to what the host has.
{
  const bridge = fakeBridge({ session: 'x11', shortcut: 'Control+Alt+Shift+Space', registered: true }, {
    'summon.setHideOnBlur': ({ enabled }, status) => ({ ...status, hideOnBlur: enabled }),
  });
  const ui = parts();
  await mountSummon(bridge, ui);
  ui.blur.checked = true;
  ui.blur.fire('change');
  await settle();
  assert.deepEqual(bridge.calls.at(-1), { method: 'summon.setHideOnBlur', params: { enabled: true } });
  assert.equal(ui.blur.checked, true);

  const failing = fakeBridge({ session: 'x11', shortcut: 'Control+Alt+Shift+Space', registered: true }, {
    'summon.setHideOnBlur': () => { throw new Error('Open Sesame could not save the shortcut setting.'); },
  });
  const other = parts();
  await mountSummon(failing, other);
  other.blur.checked = true;
  other.blur.fire('change');
  await settle();
  assert.equal(other.blur.checked, false, 'The box shows what the host kept');
  assert.equal(other.message.textContent, 'Open Sesame could not save the shortcut setting.');
  assert.equal(other.message.dataset.warn, 'true');
}

// 6. A drag is reported once when it starts and once when it ends, however it ends.
{
  const calls = [];
  const bridge = { request: async (method, params) => { calls.push({ method, params }); return params; } };
  const page = element();
  holdDuringDrag(bridge, page);
  page.fire('dragstart');
  page.fire('dragstart');
  page.fire('dragend');
  page.fire('drop');
  page.fire('dragstart');
  page.fire('drop');
  assert.deepEqual(calls, [true, false, true, false].map(held => ({ method: 'summon.hold', params: { held } })));
}

// 7. The page's methods are the host's methods, and each is in the gate.
{
  const page = read('ui/summon.js');
  const host = read('src-tauri/src/summon.rs');
  const gate = read('crates/core/src/gate.rs');
  const methods = [...host.match(/pub const METHODS: &\[&str\] = &\[([^\]]*)\]/)[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(methods, ['summon.status', 'summon.setShortcut', 'summon.setHideOnBlur', 'summon.hold']);
  for (const method of methods) {
    assert.ok(page.includes(`'${method}'`), `${method} is used by the page`);
    assert.ok(gate.includes(`"${method}"`), `${method} is in the gate`);
  }
}

// 8. Rules a reviewer is asked to look for, read from the Rust sources.
{
  const host = read('src-tauri/src/summon.rs');
  const window = read('src-tauri/src/window.rs');
  const entry = read('src-tauri/src/lib.rs');
  // The folder dialog (issue #74) takes the focus on purpose, so it holds the window first.
  const project = read('src-tauri/src/project.rs');
  const held = project.indexOf('summon::hold(window.app_handle())');
  assert.ok(held > 0 && held < project.indexOf('.blocking_pick_folder()'), 'The folder dialog takes summon::hold before it opens');
  const capability = read('src-tauri/capabilities/default.json');
  // The default is not a shortcut ChatGPT, Gemini (Option+Space, and Option+Shift+Space on a Mac),
  // Raycast or Alfred take.
  const fallback = host.match(/pub const DEFAULT_SHORTCUT: &str = "([^"]+)";/)[1];
  assert.equal(fallback, 'Control+Alt+Shift+Space');
  for (const taken of ['Alt+Space', 'Option+Space', 'Alt+Shift+Space', 'Option+Shift+Space', 'Control+Space', 'Super+Space', 'Command+Space', 'Control+Shift+Space', 'Control+Alt+Space', 'Control+Super+Space', 'Super+Alt+Space', 'Super+Shift+Space']) assert.notEqual(fallback.toLowerCase(), taken.toLowerCase());
  // Hide-on-blur is off unless the person turns it on.
  assert.match(host, /hide_on_blur: false,\n        \}\n    \}\n\}/);
  // On Wayland the window is not positioned and always-on-top is refused with the fixed message.
  // The ordinary window is left where the session puts it; only the rail is placed, by rail.rs,
  // and a Wayland session gets the rail only as a layer surface, which the session places
  // (layer.rs); without the protocol or the library it keeps the ordinary window.
  assert.equal(window.split('.center()').length - 1, 0, 'The ordinary window is not centred or otherwise placed when it is created');
  assert.match(window, /let builder = match presentation \{\n        Presentation::Rail => rail::shape\(builder\),\n        Presentation::Window => builder\n/);
  const railSource = read('src-tauri/src/rail.rs');
  assert.match(railSource, /Session::Wayland => Presentation::Window,/, 'A Wayland session keeps the ordinary window');
  assert.match(railSource, /if session == Session::Wayland && crate::layer::supported\(\) \{\n        return Presentation::Rail;\n    \}\n    presentation_for\(session\)/, 'Only a Wayland session that can dock the window gets the rail');
  // The layer-shell library is opened when it is there and never linked, so the application
  // starts without it, and it is asked only before the window is first shown.
  const layerSource = read('src-tauri/src/layer.rs');
  assert.match(layerSource, /libc::dlopen\(\n            c"libgtk-layer-shell\.so\.0"\.as_ptr\(\),/, 'gtk-layer-shell is opened at run time');
  assert.equal(/#\[link|extern crate|gtk_layer_shell::/.test(layerSource), false, 'gtk-layer-shell is not linked');
  assert.match(layerSource, /if surface\.is_realized\(\) \{\n        return false;\n    \}/, 'A window that already has a surface is not docked');
  assert.match(layerSource, /"OPEN_SESAME_LAYER_SHELL"\)\.as_deref\(\) == Ok\("off"\)/, 'The ordinary window can be asked for');
  assert.equal(/gtk_layer_/.test(railSource), false, 'Every gtk-layer-shell call is in layer.rs');
  assert.match(railSource, /app\.manage\(rail\);\n    if presentation != Presentation::Rail \{\n        return;\n    \}/, 'The ordinary window starts no pointer thread');
  assert.match(railSource, /"rail\.set" => \{\n            \/\/ The ordinary window has nothing to set\.\n            if !rail\.is_rail\(\) \{\n                return Err\(BridgeError::from\(NOT_ON_OS\)\);/, 'rail.set is refused for the ordinary window');
  // A page that loads takes none of the old page's holds with it (issue #115). The rule is for
  // every build. This reads text and cannot show that the call runs, and nothing else in the
  // repository shows a page load releasing holds: the test in router.rs calls
  // `summon::page_replaced` itself.
  //
  // What is read about the hook, after taking out `/* ... */` up to the first `*/` and then
  // `//` to the end of a line (so a string, a nested comment or a `/*` inside a line comment
  // is misread):
  // - `.on_page_load(` occurs once in window.rs;
  // - the statement `let builder = builder.on_page_load(` follows `;`, `{`, `}` or the start
  //   of the file directly, so no attribute is on it;
  // - the arm `PageLoadEvent::Started =>` is looked for between `builder.on_page_load(` and
  //   `let window = builder.build()?;` and follows `{`, `,` or `}` directly; after its arrow
  //   may stand one `{`, and between that and the call stand only statements that begin with
  //   a path and `(`, hold none of `;`, `{`, `}`, `#`, `!` and `"` after it, and end with `);`
  //   (the proposal for issue #112 adds one); the call is
  //   `summon::page_replaced(window.app_handle())` in that spelling and is followed by `;` or
  //   `,`;
  // - `fn page_replaced` occurs once in summon.rs, `pub fn page_replaced<` follows `;` or `}`
  //   directly, and its body starts with the lines matched below, in that layout.
  // What encloses the statement, the match or `page_replaced` is not read, nor a guard on an
  // earlier arm, nor what `release_page_holds` does, nor a hook set by another spelling. A
  // hook made development-only from outside passes; a correct one written another way may
  // fail.
  const bare = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const source = bare(window);
  assert.equal(source.split('.on_page_load(').length - 1, 1, 'window.rs sets the page-load hook once, as `.on_page_load(`: a second would replace the first');
  assert.ok(/(?:^|[;{}])\s*let builder = builder\.on_page_load\(/.test(source), 'The hook is set by the statement `let builder = builder.on_page_load(`, with no attribute directly on it');
  const loads = source.slice(source.indexOf('builder.on_page_load('), source.indexOf('let window = builder.build()?;'));
  assert.ok(/[{,}]\s*PageLoadEvent::Started\s*=>\s*(?:\{\s*)?(?:[A-Za-z_][A-Za-z0-9_:]*\([^;{}#!"]*\);\s*)*summon::page_replaced\(window\.app_handle\(\)\)\s*[;,]/.test(loads), 'The arm `PageLoadEvent::Started =>` has no attribute directly on it and reaches `summon::page_replaced(window.app_handle())` through statements that are path calls ended by `);`');
  assert.equal(bare(host).split('fn page_replaced').length - 1, 1, 'page_replaced is one function, not one per kind of build');
  assert.ok(/[;}]\s*pub fn page_replaced</.test(bare(host)), 'page_replaced carries no attribute');
  assert.match(bare(host), /pub fn page_replaced<R: Runtime>\(app: &AppHandle<R>\) \{\n    if let Some\(summon\) = app\.try_state::<Summon>\(\) \{\n        summon\.release_page_holds\(\);/);
  assert.match(window, /Session::Wayland\)\n            \{\n                return Err\(BridgeError::from\(NOT_ON_OS\)\);/);
  // AppKit aborts the process if a window is ordered off the main thread, and a second launch,
  // the shortcut and the bridge all call from other threads. Found in a launched app.
  const panel = bare(read('src-tauri/src/panel.rs'));
  assert.match(panel, /\.run_on_main_thread\(move \|\| \{/, 'panel::show orders the panel from the main thread');
  // tauri-nspanel's `show_and_make_key` makes the panel's content view the first responder, which
  // takes the keyboard from the web view: what was typed after the shortcut reached nothing (#142).
  assert.ok(!panel.includes('show_and_make_key'), 'panel::show does not call show_and_make_key, which takes the keyboard from the web view');
  assert.ok(!panel.includes('make_first_responder'), 'panel::show does not choose a first responder of its own');
  // Ordered in front and made key without activating the application, then the web view (and so the
  // element the page had focused) is given the keyboard, inside the same main-thread task.
  assert.match(panel, /\.run_on_main_thread\(move \|\| \{\s*panel\.order_front_regardless\(\);\s*panel\.make_key_window\(\);\s*let _ = webview\.set_focus\(\);\s*\}\)/, 'panel::show orders the panel in front, makes it key, then focuses the web view');
  // Single-instance is the first plugin, so a second launch never creates a window.
  const plugins = [...entry.matchAll(/\.plugin\(([a-z_:]+)/g)].map(match => match[1]);
  assert.equal(plugins[0], 'tauri_plugin_single_instance::init');
  // The page is granted none of the shortcut plugin's own commands: Rust registers shortcuts.
  assert.ok(!capability.includes('global-shortcut'), 'The capability grants no shortcut command');
  assert.ok(!capability.includes('nspanel'), 'The capability grants no panel command');
}

console.log('Tauri summon: the shortcut settings section, drag reporting and the source rules for Wayland, the default shortcut and plugin order passed.');
