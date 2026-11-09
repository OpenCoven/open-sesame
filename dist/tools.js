'use strict';
/* Packages describe content; only this host can execute approved operations. */
(() => {
  const M = OpenSesameToolsModel, key = 'open-sesame-tools-v1', drafts = new Map();
  const accessNames = {'github.summary': 'Read connected GitHub repositories', 'feeds.headlines': 'Read saved feed headlines', 'note.save': 'Save notes to Projects', navigate: 'Open workspace views', 'link.open': 'Open web links'};
  const accessText = definition => definition.capabilities.map(name => accessNames[name]).join(', ') || 'None';
  let installed = [], ticket = 0, storageError = false, importTicket = 0;
  try { installed = M.restore(JSON.parse(localStorage.getItem(key) || '[]')); }
  catch { storageError = true; } // Keep unreadable storage intact for recovery.

  const node = (tag, text) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const dialog = node('dialog');
  dialog.className = 'tools-dialog';
  dialog.setAttribute('aria-label', 'Tools');
  const head = node('header'), close = node('button', 'Close');
  close.type = 'button';
  close.onclick = () => dialog.close();
  head.append(node('h2', 'Tools'), close);
  dialog.append(head);
  const status = node('p');
  if (storageError) status.textContent = 'Saved tool data could not be read. Original storage is preserved; installation is disabled until it is recovered.';
  status.setAttribute('role', 'status');
  const importLabel = node('label', 'Import tool JSON '), file = node('input');
  file.type = 'file';
  file.accept = '.json,application/json';
  importLabel.append(file);
  dialog.append(importLabel);
  const starters = node('div');
  for (const slug of ['repository-summary', 'feed-headlines', 'meeting-notes']) {
    button(starters, slug.replaceAll('-', ' '), async () => {
      const current = ++importTicket;
      const response = await fetch('tools/' + slug + '/tool.json');
      if (!response.ok) throw Error('Could not load the starter. Try importing its tool.json file.');
      const d = M.parse(await response.text());
      if (current === importTicket && dialog.open) preview(d);
    });
  }
  dialog.append(starters);
  const stage = node('section'), collection = node('section');
  dialog.append(status, stage, collection);
  document.getElementById('widget-panel').append(dialog);
  const launch = node('button', 'Tools · Import or create');
  launch.type = 'button';
  launch.className = 'tools-open';
  launch.onclick = () => open();
  document.getElementById('pane-plugins').prepend(launch);

  function invalidate() { ++ticket; }
  function persist(next, discardDraft) {
    if (storageError) throw Error('Saved tool data needs recovery; it has been preserved.');
    localStorage.setItem(key, JSON.stringify(next));
    installed = next;
    if (discardDraft) drafts.delete(discardDraft);
    invalidate();
    window.dispatchEvent(new Event('open-sesame-tools-changed'));
  }
  function button(host, label, fn) {
    const b = node('button', label);
    b.type = 'button';
    b.onclick = async () => {
      if (b.disabled) return;
      b.disabled = true;
      try { await fn(); }
      catch (error) { report(error.toolMessage || 'Could not complete this action. Check the connection or local storage and try again.'); }
      finally { b.disabled = false; }
    };
    host.append(b);
    return b;
  }
  function report(text) {
    status.textContent = text;
    window.dispatchEvent(new CustomEvent('open-sesame-tool-status', {detail: text}));
  }
  function fail(message) { throw Object.assign(new Error(message), {toolMessage: message}); }
  function exportTool(d) {
    const a = node('a');
    const url = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2) + '\n'], {type: 'application/json'}));
    a.href = url;
    a.download = d.id + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function renderTool(host, instance, data, live = false, origin = 'Sample data', scope = () => dialog.open, inline = false) {
    host.replaceChildren();
    const d = instance.definition;
    const fields = drafts.get(instance.id) || M.configuration(d, instance.config);
    drafts.set(instance.id, fields);
    host.append(node('h3', d.name), node('p', d.description));
    const access = node('small', (live ? '' : M.pages[M.page(d)] + ' tab · ') + 'Access: ' + accessText(d));
    const sourceLabel = node('p', d.source ? origin : live ? 'Local form · actions run only when pressed.' : 'Sample form · actions disabled.');
    sourceLabel.hidden = inline && !d.source;
    host.append(access, sourceLabel);
    const edit = (field, input) => {
      fields[field] = input.value;
      invalidate();
      if (d.source) sourceLabel.textContent = 'Configuration changed · load data again.';
    };
    for (const c of d.components) {
      const block = node('section');
      block.append(node('strong', c.label));
      if (c.type === 'input') {
        const label = node('label', c.label), input = node('textarea');
        input.value = fields[c.field];
        input.maxLength = 2000;
        input.oninput = () => edit(c.field, input);
        label.append(input);
        block.replaceChildren(label);
      } else if (c.type === 'list') {
        const ul = node('ul'), entries = c.items || data.entries || [];
        for (const text of entries.slice(0, 50)) ul.append(node('li', String(text)));
        if (!entries.length) block.append(node('p', 'No items to show.'));
        block.append(ul);
      } else block.append(node('p', String(c.text ?? data[c.field] ?? '')));
      host.append(block);
    }
    for (const [k, v] of Object.entries(d.config)) {
      if (d.components.some(c => c.type === 'input' && c.field === k)) continue;
      const label = node('label', v.label), input = node('input');
      input.value = fields[k];
      input.maxLength = 2000;
      input.oninput = () => edit(k, input);
      label.append(input);
      host.append(label);
    }
    const controls = node('div'); controls.className = 'tool-actions'; host.append(controls);
    if (live) {
      button(controls, 'Save configuration', () => {
        persist(installed.map(x => x.id === instance.id ? {...x, config: {...fields}} : x));
        report('Configuration saved.');
      });
      if (d.source) button(controls, d.source.operation === 'feeds.headlines' ? 'Load saved headlines' : 'Load live data', async () => {
        const current = ++ticket, config = {...fields};
        const valid = () => current === ticket && scope() && installed.some(x => x.id === instance.id && x.definition === d);
        report('Loading…');
        try {
          const result = await load(d.source.operation, config, valid);
          if (!valid()) return;
          renderTool(host, instance, result, true, d.source.operation === 'feeds.headlines' ? 'Saved Reader data · refresh feeds in Reader.' : 'GitHub data · refresh is manual.', scope, inline);
          report('Loaded. No background refresh.');
        } catch (error) {
          if (valid()) report(error.toolMessage || 'Could not load data. Check the connection in Widgets or Reader, then retry.');
        }
      });
    }
    for (const a of d.actions) {
      const b = button(controls, a.label, () => { if (scope()) action(a, fields); });
      b.disabled = !live;
    }
  }
  async function load(op, config, valid) {
    if (op === 'github.summary') {
      const s = await openSesameBridge.request('github.status');
      if (!valid()) return null;
      if (!s.authenticated || !s.repositories.includes(config.repository)) fail('Choose a repository already connected in Plugins → GitHub.');
      const d = await openSesameBridge.request('github.snapshot', {repository: config.repository});
      if (d.error || Object.values(d.sections || {}).some(section => section.error)) fail('GitHub could not load every section. Check the connection and retry.');
      return {title: d.repository, count: d.sections?.pulls?.entries?.length || 0, entries: Object.values(d.sections || {}).flatMap(section => section.entries || []).map(e => e.title)};
    }
    if (op === 'feeds.headlines') {
      const saved = window.openSesameReading.handoff();
      const feed = saved.feeds.find(f => f.id === config.feed || f.url === config.feed);
      if (!feed) fail('Choose a feed already connected in Reader.');
      const entries = saved.entries.filter(e => e.feedId === feed.id);
      return {title: feed.title, count: entries.length, entries: entries.map(e => e.title || e.url)};
    }
    fail('This source is not supported.');
  }
  function action(a, fields) {
    if (a.operation === 'navigate') { dialog.close(); changeScenario(a.value); }
    else if (a.operation === 'link.open') {
      if (M.safeUrl(a.value)) window.open(a.value, '_blank', 'noopener,noreferrer');
    } else if (a.operation === 'note.save') {
      const text = Object.hasOwn(fields, a.value) ? fields[a.value] : a.value;
      if (!text.trim()) fail('Enter some notes before saving.');
      if (items.length >= 300 || activeItems().length >= 30) fail('Projects is full. Archive or remove an item before saving.');
      const lines = text.split(/\r?\n/), multiline = lines.length > 1;
      const title = multiline ? lines[0].trim() || 'Untitled note' : '';
      const item = {id: newId(), kind: 'note', text: multiline ? title : text, title, body: multiline ? lines.slice(1).join('\n').trim() : '', url: '', done: false, projectId: ''};
      items.push(item);
      if (!saveItems()) { items.pop(); fail('Could not save. Your draft is still available.'); }
      renderItems();
      report('Note saved.');
    } else fail('This action is not supported.');
  }
  function replaceInstance(old, definition) {
    persist(installed.map(x => x.id === old.id ? M.replace(x, definition) : x), old.id);
    stage.replaceChildren();
    draw();
  }
  function preview(d) {
    invalidate();
    stage.replaceChildren();
    const temp = M.instance(d), view = node('div');
    stage.append(node('h3', 'Fixture preview · actions disabled'), view);
    renderTool(view, temp, d.fixtures);
    drafts.delete(temp.id);
    button(stage, 'Install as a new instance', () => {
      if (installed.length >= 100) fail('Remove an instance before installing another tool.');
      const instance = M.instance(d);
      persist([...installed, instance]);
      stage.replaceChildren();
      draw();
      report('Installed in ' + M.pages[M.page(d)] + ' as a new tab.');
    });
    for (const old of installed.filter(x => x.definition.id === d.id)) button(stage, 'Replace ' + old.definition.name, () => {
      const message = 'Replace this tool definition and retain saved configuration? Access: ' + accessText(d) + '. Unsaved edits for this instance will be discarded.';
      if (confirm(message)) replaceInstance(old, d);
    });
    button(stage, 'Export definition', () => exportTool(d));
    status.textContent = 'Validated. Preview uses sample data only.';
  }
  file.onchange = async () => {
    const current = ++importTicket;
    invalidate();
    stage.replaceChildren();
    try {
      const f = file.files[0];
      if (!f) return;
      if (f.size > 100000) throw Error('Use a JSON package under 100 KB.');
      const d = M.parse(await f.text());
      if (current === importTicket && dialog.open) preview(d);
    } catch (error) {
      if (current === importTicket) status.textContent = error.message;
    } finally { file.value = ''; }
  };
  function draw() {
    collection.replaceChildren(node('h3', 'Installed tools'));
    for (const x of installed) {
      const details = node('details'), summary = node('summary', x.definition.name), view = node('article');
      details.append(summary, view);
      button(details, 'Open in ' + M.pages[M.page(x.definition)], () => { dialog.close(); window.OpenSesamePageWidgets?.open(x.id); });
      details.ontoggle = () => {
        invalidate();
        if (details.open) renderTool(view, x, x.definition.fixtures, true);
      };
      button(details, 'Export definition', () => exportTool(x.definition));
      if (x.previous) button(details, 'Roll back definition', () => {
        if (confirm('Restore the previous definition? Access: ' + accessText(x.previous) + '. Unsaved edits will be discarded.')) replaceInstance(x, x.previous);
      });
      button(details, 'Remove instance', () => {
        if (!confirm('Remove this tool instance?')) return;
        persist(installed.filter(v => v.id !== x.id));
        drafts.delete(x.id);
        draw();
      });
      details.dataset.instance = x.id;
      details.open = !!x.pinned;
      if (x.definition.presentations.includes('card')) button(details, x.pinned ? 'Unpin card' : 'Pin card', () => {
        persist(installed.map(v => v.id === x.id ? {...v, pinned: !v.pinned} : v));
        draw();
      });
      collection.append(details);
    }
  }
  function open(id) {
    if (id && window.OpenSesamePageWidgets) { if (dialog.open) dialog.close(); window.OpenSesamePageWidgets.open(id); return; }
    invalidate();
    changeScenario('plugins');
    if (!dialog.open) dialog.showModal();
    draw();
    if (id) {
      const detail = [...collection.querySelectorAll('details')].find(n => n.dataset.instance === id);
      if (detail) { detail.open = true; detail.scrollIntoView({block: 'nearest'}); }
    }
  }
  function catalog() {
    const roots = window.OpenSesameCaptureCatalog.roots, index = roots.findIndex(x => x.id === 'installed-tools');
    if (index >= 0) roots.splice(index, 1);
    roots.push({id: 'installed-tools', label: 'Tools', description: 'Import and open reusable tools', icon: 'plugins', group: 'open', children: [
      {id: 'tools-open', kind: 'destination', value: '/tools', label: 'Manage tools', description: 'Import and preview tools', icon: 'plugins', group: 'open'},
      ...installed.filter(x => x.definition.presentations.includes('launcher')).map(x => ({id: 'tool-' + x.id, kind: 'destination', value: '/tool ' + x.id, label: x.definition.name, description: x.definition.description, icon: 'plugins', group: 'open'}))
    ]});
  }
  dialog.addEventListener('keydown', event => event.stopPropagation());
  const closed = () => { invalidate(); ++importTicket; };
  dialog.addEventListener('close', closed);
  dialog.addEventListener('cancel', closed);
  window.addEventListener('open-sesame-view-changed', () => { if (state.scenario !== 'plugins' && dialog.open) dialog.close(); });
  window.addEventListener('open-sesame-layout', () => { if (!state.expanded && dialog.open) dialog.close(); });
  window.addEventListener('open-sesame-tools-changed', catalog);
  catalog();
  window.OpenSesameTools = {open, list: () => installed.map(x => ({id: x.id, name: x.definition.name, page: M.page(x.definition), definition: x.definition})), mount(id, host, scope) {
    const instance = installed.find(x => x.id === id);
    if (!instance) return () => {};
    renderTool(host, instance, {}, true, 'Not loaded · choose Load to read your connected source.', scope, true);
    return invalidate;
  }, invalidate, get active() { return dialog.open; }, handoff(data) {
    if (data) {
      invalidate();
      drafts.clear();
      for (const [id, fields] of data) {
        const instance = installed.find(x => x.id === id);
        if (instance) drafts.set(id, M.configuration(instance.definition, fields));
      }
      return;
    }
    return [...drafts].map(([id, fields]) => [id, {...fields}]);
  }};
})();
