// The shell owns lifetimes; widgets receive a private surface, dependencies and AbortSignal.
// Imports cannot be undone by a browser. Turning off removes CSS/DOM and retires all activity;
// a subsequent enable remounts the already cached module with a new lifetime.
export function createLifecycle({widgets, loaders, styles = {}, createSurface, loadStyle, context = {}, onChange = () => {}}) {
  const entries = new Map(widgets.map(widget => [widget.id, {widget, on: widget.defaultOn, live: null, closing: Promise.resolve()}]));
  let selected = null;
  let sequence = 0;
  let closed = false;
  const entry = id => {
    if (closed) throw Error('The widget workspace is closed.');
    const value = entries.get(id);
    if (!value) throw Error('Unknown widget.');
    return value;
  };
  const snapshot = () => ({lastView: selected, on: Object.fromEntries([...entries].map(([id,e]) => [id,e.on]))});
  const changed = () => onChange(snapshot());
  const visibility = () => {
    for (const [id,e] of entries) if (e.live?.surface) e.live.surface.hidden = id !== selected || !e.on;
  };
  const detach = record => {
    record.controller.abort();
    record.surface?.remove();
    record.removeStyle?.();
    record.removeStyle = null;
  };
  const ensure = e => {
    if (e.live) return e.live;
    const record = {controller: new AbortController(), api: null, surface: null, removeStyle: null};
    const current = () => !closed && e.on && e.live === record && !record.controller.signal.aborted;
    const previousClose = e.closing;
    e.live = record;
    record.ready = Promise.resolve().then(async () => {
      await previousClose;
      if (!current()) return;
      const loader = loaders[e.widget.id];
      if (!loader) throw Error('This widget is not available in this version.');
      const module = await loader();
      if (!current()) return;
      if (styles[e.widget.id]) {
        const removeStyle = await loadStyle(styles[e.widget.id], record.controller.signal);
        if (!current()) { removeStyle(); return; }
        record.removeStyle = removeStyle;
      }
      if (!current()) return;
      record.surface = createSurface(e.widget.id);
      visibility();
      record.api = await module.mount({...context, widget: e.widget, surface: record.surface, signal: record.controller.signal});
      if (!current()) { await record.api?.dispose?.(); record.api = null; }
    }).catch(error => {
      detach(record);
      if (e.live === record) e.live = null;
      throw error;
    });
    return record;
  };
  const retire = e => {
    const record = e.live;
    if (!record) return e.closing;
    e.live = null;
    detach(record);
    e.closing = record.ready.catch(() => {}).then(async () => {
      await record.api?.dispose?.();
      record.api = null;
    });
    return e.closing;
  };
  const setEnabled = async (id, on) => {
    if (typeof on !== 'boolean') throw TypeError('Widget state must be on or off.');
    const e = entry(id);
    e.on = on;
    if (!on && selected === id) { selected = null; sequence++; }
    changed();
    if (!on) await retire(e);
    visibility();
  };
  const show = async (id, action = 'open') => {
    const e = entry(id);
    e.on = true;
    selected = id;
    const ticket = ++sequence;
    changed();
    visibility();
    const record = ensure(e);
    await record.ready;
    if (closed || !e.on || e.live !== record || ticket !== sequence || selected !== id) return;
    visibility();
    await record.api?.command?.(action);
  };
  const restore = state => {
    for (const [id,e] of entries) if (typeof state?.on?.[id] === 'boolean') e.on = state.on[id];
    return state?.lastView && entries.get(state.lastView)?.on ? state.lastView : [...entries].find(([,e]) => e.on)?.[0] ?? null;
  };
  const dispose = async () => {
    if (closed) return;
    closed = true; sequence++;
    await Promise.all([...entries.values()].map(retire));
  };
  return Object.freeze({show,setEnabled,snapshot,restore,dispose});
}
