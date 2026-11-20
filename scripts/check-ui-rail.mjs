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
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(name, listener) { (listeners[name] ??= []).push(listener); },
    fire(name) { for (const listener of listeners[name] ?? []) listener({}); }, ...extra};
}
function rig(answer) {
  const calls = [], subscribers = [];
  const bridge = {
    request: async (method, params) => { calls.push([method, params]); return answer(method, params); },
    subscribe: subscriber => { subscribers.push(subscriber); return () => {}; },
  };
  // Where the keyboard is: `inside` marks an element in the panel.
  const doc = {activeElement: null};
  const parts = {shell: node(), panel: node({ownerDocument: doc, contains: element => element?.inside === true}), toggle: node({focus() { doc.activeElement = this; }}), toggleLabel: node(), collapse: node(), section: node(), edge: node(), hover: node(), message: node(), blurLabel: node()};
  const changes = [];
  const rail = mountRail(bridge, parts, (status, previous) => changes.push([layout(previous), layout(status)]));
  return {rail, parts, calls, changes, doc, emit: note => { for (const subscriber of subscribers) subscriber(note); }};
}
{
  let host = {...RAIL};
  const {rail, parts, calls, changes, doc, emit} = rig((method, params) => {
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
  assert.equal(parts.toggle.attributes['aria-controls'], 'panel', 'On a rail the mark is the control that opens the panel');
  assert.equal(parts.toggle.attributes['aria-hidden'], undefined);
  assert.equal(parts.toggleLabel.textContent, 'Open the panel');
  assert.equal(parts.collapse.hidden, false);
  assert.equal(parts.section.hidden, false);
  assert.equal(parts.hover.checked, true);
  assert.equal(parts.blurLabel.textContent, 'Close the panel when it loses focus');
  // A peek comes from the host, as a message: the panel is open but not to stay.
  emit({event: CHANGED_EVENT, status: {...host, expanded: true}});
  assert.equal(parts.shell.dataset.rail, 'expanded');
  assert.equal(parts.panel.inert, false);
  assert.equal(parts.toggle.attributes['aria-expanded'], 'true');
  assert.equal(parts.toggleLabel.textContent, 'Keep the panel open', 'A peek offers to keep the panel open, not to open an open panel');
  // Clicking the mark during a peek asks the host to hold it open.
  parts.toggle.fire('click');
  await tick(); await tick();
  assert.deepEqual(calls.at(-1), ['rail.set', {expanded: true}]);
  assert.equal(parts.toggleLabel.textContent, 'Close the panel');
  // Open to stay: open() asks for nothing more, the mark and the bar's control close it.
  const before = calls.length;
  await rail.open();
  assert.equal(calls.length, before, 'An open panel is not opened again');
  // The keyboard was in the panel when it closed: it goes to the mark, not to nowhere.
  doc.activeElement = {inside: true};
  parts.collapse.fire('click');
  await tick(); await tick();
  assert.deepEqual(calls.at(-1), ['rail.set', {expanded: false}]);
  assert.equal(parts.shell.dataset.rail, 'collapsed');
  assert.equal(doc.activeElement, parts.toggle, 'Closing the panel from inside puts the keyboard on the mark');
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
  // The host closes the panel while the keyboard is in it, and while it is elsewhere.
  doc.activeElement = {inside: true};
  emit({event: CHANGED_EVENT, status: {...host, expanded: false}});
  assert.equal(doc.activeElement, parts.toggle, 'A close from the host also puts the keyboard on the mark');
  emit({event: CHANGED_EVENT, status: {...host, expanded: true}});
  const elsewhere = {inside: false};
  doc.activeElement = elsewhere;
  emit({event: CHANGED_EVENT, status: {...host, expanded: false}});
  assert.equal(doc.activeElement, elsewhere, 'The keyboard outside the panel is left where it is');
  emit({event: CHANGED_EVENT, status: {...host}});
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
  // With no rail the mark is the brand, not a disabled control that says it opened something.
  assert.equal(parts.toggle.attributes['aria-hidden'], 'true');
  assert.equal(parts.toggle.attributes['aria-expanded'], undefined);
  assert.equal(parts.toggle.attributes['aria-controls'], undefined);
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
// Safari leaves a button out of Tab unless it asks to be in it (#183), and the bar's control
// is not named like the mark that also closes the panel (#186).
for (const [tag] of page.matchAll(/<button [^>]*class="(?:rail|bar)-button[^>]*>/g)) assert(tag.includes('tabindex="0"'), `${tag} is in the Tab order in WebKit`);
assert.match(main, /button\.className = 'rail-button';[^\n]*button\.tabIndex = 0;/, 'The view buttons on the strip are in the Tab order in WebKit');
assert.match(page, /<button [^>]*data-collapse title="Close panel"[^>]*>[\s\S]*?<span class="label-hidden">Close panel<\/span>/);
// The keyboard the panel had is left on the mark when the panel closes, and every close gives
// the keyboard to another application, so the closed strip draws no ring while it is away.
assert.match(main, /addEventListener\('blur', \(\) => windowFocus\(false\)\);/);
assert.match(main, /addEventListener\('focus', \(\) => windowFocus\(true\)\);/);
assert.match(read('ui/shell.css'), /\.shell\[data-window-focus="false"\] \.rail-mark:focus-visible \{ outline: none; \}/);
assert.deepEqual([...wideViews], ['shells']);
console.log('Rail source rules: sizes, corner, event, methods, presentation flags, tokens-only colours, reduced motion and icons pass.');
