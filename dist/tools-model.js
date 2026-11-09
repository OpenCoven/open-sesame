'use strict';
/* Shared by the browser, CLI and checks. Keep tools-schema.json in sync. */
(() => {
  const pages = Object.freeze({focus: 'Focus', media: 'Media', projects: 'Projects', console: 'Console', reader: 'Reader', live: 'Live', widgets: 'Widgets'});
  const page = definition => definition.schemaVersion === 2 ? definition.page : 'widgets';
  const operations = ['github.summary', 'feeds.headlines', 'note.save', 'navigate', 'link.open'];
  const plain = x => x && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
  const text = (x, n = 2000) => typeof x === 'string' && x.length > 0 && x.length <= n;
  const id = x => typeof x === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(x);
  const safeUrl = x => {
    try { const u = new URL(x); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password; }
    catch { return false; }
  };
  function validate(d) {
    const errors = [], err = (path, message) => errors.push(path + ': ' + message);
    const keys = (value, allowed, path) => {
      if (!plain(value)) { err(path, 'Expected an object'); return false; }
      for (const key of Object.keys(value)) if (!allowed.includes(key)) err(path + '.' + key, 'Unknown field');
      return true;
    };
    const op = (value, path) => {
      if (!operations.includes(value) || !(Array.isArray(d.capabilities) && d.capabilities.includes(value))) err(path, 'Declare an approved capability');
    };
    if (!keys(d, ['schemaVersion', ...(d.schemaVersion === 2 ? ['page'] : []), 'id', 'version', 'name', 'description', 'author', 'license', 'config', 'capabilities', 'source', 'components', 'actions', 'presentations', 'fixtures'], 'tool')) return errors;
    if (![1, 2].includes(d.schemaVersion)) err('schemaVersion', 'Use version 1 or 2');
    if (d.schemaVersion === 2 && !Object.hasOwn(pages, d.page)) err('page', 'Declare focus, media, projects, console, reader, live or widgets');
    if (!id(d.id)) err('id', 'Use a lowercase slug');
    if (typeof d.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(d.version)) err('version', 'Use major.minor.patch');
    for (const k of ['name', 'description', 'author', 'license']) if (!text(d[k], 500)) err(k, 'Required text, at most 500 characters');
    if (!Array.isArray(d.capabilities) || d.capabilities.some(v => !operations.includes(v))) err('capabilities', 'Use approved operations');
    if (!Array.isArray(d.presentations) || !d.presentations.length || d.presentations.some(v => !['launcher', 'card', 'panel'].includes(v))) err('presentations', 'Use launcher, card or panel');
    if (keys(d.config, Object.keys(d.config || {}), 'config')) {
      if (Object.keys(d.config).length > 12) err('config', 'At most 12 fields');
      for (const [k, v] of Object.entries(d.config)) {
        if (!id(k)) err('config.' + k, 'Use a lowercase slug');
        if (keys(v, ['label', 'default'], 'config.' + k) && (!text(v.label, 100) || typeof v.default !== 'string' || v.default.length > 2000)) err('config.' + k, 'Provide label and text default');
      }
    }
    if (d.source !== null && keys(d.source, ['operation'], 'source')) {
      op(d.source.operation, 'source.operation');
      if (!['github.summary', 'feeds.headlines'].includes(d.source.operation)) err('source', 'Use a read operation');
    }
    if (d.source?.operation === 'github.summary' && !Object.hasOwn(d.config || {}, 'repository')) err('config.repository', 'Required by github.summary');
    if (d.source?.operation === 'feeds.headlines' && !Object.hasOwn(d.config || {}, 'feed')) err('config.feed', 'Required by feeds.headlines');
    if (!Array.isArray(d.components) || !d.components.length || d.components.length > 20) err('components', 'Provide 1–20 components');
    else d.components.forEach((c, i) => {
      const p = 'components.' + i;
      if (!keys(c, ['type', 'label', 'text', 'field', 'items'], p)) return;
      if (!['text', 'metric', 'list', 'input'].includes(c.type)) err(p + '.type', 'Use text, metric, list or input');
      if (!text(c.label, 200)) err(p + '.label', 'Provide a label');
      if (c.text !== undefined && !text(c.text)) err(p + '.text', 'Expected text');
      if (c.type === 'input' && c.field === undefined) err(p + '.field', 'Input requires a configuration field');
      if (['text', 'metric'].includes(c.type) && c.text === undefined && c.field === undefined) err(p, 'Provide literal text or a data field');
      if (c.type === 'list' && c.field !== undefined) err(p + '.field', 'Lists use entries or literal items');
      if (c.field !== undefined && (!id(c.field) || c.type === 'input' && !Object.hasOwn(d.config || {}, c.field))) err(p + '.field', 'Use a known configuration field');
      if (c.items !== undefined && (!Array.isArray(c.items) || c.items.length > 50 || c.items.some(x => !text(x)))) err(p + '.items', 'Use at most 50 text items');
    });
    if (!Array.isArray(d.actions) || d.actions.length > 8) err('actions', 'Use at most eight actions');
    else d.actions.forEach((a, i) => {
      const p = 'actions.' + i;
      if (!keys(a, ['label', 'operation', 'value'], p)) return;
      if (!text(a.label, 100)) err(p + '.label', 'Provide a label');
      op(a.operation, p + '.operation');
      if (!['navigate', 'link.open', 'note.save'].includes(a.operation)) err(p, 'Use an action operation');
      if (typeof a.value !== 'string' || a.value.length > 2000) err(p + '.value', 'Provide text');
      if (a.operation === 'link.open' && !safeUrl(a.value)) err(p + '.value', 'Use an HTTP(S) URL');
      if (a.operation === 'navigate' && !['items', 'reading', 'plugins', 'focus', 'familiars'].includes(a.value)) err(p + '.value', 'Unknown destination');
    });
    if (keys(d.fixtures, ['title', 'count', 'entries'], 'fixtures') && (!text(d.fixtures.title, 500) || !Number.isFinite(d.fixtures.count) || !Array.isArray(d.fixtures.entries) || d.fixtures.entries.length > 50 || d.fixtures.entries.some(x => !text(x)))) err('fixtures', 'Provide title, numeric count and at most 50 text entries');
    return errors;
  }
  function parse(raw) {
    if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > 100000) throw Error('Package must be JSON under 100 KB');
    const d = JSON.parse(raw), errors = validate(d);
    if (errors.length) throw Error(errors.join('\n'));
    return d;
  }
  function configuration(definition, values = {}) {
    return Object.fromEntries(Object.entries(definition.config).map(([k, v]) => [k, typeof values[k] === 'string' && values[k].length <= 2000 ? values[k] : v.default]));
  }
  function restore(raw) {
    if (!Array.isArray(raw) || raw.length > 100) throw Error('Invalid saved tools');
    const seen = new Set();
    return raw.map(x => {
      if (!plain(x) || !text(x.id, 100) || seen.has(x.id) || !plain(x.config)) throw Error('Invalid saved instance');
      if (x.active !== undefined && typeof x.active !== 'boolean') throw Error('Invalid saved activation');
      seen.add(x.id);
      const definition = parse(JSON.stringify(x.definition)), previous = x.previous ? parse(JSON.stringify(x.previous)) : null;
      return {id: x.id, definition, previous, config: configuration(definition, x.config), pinned: x.pinned === true, active: x.active !== false};
    });
  }
  function instance(definition) {
    return {id: globalThis.crypto.randomUUID(), definition, config: configuration(definition), previous: null};
  }
  function replace(old, definition) {
    return {...old, previous: old.definition, definition, config: configuration(definition, old.config)};
  }
  function rollback(old) {
    if (!old.previous) throw Error('No previous definition');
    return replace(old, old.previous);
  }
  globalThis.OpenSesameToolsModel = Object.freeze({validate, parse, configuration, restore, instance, replace, rollback, safeUrl, pages, page});
})();
