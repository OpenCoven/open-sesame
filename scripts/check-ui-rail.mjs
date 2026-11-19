// The companion rail's page side, in Node against stand-ins, and the facts the page and the host
// must agree on, read from source. No window is opened: where the rail is placed, which display
// it follows and whether a resting pointer opens it are the host's (cargo test for the
// decisions, a launched application for the window).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const root = process.cwd();
const read = file => readFileSync(path.join(root, file), 'utf8');
const load = file => import(pathToFileURL(path.join(root, file)));
const tick = () => new Promise(resolve => setImmediate(resolve));

const {CHANGED_EVENT, read: readStatus, layout, mountRail} = await load('ui/rail.js');
const {createAttention, summary, watchFocus} = await load('ui/attention.js');
const {FOCUS_KEY, idle, start} = await load('ui/focus-model.js');
const {wideViews, widgets} = await load('ui/manifest.js');

// 1. What the host says, reduced to what the page draws.
const RAIL = {presentation: 'rail', shown: true, expanded: false, held: false, wide: false, edge: 'right', hover: true};
assert.equal(readStatus(RAIL).presentation, 'rail');
assert.equal(layout(readStatus(RAIL)), 'collapsed');
assert.equal(layout(readStatus({...RAIL, expanded: true})), 'expanded');
assert.equal(layout(readStatus({...RAIL, expanded: true, wide: true})), 'wide');
assert.equal(layout(readStatus({...RAIL, wide: true})), 'collapsed', 'A closed rail is the strip whatever width the panel will have');
// Anything that is not a rail's status is the ordinary window: the whole panel, all the time.
for (const other of [null, undefined, true, 'rail', [], {}, {presentation: 'window', expanded: false}, {presentation: 'panel'}]) {
  const status = readStatus(other);
  assert.deepEqual([status.presentation, status.expanded, status.held, layout(status)], ['window', true, true, 'expanded']);
}
assert.equal(readStatus({...RAIL, edge: 'top'}).edge, 'right', 'An edge the page does not know is the default');
assert.equal(readStatus({...RAIL, edge: 'left'}).edge, 'left');

// 2. The page follows the host and never decides the window's state itself.
function node(extra = {}) {
  const listeners = {};
  return {dataset: {}, attributes: {}, hidden: false, textContent: '', value: '', checked: false, disabled: false, title: '', inert: false,
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, listener) { (listeners[name] ??= []).push(listener); },
    fire(name) { for (const listener of listeners[name] ?? []) listener({}); }, ...extra};
}
function rig(answer) {
  const calls = [], subscribers = [];
  const bridge = {
    request: async (method, params) => { calls.push([method, params]); return answer(method, params); },
    subscribe: subscriber => { subscribers.push(subscriber); return () => {}; },
  };
  const parts = {shell: node(), panel: node(), toggle: node(), toggleLabel: node(), collapse: node(), section: node(), edge: node(), hover: node(), message: node(), blurLabel: node()};
  const changes = [];
  const rail = mountRail(bridge, parts, (status, previous) => changes.push([layout(previous), layout(status)]));
  return {rail, parts, calls, changes, emit: note => { for (const subscriber of subscribers) subscriber(note); }};
}
{
  let host = {...RAIL};
  const {rail, parts, calls, changes, emit} = rig((method, params) => {
    if (method === 'rail.set') host = {...host, ...params, held: params.expanded ?? host.held};
    return host;
  });
  // Before the host answers the page is the ordinary window, and the caller is not told.
  assert.equal(parts.shell.dataset.presentation, 'window');
  assert.deepEqual(changes, []);
  await rail.ready;
  assert.deepEqual([parts.shell.dataset.presentation, parts.shell.dataset.rail, parts.shell.dataset.edge], ['rail', 'collapsed', 'right']);
  assert.equal(parts.panel.inert, true, 'The closed panel is out of the tab order');
  assert.equal(parts.toggle.attributes['aria-expanded'], 'false');
  assert.equal(parts.toggleLabel.textContent, 'Open the panel');
  assert.equal(parts.collapse.hidden, false);
  assert.equal(parts.section.hidden, false);
  assert.equal(parts.hover.checked, true);
  assert.equal(parts.blurLabel.textContent, 'Close the panel when it loses focus');
  // A peek comes from the host, as a message: the panel is open but not to stay.
  emit({event: CHANGED_EVENT, status: {...host, expanded: true}});
  assert.equal(parts.shell.dataset.rail, 'expanded');
  assert.equal(parts.panel.inert, false);
  assert.equal(parts.toggleLabel.textContent, 'Open the panel', 'A peek still offers to open the panel to stay');
  // Clicking the mark during a peek asks the host to hold it open.
  parts.toggle.fire('click');
  await tick(); await tick();
  assert.deepEqual(calls.at(-1), ['rail.set', {expanded: true}]);
  assert.equal(parts.toggleLabel.textContent, 'Close the panel');
  // Open to stay: open() asks for nothing more, the mark and the bar's control close it.
  const before = calls.length;
  await rail.open();
  assert.equal(calls.length, before, 'An open panel is not opened again');
  parts.collapse.fire('click');
  await tick(); await tick();
  assert.deepEqual(calls.at(-1), ['rail.set', {expanded: false}]);
  assert.equal(parts.shell.dataset.rail, 'collapsed');
  await rail.collapse();
  assert.deepEqual(calls.at(-1), ['rail.set', {expanded: false}], 'A closed panel is not closed again');
  // Width, edge and hover go to the host one field at a time and are drawn from its answer.
  await rail.setWide(true);
  assert.deepEqual(calls.at(-1), ['rail.set', {wide: true}]);
  assert.equal(parts.shell.dataset.rail, 'collapsed');
  await rail.open();
  assert.equal(parts.shell.dataset.rail, 'wide');
  parts.edge.value = 'left'; parts.edge.fire('change');
  await tick(); await tick();
  assert.deepEqual(calls.at(-1), ['rail.set', {edge: 'left'}]);
  assert.equal(parts.shell.dataset.edge, 'left');
  parts.hover.checked = false; parts.hover.fire('change');
  await tick(); await tick();
  assert.deepEqual(calls.at(-1), ['rail.set', {hover: false}]);
  assert(changes.some(([from, to]) => from === 'collapsed' && to === 'expanded') && changes.some(([from, to]) => from === 'expanded' && to === 'collapsed'));
  // A message that is not a status changes nothing.
  emit({event: CHANGED_EVENT, status: 'open'}); emit({event: 'auth.changed', status: {expanded: false}});
  assert.equal(parts.shell.dataset.rail, 'wide');
}
// A refusal leaves the page showing what the host still has, with the reason.
{
  const {rail, parts} = rig(method => { if (method === 'rail.set') throw Error('The rail setting could not be saved.'); return {...RAIL, expanded: true, held: true}; });
  await rail.ready;
  parts.edge.value = 'left'; parts.edge.fire('change');
  await tick(); await tick(); await tick();
  assert.equal(parts.edge.value, 'right', 'The field goes back to what the host has');
  assert.equal(parts.message.textContent, 'The rail setting could not be saved.');
  assert.equal(parts.message.dataset.warn, 'true');
}
// The ordinary window: a host that reports it, a host with no rail methods, and a stand-in that
// answers `true` to everything all leave the page as the whole panel and send no change.
for (const answer of [() => ({presentation: 'window', shown: true, expanded: true, held: true, wide: false, edge: 'right', hover: true}), () => { throw Error('Unsupported desktop action.'); }, () => true]) {
  const {rail, parts, calls} = rig(answer);
  await rail.ready;
  assert.deepEqual([parts.shell.dataset.presentation, parts.shell.dataset.rail], ['window', 'expanded']);
  assert.equal(parts.panel.inert, false);
  assert.equal(parts.toggle.disabled, true);
  assert.equal(parts.collapse.hidden, true);
  assert.equal(parts.section.hidden, true);
  assert.equal(parts.blurLabel.textContent, 'Hide the window when it loses focus');
  await rail.open(); await rail.collapse(); await rail.setWide(true);
  parts.toggle.fire('click'); parts.collapse.fire('click'); parts.edge.fire('change'); parts.hover.fire('change');
  await tick();
  assert(!calls.some(([method]) => method === 'rail.set'), 'The ordinary window is never asked to change');
}
console.log('Rail page: status reading, layouts, host-led open and close, width, edge and hover, refusals and the ordinary window pass.');

// 3. Attention: what the strip says about each view.
{
  const attention = createAttention();
  const seen = [];
  attention.subscribe(marks => seen.push([...marks.keys()].join(',')));
  attention.set('focus', {tone: 'active', label: 'A session is running'});
  attention.set('focus', {tone: 'active', label: 'A session is running'});
  assert.deepEqual(seen, ['', 'focus'], 'The same mark twice is one change');
  attention.seen('focus');
  assert.equal(attention.get('focus').tone, 'active', 'Looking at a view does not end what is running there');
  attention.set('shells', {tone: 'attention', label: 'A shell ended'});
  const names = new Map(widgets.map(widget => [widget.id, widget.name]));
  assert.deepEqual(summary(attention.snapshot(), names), {tone: 'attention', label: 'Focus: A session is running. Shells: A shell ended'});
  attention.seen('shells');
  assert.equal(attention.get('shells'), null, 'What needed the person is cleared when they open the view');
  assert.equal(summary(attention.snapshot(), names).tone, 'active');
  attention.set('focus', {tone: 'loud', label: 'x'});
  assert.equal(attention.get('focus'), null, 'An unknown tone is no mark');
  assert.deepEqual(summary(attention.snapshot(), names), {tone: null, label: ''});
}
// Focus is followed from the stored session: running, then complete at the deadline with no
// second read, and a finished session the person has looked at does not ask again.
{
  let now = 1_000_000, stored = start(idle(25), now), showing = false, reads = 0;
  const timers = {pending: null, setTimeout(callback, delay) { this.pending = {callback, delay}; return 1; }, clearTimeout() { this.pending = null; }};
  const bridge = {request: async () => { reads += 1; return {settings: {[FOCUS_KEY]: {...stored}}}; }};
  const attention = createAttention();
  const watch = watchFocus({bridge, attention, showing: () => showing, now: () => now, timers});
  await watch.refresh();
  assert.deepEqual(attention.get('focus'), {tone: 'active', label: 'A session is running'});
  assert.equal(timers.pending.delay, 25 * 60_000);
  now += 25 * 60_000;
  timers.pending.callback();
  assert.deepEqual(attention.get('focus'), {tone: 'attention', label: 'Session complete'});
  assert.equal(reads, 1, 'The deadline is a timer, not another request');
  showing = true;
  await watch.refresh();
  assert.equal(attention.get('focus'), null);
  showing = false;
  await watch.refresh();
  assert.equal(attention.get('focus'), null, 'A session already looked at stays quiet');
  // A setting this version cannot read, or a host that fails, leaves the mark as it was.
  attention.set('focus', {tone: 'active', label: 'kept'});
  stored = {version: 99};
  await watch.refresh();
  assert.equal(attention.get('focus').label, 'kept');
  watch.stop();
  stored = start(idle(25), now);
  await watch.refresh();
  assert.equal(attention.get('focus').label, 'kept', 'A stopped watcher changes nothing');
}
console.log('Attention: marks, the strip summary and the focus session watcher pass.');

// 4. What the page and the host must agree on, read from source.
const rust = read('src-tauri/src/rail.rs');
const tokens = read('ui/tokens.css');
const shell = read('ui/shell.css');
const page = read('ui/index.html');
const main = read('ui/main.js');
const constant = name => Number(rust.match(new RegExp(`pub const ${name}: f64 = ([0-9.]+);`))[1]);
const token = name => Number(tokens.match(new RegExp(`--${name}: ([0-9]+)px;`))[1]);
assert.equal(constant('COLLAPSED_WIDTH'), token('rail-width'), 'The strip is as wide as the closed window');
assert.equal(constant('COLLAPSED_HEIGHT'), token('rail-height'), 'The strip is as tall as the closed window, so its buttons do not move when the panel opens');
const boundary = Number(shell.match(/@media \(max-width: ([0-9]+)px\) \{\n  \.panel \{ display: none; \}/)[1]);
assert(boundary > constant('COLLAPSED_WIDTH') && boundary < constant('EXPANDED_WIDTH'), 'The panel is drawn at every open width and never at the strip width');
assert.equal(constant('CORNER_RADIUS'), token('radius-window'), 'The page and the macOS panel cut the same corner');
assert.match(rust, new RegExp(`pub const CHANGED_EVENT: &str = "${CHANGED_EVENT}";`));
const methods = rust.match(/pub const METHODS: &\[&str\] = &\[([^\]]+)\];/)[1].match(/"[^"]+"/g).map(name => name.slice(1, -1));
assert.deepEqual(methods, ['rail.status', 'rail.set']);
const gate = read('crates/core/src/gate.rs');
for (const method of methods) assert(gate.includes(`"${method}"`), `${method} is admitted by the gate`);
for (const [, method] of read('ui/rail.js').matchAll(/bridge\.request\('([^']+)'/g)) assert(methods.includes(method), `The page asks the rail only for its own methods, not ${method}`);
// The page is handed the presentation before any script runs and never writes it.
const window = read('src-tauri/src/window.rs');
for (const name of ['__OPEN_SESAME_PRESENTATION__', '__OPEN_SESAME_SURFACE__']) assert(window.includes(`'${name}'`), `The host defines ${name}`);
assert(main.includes('window.__OPEN_SESAME_SURFACE__'));
// Motion is decoration: one rule turns all of it off for a person who asked for less.
assert.match(tokens, /@media \(prefers-reduced-motion: reduce\) \{\n  :root \{ --quick: 0ms; --smooth: 0ms; \}\n  \*, \*::before, \*::after \{ animation: none !important; transition: none !important;/);
for (const file of ['ui/shell.css', 'ui/widgets/views.css', 'ui/widgets/shells.css', 'ui/widgets/declarative.css']) {
  const text = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
  assert(!/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(text), `${file} takes its colours from tokens.css`);
  // The audit's oldest engine (docs/ui-shell.md) has neither; a rule that names one is dropped whole there.
  assert(!/color-mix\(|:has\(|@container|@layer/.test(text), `${file} uses nothing newer than the shell's engine baseline`);
  for (const [, duration] of text.matchAll(/(?:animation|transition):[^;]*?\b([0-9.]+m?s)\b/g)) assert.fail(`${file} names a duration (${duration}) outside tokens.css; use --quick or --smooth so reduced motion reaches it`);
}
assert.match(tokens, /@media \(prefers-color-scheme: light\)/, 'Dark first, with a light theme for a system set to light');
// Every view has an icon in the sprite, and the wide views are views.
for (const widget of widgets) assert(page.includes(`<symbol id="icon-${widget.id}"`), `${widget.id} has an icon`);
for (const id of wideViews) assert(widgets.some(widget => widget.id === id));
assert.deepEqual([...wideViews], ['shells']);
console.log('Rail source rules: sizes, corner, event, methods, presentation flags, tokens-only colours, reduced motion and icons pass.');

// 5. Contrast in both themes, from the token values (WCAG 2.x relative luminance). A translucent
// token is laid over what it sits on first. The notice is the shell's only error channel (#184),
// a field's edge is its boundary as a control (#185, 1.4.11) and a placeholder says what an empty
// field does (#168).
const themes = (() => {
  const values = block => Object.fromEntries([...block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
  const dark = values(tokens.match(/^:root \{([\s\S]*?)\n\}/m)[1]);
  const light = {...dark, ...values(tokens.match(/@media \(prefers-color-scheme: light\) \{\s*:root \{([\s\S]*?)\}\s*\}/)[1])};
  return {dark, light};
})();
const colour = (theme, value) => {
  const reference = value.match(/^var\((--[a-z0-9-]+)\)$/);
  if (reference) return colour(theme, theme[reference[1]]);
  if (/^--/.test(value)) return colour(theme, theme[value]);
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map(at => parseInt(hex[1].slice(at, at + 2), 16)).concat(1);
  const rgb = value.match(/^rgb\((\d+) (\d+) (\d+)(?: \/ ([0-9.]+))?\)$/);
  assert(rgb, `${value} is a colour the contrast check can read`);
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])];
};
const over = ([r, g, b, a], [R, G, B]) => [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a), 1];
const luminance = rgb => {
  const [r, g, b] = rgb.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const fieldRule = tokens.match(/^input, select, textarea \{([\s\S]*?)\n\}/m)[1];
const fieldBorder = fieldRule.match(/border: 1px solid (var\(--[a-z0-9-]+\));/)[1];
const fieldBackground = fieldRule.match(/background: (var\(--[a-z0-9-]+\));/)[1];
const placeholder = tokens.match(/input::placeholder, textarea::placeholder \{ color: (var\(--[a-z0-9-]+\)); \}/)[1];
const contrast = {}, shortfalls = [];
// Every shortfall is listed before the check fails, so one run names them all.
const note = (pass, message) => { if (!pass) shortfalls.push(message); };
for (const [name, theme] of Object.entries(themes)) {
  const surface = colour(theme, '--surface');
  const wash = over(colour(theme, '--warn-wash'), surface);
  contrast[name] = {
    notice: ratio(over(colour(theme, '--warn'), wash), wash),
    // The rail's material surface (--surface-tint) lets the desktop show through, so it is measured over a black, a mid-grey and a white backdrop.
    fieldEdge: Math.min(...[...['--surface', '--raised'].map(back => colour(theme, back)), ...[[0, 0, 0, 1], [128, 128, 128, 1], [255, 255, 255, 1]].map(backdrop => over(colour(theme, '--surface-tint'), backdrop))].map(back => ratio(over(colour(theme, fieldBorder), back), back))),
    placeholder: ratio(over(colour(theme, placeholder), colour(theme, fieldBackground)), colour(theme, fieldBackground)),
  };
  note(contrast[name].notice >= 4.5, `${name}: the notice's text reaches 4.5:1 on its wash (${contrast[name].notice.toFixed(2)})`);
  note(contrast[name].fieldEdge >= 3, `${name}: a field's border reaches 3:1 against the panel and the material surface (${contrast[name].fieldEdge.toFixed(2)})`);
  note(contrast[name].placeholder >= 4.5, `${name}: placeholder text reaches 4.5:1 in its field (${contrast[name].placeholder.toFixed(2)})`);
}
// Pointing at a field makes its edge stronger, never weaker.
const hoverBorder = tokens.match(/input:hover, select:hover, textarea:hover \{ border-color: (var\(--[a-z0-9-]+\)); \}/)[1];
for (const [name, theme] of Object.entries(themes)) {
  const surface = colour(theme, '--surface');
  note(ratio(over(colour(theme, hoverBorder), surface), surface) > ratio(over(colour(theme, fieldBorder), surface), surface), `${name}: a hovered field's edge is stronger than at rest`);
}
assert.deepEqual(shortfalls, [], 'Every measured pair reaches its contrast');
console.log(`Contrast: notice, field edge and placeholder pass in both themes (${Object.entries(contrast).map(([name, value]) => `${name} ${Object.entries(value).map(([part, n]) => `${part} ${n.toFixed(2)}`).join(', ')}`).join('; ')}).`);
