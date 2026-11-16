// Projects (issue #77): notes, tasks and bookmarks as one list, filtered by project, kind and
// archive, with an editor for one item and the projects themselves. Rows are read from the core
// through the bridge whenever the view is shown (ui/items.js). Every draft (a new item, an edit,
// a new or renamed project) stays in its field until the core has saved it. An edit is saved
// only over the row it was opened from. A row changed since is reported, the fields the person
// did not edit show the newer row, and saving again writes only the fields the person edited.
import { LIMITS, collection, counts, draftItem, excerpt, isArchived, title } from '../items.js';
import { itemStore, maker, redraw, statusLine, whenShown } from './view-kit.js';

const KINDS = {note: 'Note', task: 'Task', bookmark: 'Bookmark'};
const CHANGED = 'That item was changed after you opened it. Your changes were not saved. Save again to apply them to the newer version.';
const MISSING = 'That item no longer exists.';

export async function mount({surface, signal, bridge, host}) {
  const document = surface.ownerDocument;
  const h = maker(document);
  const alive = () => !signal.aborted;
  const options = (pairs, chosen) => pairs.map(([value, label]) => h('option', {value, text: label, selected: value === chosen}));
  const filter = {projectId: 'all', kind: 'all', archived: false};
  const drafts = new Map(); // item ID → {opened, fields, edited}: an edit not yet saved, and the names of the fields the person changed
  const renames = new Map(); // project ID → a new name not yet saved
  let selected = null, confirming = null, rows = [], projects = [], addNumber = 0, projectNumber = 0;

  // Filters and counts.
  const projectFilter = h('select', {'aria-label': 'Project', 'data-filter-project': true});
  const kindFilter = h('select', {'aria-label': 'Kind', 'data-filter-kind': true}, options([['all', 'Everything'], ['note', 'Notes'], ['task', 'Tasks'], ['bookmark', 'Bookmarks']], 'all'));
  const activeButton = h('button', {type: 'button', 'data-show-archived': 'false', 'aria-pressed': 'true', text: 'Active'});
  const archiveButton = h('button', {type: 'button', 'data-show-archived': 'true', 'aria-pressed': 'false', text: 'Archive'});
  const tally = h('p', {class: 'muted', 'data-projects-counts': true});
  // New item.
  const addKind = h('select', {name: 'kind', 'aria-label': 'Kind of item', 'data-add-kind': true}, options(Object.entries(KINDS), 'note'));
  const addText = h('textarea', {name: 'text', rows: 2, 'aria-label': 'New item', placeholder: 'Write a note, a task or a page name', 'data-add-text': true});
  const addUrl = h('input', {type: 'url', name: 'url', hidden: true, 'aria-label': 'Page address', placeholder: 'Page address', spellcheck: 'false', 'data-add-url': true});
  const addSave = h('button', {type: 'submit', text: 'Add'});
  const added = statusLine(h, {'data-add-status': true});
  const addForm = h('form', {class: 'capture', autocomplete: 'off', 'aria-label': 'New item', 'data-add': true}, [addText, addUrl, h('div', {class: 'view-row'}, [addKind, addSave]), added.line]);
  // List, editor and projects.
  const list = h('ul', {class: 'item-list', 'data-item-list': true});
  const empty = h('p', {class: 'muted', 'data-item-empty': true, text: 'Nothing here yet.'});
  const listed = statusLine(h, {'data-list-status': true});
  const editor = h('section', {class: 'card editor', hidden: true, 'aria-labelledby': 'editor-title', 'data-editor': true});
  const projectName = h('input', {type: 'text', name: 'name', maxlength: 40, 'aria-label': 'New project name', placeholder: 'New project', 'data-project-name': true});
  const projectForm = h('form', {class: 'view-row', autocomplete: 'off', 'data-project-add': true}, [projectName, h('button', {type: 'submit', text: 'Add project'})]);
  const projectList = h('ul', {class: 'project-list', 'data-project-list': true});
  const projectStatus = statusLine(h, {'data-project-status': true});
  const problem = statusLine(h, {'data-projects-problem': true});
  const retry = h('button', {type: 'button', hidden: true, 'data-projects-retry': true, text: 'Try again'});
  surface.append(h('section', {class: 'view projects'}, [
    h('h2', {text: 'Projects'}),
    h('div', {class: 'view-row filters'}, [projectFilter, kindFilter, h('div', {role: 'group', 'aria-label': 'Show', class: 'view-row'}, [activeButton, archiveButton]), tally]),
    h('div', {class: 'view-row'}, [problem.line, retry]),
    addForm, listed.line, list, empty, editor,
    h('section', {class: 'card', 'aria-labelledby': 'project-admin-title'}, [h('h3', {id: 'project-admin-title', text: 'Projects'}), projectForm, projectList, projectStatus.line]),
  ]));

  const store = itemStore({bridge, host, signal, draw: value => draw(value)});
  const nameOf = id => projects.find(project => project.id === id)?.name ?? '';
  const projectChoices = () => [['', 'Inbox'], ...projects.map(project => [project.id, project.name])];

  function draw(value = store.snapshot()) {
    ({items: rows, projects} = value);
    if (filter.projectId !== 'all' && filter.projectId !== 'inbox' && !nameOf(filter.projectId)) filter.projectId = 'all';
    projectFilter.replaceChildren(...options([['all', 'All projects'], ['inbox', 'Inbox'], ...projects.map(project => [project.id, project.name])], filter.projectId));
    const tallied = counts(rows);
    tally.textContent = `${tallied.active} of ${LIMITS.active} active · ${tallied.total} of ${LIMITS.items} items`;
    const shown = collection(rows, filter);
    redraw(list, () => list.replaceChildren(...shown.map(row)));
    empty.hidden = shown.length > 0;
    redraw(projectList, () => projectList.replaceChildren(...projects.map(projectRow)));
    if (selected) drawEditor();
  }
  function row(item) {
    const archived = isArchived(item), name = title(item);
    const detail = item.kind === 'note' ? excerpt(item.body) : item.kind === 'bookmark' ? item.url : '';
    return h('li', {'data-item': item.id, 'data-kind': item.kind}, [
      item.kind === 'task' ? h('input', {type: 'checkbox', checked: archived, 'aria-label': `Done: ${name}`, 'data-complete': item.id, 'data-focus-key': `done:${item.id}`}) : null,
      h('div', {class: 'item-main'}, [
        h('button', {type: 'button', class: 'item-open', 'data-open': item.id, 'data-focus-key': `open:${item.id}`, 'aria-current': item.id === selected ? 'true' : null, text: name}),
        h('p', {class: 'muted', text: `${KINDS[item.kind] ?? item.kind} · ${nameOf(item.projectId) || 'Inbox'}${drafts.has(item.id) ? ' · Unsaved edit' : ''}`}),
        detail && detail !== name ? h('p', {class: 'muted item-detail', text: detail}) : null,
      ]),
      h('div', {class: 'view-row'}, [
        h('button', {type: 'button', 'data-archive': item.id, 'data-focus-key': `archive:${item.id}`, text: archived ? 'Restore' : 'Archive'}),
        h('button', {type: 'button', 'data-delete': item.id, 'data-focus-key': `delete:${item.id}`, text: confirming === `item:${item.id}` ? 'Confirm delete' : 'Delete'}),
      ]),
    ]);
  }
  function projectRow(project) {
    return h('li', {'data-project': project.id}, [
      h('input', {type: 'text', maxlength: 40, value: renames.get(project.id) ?? project.name, 'aria-label': `Name of ${project.name}`, 'data-rename-input': project.id, 'data-focus-key': `name:${project.id}`}),
      h('button', {type: 'button', 'data-rename': project.id, 'data-focus-key': `rename:${project.id}`, text: 'Rename'}),
      h('button', {type: 'button', 'data-remove-project': project.id, 'data-focus-key': `remove:${project.id}`, text: confirming === `project:${project.id}` ? 'Confirm delete' : 'Delete'}),
    ]);
  }

  // The editor shows one item. Its fields are the draft, kept per item until saved.
  const fieldsFor = item => item.kind === 'note' ? {title: item.title || item.text, body: item.body, projectId: item.projectId}
    : item.kind === 'bookmark' ? {text: item.text, url: item.url, projectId: item.projectId} : {text: item.text, projectId: item.projectId};
  let editorStatus = statusLine(h, {'data-editor-status': true});
  function open(id) {
    const item = rows.find(entry => entry.id === id);
    if (!item) return;
    if (!drafts.has(id)) drafts.set(id, {opened: item.updatedAt, fields: fieldsFor(item), edited: new Set()});
    selected = id;
    editorStatus = statusLine(h, {'data-editor-status': true});
    drawEditor({build: true});
    draw();
    editor.querySelector('input, textarea')?.focus();
  }
  function drawEditor({build = false} = {}) {
    const item = rows.find(entry => entry.id === selected), draft = drafts.get(selected);
    if (!item || !draft) {
      if (selected && draft) editorStatus.say(MISSING, true);
      else { editor.hidden = true; selected = null; return; }
    }
    editor.hidden = false;
    const project = editor.querySelector('[data-edit-field="projectId"]');
    if (!build && project) {
      // Projects may have changed; keep the chosen one.
      project.replaceChildren(...options(projectChoices(), draft.fields.projectId));
      return;
    }
    const kind = item?.kind ?? 'note';
    const field = (label, control) => h('label', {class: 'field'}, [label, control]);
    const input = (name, attributes = {}) => h('input', {type: 'text', name, value: draft.fields[name] ?? '', 'data-edit-field': name, ...attributes});
    const fields = kind === 'note' ? [field('Title', input('title')), field('Body', h('textarea', {name: 'body', rows: 6, 'data-edit-field': 'body', text: draft.fields.body ?? ''}))]
      : kind === 'bookmark' ? [field('Name', input('text')), field('Address', input('url', {type: 'url', spellcheck: 'false'}))]
      : [field('Task', input('text'))];
    editor.replaceChildren(
      h('h3', {id: 'editor-title', text: `Edit ${KINDS[kind]?.toLowerCase() ?? 'item'}`}),
      h('form', {class: 'editor-form', autocomplete: 'off', 'data-editor-form': true}, [
        ...fields,
        field('Project', h('select', {name: 'projectId', 'data-edit-field': 'projectId'}, options(projectChoices(), draft.fields.projectId))),
        h('div', {class: 'view-row'}, [h('button', {type: 'submit', text: 'Save'}), h('button', {type: 'button', 'data-editor-close': true, text: 'Close'}), h('button', {type: 'button', 'data-editor-discard': true, text: 'Discard changes'})]),
      ]),
      editorStatus.line,
    );
  }
  // The row changed after the editor opened it: the fields the person did not edit take the newer
  // row's values and are shown again, so saving again writes over nothing the person was not shown.
  function rebase(draft, latest) {
    const newer = fieldsFor(latest);
    for (const name of Object.keys(newer)) if (!draft.edited.has(name)) draft.fields[name] = newer[name];
    draft.opened = latest.updatedAt;
    const focused = editor.contains(document.activeElement) ? document.activeElement.dataset?.editField : undefined;
    drawEditor({build: true});
    if (focused) editor.querySelector(`[data-edit-field="${focused}"]`)?.focus();
  }
  // Only the fields the person edited, so a field another writer changed is never written back.
  function editedChanges(current, draft) {
    const values = draft.fields, edited = name => draft.edited.has(name), changes = {};
    if (edited('projectId')) changes.projectId = values.projectId;
    if (current.kind === 'note') {
      if (edited('title')) Object.assign(changes, {title: values.title.trim(), text: values.title.trim() || current.text});
      if (edited('body')) changes.body = values.body;
    } else if (current.kind === 'bookmark') {
      if (edited('text') || edited('url')) changes.text = values.text.trim() || values.url.trim();
      if (edited('url')) changes.url = values.url.trim();
    } else if (edited('text')) changes.text = values.text.trim();
    return changes;
  }
  async function saveEdit() {
    const id = selected, draft = drafts.get(id), current = rows.find(entry => entry.id === id);
    if (!draft) return;
    if (!current) { editorStatus.say(MISSING, true); return; }
    if (current.updatedAt !== draft.opened) { rebase(draft, current); editorStatus.say(CHANGED, true); return; }
    const changes = editedChanges(current, draft);
    if (current.kind === 'task' && draft.edited.has('text') && !changes.text) { editorStatus.say('Write the task first.', true); return; }
    if (current.kind === 'bookmark' && draft.edited.has('url') && !changes.url) { editorStatus.say('Add the page address.', true); return; }
    editorStatus.say('Saving…');
    const result = await store.update(id, changes);
    if (!alive()) return;
    if (result.saved) {
      drafts.delete(id);
      drafts.set(id, {opened: result.item.updatedAt, fields: fieldsFor(result.item), edited: new Set()});
      editorStatus.say('Saved.');
      draw();
      return;
    }
    if (result.conflict) {
      await store.load();
      if (!alive()) return;
      const latest = rows.find(entry => entry.id === id);
      if (latest) rebase(draft, latest);
      editorStatus.say(latest ? CHANGED : MISSING, true);
      return;
    }
    editorStatus.say(result.error, true);
  }
  editor.addEventListener('input', event => {
    const name = event.target.dataset?.editField, draft = drafts.get(selected);
    if (!name || !draft) return;
    draft.fields[name] = event.target.value;
    draft.edited.add(name);
  });
  editor.addEventListener('change', event => {
    const draft = drafts.get(selected);
    if (event.target.dataset?.editField === 'projectId' && draft) { draft.fields.projectId = event.target.value; draft.edited.add('projectId'); }
  });
  editor.addEventListener('submit', event => { event.preventDefault(); saveEdit(); });
  editor.addEventListener('click', event => {
    if (event.target.closest('[data-editor-close]')) {
      // A changed draft is kept for this item; reopening it shows the draft again.
      if (!drafts.get(selected)?.edited.size) drafts.delete(selected);
      selected = null; editor.hidden = true; draw();
    } else if (event.target.closest('[data-editor-discard]')) {
      const id = selected, item = rows.find(entry => entry.id === id);
      drafts.delete(id);
      if (item) open(id); else { selected = null; editor.hidden = true; draw(); }
    }
  });

  // New item.
  addKind.addEventListener('change', () => { addUrl.hidden = addKind.value !== 'bookmark'; });
  addForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (addSave.disabled) return;
    const projectId = filter.projectId === 'all' || filter.projectId === 'inbox' ? '' : filter.projectId;
    const kind = addKind.value, fields = draftItem({kind, text: addText.value, url: addUrl.value, projectId});
    if (!fields) { added.say(kind === 'bookmark' ? 'Add the page address.' : 'Write something to add.', true); (kind === 'bookmark' ? addUrl : addText).focus(); return; }
    addSave.disabled = true; addText.readOnly = true; addUrl.readOnly = true;
    added.say('Saving…');
    const result = await store.create(fields, {draft: `add:${addNumber}`});
    if (!alive()) return;
    addSave.disabled = false; addText.readOnly = false; addUrl.readOnly = false;
    if (result.saved) { addNumber += 1; addText.value = ''; addUrl.value = ''; added.say(`${KINDS[kind]} added.`); }
    else added.say(result.error, true);
  });

  // List actions.
  list.addEventListener('click', async event => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.open) { open(target.dataset.open); return; }
    if (target.dataset.archive) {
      const id = target.dataset.archive, item = rows.find(entry => entry.id === id);
      target.disabled = true;
      const result = await store.setStage(id, item && isArchived(item) ? 'restore' : 'done');
      if (!alive()) return;
      listed.say(result.saved ? '' : result.error, !result.saved);
      draw();
      return;
    }
    if (target.dataset.delete) {
      const id = target.dataset.delete;
      if (confirming !== `item:${id}`) { confirming = `item:${id}`; draw(); return; }
      confirming = null;
      target.disabled = true;
      const result = await store.remove(id);
      if (!alive()) return;
      if (result.saved) { drafts.delete(id); if (selected === id) { selected = null; editor.hidden = true; } }
      listed.say(result.saved ? 'Deleted.' : result.error, !result.saved);
      draw();
    }
  });
  list.addEventListener('change', async event => {
    const box = event.target.closest('[data-complete]');
    if (!box) return;
    box.disabled = true;
    const result = await store.complete(box.dataset.complete, box.checked);
    if (!alive()) return;
    listed.say(result.saved ? '' : result.error, !result.saved);
    draw();
  });

  // Filters.
  projectFilter.addEventListener('change', () => { filter.projectId = projectFilter.value; draw(); });
  kindFilter.addEventListener('change', () => { filter.kind = kindFilter.value; draw(); });
  for (const choice of [activeButton, archiveButton]) choice.addEventListener('click', () => {
    filter.archived = choice.dataset.showArchived === 'true';
    activeButton.setAttribute('aria-pressed', String(!filter.archived));
    archiveButton.setAttribute('aria-pressed', String(filter.archived));
    draw();
  });

  // Projects.
  projectForm.addEventListener('submit', async event => {
    event.preventDefault();
    const name = projectName.value.trim();
    if (!name) { projectStatus.say('Name the project first.', true); projectName.focus(); return; }
    const result = await store.createProject(name, {draft: `project:${projectNumber}`});
    if (!alive()) return;
    if (result.saved) { projectNumber += 1; projectName.value = ''; projectStatus.say(`${result.project.name} is ready.`); }
    else projectStatus.say(result.error, true);
  });
  projectList.addEventListener('input', event => { const id = event.target.dataset?.renameInput; if (id) renames.set(id, event.target.value); });
  projectList.addEventListener('click', async event => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.rename) {
      const id = target.dataset.rename, input = projectList.querySelector(`[data-rename-input="${id}"]`);
      const result = await store.renameProject(id, input.value);
      if (!alive()) return;
      if (result.saved) renames.delete(id);
      projectStatus.say(result.saved ? 'Renamed.' : result.error, !result.saved);
      if (!result.saved) input.focus();
      return;
    }
    if (target.dataset.removeProject) {
      const id = target.dataset.removeProject;
      if (confirming !== `project:${id}`) { confirming = `project:${id}`; draw(); return; }
      confirming = null;
      const result = await store.removeProject(id);
      if (!alive()) return;
      projectStatus.say(result.saved ? (result.warning || 'Project deleted. Its items are in the inbox.') : result.error, !result.saved || Boolean(result.warning));
      draw();
    }
  });

  async function refresh() {
    const read = await store.load();
    if (!alive()) return;
    problem.say(read.ok ? '' : read.error, !read.ok);
    retry.hidden = read.ok;
    draw();
  }
  retry.addEventListener('click', refresh);
  whenShown(document, signal, refresh);

  await refresh();
  return {
    async command(action) { if (action === 'open') await refresh(); },
    dispose() {},
  };
}
