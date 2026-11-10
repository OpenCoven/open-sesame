'use strict';
(() => {
  const records = new WeakMap();
  let current = null, menu = null;
  const MAX_TEXT = 1024 * 1024;
  async function copy(record, all = false) {
    if (!record.valid()) return;
    if (all) record.term.selectAll();
    const text = record.term.getSelection();
    if (!text) return;
    if (new TextEncoder().encode(text).length > MAX_TEXT) {toast('Select a smaller section to copy.'); return}
    try {
      if (window.__OPEN_SESAME_NATIVE__) await openSesameBridge.request('terminal.clipboard.write', {text});
      else await navigator.clipboard.writeText(text);
    } catch {toast('Could not copy terminal text. Try the Edit menu.')}
  }
  async function paste(record) {
    if (!record.valid()) return;
    if (!record.canPaste()) {toast('Open a shell before pasting.'); return}
    try {
      const text = window.__OPEN_SESAME_NATIVE__ ? await openSesameBridge.request('terminal.clipboard.read') : await navigator.clipboard.readText();
      // A delayed clipboard read must never type into a different or closed pane.
      if (!record.valid() || !record.canPaste() || document.activeElement?.closest('.terminal-native') !== record.element) return;
      if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_TEXT) throw Error('Clipboard text is too large.');
      record.term.paste(text); record.term.focus();
    } catch (error) {if (record.valid()) toast(error.message === 'Clipboard text is too large.' ? error.message : 'Could not paste. Use Command-V or the Edit menu.')}
  }
  function close({focus = false} = {}) {
    const previous = current; menu?.remove(); menu = null; current = null;
    if (focus && previous?.valid()) previous.term.focus();
  }
  function command(record, name) {
    if (!record?.valid()) return false;
    if (name === 'copy') void copy(record);
    else if (name === 'copy-all') void copy(record, true);
    else if (name === 'paste') void paste(record);
    else if (name === 'select-all') record.term.selectAll();
    else return false;
    return true;
  }
  function show(record, event) {
    if (!record.valid()) return;
    event.preventDefault(); close(); current = record;
    menu = document.createElement('div'); menu.className = 'terminal-clipboard-menu';
    menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Terminal clipboard');
    for (const [action, label] of [['copy','Copy selection'],['paste','Paste'],['select-all','Select all'],['copy-all','Copy all output']]) {
      const item = document.createElement('button'); item.type = 'button'; item.textContent = label;
      item.setAttribute('role', 'menuitem'); item.disabled = action === 'copy' && !record.term.hasSelection();
      item.addEventListener('click', () => {command(record, action); close({focus:true})}); menu.append(item);
    }
    document.getElementById('widget-panel').append(menu);
    const bounds = menu.parentElement.getBoundingClientRect();
    menu.style.left = Math.max(4, Math.min(event.clientX - bounds.left, bounds.width - menu.offsetWidth - 4)) + 'px';
    menu.style.top = Math.max(4, Math.min(event.clientY - bounds.top, bounds.height - menu.offsetHeight - 4)) + 'px';
    menu.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
  }
  function attach(term, element, valid, canPaste = valid) {
    const record = {term, element, valid, canPaste}; records.set(term, record);
    element.__openSesameClipboardTerm = term;
    const context = event => show(record, event);
    element.addEventListener('contextmenu', context);
    return () => {element.removeEventListener('contextmenu', context); if (current === record) close(); records.delete(term); delete element.__openSesameClipboardTerm};
  }
  function handleKey(term, event) {
    const record = records.get(term);
    if (!record?.valid() || event.type !== 'keydown' || event.altKey) return true;
    const key = event.key.toLowerCase(), shortcut = event.metaKey || event.ctrlKey && event.shiftKey;
    if (shortcut && ['c','v','a'].includes(key)) {
      event.preventDefault(); command(record, key === 'c' ? 'copy' : key === 'v' ? 'paste' : 'select-all'); return false;
    }
    return true; // In particular, Ctrl-C remains a shell interrupt.
  }
  function nativeCommand(name) {
    if (state.scenario !== 'terminal') return false;
    const element = document.activeElement?.closest('.terminal-native');
    if (!element) return false;
    const term = element.__openSesameClipboardTerm;
    return command(records.get(term), name);
  }
  document.addEventListener('pointerdown', event => {if (menu && !menu.contains(event.target)) close()}, true);
  document.addEventListener('keydown', event => {
    if (!menu || event.defaultPrevented) return;
    if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); close({focus:true})}
    else if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault(); const items = [...menu.querySelectorAll('button:not(:disabled)')], index = items.indexOf(document.activeElement);
      items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length]?.focus();
    }
  });
  window.addEventListener('open-sesame-view-changed', () => close());
  window.OpenSesameTerminalClipboard = {attach, handleKey, nativeCommand};
})();
