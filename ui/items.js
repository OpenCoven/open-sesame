// Notes, tasks, bookmarks and projects for Today and Projects (issue #77). The core owns the
// rows (crates/core/src/storage); this module owns the rules the UI applies on top of them and is
// the only place the restart's views write items. It reaches the core only through the bridge
// it is handed, and checked by scripts/check-ui-items.mjs.
//
// - Archived means stage 'done', or a task with done set, as in dist/item-workflow.js. The UI
//   writes both fields together: archiving sets stage 'done' and, for a task, done; restoring
//   clears both. Rows another writer stored with only one of them set are read by the same rule.
// - The caps are the prototype's: 300 items in all, 30 that are not archived, 30 projects, with
//   its sentences. The core does not enforce them, so a capped save never reaches it.
// - A create names a client UUID v4 kept per draft. After a failure or a lost reply, the same
//   draft is sent again under the same ID, so the core keeps one row; if the draft changed in
//   between, the stored row is looked up first and edited rather than duplicated.
// - Every edit names the updatedAt it started from. A conflict is reported and overwrites
//   nothing; reading again picks up the other change.
// - Nothing is shown as saved until the core answers with the stored row. Timestamps are never
//   sent; they are the core's.

export const LIMITS = Object.freeze({items: 300, active: 30, projects: 30});
const STAGES = ['inbox', 'active', 'review'];
const FIELDS = ['kind', 'text', 'title', 'body', 'url', 'projectId', 'stage', 'previousStage', 'done', 'priority', 'dueDate', 'read', 'readingLater'];
const DEFAULTS = Object.freeze({text: '', title: '', body: '', url: '', projectId: '', stage: 'inbox', previousStage: null, done: false, priority: null, dueDate: '', read: false, readingLater: false});
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// The bridge's sentence when the host does not answer (ui/bridge.js).
const NO_RESPONSE = 'The desktop connection did not respond.';
const ITEM_CONFLICT = 'That item was changed after you opened it. Your changes were not saved.';
const PROJECT_CONFLICT = 'That project was changed after you opened it. Your changes were not saved.';
const ITEM_MISSING = 'That item no longer exists.';
const PROJECT_MISSING = 'That project no longer exists.';
const CAPS = Object.freeze({
  active: 'You have 30 active items. Archive one to make room.',
  items: 'Your archive is full. Remove an archived item to make room.',
  projects: 'You have 30 projects.',
  restore: kind => `Complete or archive an item before restoring this ${kind}.`,
});

// ---- Rules, ported from the prototype ----

const known = value => STAGES.includes(value);
export const isArchived = item => item?.stage === 'done' || (item?.kind === 'task' && item.done === true);
export const stage = item => isArchived(item) ? 'done' : known(item?.stage) ? item.stage : 'inbox';

// The fields that archive ('done'), restore ('restore') or move an item between stages, or null
// for a stage that does not exist. As in the prototype, done is written only for a task.
export function patch(item, value) {
  if (value === 'restore') value = known(item.previousStage) ? item.previousStage : 'inbox';
  if (value !== 'done' && !known(value)) return null;
  return {stage: value, done: value === 'done' && item.kind === 'task', previousStage: value === 'done' ? (known(item.stage) ? item.stage : known(item.previousStage) ? item.previousStage : 'inbox') : value};
}

// Plain text from a note's Markdown, at most 180 characters.
export function excerpt(body) {
  const text = String(body || '').replace(/```[^\n]*\n?|~~~[^\n]*\n?/g, ' ')
    .replace(/!\[([^\]]*)\]\([^\n]*?\)/g, '$1').replace(/\[([^\]]+)\]\([^\n]*?\)/g, '$1')
    .replace(/<\/?[a-z][^>]*>/gi, '').replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)/gm, '')
    .replace(/\*\*|__|~~|`/g, '').replace(/\s+/g, ' ').trim();
  return text.length > 180 ? text.slice(0, 177).trimEnd() + '…' : text;
}

// What a row is called wherever it is listed. An address that cannot be parsed is shown as written.
export function title(item) {
  if (item.title) return item.title;
  if (!item.url) return item.text || 'Untitled ' + item.kind;
  const cleaned = item.text.replace(/https?:\/\/[^\s<>"']+/ig, '').trim();
  if (cleaned) return cleaned;
  try {
    const address = new URL(item.url);
    return address.hostname.replace(/^www\./, '') + (address.pathname === '/' ? '' : address.pathname);
  } catch { return item.url; }
}

const byChange = (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

export function counts(items) {
  const archived = items.filter(isArchived).length;
  return {total: items.length, active: items.length - archived, archived};
}

// One Projects list: every kind together unless one is chosen, in all projects ('all'), the
// inbox ('inbox') or one project, active or archived; most recently changed first.
export function collection(items, {projectId = 'all', archived = false, kind = 'all'} = {}) {
  return items.filter(item => isArchived(item) === archived && (kind === 'all' || item.kind === kind)
    && (projectId === 'all' || (projectId === 'inbox' ? !item.projectId : item.projectId === projectId))).sort(byChange);
}

// Today, as the mobile presentation projects it: the latest active note by updatedAt, then
// createdAt, with a plain-text excerpt and its project's name, and the open tasks with up to
// three rows to complete in place.
export function today(items, projects) {
  const notes = items.filter(item => item.kind === 'note' && !isArchived(item));
  const latest = notes.reduce((best, item) => !best || item.updatedAt > best.updatedAt || (item.updatedAt === best.updatedAt && item.createdAt > best.createdAt) ? item : best, null);
  const tasks = items.filter(item => item.kind === 'task'), open = tasks.filter(item => !isArchived(item)).sort(byChange);
  return {
    latest: latest && {item: latest, title: title(latest), excerpt: excerpt(latest.body) || excerpt(title(latest)), project: projects.find(project => project.id === latest.projectId)?.name ?? ''},
    tasks: {open: open.length, done: tasks.length - open.length, entries: open.slice(0, 3)},
  };
}

// ---- Store ----

const sentence = error => (typeof error === 'string' && error) || (error && typeof error.message === 'string' && error.message) || NO_RESPONSE;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const wire = item => Object.fromEntries(FIELDS.map(key => [key, Object.hasOwn(item, key) ? item[key] : DEFAULTS[key]]));
const pick = changes => Object.fromEntries(Object.entries(changes).filter(([key]) => FIELDS.includes(key)));
const freeze = rows => Object.freeze(rows.map(row => Object.freeze({...row})));

export function createItemStore({bridge, uuid}) {
  if (typeof bridge?.request !== 'function' || typeof uuid !== 'function') throw TypeError('The item store needs a bridge and a UUID source.');
  let items = [], projects = [], problem = 'Your items are still loading.';
  const creates = new Map(), edits = new Map(), listeners = new Set();
  const snapshot = () => Object.freeze({items: freeze(items), projects: freeze(projects)});
  const notify = () => { const value = snapshot(); for (const listener of [...listeners]) listener(value); };
  const keep = row => { items = [...items.filter(item => item.id !== row.id), row].sort(byChange); };
  const keepProject = row => { projects = [...projects.filter(project => project.id !== row.id), row].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())); };
  const failure = (error, conflictSentence) => ({saved: false, error: sentence(error), conflict: sentence(error) === conflictSentence});
  const refused = (error, extra = {}) => ({saved: false, error, ...extra});
  // The stored row for an ID, or null. The core serves items.get; for projects it serves only the list.
  const findItem = async id => (await bridge.request('items.get', {id}))?.item ?? null;
  const findProject = async id => {
    const listed = (await bridge.request('projects.list', {}))?.projects;
    if (!Array.isArray(listed)) throw Error('Could not read your saved data. Try again.');
    return listed.find(project => project.id === id) ?? null;
  };
  const freshId = () => {
    const id = uuid();
    if (typeof id !== 'string' || !V4.test(id)) throw Error('Open Sesame could not make an ID for this item. Try again.');
    return id;
  };

  async function load() {
    try {
      const [listed, grouped] = await Promise.all([bridge.request('items.list', {}), bridge.request('projects.list', {})]);
      if (!Array.isArray(listed?.items) || !Array.isArray(grouped?.projects)) throw Error('Could not read your saved data. Try again.');
      [items, projects, problem] = [[...listed.items].sort(byChange), grouped.projects, null];
      notify();
      return {ok: true};
    } catch (error) {
      problem = sentence(error);
      return {ok: false, error: problem};
    }
  }

  // A create keeps its ID with its draft until the core confirms it; see the header.
  async function send(draftKey, payload, {method, field, conflictSentence, row, stored, lookup}) {
    let attempt = creates.get(draftKey), expectedUpdatedAt;
    if (!attempt || !same(attempt.payload, payload)) {
      let id;
      if (attempt) {
        // The draft changed after an attempt whose outcome is unknown: did that one commit?
        let found;
        try { found = await lookup(attempt.id); } catch (error) { return failure(error, conflictSentence); }
        id = attempt.id;
        if (found) { stored(found); expectedUpdatedAt = found.updatedAt; }
      } else {
        try { id = freshId(); } catch (error) { return refused(error.message); }
      }
      attempt = {id, payload, expectedUpdatedAt};
      creates.set(draftKey, attempt);
    }
    try {
      const sent = {...attempt.payload, id: attempt.id, ...(attempt.expectedUpdatedAt === undefined ? {} : {expectedUpdatedAt: attempt.expectedUpdatedAt})};
      const reply = await bridge.request(method, {[field]: sent});
      if (creates.get(draftKey) === attempt) creates.delete(draftKey);
      stored(reply[field]);
      notify();
      return {saved: true, [row]: reply[field]};
    } catch (error) { return failure(error, conflictSentence); }
  }

  function create(fields, {draft} = {}) {
    if (typeof draft !== 'string' || !draft) throw TypeError('A create names its draft.');
    return (async () => {
      if (problem) return refused(problem);
      const active = counts(items).active;
      if (!isArchived(fields) && active >= LIMITS.active) return refused(CAPS.active, {cap: true});
      if (items.length >= LIMITS.items) return refused(CAPS.items, {cap: true});
      return send(`item:${draft}`, wire({...DEFAULTS, ...pick(fields)}), {method: 'items.save', field: 'item', row: 'item', conflictSentence: ITEM_CONFLICT, stored: keep, lookup: findItem});
    })();
  }

  // An edit of the row as last read. After a lost reply, the same edit is sent again unchanged; a
  // newer one first reads the row and, if the earlier edit had committed, builds on it.
  async function update(id, changes) {
    if (problem) return refused(problem);
    let base = items.find(item => item.id === id);
    if (!base) return refused(ITEM_MISSING);
    const after = {...base, ...pick(changes)};
    if (isArchived(base) && !isArchived(after) && counts(items).active >= LIMITS.active) return refused(CAPS.restore(after.kind), {cap: true});
    let payload = {...wire(after), id, expectedUpdatedAt: base.updatedAt};
    const prior = edits.get(id);
    if (prior && !same(prior, payload)) {
      let found;
      try { found = await findItem(id); } catch (error) { return failure(error, ITEM_CONFLICT); }
      if (!found) { items = items.filter(item => item.id !== id); notify(); edits.delete(id); return refused(ITEM_MISSING); }
      if (found.updatedAt !== base.updatedAt && same(wire(found), wire(prior))) {
        keep(found);
        base = found;
        payload = {...wire({...found, ...pick(changes)}), id, expectedUpdatedAt: found.updatedAt};
      }
    }
    edits.set(id, payload);
    try {
      const reply = await bridge.request('items.save', {item: payload});
      if (edits.get(id) === payload) edits.delete(id);
      keep(reply.item);
      notify();
      return {saved: true, item: reply.item};
    } catch (error) { return failure(error, ITEM_CONFLICT); }
  }

  async function setStage(id, value) {
    const item = items.find(row => row.id === id);
    if (!item) return refused(problem ?? ITEM_MISSING);
    const fields = patch(item, value);
    if (!fields) return refused('Choose a valid stage.');
    return update(id, fields);
  }

  function complete(id, done) {
    const item = items.find(row => row.id === id);
    if (item && item.kind !== 'task') throw TypeError('Only a task is completed.');
    return setStage(id, done ? 'done' : 'restore');
  }

  async function remove(id) {
    try {
      await bridge.request('items.delete', {id});
    } catch (error) { return failure(error, ITEM_CONFLICT); }
    items = items.filter(item => item.id !== id);
    creates.forEach((attempt, key) => { if (attempt.id === id) creates.delete(key); });
    edits.delete(id);
    notify();
    return {saved: true};
  }

  function createProject(name, {draft} = {}) {
    if (typeof draft !== 'string' || !draft) throw TypeError('A create names its draft.');
    return (async () => {
      if (problem) return refused(problem);
      const trimmed = String(name ?? '').trim();
      const existing = projects.find(project => project.name.toLowerCase() === trimmed.toLowerCase());
      if (trimmed && existing) return {saved: true, project: existing};
      if (projects.length >= LIMITS.projects) return refused(CAPS.projects, {cap: true});
      return send(`project:${draft}`, {name: trimmed}, {method: 'projects.save', field: 'project', row: 'project', conflictSentence: PROJECT_CONFLICT, stored: keepProject, lookup: findProject});
    })();
  }

  async function renameProject(id, name) {
    const base = projects.find(project => project.id === id);
    if (!base) return refused(problem ?? PROJECT_MISSING);
    try {
      const reply = await bridge.request('projects.save', {project: {id, name: String(name ?? '').trim(), rootPath: base.rootPath ?? '', expectedUpdatedAt: base.updatedAt}});
      keepProject(reply.project);
      notify();
      return {saved: true, project: reply.project};
    } catch (error) { return failure(error, PROJECT_CONFLICT); }
  }

  // The core moves the project's items to the inbox and moves their updatedAt, so they are read
  // again; a failed read is reported after the delete, which did happen.
  async function removeProject(id) {
    try { await bridge.request('projects.delete', {id}); } catch (error) { return failure(error, PROJECT_CONFLICT); }
    projects = projects.filter(project => project.id !== id);
    const reread = await load();
    if (!reread.ok) notify();
    return reread.ok ? {saved: true} : {saved: true, warning: reread.error};
  }

  return Object.freeze({
    load, snapshot, create, update, setStage, complete, remove, createProject, renameProject, removeProject,
    get problem() { return problem; },
    subscribe(listener) {
      if (typeof listener !== 'function') throw TypeError('subscribe needs a function.');
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  });
}
