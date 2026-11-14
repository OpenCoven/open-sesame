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
  const state = { status: { defaultShortcut: 'Alt+Shift+Space', toggleCommand: 'open-sesame --toggle', message: '', hideOnBlur: false, ...status } };
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
  assert.deepEqual(describe({ ...base, session: 'macos', shortcut: 'Alt+Shift+Space', registered: true }),
    { editable: true, warn: false, hint: EXAMPLE, message: 'Press Alt+Shift+Space anywhere to show or hide Open Sesame.' });
  assert.deepEqual(describe({ ...base, session: 'x11', shortcut: '', registered: false }),
    { editable: true, warn: false, hint: EXAMPLE, message: 'No shortcut is set.' });
  const refused = 'Open Sesame could not register Alt+Space. Another application may already use it. Choose a different shortcut.';
  assert.deepEqual(describe({ ...base, session: 'windows', shortcut: 'Alt+Space', registered: false, message: refused }),
    { editable: true, warn: true, hint: EXAMPLE, message: refused });
  // Wayland: no field to fill in, and the exact command to bind.
  const wayland = describe({ ...base, session: 'wayland', shortcut: 'Alt+Shift+Space', registered: false, message: 'ignored here' });
  assert.equal(wayland.editable, false);
  assert.equal(wayland.warn, false);
  assert.ok(wayland.hint.endsWith('open-sesame --toggle'), wayland.hint);
  assert.equal(wayland.message, '');
}

// 2. The section appears with what the host reports, and stays hidden when the host has no summon.
{
  const bridge = fakeBridge({ session: 'x11', shortcut: 'Alt+Shift+Space', registered: true, hideOnBlur: true });
  const ui = parts();
  await mountSummon(bridge, ui);
  assert.equal(ui.section.hidden, false);
  assert.equal(ui.form.hidden, false);
  assert.equal(ui.input.value, 'Alt+Shift+Space');
  assert.equal(ui.blur.checked, true);
  assert.equal(ui.message.textContent, 'Press Alt+Shift+Space anywhere to show or hide Open Sesame.');
  assert.equal(ui.message.dataset.warn, 'false');
  assert.deepEqual(bridge.calls, [{ method: 'summon.status', params: {} }]);

  const none = parts();
  await mountSummon({ request: async () => { throw new Error('Unsupported desktop action.'); } }, none);
  assert.equal(none.section.hidden, true, 'No summon methods, no section');

  const wayland = parts();
  await mountSummon(fakeBridge({ session: 'wayland', shortcut: 'Alt+Shift+Space', registered: false }), wayland);
  assert.equal(wayland.section.hidden, false);
  assert.equal(wayland.form.hidden, true, 'Wayland offers no shortcut field');
  assert.ok(wayland.hint.textContent.endsWith('open-sesame --toggle'));
}

// 3. Saving sends the trimmed text once and shows the host's answer; nothing is reloaded.
{
  const bridge = fakeBridge({ session: 'macos', shortcut: 'Alt+Shift+Space', registered: true }, {
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
  const bridge = fakeBridge({ session: 'windows', shortcut: 'Alt+Shift+Space', registered: true }, {
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
  assert.equal(bridge.state.status.shortcut, 'Alt+Shift+Space');
  assert.equal(bridge.state.status.registered, true);
}

// 5. The checkbox sends its state, and a failure puts it back to what the host has.
{
  const bridge = fakeBridge({ session: 'x11', shortcut: 'Alt+Shift+Space', registered: true }, {
    'summon.setHideOnBlur': ({ enabled }, status) => ({ ...status, hideOnBlur: enabled }),
  });
  const ui = parts();
  await mountSummon(bridge, ui);
  ui.blur.checked = true;
  ui.blur.fire('change');
  await settle();
  assert.deepEqual(bridge.calls.at(-1), { method: 'summon.setHideOnBlur', params: { enabled: true } });
  assert.equal(ui.blur.checked, true);

  const failing = fakeBridge({ session: 'x11', shortcut: 'Alt+Shift+Space', registered: true }, {
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
  const capability = read('src-tauri/capabilities/default.json');
  // The default is not a shortcut ChatGPT, Gemini, Raycast or Alfred take.
  const fallback = host.match(/pub const DEFAULT_SHORTCUT: &str = "([^"]+)";/)[1];
  assert.equal(fallback, 'Alt+Shift+Space');
  for (const taken of ['Alt+Space', 'Option+Space', 'Control+Space', 'Super+Space', 'Command+Space', 'Control+Shift+Space', 'Control+Alt+Space']) assert.notEqual(fallback.toLowerCase(), taken.toLowerCase());
  // Hide-on-blur is off unless the person turns it on.
  assert.match(host, /hide_on_blur: false,\n        \}\n    \}\n\}/);
  // On Wayland the window is not positioned and always-on-top is refused with the fixed message.
  assert.match(window, /if summon::session\(\) == Session::Wayland \{\n        builder\n    \} else \{\n        builder\.center\(\)\n    \};/);
  assert.equal(window.split('.center()').length - 1, 1, 'The window is centred in one place only');
  assert.match(window, /Session::Wayland\)\n            \{\n                return Err\(BridgeError::from\(NOT_ON_OS\)\);/);
  // Single-instance is the first plugin, so a second launch never creates a window.
  const plugins = [...entry.matchAll(/\.plugin\(([a-z_:]+)/g)].map(match => match[1]);
  assert.equal(plugins[0], 'tauri_plugin_single_instance::init');
  // The page is granted none of the shortcut plugin's own commands: Rust registers shortcuts.
  assert.ok(!capability.includes('global-shortcut'), 'The capability grants no shortcut command');
  assert.ok(!capability.includes('nspanel'), 'The capability grants no panel command');
}

console.log('Tauri summon: the shortcut settings section, drag reporting and the source rules for Wayland, the default shortcut and plugin order passed.');
