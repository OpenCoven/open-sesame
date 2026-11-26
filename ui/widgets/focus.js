// Focus (issue #77): a timer stored in the core as its length and its start, deadline and pause
// times (ui/focus-model.js). The time shown is worked out from those times and the clock every
// time it is drawn, so hiding the window, a sleeping machine or a relaunch cannot make it drift.
// The redraw each second while it runs only refreshes the display.
import { DEFAULT_MINUTES, createFocusStore, validMinutes } from '../focus-model.js';
import { maker, statusLine, statusRow, whenShown } from './view-kit.js';

const STATES = {idle: 'Ready to start', running: 'Running', paused: 'Paused', finished: 'Session complete'};
const BUTTONS = {idle: ['start'], running: ['pause', 'reset'], paused: ['resume', 'reset'], finished: ['reset']};
// The control that takes keyboard focus when the focused one is hidden by the change it made.
const NEXT = {start: 'pause', pause: 'resume', resume: 'pause', reset: 'start'};
const RANGE = 'Choose a length from 15 to 1440 minutes.';

export async function mount({surface, signal, bridge}) {
  const document = surface.ownerDocument;
  const h = maker(document);
  const alive = () => !signal.aborted;
  const clock = h('p', {class: 'focus-clock', role: 'timer', 'aria-label': 'Time left', 'data-focus-clock': true});
  const state = h('p', {class: 'muted', 'data-focus-state': true});
  const button = (action, label) => h('button', {type: 'button', 'data-focus-action': action, text: label});
  const controls = {start: button('start', 'Start'), pause: button('pause', 'Pause'), resume: button('resume', 'Resume'), reset: button('reset', 'Reset')};
  const minutes = h('input', {type: 'number', name: 'minutes', min: 15, max: 1440, step: 1, value: DEFAULT_MINUTES, inputmode: 'numeric', 'aria-describedby': 'focus-range', 'data-focus-minutes': true});
  // The range is shown beside the field, and a length outside it is said in the status line
  // rather than in a browser bubble.
  const length = h('form', {class: 'view-row', 'data-focus-length': true, autocomplete: 'off', novalidate: true}, [
    h('label', {}, ['Minutes ', minutes]), h('span', {class: 'muted', id: 'focus-range', 'data-focus-range': true, text: '15–1440'}), h('button', {type: 'submit', text: 'Set length'}),
  ]);
  const recover = h('button', {type: 'button', hidden: true, 'data-focus-recover': true, text: 'Start over'});
  const status = statusLine(h, {'data-focus-message': true});
  surface.append(h('section', {class: 'view focus'}, [
    h('h2', {text: 'Focus'}), clock, state, h('div', {class: 'view-row'}, Object.values(controls)), length, statusRow(h, signal, [status.line, recover]),
  ]));

  const store = createFocusStore({bridge, now: () => Date.now()});
  let timer = null, busy = false, lengthDraft = false, last = null;

  // `had` names the control that had keyboard focus when a press started, since a control that
  // is disabled while its write is out may lose focus in the meantime.
  function draw(had = Object.keys(controls).find(action => controls[action] === document.activeElement)) {
    const shown = store.view();
    clock.textContent = shown.clock;
    state.textContent = store.problem || STATES[shown.status];
    for (const [action, control] of Object.entries(controls)) {
      control.hidden = !BUTTONS[shown.status].includes(action);
      control.disabled = busy || Boolean(store.problem);
    }
    // Keep keyboard focus on the timer's controls: a hidden control hands it to the one that
    // replaced it. Focus the person moved elsewhere in the meantime is left alone.
    const active = document.activeElement;
    if (had && !busy && (!active || active === document.body || active === controls[had])) {
      const visible = action => !controls[action].hidden && !controls[action].disabled;
      const target = [had, NEXT[had], ...BUTTONS[shown.status]].find(action => action && visible(action));
      if (target && controls[target] !== active) controls[target].focus();
    }
    // The end of a session is said in the status line, a polite live region, in place of the
    // message from when it started; the timer role itself does not announce.
    if (last === 'running' && shown.status === 'finished' && !store.problem) status.say('Session complete.');
    last = shown.status;
    recover.hidden = !store.recoverable;
    if (!lengthDraft) minutes.value = String(Math.round(shown.durationMs / 60_000));
    if (shown.status === 'running' && timer === null) timer = setInterval(() => { if (alive()) draw(); }, 1000);
    if (shown.status !== 'running' && timer !== null) { clearInterval(timer); timer = null; }
  }
  async function refresh() {
    const read = await store.load();
    if (!alive()) return;
    if (!read.ok) status.say(read.error, true);
    draw();
  }
  async function act(write, done) {
    const had = Object.keys(controls).find(action => controls[action] === document.activeElement);
    busy = true; draw(had);
    const result = await write();
    if (!alive()) return result;
    busy = false;
    if (result.saved) { status.say(done); lengthDraft = false; } else status.say(result.error, true);
    draw(had);
    return result;
  }

  const done = {start: 'Focus started.', pause: 'Paused.', resume: 'Resumed.', reset: 'Timer reset.'};
  for (const [action, control] of Object.entries(controls)) control.addEventListener('click', () => act(() => store[action](), done[action]));
  minutes.addEventListener('input', () => { lengthDraft = true; });
  length.addEventListener('submit', event => {
    event.preventDefault();
    const value = Number(minutes.value);
    if (!minutes.value.trim() || !validMinutes(value)) { status.say(RANGE, true); minutes.focus(); return; }
    act(() => store.setDuration(value), `Length set to ${value} minutes.`);
  });
  recover.addEventListener('click', () => act(() => store.recover(), 'Started over with a new timer.'));
  whenShown(document, signal, refresh);
  signal.addEventListener('abort', () => { if (timer !== null) clearInterval(timer); timer = null; }, {once: true});

  await refresh();
  return {
    async command(action) { if (action === 'open') await refresh(); },
    dispose() { if (timer !== null) clearInterval(timer); timer = null; },
  };
}
