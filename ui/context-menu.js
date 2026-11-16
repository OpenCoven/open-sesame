// The page's own context menu (issue #115, decided on 16 November 2026).
//
// The web view's native context menu is another window: opening it can take the keyboard from
// this one, and a window that hides when it loses focus then hides under the person's pointer.
// So the native menu is never opened here. Every `contextmenu` event is cancelled, and where
// there is something to offer, a menu drawn in the page takes its place: Cut, Copy, Paste and
// Select All in a text field, Copy for selected text, and whatever a part of the page provides
// for itself with `provideMenu` (a terminal pane offers Copy and Paste).
//
// Copy and paste go through the host, which holds the only clipboard access the app has; the
// methods are the two the terminal already uses. What this does not cover: a `<select>` list
// and an input method's window are native popups too and are not replaced, a field that is
// `contenteditable` or of a type without a text selection (email, number) gets no menu, a
// paste made here is not one step of the field's own undo, and with the native menu gone a
// development build no longer offers Inspect Element on a right click.
//
// Everything the menu touches is passed in, so scripts/check-tauri-summon.mjs can run it in
// Node against stand-ins.

const READ = 'terminal.clipboard.read';
const WRITE = 'terminal.clipboard.write';
// The input types whose text selection a script may read. Others throw or answer null.
const TEXT_TYPES = new Set(['text', 'search', 'url', 'tel', 'password']);

const providers = new WeakMap();

/**
 * Gives `element` a menu of its own. `items` is called when a context menu is asked for inside
 * the element and returns [{ label, enabled, run }]; an empty list means no menu there. The
 * returned function takes the menu away again.
 */
export function provideMenu(element, items) {
  providers.set(element, items);
  return () => { if (providers.get(element) === items) providers.delete(element); };
}

// Whether `node` is a field whose text and selection the menu can work on.
export function isTextField(node) {
  if (!node || typeof node.tagName !== 'string') return false;
  const tag = node.tagName.toLowerCase();
  if (tag === 'textarea') return true;
  return tag === 'input' && TEXT_TYPES.has(String(node.type || 'text').toLowerCase());
}

/**
 * What the menu offers for a text field: [{ id, label, enabled }], always these four in this
 * order, as a system's own menu has them. A field that hides what is typed gives nothing to
 * the clipboard.
 */
export function fieldItems({ editable, secret, hasSelection, hasText }) {
  return [
    { id: 'cut', label: 'Cut', enabled: editable && hasSelection && !secret },
    { id: 'copy', label: 'Copy', enabled: hasSelection && !secret },
    { id: 'paste', label: 'Paste', enabled: editable },
    { id: 'selectAll', label: 'Select All', enabled: hasText },
  ];
}

// The text a paste puts into `field` in place of what is selected: no more than the field's
// own limit allows.
export function pasteFor(field, start, end, clip) {
  const limit = Number(field.maxLength);
  if (!Number.isInteger(limit) || limit < 0) return clip;
  const room = limit - (String(field.value).length - (end - start));
  return room > 0 ? clip.slice(0, room) : '';
}

/**
 * Starts the menu for a document.
 *
 * bridge: the object from createBridge
 * doc: the document
 * report: told the host's sentence when the clipboard refuses
 *
 * Returns { close, isOpen } for the caller and the check.
 */
export function mountContextMenu(bridge, doc, { report = () => {} } = {}) {
  const view = doc.defaultView;
  let menu = null;
  let origin = null;

  const failed = error => report((error && typeof error.message === 'string' && error.message) || String(error));
  const write = text => bridge.request(WRITE, { text }).catch(failed);
  const read = () => bridge.request(READ, {}).then(clip => (typeof clip === 'string' ? clip : ''));

  const close = ({ restore = true } = {}) => {
    if (!menu) return;
    const [gone, back] = [menu, origin];
    menu = null;
    origin = null;
    gone.remove();
    if (restore) back?.focus?.();
  };

  const changed = field => field.dispatchEvent(new view.Event('input', { bubbles: true }));

  // The four actions on a field. The selection is the one the field had when the menu opened;
  // the menu holds the focus meanwhile.
  const forField = field => {
    const value = String(field.value);
    const start = field.selectionStart ?? value.length;
    const end = field.selectionEnd ?? start;
    const editable = !field.readOnly && !field.disabled;
    const secret = String(field.type).toLowerCase() === 'password';
    const selected = value.slice(start, end);
    const actions = {
      // Nothing is taken out of the field unless the clipboard has it.
      cut: () => bridge.request(WRITE, { text: selected }).then(() => { field.setRangeText('', start, end, 'end'); changed(field); }, failed),
      copy: () => { field.setSelectionRange(start, end); return write(selected); },
      paste: () => read().then(clip => {
        const text = pasteFor(field, start, end, clip);
        if (text || start !== end) { field.setRangeText(text, start, end, 'end'); changed(field); }
      }, failed),
      selectAll: () => field.setSelectionRange(0, String(field.value).length),
    };
    return fieldItems({ editable, secret, hasSelection: end > start, hasText: value.length > 0 })
      .map(item => ({ label: item.label, enabled: item.enabled, run: actions[item.id] }));
  };

  // What to offer at `target`: the nearest part of the page that provides a menu, else the
  // field, else Copy for selected text, else nothing.
  const itemsAt = target => {
    for (let node = target; node; node = node.parentNode) {
      const provided = providers.get(node);
      if (provided) return provided() || [];
    }
    if (isTextField(target)) return forField(target);
    const selected = String(doc.getSelection?.() ?? '');
    return selected ? [{ label: 'Copy', enabled: true, run: () => write(selected) }] : [];
  };

  const show = (items, x, y) => {
    // What had the keyboard gets it back when the menu closes: the field, or a pane's own input.
    const focused = doc.activeElement;
    const box = doc.createElement('div');
    box.className = 'context-menu';
    box.setAttribute('role', 'menu');
    const buttons = items.map(item => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.textContent = item.label;
      button.disabled = !item.enabled;
      button.addEventListener('click', () => {
        close();
        Promise.resolve().then(item.run).catch(failed);
      });
      box.append(button);
      return button;
    });
    const usable = buttons.filter(button => !button.disabled);
    box.addEventListener('keydown', event => {
      const at = usable.indexOf(doc.activeElement);
      const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: usable.length - 1 }[event.key];
      if (to !== undefined && usable.length) {
        event.preventDefault();
        usable[(to + usable.length) % usable.length].focus();
      } else if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault();
        close();
      }
    });
    doc.body.append(box);
    // Kept inside the window, whatever corner the pointer is in.
    const { width = 0, height = 0 } = box.getBoundingClientRect?.() ?? {};
    box.style.left = `${Math.max(0, Math.min(x, (view.innerWidth || 0) - width))}px`;
    box.style.top = `${Math.max(0, Math.min(y, (view.innerHeight || 0) - height))}px`;
    menu = box;
    origin = focused;
    (usable[0] ?? box).focus?.();
  };

  // Capturing, so no part of the page can let the native menu through by stopping the event.
  doc.addEventListener('contextmenu', event => {
    event.preventDefault();
    if (menu?.contains(event.target)) return;
    close({ restore: false });
    const items = itemsAt(event.target);
    if (items.length) show(items, event.clientX || 0, event.clientY || 0);
  }, true);
  doc.addEventListener('pointerdown', event => { if (menu && !menu.contains(event.target)) close({ restore: false }); }, true);
  doc.addEventListener('scroll', () => close(), true);
  view.addEventListener('resize', () => close());
  view.addEventListener('blur', () => close({ restore: false }));

  return { close, isOpen: () => menu !== null };
}
