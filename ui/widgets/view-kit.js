// Shared by the Today, Projects and Focus views (issue #77). Each view owns its stores for one
// lifetime and reads them again when it is shown or the window comes back; nothing here outlives
// the AbortSignal it is given or reaches anything but the bridge.
import { createItemStore } from '../items.js';

// Elements from text and attributes only, never from HTML.
export function maker(document) {
  return (tag, attributes = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) {
      if (value === false || value === null || value === undefined) continue;
      if (name === 'text') node.textContent = value;
      else node.setAttribute(name, value === true ? '' : String(value));
    }
    node.append(...[].concat(children).filter(child => child !== null && child !== undefined && child !== false));
    return node;
  };
}

export const message = error => (error && typeof error.message === 'string' && error.message) || String(error);

// The item store for one lifetime, drawn with `draw` whenever its rows change.
export function itemStore({bridge, host, signal, draw}) {
  const store = createItemStore({bridge, uuid: () => host.crypto.randomUUID()});
  const stop = store.subscribe(value => { if (!signal.aborted) draw(value); });
  signal.addEventListener('abort', stop, {once: true});
  return store;
}

// The shell sends this to the document when the rail's panel opens (ui/main.js): the window was
// on screen all along as the strip, so the document's own visibility did not change.
export const PANEL_SHOWN = 'open-sesame-panel-shown';

// Runs `refresh` when the window is shown again or the panel opens, until the lifetime ends.
export function whenShown(document, signal, refresh) {
  const listener = () => { if (document.visibilityState === 'visible' && !signal.aborted) refresh(); };
  for (const name of ['visibilitychange', PANEL_SHOWN]) {
    document.addEventListener(name, listener);
    signal.addEventListener('abort', () => document.removeEventListener(name, listener), {once: true});
  }
}

// Draws a list again and gives keyboard focus back to the same row's control. When that row has
// left the list (completed, archived or deleted), focus goes to the same control on the next row,
// else on the previous row; where no other row has that control (a task's checkbox in a list of
// notes), to the first control of the next row, else of the previous row; else to what `fallback`
// returns (the list's heading or empty-state line, focusable with tabindex -1), so it never falls
// to the document.
const lastFocused = new WeakMap(); // list → the control in it that last had keyboard focus
export function redraw(list, draw, fallback = () => null) {
  if (!lastFocused.has(list)) list.addEventListener('focusin', event => lastFocused.set(list, event.target));
  const document = list.ownerDocument, active = document.activeElement;
  let source = active && list.contains(active) ? active : null;
  // A control disabled while its write is out can lose focus to the document before the answer
  // comes; it still counts as focused then. Focus the person moved elsewhere is left alone.
  const last = lastFocused.get(list);
  if (!source && (!active || active === document.body) && last?.disabled && list.contains(last)) source = last;
  lastFocused.set(list, source);
  const key = source?.dataset.focusKey;
  const keyed = () => [...list.querySelectorAll('[data-focus-key]')];
  let after = [], before = [], rowAfter = [], rowBefore = [];
  if (key) {
    // The rows are the list's children; each one's first control stands for it.
    let row = source;
    while (row && row.parentElement !== list) row = row.parentElement;
    const rows = [...list.children], place = rows.indexOf(row);
    const first = some => some.map(other => other.querySelector('[data-focus-key]')?.dataset.focusKey).filter(Boolean);
    if (place >= 0) { rowAfter = first(rows.slice(place + 1)); rowBefore = first(rows.slice(0, place).reverse()); }
    // The same control on other rows: keys share the part before the first colon.
    const kind = key.slice(0, key.indexOf(':') + 1);
    const same = keyed().map(node => node.dataset.focusKey).filter(other => other === key || (kind && other.startsWith(kind)));
    const at = same.indexOf(key);
    after = same.slice(at + 1); before = same.slice(0, Math.max(at, 0)).reverse();
  }
  draw();
  if (!key) return;
  const now = new Map(keyed().map(node => [node.dataset.focusKey, node]));
  const target = [key, ...after, ...before, ...rowAfter, ...rowBefore].map(other => now.get(other)).find(Boolean) ?? fallback();
  target?.focus();
}

// A row for a status line and what goes with it, such as Try again or Start over. While every
// part is hidden or has nothing to say the row is hidden too, so the view's grid gives it no gap
// (#170). The shell's engine baseline has no :has() to say this in the stylesheet
// (docs/ui-shell.md), so the row watches its parts until the lifetime ends.
export function statusRow(h, signal, children) {
  const row = h('div', {class: 'view-row'}, children);
  const quiet = node => node.hidden || (node.classList.contains('view-status') && node.textContent === '');
  // Assigned only on a change: the row's own attribute is watched too, and every assignment is one.
  const sync = () => { const hidden = [...row.children].every(quiet); if (row.hidden !== hidden) row.hidden = hidden; };
  const observer = new MutationObserver(sync);
  observer.observe(row, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden']});
  signal.addEventListener('abort', () => observer.disconnect(), {once: true});
  sync();
  return row;
}

// A status line: a sentence, marked as a warning when something was not done.
export function statusLine(h, attributes = {}) {
  const line = h('p', {class: 'view-status', role: 'status', ...attributes});
  const say = (text, warn = false) => {
    line.textContent = text || '';
    if (warn) line.dataset.tone = 'warn'; else delete line.dataset.tone;
  };
  return {line, say};
}
