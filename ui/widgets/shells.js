import { createPane } from '../terminal.js';
import { provideMenu } from '../context-menu.js';

export async function mount({surface, signal, bridge, host, info, attention}) {
  const document = surface.ownerDocument;
  surface.innerHTML = `  <section class="terminals" data-terminals aria-label="Terminals">
    <form class="launch" data-launch autocomplete="off">
      <label>Folder <input name="cwd" placeholder="Home folder" spellcheck="false" autocapitalize="off"></label>
      <button type="button" data-action="choose">Choose…</button>
      <button type="button" data-action="reveal">Show folder</button>
      <label>SSH host <input name="host" placeholder="This machine" spellcheck="false" autocapitalize="off"></label>
      <label>User <input name="user" spellcheck="false" autocapitalize="off"></label>
      <button type="submit">New shell</button>
    </form>
    <p class="notice" role="alert" data-notice hidden></p>
    <div class="tabs" role="tablist" aria-label="Open shells" data-tabs></div>
    <div class="panes" data-panes></div>
  </section>
`;
  const terminals = surface.querySelector('[data-terminals]');
  const form = surface.querySelector('[data-launch]');
  const notice = surface.querySelector('[data-notice]');
  const tabs = surface.querySelector('[data-tabs]');
  const panes = surface.querySelector('[data-panes]');
  const message = error => (error && typeof error.message === 'string' && error.message) || String(error);
  const say = text => { if (disposed || signal.aborted) return; notice.textContent = text || ''; notice.hidden = !text; };

  // The terminal emulator is the reviewed bundle in dist/vendor (licence and provenance in
  // dist/vendor/THIRD-PARTY.txt). It is not copied into ui/: src-tauri/tauri.conf.json lists the
  // two files beside this folder, so the app serves them as ./xterm.js and ./xterm.css. The bundle
  // hands its classes over on one global, read once here and passed on as arguments.
  let emulator;
  const loadEmulator = () => (emulator ??= import('../xterm.js').then(() => host.OpenSesameXterm));
  const observe = (element, callback) => {
    let frame;
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(callback); });
    observer.observe(element);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  };

  const open = new Map();
  let count = 0;
  const mac = info.platform === 'darwin';
  let disposed = false;

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
    if (disposed || signal.aborted) throw Error('This widget is off.');
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
      { bridge, Terminal, FitAddon, Channel: host.__TAURI__.core.Channel, mac, observe },
      panel,
      { ...request, id },
      {
        onBytes: hooks.onBytes,
        onError: text => { if (!disposed) say(text); hooks.onError?.(text); },
        onExit: () => {
          item.dataset.ended = 'true'; tab.textContent = `${label} (ended)`;
          // The strip says so when the person is looking elsewhere (ui/attention.js).
          if (!disposed && !attention?.showing('shells')) attention?.set('shells', {tone: 'attention', label: 'A shell ended'});
          hooks.onExit?.();
        },
      },
    );
    // The pane's own menu, in place of the native one (issue #115): the emulator keeps its
    // selection, and copy and paste go through the host as the keys do. The menu is kept by
    // the panel and goes with it.
    provideMenu(panel, () => [
      { label: 'Copy', enabled: pane.hasSelection(), run: () => { pane.copy(); } },
      { label: 'Paste', enabled: !pane.ended, run: () => pane.paste() },
    ]);
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
    bridge.request('project.chooseFolder', {}).then(result => { if (!disposed && result?.path) form.elements.cwd.value = result.path; }, error => say(message(error)));
  });

  form.querySelector('[data-action="reveal"]').addEventListener('click', () => {
    say('');
    bridge.request('project.reveal', { path: form.elements.cwd.value.trim() }).catch(error => say(message(error)));
  });

  const dispose = async () => {
    disposed = true;
    await Promise.all([...open.keys()].map(remove));
    surface.replaceChildren();
  };
  signal.addEventListener('abort', () => { disposed = true; }, {once:true});
  return {launch, dispose, command: async action => {
    if (!info.available) { say('Open this page in the Open Sesame app to connect to this machine.'); return; }
    if (action === 'selftest' && host.__OPEN_SESAME_SELFTEST__) {
      const module = await import('../dev/selftest.js');
      await module.run({launch,bridge,config:host.__OPEN_SESAME_SELFTEST__});
    } else if (action === 'new') await launch({mode:'local'});
    else form.elements.cwd.focus();
  }};
}
