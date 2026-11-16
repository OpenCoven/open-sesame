// The shortcut settings section of the new shell (issue #71). Loads ui/summon.js against
// stand-in elements and a stand-in bridge and verifies what a person is told for each state the
// host can report, that a change takes effect from the host's answer without a reload, that a
// refusal is shown and leaves the saved shortcut in place, and that the page reports a drag.
// It runs the page's own context menu (issue #115) against a stand-in document. It also reads the Rust sources as text for the rules a reviewer is asked to look for. It runs
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
  // A saved shortcut the default replaced: the host's notice comes first, as a warning, in
  // front of what the status says anyway. On Wayland no shortcut is registered at all, so
  // there is nothing to say about one.
  const notice = 'Your saved shortcut, Shift+Up, is one Open Sesame no longer takes, so the default, Control+Alt+Shift+Space, is used. Set another here if you prefer.';
  assert.deepEqual(describe({ ...base, session: 'macos', shortcut: 'Control+Alt+Shift+Space', registered: true, notice }),
    { editable: true, warn: true, hint: EXAMPLE, message: `${notice} Press Control+Alt+Shift+Space anywhere to show or hide Open Sesame.` });
  assert.deepEqual(describe({ ...base, session: 'windows', shortcut: 'Control+Alt+Shift+Space', registered: false, message: refused, notice }),
    { editable: true, warn: true, hint: EXAMPLE, message: `${notice} ${refused}` });
  assert.equal(describe({ ...base, session: 'macos', shortcut: 'Control+Alt+Shift+Space', registered: true, notice: '' }).warn, false);
  assert.equal(describe({ ...base, session: 'macos', shortcut: 'Control+Alt+Shift+Space', registered: true, notice: 7 }).warn, false);
  assert.equal(describe({ ...base, session: 'wayland', shortcut: 'Control+Alt+Shift+Space', registered: false, notice }).message, '');
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
  ui.input.value = '  Control+Shift+K ';
  ui.form.fire('submit', { preventDefault: () => { prevented += 1; } });
  await settle();
  assert.equal(prevented, 1, 'The form never navigates');
  assert.deepEqual(bridge.calls.at(-1), { method: 'summon.setShortcut', params: { shortcut: 'Control+Shift+K' } });
  assert.equal(ui.input.value, 'Control+Shift+K');
  assert.equal(ui.message.textContent, 'Press Control+Shift+K anywhere to show or hide Open Sesame.');

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
  // One press (issue #115). The rules themselves are tested in Rust; what is read here is that
  // the places a window cannot be seen from a test still go through them: the tray notes only
  // a press that opens its menu, a press that hid the window on blur does nothing more for the
  // shortcut and the tray click, losing the keyboard is noted for the next press, only a press
  // that hides conceals the window, and only a hidden window is moved against the tray icon.
  // And the ways in call them: the shortcut's handler, the tray click and `--toggle` each go
  // to their own function, and each of the three functions in window.rs decides by its own
  // rule and then acts on the window.
  const tray = read('src-tauri/src/tray.rs');
  assert.match(host, /if event\.state == ShortcutState::Pressed \{\n                pressed\(app\);\n            \}/);
  assert.match(host, /Launch::Toggle => \{\n            window::toggle\(app\);\n        \}/);
  assert.match(tray, /\) = \(cfg!\(windows\), event\)\s*\{\s*summon::tray_clicked\(tray\.app_handle\(\), rect\);/);
  assert.equal(tray.split('window::toggle_at').length - 1, 0, 'The tray click goes through summon::tray_clicked');
  assert.match(window, /pub fn toggle<R: Runtime>\(app: &AppHandle<R>\) -> Option<summon::Press> \{\n    let window = app\.get_webview_window\(MAIN_WINDOW\)\?;\n    let press = summon::press_on\(app, &window\);\n    let _ = act\(&window, press\);\n    Some\(press\)\n\}/);
  assert.match(window, /pub fn toggle_from_tray_menu<R: Runtime>\(app: &AppHandle<R>\) -> Option<summon::Press> \{\n    let window = app\.get_webview_window\(MAIN_WINDOW\)\?;\n    let press = summon::tray_item_on\(app, &window\);\n    let _ = act\(&window, press\);\n    Some\(press\)\n\}/);
  assert.match(window, /pub fn toggle_at<R: Runtime>\(app: &AppHandle<R>, icon: tauri::Rect\) -> Option<summon::Press> \{\n    let window = app\.get_webview_window\(MAIN_WINDOW\)\?;\n    let press = summon::press_on\(app, &window\);\n    let kept_in_place =\n        window\.is_fullscreen\(\)\.unwrap_or\(false\) \|\| window\.is_maximized\(\)\.unwrap_or\(false\);\n    if places\(press, kept_in_place\) \{\n        let _ = place_against\(&window, icon\);\n    \}\n    let _ = act\(&window, press\);\n    Some\(press\)\n\}/);
  assert.match(tray, /button_state: MouseButtonState::Down,\n[^}]*\}\s*= &event\s*\{\s*if summon::opens_the_tray_menu\(cfg!\(windows\), \*button == MouseButton::Right\) \{\s*summon::tray_pressed\(tray\.app_handle\(\)\);/);
  assert.match(tray, /TOGGLE => \{\s*window::toggle_from_tray_menu\(app\);/);
  assert.match(host, /fn pressed<R: Runtime>\(app: &AppHandle<R>\) -> Option<Press> \{\n    if blur_just_hid\(app\) \{\n        return None;\n    \}\n    window::toggle\(app\)\n\}/);
  assert.match(host, /pub fn tray_clicked<R: Runtime>\(app: &AppHandle<R>, icon: tauri::Rect\) -> Option<Press> \{\n    if blur_just_hid\(app\) \{\n        return None;\n    \}\n    window::toggle_at\(app, icon\)\n\}/);
  assert.match(host, /pub fn blurred<R: Runtime>\(app: &AppHandle<R>\) \{\n    let Some\(summon\) = app\.try_state::<Summon>\(\) else \{\n        return;\n    \};\n    \*lock\(&summon\.lost_focus\) = Some\(Instant::now\(\)\);/);
  assert.match(window, /    if conceals\(press\) \{\n        conceal\(window\)\n    \} else \{\n        focus\(window\)\n    \}/);
  assert.match(window, /    if places\(press, kept_in_place\) \{\n        let _ = place_against\(&window, icon\);\n    \}/);
  assert.equal(window.split('place_against(&window').length - 1, 1, 'The window is moved against the tray icon in one place');
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
  assert.match(window, /if summon::session\(\) == Session::Wayland \{\n        builder\n    \} else \{\n        builder\.center\(\)\n    \};/);
  assert.equal(window.split('.center()').length - 1, 1, 'The window is centred in one place only');
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
  assert.match(read('src-tauri/src/panel.rs'), /\.run_on_main_thread\(move \|\| panel\.show_and_make_key\(\)\)/);
  // Single-instance is the first plugin, so a second launch never creates a window.
  const plugins = [...entry.matchAll(/\.plugin\(([a-z_:]+)/g)].map(match => match[1]);
  assert.equal(plugins[0], 'tauri_plugin_single_instance::init');
  // The page is granted none of the shortcut plugin's own commands: Rust registers shortcuts.
  assert.ok(!capability.includes('global-shortcut'), 'The capability grants no shortcut command');
  assert.ok(!capability.includes('nspanel'), 'The capability grants no panel command');
}

// 9. The page's own context menu (issue #115): the native one is never opened, and what is
//    offered is drawn in the page. Stand-ins for the document; no web view is run here.
{
  const { mountContextMenu, provideMenu, fieldItems, isTextField, pasteFor } = await import(pathToFileURL(path.join(root, 'ui/context-menu.js')));

  // What a field offers, by its state.
  const enabled = state => fieldItems(state).filter(item => item.enabled).map(item => item.id);
  assert.deepEqual(fieldItems({ editable: true, secret: false, hasSelection: true, hasText: true }).map(item => item.label), ['Cut', 'Copy', 'Paste', 'Select All']);
  assert.deepEqual(enabled({ editable: true, secret: false, hasSelection: true, hasText: true }), ['cut', 'copy', 'paste', 'selectAll']);
  assert.deepEqual(enabled({ editable: true, secret: false, hasSelection: false, hasText: true }), ['paste', 'selectAll']);
  assert.deepEqual(enabled({ editable: true, secret: false, hasSelection: false, hasText: false }), ['paste']);
  assert.deepEqual(enabled({ editable: false, secret: false, hasSelection: true, hasText: true }), ['copy', 'selectAll']);
  assert.deepEqual(enabled({ editable: true, secret: true, hasSelection: true, hasText: true }), ['paste', 'selectAll'], 'A password field gives nothing to the clipboard');
  for (const [tagName, type, expected] of [['INPUT', 'text', true], ['INPUT', 'search', true], ['INPUT', 'password', true], ['INPUT', undefined, true], ['TEXTAREA', undefined, true],
    ['INPUT', 'checkbox', false], ['INPUT', 'email', false], ['INPUT', 'number', false], ['INPUT', 'file', false], ['BUTTON', 'button', false], ['DIV', undefined, false]]) {
    assert.equal(isTextField({ tagName, type }), expected, `${tagName} ${type}`);
  }
  assert.equal(isTextField(null), false);
  assert.equal(pasteFor({ value: 'abcdef', maxLength: -1 }, 2, 4, 'XYZ'), 'XYZ');
  assert.equal(pasteFor({ value: 'abcdef', maxLength: 7 }, 2, 4, 'XYZ12'), 'XYZ', 'A paste respects the field limit');
  assert.equal(pasteFor({ value: 'abcdef', maxLength: 4 }, 6, 6, 'XYZ'), '');
  assert.equal(pasteFor({ value: 'abcdef' }, 2, 4, 'XYZ'), 'XYZ');
  assert.equal(pasteFor({ value: 'ab', maxLength: 4 }, 2, 2, 'x\u{1F600}y'), 'x', 'A paste is never cut in the middle of a character');
  assert.equal(pasteFor({ value: 'ab', maxLength: 5 }, 2, 2, 'x\u{1F600}y'), 'x\u{1F600}');

  // A stand-in document: enough of the DOM for the menu to be built, focused and removed.
  const makeDocument = () => {
    const node = (tagName, extra = {}) => {
      const listeners = new Map();
      const self = {
        tagName: tagName.toUpperCase(), children: [], parentNode: null, attributes: {}, style: {}, textContent: '', disabled: false,
        setAttribute: (name, value) => { self.attributes[name] = value; },
        addEventListener: (name, run) => { listeners.set(name, [...(listeners.get(name) || []), run]); },
        fire: (name, event = {}) => { for (const run of listeners.get(name) || []) run(event); },
        append: (...kids) => { for (const kid of kids) { kid.parentNode = self; self.children.push(kid); } },
        remove: () => { const kids = self.parentNode?.children; if (kids) kids.splice(kids.indexOf(self), 1); self.parentNode = null; if (doc.activeElement === self || self.children.includes(doc.activeElement)) doc.activeElement = doc.body; },
        contains: other => { for (let at = other; at; at = at.parentNode) if (at === self) return true; return false; },
        focus: () => { doc.activeElement = self; },
        getBoundingClientRect: () => ({ width: 120, height: 100, left: 400, bottom: 320 }),
        ...extra,
      };
      return self;
    };
    const listeners = new Map();
    const windowListeners = new Map();
    const doc = {
      selection: '',
      createElement: tag => node(tag),
      getSelection: () => doc.selection,
      addEventListener: (name, run, capture) => { listeners.set(name, [...(listeners.get(name) || []), { run, capture }]); },
      // Capturing listeners run first, as they do in a document.
      fire: (name, event = {}) => { const all = listeners.get(name) || []; for (const { run } of [...all.filter(entry => entry.capture === true), ...all.filter(entry => entry.capture !== true)]) run(event); },
      listenersFor: name => (listeners.get(name) || []),
      defaultView: {
        innerWidth: 800, innerHeight: 600,
        Event: class { constructor(type, init) { this.type = type; this.bubbles = init?.bubbles === true; } },
        addEventListener: (name, run) => { windowListeners.set(name, [...(windowListeners.get(name) || []), run]); },
        fire: name => { for (const run of windowListeners.get(name) || []) run({}); },
      },
      node,
    };
    doc.body = node('body');
    doc.activeElement = doc.body;
    return doc;
  };
  const field = (doc, value, start, end, extra = {}) => {
    const events = [];
    const self = doc.node('input', {
      type: 'text', value, selectionStart: start, selectionEnd: end, readOnly: false, maxLength: -1,
      setRangeText: (text, from, to) => { self.value = self.value.slice(0, from) + text + self.value.slice(to); self.selectionStart = self.selectionEnd = from + text.length; },
      setSelectionRange: (from, to) => { self.selectionStart = from; self.selectionEnd = to; },
      dispatchEvent: event => { events.push(event.type); },
      events,
      ...extra,
    });
    doc.body.append(self);
    return self;
  };
  const clipboard = (text = '') => {
    const state = { text, calls: [] };
    state.request = async (method, params) => {
      state.calls.push(method);
      if (method === 'terminal.clipboard.write') { state.text = params.text; return {}; }
      if (method === 'terminal.clipboard.read') return state.text;
      throw new Error(`Unexpected ${method}`);
    };
    return state;
  };
  const ask = (doc, target, at = {}) => {
    let prevented = 0;
    doc.fire('contextmenu', { target, clientX: 10, clientY: 20, preventDefault: () => { prevented += 1; }, ...at });
    return prevented;
  };
  const menuOf = doc => doc.body.children.find(child => child.attributes.role === 'menu');
  const choose = async (doc, label) => {
    const button = menuOf(doc).children.find(child => child.textContent === label);
    assert.ok(button, `${label} is offered`);
    assert.equal(button.disabled, false, `${label} can be chosen`);
    button.fire('click');
    await settle();
  };

  // Nothing to offer: the native menu is still cancelled, and no menu is drawn.
  {
    const doc = makeDocument();
    const menu = mountContextMenu(clipboard(), doc);
    // The native menu is cancelled by a capturing listener, so no part of the page can let it
    // through, and that listener alone cancels it. The menu is built by a second one that does
    // not capture, so the part of the page that was pressed has heard the event first.
    const [first, second, ...more] = doc.listenersFor('contextmenu');
    assert.deepEqual([first.capture, second.capture, more.length], [true, undefined, 0]);
    {
      let prevented = 0;
      first.run({ target: doc.body, preventDefault: () => { prevented += 1; } });
      assert.equal(prevented, 1, 'The capturing listener cancels the native menu by itself');
    }
    const plain = doc.node('p');
    doc.body.append(plain);
    assert.equal(ask(doc, plain), 1, 'The native menu is cancelled where there is nothing to offer');
    assert.equal(menu.isOpen(), false);
    assert.equal(menuOf(doc), undefined);
    // Selected text anywhere on the page: Copy, and only that.
    doc.selection = 'some words';
    const bridge = clipboard();
    const doc2 = makeDocument();
    mountContextMenu(bridge, doc2);
    doc2.selection = 'some words';
    const text = doc2.node('p');
    doc2.body.append(text);
    assert.equal(ask(doc2, text), 1);
    assert.deepEqual(menuOf(doc2).children.map(child => child.textContent), ['Copy']);
    await choose(doc2, 'Copy');
    assert.equal(bridge.text, 'some words');
    assert.equal(menuOf(doc2), undefined, 'Choosing closes the menu');
  }

  // A text field: the four items, each doing what it says through the host's clipboard.
  {
    const doc = makeDocument();
    const bridge = clipboard('PASTED');
    const reported = [];
    const menu = mountContextMenu(bridge, doc, { report: text => reported.push(text) });
    const input = field(doc, 'hello world', 0, 5);
    input.focus();
    assert.equal(ask(doc, input, { clientX: 790, clientY: 590 }), 1);
    const box = menuOf(doc);
    assert.equal(menu.isOpen(), true);
    assert.deepEqual(box.children.map(child => [child.textContent, child.disabled, child.attributes.role, child.type]),
      [['Cut', false, 'menuitem', 'button'], ['Copy', false, 'menuitem', 'button'], ['Paste', false, 'menuitem', 'button'], ['Select All', false, 'menuitem', 'button']]);
    assert.deepEqual([box.style.left, box.style.top], ['680px', '500px'], 'The menu stays inside the window');
    assert.equal(doc.activeElement, box.children[0], 'The first item that can be chosen has the keyboard');
    // The arrow keys move among the items; Escape closes and gives the keyboard back.
    let stopped = 0;
    box.fire('keydown', { key: 'ArrowUp', preventDefault: () => { stopped += 1; } });
    assert.equal(doc.activeElement, box.children[3]);
    box.fire('keydown', { key: 'ArrowDown', preventDefault: () => { stopped += 1; } });
    assert.equal(doc.activeElement, box.children[0]);
    // Home and End go to the ends, and a key the menu takes goes no further: Escape must not
    // also close a panel behind the menu.
    let kept = 0;
    const key = name => box.fire('keydown', { key: name, preventDefault: () => { stopped += 1; }, stopPropagation: () => { kept += 1; } });
    key('End');
    assert.equal(doc.activeElement, box.children[3]);
    key('Home');
    assert.equal(doc.activeElement, box.children[0]);
    key('a');
    assert.deepEqual([stopped, kept, menu.isOpen()], [4, 3, true], 'Any other key does nothing here and goes no further: a shortcut of the page must not open a panel over the menu');
    key('Escape');
    assert.deepEqual([stopped, kept], [5, 4]);
    assert.equal(menu.isOpen(), false);
    assert.equal(doc.activeElement, input, 'The field has the keyboard again');
    // From the menu itself, up is the last item and down the first.
    ask(doc, input);
    menuOf(doc).focus();
    menuOf(doc).fire('keydown', { key: 'ArrowUp', preventDefault: () => {} });
    assert.equal(doc.activeElement, menuOf(doc).children[3]);
    menuOf(doc).focus();
    menuOf(doc).fire('keydown', { key: 'ArrowDown', preventDefault: () => {} });
    assert.equal(doc.activeElement, menuOf(doc).children[0]);
    menu.close();
    ask(doc, input);
    menuOf(doc).fire('keydown', { key: 'Tab', preventDefault: () => {}, stopPropagation: () => {} });
    assert.equal(menu.isOpen(), false, 'Tab closes the menu');
    // Near the left and top edges the menu is not pushed outside either.
    ask(doc, input, { clientX: -30, clientY: -5 });
    assert.deepEqual([menuOf(doc).style.left, menuOf(doc).style.top], ['0px', '0px']);
    menu.close();
    // Asked for with the keyboard, the event carries no place: the menu goes under the field.
    ask(doc, input, { clientX: 0, clientY: 0 });
    assert.deepEqual([menuOf(doc).style.left, menuOf(doc).style.top], ['400px', '320px']);
    menu.close();
    // After a choice the field the menu was for has the keyboard, whatever had it before.
    const elsewhere = doc.node('button');
    doc.body.append(elsewhere);
    elsewhere.focus();
    ask(doc, input);
    await choose(doc, 'Select All');
    assert.equal(doc.activeElement, input, 'The field asked about has the keyboard after a choice');
    input.selectionStart = 0;
    input.selectionEnd = 5;

    ask(doc, input);
    await choose(doc, 'Copy');
    assert.equal(bridge.text, 'hello');
    assert.equal(input.value, 'hello world');
    assert.deepEqual([input.selectionStart, input.selectionEnd], [0, 5], 'Copy leaves the selection');

    ask(doc, input);
    await choose(doc, 'Cut');
    assert.equal(bridge.text, 'hello');
    assert.equal(input.value, ' world');
    assert.deepEqual(input.events, ['input'], 'The page hears of the change as it does of typing');

    bridge.text = 'PASTED';
    input.selectionStart = input.selectionEnd = 0;
    ask(doc, input);
    await choose(doc, 'Paste');
    assert.equal(input.value, 'PASTED world');
    assert.deepEqual([input.selectionStart, input.selectionEnd], [6, 6]);
    assert.deepEqual(input.events, ['input', 'input']);

    ask(doc, input);
    await choose(doc, 'Select All');
    assert.deepEqual([input.selectionStart, input.selectionEnd], [0, 12]);
    assert.deepEqual(reported, []);

    // A clipboard with no text in it changes nothing: the selection is not replaced by nothing.
    {
      const empty = field(doc, 'hello world', 0, 5);
      bridge.text = '';
      ask(doc, empty);
      await choose(doc, 'Paste');
      assert.equal(empty.value, 'hello world', 'An empty clipboard leaves the selected text');
      assert.deepEqual(empty.events, []);
      // Nor does a field with no room left.
      const full = field(doc, 'abcdef', 0, 0, { maxLength: 6 });
      bridge.text = 'MORE';
      ask(doc, full);
      await choose(doc, 'Paste');
      assert.equal(full.value, 'abcdef');
      // A field that changed while the clipboard answered is left as it is.
      const moving = field(doc, 'KEEP THIS text', 0, 5);
      const slow = { request: async (method, params) => { moving.value = 'THIS text now'; return bridge.request(method, params); } };
      const doc3 = makeDocument();
      mountContextMenu(slow, doc3);
      doc3.body.append(moving);
      ask(doc3, moving);
      await choose(doc3, 'Cut');
      assert.equal(moving.value, 'THIS text now', 'Cut removes nothing from a field that changed meanwhile');
      moving.value = 'KEEP THIS text';
      bridge.text = 'X';
      ask(doc3, moving);
      await choose(doc3, 'Paste');
      assert.equal(moving.value, 'THIS text now', 'Paste puts nothing into a field that changed meanwhile');
    }

    // A field with a limit takes no more than fits.
    const short = field(doc, 'abc', 3, 3, { maxLength: 8 });
    bridge.text = 'PASTED-LONG';
    ask(doc, short);
    await choose(doc, 'Paste');
    assert.equal(short.value, 'abcPASTE');

    // The clipboard refusing is said, and the field is left as it was.
    const refusing = { request: async () => { throw new Error('The clipboard is unavailable.'); } };
    const doc2 = makeDocument();
    const said = [];
    mountContextMenu(refusing, doc2, { report: text => said.push(text) });
    const other = field(doc2, 'keep', 0, 4);
    ask(doc2, other);
    await choose(doc2, 'Paste');
    ask(doc2, other);
    await choose(doc2, 'Cut');
    assert.deepEqual(said, ['The clipboard is unavailable.', 'The clipboard is unavailable.']);
    assert.equal(other.value, 'keep');
  }

  // A password field and a read-only field.
  {
    const doc = makeDocument();
    const bridge = clipboard('x');
    mountContextMenu(bridge, doc);
    const secret = field(doc, 'hunter2', 0, 7, { type: 'password' });
    ask(doc, secret);
    assert.deepEqual(menuOf(doc).children.map(child => [child.textContent, child.disabled]), [['Cut', true], ['Copy', true], ['Paste', false], ['Select All', false]]);
    const fixed = field(doc, 'fixed', 0, 5, { readOnly: true });
    ask(doc, fixed);
    assert.equal(doc.body.children.filter(child => child.attributes.role === 'menu').length, 1, 'A second request replaces the menu');
    assert.deepEqual(menuOf(doc).children.map(child => [child.textContent, child.disabled]), [['Cut', true], ['Copy', false], ['Paste', true], ['Select All', false]]);
    assert.deepEqual(bridge.calls, [], 'Nothing reads the clipboard until Paste is chosen');
    // A field that is switched off offers neither Cut nor Paste.
    const off = field(doc, 'off', 0, 3, { disabled: true });
    ask(doc, off);
    assert.deepEqual(menuOf(doc).children.map(child => [child.textContent, child.disabled]), [['Cut', true], ['Copy', false], ['Paste', true], ['Select All', false]]);
    // A menu with nothing to choose still takes the keyboard, so Escape can close it.
    const nothing = field(doc, '', 0, 0, { readOnly: true });
    nothing.focus();
    ask(doc, nothing);
    const dead = menuOf(doc);
    assert.deepEqual(dead.children.map(child => child.disabled), [true, true, true, true]);
    assert.deepEqual([dead.attributes.tabindex, dead.attributes['aria-label'], doc.activeElement === dead], ['-1', 'Context menu', true]);
    dead.fire('keydown', { key: 'Escape', preventDefault: () => {}, stopPropagation: () => {} });
    assert.equal(menuOf(doc), undefined);
    assert.equal(doc.activeElement, nothing);
  }

  // A part of the page with a menu of its own, as a terminal pane has; a press elsewhere, a
  // scroll, a resize and the window losing focus all close the menu.
  {
    const doc = makeDocument();
    const menu = mountContextMenu(clipboard(), doc);
    const pane = doc.node('div');
    const inner = doc.node('canvas');
    pane.append(inner);
    doc.body.append(pane);
    const ran = [];
    const withdraw = provideMenu(pane, () => [{ label: 'Copy', enabled: false, run: () => ran.push('copy') }, { label: 'Paste', enabled: true, run: () => ran.push('paste') }]);
    doc.selection = 'page text';
    assert.equal(ask(doc, inner), 1);
    assert.deepEqual(menuOf(doc).children.map(child => [child.textContent, child.disabled]), [['Copy', true], ['Paste', false]], 'The pane decides, not the page selection');
    assert.equal(doc.activeElement, menuOf(doc).children[1]);
    await choose(doc, 'Paste');
    assert.deepEqual(ran, ['paste']);
    for (const closes of [() => doc.fire('pointerdown', { target: doc.body }), () => doc.fire('scroll', { target: doc.body }), () => doc.fire('scroll'), () => doc.defaultView.fire('resize'), () => doc.defaultView.fire('blur')]) {
      ask(doc, inner);
      assert.equal(menu.isOpen(), true);
      closes();
      assert.equal(menu.isOpen(), false);
    }
    // A scroll inside the pane the menu belongs to leaves it open: a terminal scrolls by
    // itself whenever a program prints.
    ask(doc, inner);
    doc.fire('scroll', { target: inner });
    doc.fire('scroll', { target: pane });
    assert.equal(menu.isOpen(), true, 'The pane scrolling does not close its menu');
    menu.close();
    // So does a scroll somewhere else on the page, for a field's menu and for Copy over
    // selected text: a terminal beside them prints. A scroll of what holds the field or the
    // text moves it, and closes the menu.
    {
      const holder = doc.node('div');
      const input = field(doc, 'hello', 0, 5);
      const words = doc.node('p');
      holder.append(input, words);
      doc.body.append(holder);
      doc.selection = '';
      for (const [target, label] of [[input, 'Cut'], [words, 'Copy']]) {
        if (target === words) doc.selection = 'page text';
        ask(doc, target);
        assert.equal(menuOf(doc).children[0].textContent, label);
        doc.fire('scroll', { target: inner });
        doc.fire('scroll', { target: pane });
        assert.equal(menu.isOpen(), true, `${label}: a scroll elsewhere leaves the menu open`);
        doc.fire('scroll', { target: holder });
        assert.equal(menu.isOpen(), false, `${label}: a scroll of what holds it closes the menu`);
        ask(doc, target);
        doc.fire('scroll', { target: doc });
        assert.equal(menu.isOpen(), false, `${label}: the page scrolling closes the menu`);
      }
      // A field inside a part with a menu of its own gets that part's menu, not the field's.
      const inside = field(doc, 'typed', 0, 5);
      pane.append(inside);
      ask(doc, inside);
      assert.deepEqual(menuOf(doc).children.map(child => child.textContent), ['Copy', 'Paste'], 'The nearest part that provides a menu decides, before the field');
      menu.close();
      doc.selection = 'page text';
    }
    // The pane is asked what it offers after it has heard the event itself: here its own
    // listener makes the selection the menu then finds, as the emulator does on a Mac.
    {
      let selected = false;
      const undo = provideMenu(inner, () => [{ label: 'Copy', enabled: selected, run: () => {} }]);
      doc.addEventListener('contextmenu', () => { selected = true; });
      const all = doc.listenersFor('contextmenu');
      all.splice(1, 0, all.pop());
      ask(doc, inner);
      assert.deepEqual(menuOf(doc).children.map(child => child.disabled), [false], 'Copy is offered for what the pane selected on this very press');
      all.splice(1, 1);
      menu.close();
      undo();
    }
    // A provider that answers with no list leaves the choice to what is above it.
    {
      const undo = provideMenu(inner, () => undefined);
      ask(doc, inner);
      assert.deepEqual(menuOf(doc).children.map(child => child.textContent), ['Copy', 'Paste'], 'The pane above decides');
      menu.close();
      undo();
    }
    // A press inside the menu does not close it before the click arrives, and a context-menu
    // request on the menu itself is cancelled and changes nothing.
    ask(doc, inner);
    const box = menuOf(doc);
    doc.fire('pointerdown', { target: box.children[1] });
    assert.equal(menu.isOpen(), true);
    assert.equal(ask(doc, box.children[1]), 1);
    assert.equal(menuOf(doc), box);
    menu.close();
    withdraw();
    doc.selection = '';
    assert.equal(ask(doc, inner), 1);
    assert.equal(menu.isOpen(), false, 'A pane whose menu was withdrawn offers nothing');
  }

  // The shell mounts it, the terminal pane provides its own, and nothing in the shell opens
  // the native menu on purpose.
  const main = read('ui/main.js');
  assert.match(main, /^mountContextMenu\(bridge, document, \{ report \}\);$/m);
  assert.ok(main.indexOf('mountContextMenu(bridge, document') < main.indexOf('async function start()'), 'Mounted before the host is asked anything');
  // The pane's two items, read as text: Copy only with a selection in the emulator, Paste
  // until the shell has ended, each calling the pane's own function, which the keys call too.
  const shells = read('ui/widgets/shells.js');
  assert.match(shells, /provideMenu\(panel, \(\) => \[\n\s+\{ label: 'Copy', enabled: pane\.hasSelection\(\), run: \(\) => \{ pane\.copy\(\); \} \},\n\s+\{ label: 'Paste', enabled: !pane\.ended, run: \(\) => pane\.paste\(\) \},\n\s+\]\);/);
  assert.match(read('ui/terminal.js'), /hasSelection: \(\) => Boolean\(term\.getSelection\(\)\),/);
  assert.match(read('ui/shell.css'), /^\.context-menu \{ position: fixed;/m);
  // The menu shows which item has the keyboard, and draws no ring around itself.
  assert.match(read('ui/shell.css'), /^\.context-menu:focus \{ outline: none; \}$/m);
  assert.match(read('ui/shell.css'), /^\.context-menu button:hover:not\(:disabled\), \.context-menu button:focus-visible \{ background: var\(--page\); \}$/m);
}

console.log('Tauri summon: the shortcut settings section, drag reporting, the in-page context menu and the source rules for Wayland, the default shortcut and plugin order passed.');
