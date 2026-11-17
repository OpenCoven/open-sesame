// An in-memory stand-in for the core's item and project commands, for headless checks and
// rendered fixtures of the restart UI (issue #77). It follows the rules in
// crates/core/src/storage/ops.rs and model.rs: the core sets every timestamp; a create may name
// a client UUID v4 and the same create sent again finds it and writes nothing; an edit names
// the updatedAt it started from and is refused with the core's conflict sentence otherwise;
// deleting a project moves its items to the inbox and moves their updatedAt forward. It is a
// synthetic host: passing against it is not evidence about the Rust core, which cargo tests.
//
// Faults are queued per method: 'fail' throws before anything is written, 'lose' writes and
// then throws as if the reply was lost, and 'throw' rejects with the given raw value.

export const NO_RESPONSE = 'The desktop connection did not respond.';
export const BAD_REQUEST = 'That request was not understood.';
const ITEM_FIELDS = ['id', 'kind', 'text', 'title', 'body', 'url', 'projectId', 'stage', 'previousStage', 'done', 'priority', 'dueDate', 'read', 'readingLater', 'expectedUpdatedAt'];
const PROJECT_FIELDS = ['id', 'name', 'rootPath', 'expectedUpdatedAt'];
const ROWS = {
  item: {missing: 'That item no longer exists.', changed: 'That item was changed after you opened it. Your changes were not saved.'},
  project: {missing: 'That project no longer exists.', changed: 'That project was changed after you opened it. Your changes were not saved.'},
};
const uuid = version => new RegExp(`^[0-9a-f]{8}-[0-9a-f]{4}-${version}[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`);
const V4 = uuid(4), V7 = uuid(7);
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function createStorageCore({start = Date.UTC(2026, 10, 16, 9, 0, 0), state = null} = {}) {
  let clock = state?.clock ?? start, sequence = state?.sequence ?? 0;
  const items = new Map(state?.items ?? []), projects = new Map(state?.projects ?? []);
  const faults = [], calls = [];
  const now = () => (clock += 1000);
  const newId = () => `0192f000-0000-7000-8000-${String(++sequence).padStart(12, '0')}`;
  const refuse = message => { throw Error(message); };

  function target(rows, table, id, expected, at) {
    if (id === undefined) {
      if (expected !== undefined) refuse(BAD_REQUEST);
      return {id: newId(), createdAt: at, updatedAt: at};
    }
    const stored = table.get(id);
    if (stored && expected === stored.updatedAt) return {id, createdAt: stored.createdAt, updatedAt: Math.max(at, stored.updatedAt + 1)};
    if (stored) return {changed: stored};
    if (expected === undefined && !V7.test(id)) {
      if (!V4.test(id)) refuse('That ID is not valid.');
      return {id, createdAt: at, updatedAt: at};
    }
    refuse(rows.missing);
  }

  function saveItem(draft) {
    if (!draft || typeof draft !== 'object' || Object.keys(draft).some(key => !ITEM_FIELDS.includes(key))) refuse(BAD_REQUEST);
    if (!['note', 'task', 'bookmark'].includes(draft.kind)) refuse(BAD_REQUEST);
    const item = {id: '', kind: draft.kind, text: draft.text ?? '', title: draft.title ?? '', body: draft.body ?? '', url: draft.url ?? '', projectId: draft.projectId ?? '',
      stage: draft.stage ?? 'inbox', previousStage: draft.previousStage ?? null, done: draft.done ?? false, priority: draft.priority ?? null, dueDate: draft.dueDate ?? '',
      read: draft.read ?? false, readingLater: draft.readingLater ?? false, createdAt: 0, updatedAt: 0};
    if (!item.text && !item.title) refuse('An item needs some text.');
    if ([...item.text].length > 20_000) refuse('That text is too long to save.');
    if ([...item.title].length > 300) refuse('That title is too long.');
    if (!item.url && item.kind === 'bookmark') refuse('A bookmark needs a web address.');
    if (!['inbox', 'active', 'review', 'done'].includes(item.stage)) refuse(BAD_REQUEST);
    const at = now(), place = target(ROWS.item, items, draft.id, draft.expectedUpdatedAt, at);
    if (place.changed) {
      Object.assign(item, {id: place.changed.id, createdAt: place.changed.createdAt, updatedAt: place.changed.updatedAt});
      if (same(item, place.changed)) return clone(place.changed);
      refuse(ROWS.item.changed);
    }
    Object.assign(item, {id: place.id, createdAt: place.createdAt, updatedAt: place.updatedAt});
    if (item.projectId && !projects.has(item.projectId)) refuse('That project no longer exists.');
    items.set(item.id, item);
    return clone(item);
  }

  function saveProject(draft) {
    if (!draft || typeof draft !== 'object' || Object.keys(draft).some(key => !PROJECT_FIELDS.includes(key))) refuse(BAD_REQUEST);
    const name = String(draft.name ?? '').trim();
    if (!name) refuse('A project needs a name.');
    if ([...name].length > 40) refuse('That project name is too long.');
    const project = {id: '', name, rootPath: draft.rootPath ?? '', createdAt: 0, updatedAt: 0};
    const at = now(), place = target(ROWS.project, projects, draft.id, draft.expectedUpdatedAt, at);
    if (place.changed) {
      Object.assign(project, {id: place.changed.id, createdAt: place.changed.createdAt, updatedAt: place.changed.updatedAt});
      if (same(project, place.changed)) return clone(place.changed);
      refuse(ROWS.project.changed);
    }
    Object.assign(project, {id: place.id, createdAt: place.createdAt, updatedAt: place.updatedAt});
    for (const other of projects.values()) if (other.id !== project.id && other.name.toLowerCase() === name.toLowerCase()) refuse('A project with that name already exists.');
    projects.set(project.id, project);
    return clone(project);
  }

  const byChange = (a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
  const handlers = {
    'items.list': () => ({items: [...items.values()].sort(byChange).map(clone)}),
    'items.get': ({id}) => ({item: clone(items.get(id)) ?? null}),
    'items.save': ({item}) => ({item: saveItem(item)}),
    'items.delete': ({id}) => ({deleted: items.delete(id)}),
    'projects.list': () => ({projects: [...projects.values()].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id.localeCompare(b.id)).map(clone)}),
    'projects.save': ({project}) => ({project: saveProject(project)}),
    'projects.delete': ({id}) => {
      const at = now();
      for (const item of items.values()) if (item.projectId === id) Object.assign(item, {projectId: '', updatedAt: Math.max(item.updatedAt + 1, at)});
      return {deleted: projects.delete(id)};
    },
  };

  return {
    calls,
    items,
    projects,
    // Queue a fault for the next call of `method`.
    fault(method, mode, value) { faults.push({method, mode, value}); },
    // A row written by another writer, such as the MCP server in #81.
    write(row) { const at = now(); const stored = {...row, updatedAt: Math.max(at, (row.updatedAt ?? 0) + 1)}; items.set(stored.id, stored); return clone(stored); },
    seed(fields) { return saveItem(fields); },
    seedProject(name) { return saveProject({name}); },
    // What survives a relaunch: the whole store and its clock.
    state: () => clone({clock, sequence, items: [...items], projects: [...projects]}),
    bridge: {
      async request(method, params = {}) {
        calls.push([method, clone(params)]);
        const index = faults.findIndex(fault => fault.method === method);
        const fault = index < 0 ? null : faults.splice(index, 1)[0];
        if (fault?.mode === 'throw') throw fault.value;
        if (fault?.mode === 'fail') throw Error(fault.value ?? 'Could not save. Your changes were not stored; try again.');
        const handler = Object.hasOwn(handlers, method) ? handlers[method] : null;
        if (!handler) throw Error('That feature is not available in this version.');
        const result = handler(clone(params));
        if (fault?.mode === 'lose') throw Error(NO_RESPONSE);
        return clone(result);
      },
    },
  };
}
