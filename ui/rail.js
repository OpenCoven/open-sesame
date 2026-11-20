// The companion rail: one window that rests against a screen edge as a strip of icons and opens
// into the panel. The host owns the window (src-tauri/src/rail.rs): where it is, how wide it is,
// which display it is on and when a resting pointer opens it. The page asks `rail.status`, sends
// `rail.set` and follows the `rail.changed` host message; it never sizes or moves anything.
//
// Where a session cannot have a rail, the host reports the ordinary window and the page is the
// whole panel all the time. A page with no host, or a host with no rail methods, is the same.
// Everything the module touches is passed in, so scripts/check-ui-rail.mjs runs it in Node
// against stand-ins.

export const CHANGED_EVENT = 'rail.changed';

const text = error => (error && typeof error.message === 'string' && error.message) || String(error);

const WINDOW = Object.freeze({presentation: 'window', shown: true, expanded: true, held: true, wide: false, edge: 'right', hover: false});

// What the host said, reduced to what the page draws. Anything that is not a rail's status is
// the ordinary window.
export function read(status) {
  if (!status || typeof status !== 'object' || status.presentation !== 'rail') return WINDOW;
  return Object.freeze({
    presentation: 'rail',
    shown: status.shown !== false,
    expanded: status.expanded === true,
    held: status.held === true,
    wide: status.wide === true,
    edge: status.edge === 'left' ? 'left' : 'right',
    hover: status.hover !== false,
  });
}

// The name of the layout for a status: the strip, the panel, or the wide panel.
export const layout = status => !status.expanded ? 'collapsed' : status.wide ? 'wide' : 'expanded';

/**
 * Runs the rail.
 *
 * bridge: the object from createBridge
 * parts: {shell, panel, toggle, toggleLabel, collapse, section, edge, hover, message, blurLabel}
 * onChange(status, previous): called after the page shows a new status
 */
export function mountRail(bridge, parts, onChange = () => {}) {
  const {shell, panel, toggle, toggleLabel, collapse, section, edge, hover, message, blurLabel} = parts;
  let current = WINDOW;

  const say = (words, warn) => {
    message.textContent = words;
    message.dataset.warn = warn ? 'true' : 'false';
  };

  function show(status, quiet = false) {
    const previous = current;
    current = read(status);
    const rail = current.presentation === 'rail';
    shell.dataset.presentation = current.presentation;
    shell.dataset.rail = layout(current);
    shell.dataset.edge = current.edge;
    // The closed panel is out of the tab order and out of reach of assistive technology.
    panel.inert = !current.expanded;
    const label = !rail ? 'Open Sesame' : current.expanded && current.held ? 'Close the panel' : 'Open the panel';
    toggle.disabled = !rail;
    toggle.title = label;
    toggle.setAttribute('aria-expanded', String(current.expanded));
    toggleLabel.textContent = label;
    collapse.hidden = !rail;
    section.hidden = !rail;
    edge.value = current.edge;
    hover.checked = current.hover;
    blurLabel.textContent = rail ? 'Close the panel when it loses focus' : 'Hide the window when it loses focus';
    if (!quiet) onChange(current, previous);
    return current;
  }

  // One change at a time, in the order asked. A refusal leaves the host as it was: the page
  // shows what the host still has and says why.
  let queue = Promise.resolve();
  function set(change) {
    if (current.presentation !== 'rail') return Promise.resolve(current);
    const result = queue.then(async () => {
      try {
        const next = show(await bridge.request('rail.set', change));
        say('', false);
        return next;
      } catch (error) {
        await bridge.request('rail.status').then(status => show(status), () => {});
        say(text(error), true);
        return current;
      }
    });
    queue = result;
    return result;
  }

  bridge.subscribe(note => {
    if (note.event === CHANGED_EVENT && note.status && typeof note.status === 'object') show(note.status);
  });
  toggle.addEventListener('click', () => set({expanded: !(current.expanded && current.held)}));
  collapse.addEventListener('click', () => set({expanded: false}));
  edge.addEventListener('change', () => set({edge: edge.value === 'left' ? 'left' : 'right'}));
  hover.addEventListener('change', () => set({hover: hover.checked === true}));

  // The page starts as the ordinary window; the caller is told from the host's first answer on.
  show(null, true);
  return {
    status: () => current,
    // Opens the panel to stay, as a click on a view does.
    open: () => current.expanded && current.held ? Promise.resolve(current) : set({expanded: true}),
    collapse: () => current.expanded ? set({expanded: false}) : Promise.resolve(current),
    setWide: wide => current.wide === wide ? Promise.resolve(current) : set({wide}),
    // The first answer from the host. A host with no rail leaves the ordinary window.
    ready: bridge.request('rail.status').then(status => show(status), () => current),
  };
}
