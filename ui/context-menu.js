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
// `contenteditable` or of a type without a text selection (email, number) gets no field menu
// (only Copy, when text is selected on the page), a paste made here is not one step of the
// field's own undo, and with the native menu gone a development build no longer offers Inspect
// Element on a right click. Copy for selected text is offered wherever on the page the menu is
// asked for, not only over the selection; that menu belongs to the element that was pressed,
// so when that element is itself what scrolls, scrolling it leaves the menu where it is while
// the text moves under it. Copy still writes the text that was selected when the menu opened.
//
// The native menu is cancelled while the event is captured, so no part of the page can let it
// through. The menu itself is built when the event has bubbled back to the document, after
// the part of the page that was pressed has heard it: the terminal emulator selects the word
// under the pointer in its own listener on a Mac, and the pane is asked what it offers only
// after that.
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
  if (room <= 0) return '';
  const cut = clip.slice(0, room);
  // Never half of a character that takes two code units.
  const last = cut.charCodeAt(cut.length - 1);
  return cut.length < clip.length && last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
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
  // The part of the page the open menu belongs to. A scroll inside it leaves the menu open.
  let anchor = null;

  const failed = error => report((error && typeof error.message === 'string' && error.message) || String(error));
  const write = text => bridge.request(WRITE, { text }).catch(failed);
  const read = () => bridge.request(READ, {}).then(clip => (typeof clip === 'string' ? clip : ''));

  const close = ({ restore = true } = {}) => {
    if (!menu) return;
    const [gone, back] = [menu, origin];
    menu = null;
    origin = null;
    anchor = null;
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
    // The clipboard answers later. A field that changed meanwhile is left as it is: the range
    // remembered here no longer names the same text.
    const same = () => String(field.value) === value;
    const actions = {
      // Nothing is taken out of the field unless the clipboard has it.
      cut: () => bridge.request(WRITE, { text: selected }).then(() => { if (same()) { field.setRangeText('', start, end, 'end'); changed(field); } }, failed),
      copy: () => { field.setSelectionRange(start, end); return write(selected); },
      // A clipboard with no text in it, or a field with no room, changes nothing: the
      // selection is not replaced by nothing.
      paste: () => read().then(clip => {
        const text = pasteFor(field, start, end, clip);
        if (text && same()) { field.setRangeText(text, start, end, 'end'); changed(field); }
      }, failed),
      selectAll: () => field.setSelectionRange(0, String(field.value).length),
    };
    return fieldItems({ editable, secret, hasSelection: end > start, hasText: value.length > 0 })
      .map(item => ({ label: item.label, enabled: item.enabled, run: actions[item.id] }));
  };

  // What to offer at `target`, and the part of the page it belongs to: the nearest part that
  // provides a menu, else the field, else Copy for selected text, else nothing. A provider
  // that answers with no list at all leaves the choice to what is above it.
  const itemsAt = target => {
    for (let node = target; node; node = node.parentNode) {
      const items = providers.get(node)?.();
      if (items) return { items, within: node, back: null };
    }
    if (isTextField(target)) return { items: forField(target), within: target, back: target };
    const selected = String(doc.getSelection?.() ?? '');
    return { items: selected ? [{ label: 'Copy', enabled: true, run: () => write(selected) }] : [], within: target ?? null, back: null };
  };

  const show = ({ items, within, back }, x, y) => {
    // What gets the keyboard when the menu closes: the field the menu was for, else what had
    // it, which for a pane is its own input.
    const focused = back ?? doc.activeElement;
    const box = doc.createElement('div');
    box.className = 'context-menu';
    box.setAttribute('role', 'menu');
    box.setAttribute('aria-label', 'Context menu');
    // So that a menu with nothing to choose can still hold the keyboard and be closed by it.
    box.setAttribute('tabindex', '-1');
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
      // From the menu itself, which has the keyboard when it was put there by a script or no
      // item can be chosen, up is the last item and down the first.
      const to = { ArrowDown: at + 1, ArrowUp: at < 0 ? usable.length - 1 : at - 1, Home: 0, End: usable.length - 1 }[event.key];
      // No key goes further than the menu while it has the keyboard: Escape must not also
      // close a panel behind it, and a shortcut of the page's must not open one over it.
      event.stopPropagation?.();
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
    anchor = within;
    (usable[0] ?? box).focus?.();
  };

  // Where the menu goes. A menu asked for with the keyboard carries no pointer position, and
  // is put under the element it was asked on.
  const place = event => {
    if (event.clientX || event.clientY) return [event.clientX || 0, event.clientY || 0];
    const { left = 0, bottom = 0 } = event.target?.getBoundingClientRect?.() ?? {};
    return [left, bottom];
  };

  // Capturing, so no part of the page can let the native menu through by stopping the event.
  doc.addEventListener('contextmenu', event => {
    event.preventDefault();
    if (!menu?.contains(event.target)) close({ restore: false });
  }, true);
  // Not capturing: built after the part of the page that was pressed has heard the event.
  doc.addEventListener('contextmenu', event => {
    if (menu?.contains(event.target)) return;
    const found = itemsAt(event.target);
    if (found.items.length) show(found, ...place(event));
  });
  doc.addEventListener('pointerdown', event => { if (menu && !menu.contains(event.target)) close({ restore: false }); }, true);
  // A scroll closes the menu when it moves the part of the page the menu belongs to: a scroll
  // of something that part is inside, or one that does not say what scrolled. A scroll inside
  // that part leaves the menu open, because a terminal scrolls by itself whenever a program
  // prints, and so does a scroll somewhere else on the page, for the same reason: a field's
  // menu must not close because a terminal beside it printed.
  doc.addEventListener('scroll', event => {
    const scrolled = event?.target;
    const stays = anchor && scrolled?.contains && (scrolled === anchor || !scrolled.contains(anchor));
    if (!stays) close();
  }, true);
  view.addEventListener('resize', () => close());
  view.addEventListener('blur', () => close({ restore: false }));

  return { close, isOpen: () => menu !== null };
}
