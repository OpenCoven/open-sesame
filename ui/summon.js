// The shortcut settings (issue #71): which keys show or hide the window from anywhere, whether
// the system accepted them, and whether the window hides when it loses focus.
//
// The host owns all of it (src-tauri/src/summon.rs). The page asks `summon.status`, and sends
// `summon.setShortcut`, `summon.setHideOnBlur` and `summon.hold`. A change takes effect at once;
// nothing here needs a restart. Everything the section touches is passed in, so
// scripts/check-tauri-summon.mjs can run it in Node against stand-ins.

const text = error => (error && typeof error.message === 'string' && error.message) || String(error);

export const EXAMPLE = 'Write the keys joined by +, for example Alt+Shift+Space. On a Mac, Alt is the Option key and Super is the Command key.';

// What the section says for a status from the host: {hint, message, warn, editable}.
export function describe(status) {
  if (status.session === 'wayland') {
    return {
      editable: false,
      warn: false,
      hint: `This Wayland session does not let an application register a global shortcut. In your desktop's keyboard settings, bind a shortcut to this command: ${status.toggleCommand}`,
      message: '',
    };
  }
  if (!status.shortcut) return { editable: true, warn: false, hint: EXAMPLE, message: 'No shortcut is set.' };
  if (status.registered) return { editable: true, warn: false, hint: EXAMPLE, message: `Press ${status.shortcut} anywhere to show or hide Open Sesame.` };
  return { editable: true, warn: true, hint: EXAMPLE, message: status.message || `Open Sesame could not register ${status.shortcut}.` };
}

/**
 * Runs the section.
 *
 * bridge: the object from createBridge
 * parts: { section, hint, form, input, message, blur } - the section's elements
 */
export function mountSummon(bridge, parts) {
  const { section, hint, form, input, message, blur } = parts;
  let busy = false;

  const say = (words, warn) => {
    message.textContent = words;
    message.dataset.warn = warn ? 'true' : 'false';
  };

  // Shows what the host reports. The field is overwritten only when the host's value is the news.
  const show = (status, { keepField = false } = {}) => {
    const view = describe(status);
    hint.textContent = view.hint;
    form.hidden = !view.editable;
    if (!keepField) input.value = status.shortcut;
    blur.checked = status.hideOnBlur === true;
    say(view.message, view.warn);
    section.hidden = false;
  };

  const refresh = options => bridge.request('summon.status').then(status => show(status, options));

  const change = async (method, params, options) => {
    if (busy) return;
    busy = true;
    try {
      show(await bridge.request(method, params));
    } catch (error) {
      // A refusal leaves the host as it was. Show what it still has, then the reason on top.
      await refresh(options).catch(() => {});
      say(text(error), true);
    } finally {
      busy = false;
    }
  };

  form.addEventListener('submit', event => {
    event.preventDefault?.();
    change('summon.setShortcut', { shortcut: String(input.value || '').trim() }, { keepField: true });
  });
  blur.addEventListener('change', () => {
    change('summon.setHideOnBlur', { enabled: blur.checked === true });
  });

  // The section stays hidden if the host has no summon methods.
  return refresh().catch(() => {});
}

// Tells the host while something is being dragged out of the page, so a window that hides on
// blur stays until the drag ends. `target` is the document.
export function holdDuringDrag(bridge, target) {
  let held = false;
  const set = value => {
    if (held === value) return;
    held = value;
    bridge.request('summon.hold', { held }).catch(() => {});
  };
  target.addEventListener('dragstart', () => set(true));
  for (const end of ['dragend', 'drop']) target.addEventListener(end, () => set(false));
}
