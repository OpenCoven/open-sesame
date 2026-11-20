// What the closed rail says about each view: nothing, that something is running there, or that
// something there needs the person. The strip is all a person sees most of the time, so this is
// where the companion says which view to open.
//
// A mark belongs to a view and has a tone and a sentence. 'attention' is something finished or
// waiting for the person and stays until they open that view; 'active' is something under way
// and goes when it ends. A view sets its own mark through `context.attention`, as Shells does
// when a shell ends: a pane's messages reach only the view that opened it. The watcher below
// covers Focus while that view is not loaded, from the setting the session is kept in, without
// importing a widget.
import { FOCUS_KEY, parse, view as focusView } from './focus-model.js';

const TONES = new Set(['attention', 'active']);

export function createAttention() {
  const marks = new Map();
  const listeners = new Set();
  const notify = () => { for (const listener of listeners) listener(snapshot()); };
  const snapshot = () => new Map(marks);
  return Object.freeze({
    // `mark` is {tone, label}, or null to clear.
    set(id, mark) {
      const next = mark && TONES.has(mark.tone) ? Object.freeze({tone: mark.tone, label: String(mark.label || '')}) : null;
      const before = marks.get(id) ?? null;
      if (before?.tone === next?.tone && before?.label === next?.label) return;
      if (next) marks.set(id, next); else marks.delete(id);
      notify();
    },
    get: id => marks.get(id) ?? null,
    snapshot,
    // The view was opened: what needed the person has been seen. What is running stays.
    seen(id) { if (marks.get(id)?.tone === 'attention') { marks.delete(id); notify(); } },
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
  });
}

// What the strip says for a set of marks: the worst tone and one sentence naming each view.
export function summary(marks, names) {
  const lines = [...marks].map(([id, mark]) => `${names.get(id) ?? id}: ${mark.label}`);
  const tone = [...marks.values()].some(mark => mark.tone === 'attention') ? 'attention' : marks.size ? 'active' : null;
  return {tone, label: lines.join('. ')};
}

/**
 * Focus: a running session is marked as under way, and one that has run out needs the person
 * until they open Focus. The session is read from the core's settings; the deadline is then a
 * timer here, so the mark changes at the right second without asking again.
 *
 * showing(): whether the person is looking at Focus now
 * Returns {refresh, stop}; call refresh when the session may have changed.
 */
export function watchFocus({bridge, attention, showing, now = () => Date.now(), timers = globalThis}) {
  let timer = null, stopped = false, seenDeadline = null;
  const clear = () => { if (timer !== null) timers.clearTimeout(timer); timer = null; };
  function draw(session) {
    clear();
    if (stopped) return;
    const shown = focusView(session, now());
    if (shown.status === 'running') {
      attention.set('focus', {tone: 'active', label: 'A session is running'});
      // A session is at most a day long, well inside what a timer can hold.
      timer = timers.setTimeout(() => draw(session), Math.max(250, shown.remainingMs));
    } else if (shown.status === 'finished') {
      // A finished session the person has looked at does not ask again.
      if (showing()) seenDeadline = shown.deadlineAt;
      attention.set('focus', shown.deadlineAt === seenDeadline ? null : {tone: 'attention', label: 'Session complete'});
    } else attention.set('focus', null);
  }
  async function refresh() {
    if (stopped) return;
    try {
      const reply = await bridge.request('settings.all', {});
      const settings = reply?.settings;
      if (!settings || typeof settings !== 'object') return;
      const parsed = parse(Object.hasOwn(settings, FOCUS_KEY) ? settings[FOCUS_KEY] : undefined);
      if (parsed.ok) draw(parsed.session);
    } catch { /* The mark stays as it was; the next refresh asks again. */ }
  }
  return {refresh, stop() { stopped = true; clear(); }};
}
