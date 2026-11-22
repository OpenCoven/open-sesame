// Today (issue #77): quick capture, the latest note, the focus clock and the open tasks, as the
// mobile presentation's Today overlay shows them (dist/mobile-shell.js, docs/mobile-shell.md).
// Its rows and the focus session are read from the core through the bridge whenever it is shown.
// A draft is kept in its field until the core has saved it; the palette's captures arrive here
// as the commands `capture-note`, `capture-task` and `capture-<kind>@<draft>:<text>`, and a
// capture that was saved answers `{saved: true}`.
import { draftItem, title, today as summary } from '../items.js';
import { createFocusStore } from '../focus-model.js';
import { itemStore, maker, redraw, statusLine, whenShown } from './view-kit.js';

const SAVED = {note: 'Note saved.', task: 'Task saved.'};
const EMPTY = 'Write something to capture.';
const FOCUS = {idle: 'Ready to start', running: 'Running', paused: 'Paused', finished: 'Session complete'};
const CAPTURE = /^capture-(note|task)(?:@([A-Za-z0-9-]{1,64}))?(?::([\s\S]*))?$/;

export async function mount({surface, signal, bridge, host, navigate}) {
  const document = surface.ownerDocument;
  const h = maker(document);
  const alive = () => !signal.aborted;

  const date = h('p', {class: 'today-date'});
  const text = h('textarea', {name: 'text', rows: 2, 'data-capture-text': true, 'aria-label': 'What to capture', placeholder: 'Write a note or a task'});
  const kind = h('select', {name: 'kind', 'aria-label': 'Capture as', 'data-capture-kind': true}, [h('option', {value: 'note', text: 'Note'}), h('option', {value: 'task', text: 'Task'})]);
  const save = h('button', {type: 'submit', text: 'Save'});
  const capture = statusLine(h, {'data-capture-status': true});
  const form = h('form', {class: 'capture', 'data-capture': true, autocomplete: 'off', 'aria-label': 'Quick capture'}, [text, h('div', {class: 'view-row'}, [kind, save]), capture.line]);
  const note = h('article', {class: 'card', 'data-today-note': true, 'aria-labelledby': 'today-note-title'});
  const clock = h('p', {class: 'today-clock', 'data-today-clock': true});
  const focusState = h('p', {class: 'muted', 'data-today-focus-state': true});
  const focusCard = h('article', {class: 'card', 'data-today-focus': true, 'aria-labelledby': 'today-focus-title'}, [
    h('h3', {id: 'today-focus-title', text: 'Focus'}), clock, focusState, h('button', {type: 'button', 'data-open-focus': true, text: 'Open Focus'}),
  ]);
  const taskCount = h('p', {class: 'muted', 'data-today-task-count': true});
  const taskList = h('ul', {class: 'today-tasks', 'data-today-tasks': true});
  const tasks = h('section', {class: 'card', 'aria-labelledby': 'today-tasks-title'}, [h('h3', {id: 'today-tasks-title', text: 'Tasks'}), taskCount, taskList]);
  const problem = statusLine(h, {'data-today-problem': true});
  const retry = h('button', {type: 'button', hidden: true, 'data-today-retry': true, text: 'Try again'});
  surface.append(h('section', {class: 'view today'}, [
    h('header', {}, [date, h('h2', {text: 'Today'})]), form, h('div', {class: 'view-row'}, [problem.line, retry]), h('div', {class: 'today-cards'}, [note, focusCard]), tasks,
  ]));

  const items = itemStore({bridge, host, signal, draw: value => drawItems(value)});
  const focus = createFocusStore({bridge, now: () => Date.now()});
  let timer = null, draftNumber = 0, saving = false;

  function drawItems({items: rows, projects}) {
    const shown = summary(rows, projects);
    note.replaceChildren(h('h3', {id: 'today-note-title', text: 'Latest note'}));
    if (shown.latest) {
      note.append(h('p', {class: 'card-title', 'data-today-note-title': true, text: shown.latest.title}));
      if (shown.latest.excerpt && shown.latest.excerpt !== shown.latest.title) note.append(h('p', {class: 'muted', text: shown.latest.excerpt}));
      if (shown.latest.project) note.append(h('p', {class: 'muted', text: shown.latest.project}));
    } else note.append(h('p', {class: 'muted', text: 'No notes yet. Capture one above.'}));
    note.append(h('button', {type: 'button', 'data-open-projects': true, text: 'Open Projects'}));
    taskCount.textContent = `${shown.tasks.open} open · ${shown.tasks.done} done`;
    redraw(taskList, () => taskList.replaceChildren(...(shown.tasks.entries.length ? shown.tasks.entries.map(task => h('li', {'data-item': task.id}, [
      h('label', {}, [h('input', {type: 'checkbox', 'data-complete': task.id, 'data-focus-key': `done:${task.id}`}), h('span', {text: title(task)})]),
    ])) : [h('li', {class: 'muted', tabindex: -1, text: 'No open tasks.'})])), () => taskList.querySelector('li[tabindex]'));
  }
  function drawFocus() {
    const shown = focus.view();
    clock.textContent = shown.clock;
    focusState.textContent = focus.problem || FOCUS[shown.status];
    // The display is drawn again each second while the session runs; the time shown is always
    // worked out from the stored times, so a missed redraw changes nothing.
    if (shown.status === 'running' && timer === null) timer = setInterval(() => { if (alive()) drawFocus(); }, 1000);
    if (shown.status !== 'running' && timer !== null) { clearInterval(timer); timer = null; }
  }
  async function refresh() {
    date.textContent = new Intl.DateTimeFormat(undefined, {weekday: 'long', day: 'numeric', month: 'long'}).format(Date.now());
    const [read] = await Promise.all([items.load(), focus.load()]);
    if (!alive()) return;
    problem.say(read.ok ? '' : read.error, !read.ok);
    retry.hidden = read.ok;
    // A failed read is not an empty store: the note and task cards wait for a read that works.
    note.hidden = !read.ok; tasks.hidden = !read.ok;
    drawFocus();
  }

  async function submit() {
    if (saving) return;
    const chosen = kind.value, fields = draftItem({kind: chosen, text: text.value});
    if (!fields) { capture.say(EMPTY, true); text.focus(); return; }
    saving = true; text.readOnly = true; save.disabled = true;
    capture.say('Saving…');
    const result = await items.create(fields, {draft: `field:${draftNumber}`});
    if (!alive()) return;
    saving = false; text.readOnly = false; save.disabled = false;
    if (result.saved) { draftNumber += 1; text.value = ''; capture.say(SAVED[chosen]); }
    else capture.say(result.error, true);
    text.focus();
  }
  form.addEventListener('submit', event => { event.preventDefault(); submit(); });
  text.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); submit(); }
  });
  surface.addEventListener('click', event => {
    if (event.target.closest('[data-open-projects]')) navigate('projects');
    else if (event.target.closest('[data-open-focus]')) navigate('focus');
    else if (event.target.closest('[data-today-retry]')) refresh();
  });
  taskList.addEventListener('change', async event => {
    const box = event.target.closest('[data-complete]');
    if (!box) return;
    box.disabled = true;
    const result = await items.complete(box.dataset.complete, true);
    if (!alive()) return;
    if (!result.saved) { box.checked = false; box.disabled = false; problem.say(result.error, true); }
    else problem.say('');
  });
  whenShown(document, signal, refresh);
  signal.addEventListener('abort', () => { if (timer !== null) clearInterval(timer); timer = null; }, {once: true});

  await refresh();
  return {
    async command(action) {
      if (action === 'open') return refresh();
      const match = CAPTURE.exec(action);
      if (!match) return;
      const [, chosen, draft, typed] = match;
      if (typed === undefined) { kind.value = chosen; text.focus(); return; }
      // A capture typed in the palette is saved under the palette's draft, so the field's draft
      // is never replaced, and a retry of it after a failure or a lost reply, edited or not,
      // keeps its client ID; when it fails, the palette keeps the text and shows why.
      const fields = draftItem({kind: chosen, text: typed});
      if (!fields) throw Error(EMPTY);
      await refresh();
      const result = await items.create(fields, {draft: draft ? `palette:${draft}` : `palette:${chosen}:${typed}`});
      if (!result.saved) throw Error(result.error);
      if (alive()) capture.say(SAVED[chosen]);
      return {saved: true};
    },
    dispose() { if (timer !== null) clearInterval(timer); timer = null; },
  };
}
