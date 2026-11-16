// Entry point of the new shell. It proves the path from page to host and back (issue #70) and
// hosts terminal panes (issue #74). Views, the widget manifest and lazy loading by widget arrive
// with issue #76; until then the terminal emulator is the one thing loaded on demand.
import { createBridge } from './bridge.js';
import { holdDuringDrag, mountSummon } from './summon.js';
import { createPane } from './terminal.js';

const SYSTEMS = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };

const bridge = createBridge(window);
const shell = document.querySelector('.shell');
const status = shell.querySelector('[data-status]');
const facts = shell.querySelector('[data-facts]');
const settings = shell.querySelector('[data-settings]');
const terminals = shell.querySelector('[data-terminals]');
const form = shell.querySelector('[data-launch]');
const notice = shell.querySelector('[data-notice]');
const tabs = shell.querySelector('[data-tabs]');
const panes = shell.querySelector('[data-panes]');

const message = error => (error && typeof error.message === 'string' && error.message) || String(error);
const say = text => { notice.textContent = text || ''; notice.hidden = !text; };

// The terminal emulator is the reviewed bundle in dist/vendor (licence and provenance in
// dist/vendor/THIRD-PARTY.txt). It is not copied into ui/: src-tauri/tauri.conf.json lists the
// two files beside this folder, so the app serves them as ./xterm.js and ./xterm.css. The bundle
// hands its classes over on one global, read once here and passed on as arguments.
let emulator;
const loadEmulator = () => (emulator ??= import('./xterm.js').then(() => window.OpenSesameXterm));
const observe = (element, callback) => {
  const observer = new ResizeObserver(() => requestAnimationFrame(callback));
  observer.observe(element);
  return () => observer.disconnect();
};

const open = new Map();
let count = 0;
let mac = false;

const select = id => {
  for (const [key, entry] of open) {
    const current = key === id;
    entry.tab.setAttribute('aria-selected', String(current));
    entry.tab.tabIndex = current ? 0 : -1;
    entry.panel.hidden = !current;
    if (current) { entry.pane.fit(); entry.pane.focus(); }
  }
};

const remove = async id => {
  const entry = open.get(id);
  if (!entry) return;
  open.delete(id);
  entry.item.remove();
  entry.panel.remove();
  await entry.pane.close();
  const next = [...open.keys()].pop();
  if (next) select(next);
};

// Opens a pane and its tab. `hooks` lets a caller watch the pane's bytes and its end.
const launch = async (request, hooks = {}) => {
  const { Terminal, FitAddon } = await loadEmulator();
  count += 1;
  const id = `pane-${count}-${Math.random().toString(36).slice(2, 8)}`;
  const label = request.name || (request.mode === 'ssh' ? request.host : `Shell ${count}`);

  const panel = document.createElement('div');
  panel.className = 'pane';
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-label', label);
  panes.append(panel);

  const item = document.createElement('span');
  item.className = 'tab';
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.setAttribute('role', 'tab');
  tab.textContent = label;
  tab.addEventListener('click', () => select(id));
  const closer = document.createElement('button');
  closer.type = 'button';
  closer.className = 'close';
  closer.setAttribute('aria-label', `Close ${label}`);
  closer.textContent = '×';
  closer.addEventListener('click', () => remove(id));
  item.append(tab, closer);
  tabs.append(item);

  const pane = createPane(
    { bridge, Terminal, FitAddon, Channel: window.__TAURI__.core.Channel, mac, observe },
    panel,
    { ...request, id },
    {
      onBytes: hooks.onBytes,
      onError: text => { say(text); hooks.onError?.(text); },
      onExit: () => { item.dataset.ended = 'true'; tab.textContent = `${label} (ended)`; hooks.onExit?.(); },
    },
  );
  open.set(id, { pane, tab, item, panel });
  select(id);
  try {
    const result = await pane.opened;
    if (request.mode !== 'ssh' && !request.name && result?.machine) panel.setAttribute('aria-label', `${label} on ${result.machine}`);
    return { id, pane, result, close: () => remove(id) };
  } catch (error) {
    await remove(id);
    throw error;
  }
};

form.addEventListener('submit', event => {
  event.preventDefault();
  say('');
  const data = new FormData(form);
  const host = String(data.get('host') || '').trim();
  launch({ mode: host ? 'ssh' : 'local', cwd: String(data.get('cwd') || '').trim(), host, user: String(data.get('user') || '').trim() })
    .catch(error => say(message(error)));
});

form.querySelector('[data-action="choose"]').addEventListener('click', () => {
  say('');
  bridge.request('project.chooseFolder', {}).then(result => { if (result?.path) form.elements.cwd.value = result.path; }, error => say(message(error)));
});

form.querySelector('[data-action="reveal"]').addEventListener('click', () => {
  say('');
  bridge.request('project.reveal', { path: form.elements.cwd.value.trim() }).catch(error => say(message(error)));
});

bridge.ready.then(info => {
  if (!info.available) {
    shell.dataset.state = 'unavailable';
    status.textContent = info.error || 'Open this page in the Open Sesame app to connect to this machine.';
    return;
  }
  shell.dataset.state = 'connected';
  status.textContent = 'Connected to this machine.';
  mac = info.platform === 'darwin';
  facts.querySelector('[data-fact="platform"]').textContent = SYSTEMS[info.platform] || info.platform;
  facts.querySelector('[data-fact="version"]').textContent = window.__OPEN_SESAME_VERSION__ || 'Unknown';
  facts.hidden = false;
  settings.hidden = false;
  const section = settings.querySelector('[data-summon]');
  mountSummon(bridge, {
    section,
    hint: section.querySelector('[data-summon-hint]'),
    form: section.querySelector('[data-summon-form]'),
    input: section.querySelector('#summon-shortcut'),
    message: section.querySelector('[data-summon-message]'),
    blur: section.querySelector('[data-summon-blur]'),
  });
  holdDuringDrag(bridge, document);
  terminals.hidden = false;
  // A development build started with OPEN_SESAME_SELFTEST runs the acceptance pass in
  // ui/dev/selftest.js. A release build never sets the flag.
  const selftest = window.__OPEN_SESAME_SELFTEST__;
  if (selftest) import('./dev/selftest.js').then(module => module.run({ launch, config: selftest }));
});
