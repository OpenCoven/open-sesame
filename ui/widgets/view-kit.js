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

// Runs `refresh` when the window is shown again, until the lifetime ends.
export function whenShown(document, signal, refresh) {
  const listener = () => { if (document.visibilityState === 'visible' && !signal.aborted) refresh(); };
  document.addEventListener('visibilitychange', listener);
  signal.addEventListener('abort', () => document.removeEventListener('visibilitychange', listener), {once: true});
}

// Draws a list again and gives keyboard focus back to the same row's control.
export function redraw(list, draw) {
  const active = list.ownerDocument.activeElement;
  const key = active && list.contains(active) ? active.dataset.focusKey : undefined;
  draw();
  if (key) [...list.querySelectorAll('[data-focus-key]')].find(node => node.dataset.focusKey === key)?.focus();
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
