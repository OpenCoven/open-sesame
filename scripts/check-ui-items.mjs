// Item store (issue #77). ui/items.js is the restart's one owner of notes, tasks, bookmarks and
// projects for Today and Projects. This pins its archive rule, stage patch, excerpt and titles to
// the prototype (dist/item-workflow.js and dist/app.js, loaded in node:vm), then drives the store
// over the in-memory core stand-in: retry with the same client UUID after a lost reply, edits
// that always name expectedUpdatedAt, conflicts that overwrite nothing, the 300/30/30 caps at
// their edges, and failures that report an error and save nothing. No Rust runs here.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFileSync(path.join(root, file), 'utf8');
const I = await import(pathToFileURL(path.join(root, 'ui/items.js')));
const { createStorageCore, NO_RESPONSE } = await import(pathToFileURL(path.join(root, 'scripts/fixtures/ui-storage-core.mjs')));
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const plain = value => value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));

// 1. Pure rules match the prototype.
const window = {};
const context = vm.createContext({window, URL});
vm.runInContext(read('dist/item-workflow.js'), context);
const app = read('dist/app.js');
vm.runInContext(app.slice(app.indexOf('function itemKind(n)'), app.indexOf('function inProject(')), context);
const W = window.OpenSesameItemWorkflow;
const kinds = ['note', 'task', 'bookmark'], stages = ['inbox', 'active', 'review', 'done', 'unknown', undefined];
const samples = [];
for (const kind of kinds) for (const stage of stages) for (const previousStage of ['inbox', 'active', 'review', 'done', null]) for (const done of [false, true]) samples.push({kind, stage, previousStage, done});
for (const item of samples) {
  assert.equal(I.isArchived(item), W.isArchived(item), `isArchived ${JSON.stringify(item)}`);
  assert.equal(I.stage(item), W.stage(item), `stage ${JSON.stringify(item)}`);
  for (const value of ['inbox', 'active', 'review', 'done', 'restore', 'bogus']) {
    const ours = I.patch(item, value), theirs = W.patch(item, value, 0);
    if (theirs) delete theirs.updatedAt;
    assert.deepEqual(plain(ours), plain(theirs), `patch ${JSON.stringify(item)} ${value}`);
  }
}
assert.equal(I.isArchived({kind: 'note', stage: 'inbox', done: true}), false, 'Only a task is archived by done');
assert.equal(I.isArchived({kind: 'task', stage: 'inbox', done: true}), true, 'A task written done by another writer is archived');
for (const body of ['', 'Plain text', '# Heading\n\n- [x] item\n> quote', '```js\ncode\n```', '![alt](a.png) and [link](https://example.com)', '<b>bold</b> **strong** __u__ ~~s~~ `c`', 'x'.repeat(181), 'word '.repeat(60), '1. one\n2) two', null, undefined, 42])
  assert.equal(I.excerpt(body), W.excerpt(body), `excerpt ${JSON.stringify(body)}`);
// One difference from the prototype: the tag step replaces a tag with a space rather than removing
// it, so that step never joins the text around a tag into another one (code scanning alert 24).
// An excerpt can still hold text shaped like a tag and is shown with textContent only.
assert.equal(I.excerpt('<<b>script>alert(1)</script>'), '< script>alert(1)');
assert.equal(I.excerpt('a<b>x</b>c'), 'a x c');
for (const body of ['<scr<b>ipt>x<<i>img src=x onerror=y>', '<<<a>a>a>script>', '<</b>/script>'])
  assert.doesNotMatch(I.excerpt(body), /<\/?[a-z]/i, `no tag is formed in ${JSON.stringify(body)}`);
// What a Projects edit sends: only the fields the person edited, so a field another writer
// changed is never written back. A note's title is also its text; a bookmark with no name is named
// by its address.
{
  const note = {kind: 'note', text: 'Old', title: 'Old', body: 'newer body', projectId: 'p'};
  const fields = {title: ' New title ', body: 'body as opened', projectId: 'q'};
  assert.deepEqual(I.editChanges(note, fields, new Set(['title'])), {title: 'New title', text: 'New title'}, 'a title edit sends no body');
  assert.deepEqual(I.editChanges(note, {...fields, title: '  '}, ['title']), {title: '', text: 'Old'}, 'a cleared title keeps the text');
  assert.deepEqual(I.editChanges(note, fields, ['body']), {body: 'body as opened'});
  assert.deepEqual(I.editChanges(note, fields, ['projectId']), {projectId: 'q'});
  assert.deepEqual(I.editChanges(note, fields, []), {}, 'nothing edited sends nothing');
  const bookmark = {kind: 'bookmark', text: 'Site', url: 'https://a.example/', projectId: ''};
  assert.deepEqual(I.editChanges(bookmark, {text: 'Site', url: ' https://b.example/ ', projectId: ''}, ['url']), {text: 'Site', url: 'https://b.example/'});
  assert.deepEqual(I.editChanges(bookmark, {text: ' ', url: 'https://a.example/', projectId: ''}, ['text']), {text: 'https://a.example/'});
  const task = {kind: 'task', text: 'Old task', projectId: ''};
  assert.deepEqual(I.editChanges(task, {text: ' Call Sam ', projectId: ''}, ['text']), {text: 'Call Sam'});
  assert.deepEqual(I.editChanges(task, {text: 'Old task', projectId: 'p'}, ['projectId']), {projectId: 'p'});
}
for (const item of [{kind: 'note', text: 'Only text', title: '', url: ''}, {kind: 'note', text: '', title: 'A title', url: ''}, {kind: 'task', text: '', title: '', url: ''},
  {kind: 'bookmark', text: 'Read https://example.com/a later', title: '', url: 'https://example.com/a'}, {kind: 'bookmark', text: 'https://www.example.com/', title: '', url: 'https://www.example.com/'},
  {kind: 'bookmark', text: 'https://example.com/path/x', title: '', url: 'https://example.com/path/x'}])
  assert.equal(I.title(item), context.thoughtTitle(item), `title ${JSON.stringify(item)}`);
assert.equal(I.title({kind: 'bookmark', text: '', title: '', url: 'not a web address'}), 'not a web address', 'An unparsable address is shown as written, not thrown');

// 2. Today's projection: the latest active note by updatedAt then createdAt, its excerpt and
// project, and open tasks (up to three rows) by the archive rule.
const projects = [{id: 'p1', name: 'Garden', rootPath: '', createdAt: 1, updatedAt: 1}];
const row = (id, fields) => ({id, kind: 'note', text: id, title: '', body: '', url: '', projectId: '', stage: 'inbox', previousStage: null, done: false, priority: null, dueDate: '', read: false, readingLater: false, createdAt: 1, updatedAt: 1, ...fields});
const items = [
  row('older', {updatedAt: 5}), row('tie-old', {updatedAt: 9, createdAt: 2}), row('tie-new', {updatedAt: 9, createdAt: 3, projectId: 'p1', body: '# Plan\n\n**Water** the [beds](https://example.com)'}),
  row('archived', {updatedAt: 50, stage: 'done'}), row('mark', {kind: 'bookmark', url: 'https://example.com', updatedAt: 60}),
  row('t1', {kind: 'task', updatedAt: 8}), row('t2', {kind: 'task', updatedAt: 7}), row('t3', {kind: 'task', updatedAt: 6}), row('t4', {kind: 'task', updatedAt: 4}),
  row('t5', {kind: 'task', done: true, updatedAt: 70}), row('t6', {kind: 'task', stage: 'done', done: true, updatedAt: 71}),
];
const today = I.today(items, projects);
assert.equal(today.latest.item.id, 'tie-new');
assert.equal(today.latest.excerpt, 'Plan Water the beds');
assert.equal(today.latest.project, 'Garden');
assert.equal(I.today([row('n', {text: 'Short capture'})], []).latest.excerpt, 'Short capture', 'Without a body the excerpt is the note’s own text');
assert.equal(I.today([row('n', {text: '**Bold** idea, see [the plan](https://example.com)'})], []).latest.excerpt, 'Bold idea, see the plan', 'and is plain text');
assert.equal(I.today([row('n', {text: 'word '.repeat(4000)})], []).latest.excerpt.length, 178, 'and is short: 177 characters and an ellipsis');
assert.equal(I.today([row('n', {projectId: 'gone'})], []).latest.project, '', 'A project that no longer exists shows as no project');
assert.deepEqual(today.tasks.entries.map(item => item.id), ['t1', 't2', 't3']);
assert.equal(today.tasks.open, 4);
assert.equal(today.tasks.done, 2);
assert.equal(I.today([], []).latest, null);
assert.deepEqual(I.collection(items, {projectId: 'p1'}).map(item => item.id), ['tie-new']);
assert.equal(I.collection(items, {projectId: 'inbox'}).some(item => item.projectId), false);
assert.deepEqual(I.collection(items, {archived: true}).map(item => item.id).sort(), ['archived', 't5', 't6']);
assert.deepEqual(I.collection(items, {kind: 'bookmark'}).map(item => item.id), ['mark']);
assert.equal(I.collection(items, {}).length, items.length - 3, 'The default collection is active items in every project');

// 3. The store over the stand-in core.
let ids = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;
const saves = core => core.calls.filter(([method]) => method === 'items.save');
const loaded = async (core, options = {}) => { const store = I.createItemStore({bridge: core.bridge, uuid, ...options}); assert.deepEqual(await store.load(), {ok: true}); return store; };

{ // A capture is saved under a client UUID v4 and shown only after the core answers.
  const core = createStorageCore();
  const store = await loaded(core);
  const seen = [];
  const unsubscribe = store.subscribe(snapshot => seen.push(snapshot.items.length));
  const result = await store.create({kind: 'note', text: 'Buy seeds'}, {draft: 'today'});
  assert.equal(result.saved, true);
  assert.match(result.item.id, V4);
  assert.deepEqual(saves(core)[0][1], {item: {id: result.item.id, kind: 'note', text: 'Buy seeds', title: '', body: '', url: '', projectId: '', stage: 'inbox', previousStage: null, done: false, priority: null, dueDate: '', read: false, readingLater: false}});
  assert.deepEqual(store.snapshot().items.map(item => item.text), ['Buy seeds']);
  assert.deepEqual(seen, [1]);
  unsubscribe();
  await store.create({kind: 'task', text: 'Water'}, {draft: 'today'});
  assert.deepEqual(seen, [1], 'An unsubscribed listener hears nothing');
  assert(Object.isFrozen(store.snapshot().items) && store.snapshot().items.every(Object.isFrozen), 'Callers cannot change the snapshot');
  assert.throws(() => store.create({kind: 'note', text: 'x'}), TypeError, 'A create names its draft, so a retry can reuse its ID');
}
{ // A lost reply: nothing is shown as saved; the retry reuses the ID and the core keeps one row.
  const core = createStorageCore();
  const store = await loaded(core);
  core.fault('items.save', 'lose');
  const lost = await store.create({kind: 'note', text: 'Call the plumber'}, {draft: 'today'});
  assert.deepEqual(plain(lost), {saved: false, error: NO_RESPONSE, conflict: false});
  assert.equal(store.snapshot().items.length, 0, 'An unanswered save is not shown as saved');
  assert.equal(core.items.size, 1, 'The stand-in did commit it');
  const retried = await store.create({kind: 'note', text: 'Call the plumber'}, {draft: 'today'});
  assert.equal(retried.saved, true);
  assert.equal(saves(core)[1][1].item.id, saves(core)[0][1].item.id, 'The retry sends the same ID');
  assert.equal(core.items.size, 1, 'One row');
  assert.equal(store.snapshot().items.length, 1);
  const next = await store.create({kind: 'note', text: 'Another'}, {draft: 'today'});
  assert.notEqual(next.item.id, retried.item.id, 'A confirmed save retires its retry ID');
}
{ // The draft changed after a lost reply: the stored row is found and edited, not duplicated.
  const core = createStorageCore();
  const store = await loaded(core);
  core.fault('items.save', 'lose');
  await store.create({kind: 'note', text: 'Draft one'}, {draft: 'today'});
  const result = await store.create({kind: 'note', text: 'Draft one, finished'}, {draft: 'today'});
  assert.equal(result.saved, true);
  assert.equal(core.items.size, 1);
  assert.equal([...core.items.values()][0].text, 'Draft one, finished');
  const [, get, edit] = core.calls.filter(([method]) => method === 'items.save' || method === 'items.get');
  assert.equal(get[0], 'items.get');
  assert.equal(typeof edit[1].item.expectedUpdatedAt, 'number', 'The second save is an edit of the found row');
}
{ // The draft changed after a failure that wrote nothing: the free ID carries the new text.
  const core = createStorageCore();
  const store = await loaded(core);
  core.fault('items.save', 'fail');
  const failed = await store.create({kind: 'task', text: 'Draft'}, {draft: 'projects'});
  assert.equal(failed.saved, false);
  assert.equal(failed.error, 'Could not save. Your changes were not stored; try again.');
  const result = await store.create({kind: 'task', text: 'Draft, edited'}, {draft: 'projects'});
  assert.equal(result.saved, true);
  assert.equal(result.item.id, saves(core)[0][1].item.id);
  assert.equal(core.items.size, 1);
  assert.equal(saves(core)[1][1].item.expectedUpdatedAt, undefined);
}
{ // A thrown error of any shape is reported, nothing is saved, and the retry still reuses the ID.
  const core = createStorageCore();
  const store = await loaded(core);
  core.fault('items.save', 'throw', 'host went away');
  assert.deepEqual(plain(await store.create({kind: 'note', text: 'x'}, {draft: 'a'})), {saved: false, error: 'host went away', conflict: false});
  core.fault('items.save', 'throw', undefined);
  assert.equal((await store.create({kind: 'note', text: 'x'}, {draft: 'a'})).error, NO_RESPONSE, 'A reason-less failure says the host did not answer');
  core.fault('items.save', 'throw', new TypeError('Failed to fetch'));
  assert.equal((await store.create({kind: 'note', text: 'x'}, {draft: 'a'})).error, 'Failed to fetch');
  assert.equal(store.snapshot().items.length, 0);
  assert.equal(new Set(saves(core).map(([, params]) => params.item.id)).size, 1);
  assert.equal((await store.create({kind: 'note', text: 'x'}, {draft: 'a'})).saved, true);
  // The core's own refusal comes back as its sentence.
  assert.equal((await store.create({kind: 'bookmark', text: 'No address'}, {draft: 'b'})).error, 'A bookmark needs a web address.');
}
{ // Edits name expectedUpdatedAt; another writer's change is a conflict that overwrites nothing.
  const core = createStorageCore();
  const seeded = core.seed({kind: 'note', text: 'Original'});
  const store = await loaded(core);
  const edited = await store.update(seeded.id, {text: 'Mine'});
  assert.equal(edited.saved, true);
  assert.equal(saves(core)[0][1].item.expectedUpdatedAt, seeded.updatedAt);
  assert.equal(Object.hasOwn(saves(core)[0][1].item, 'updatedAt') || Object.hasOwn(saves(core)[0][1].item, 'createdAt'), false, 'Timestamps are never sent');
  const theirs = core.write({...core.items.get(seeded.id), text: 'Theirs'});
  const conflict = await store.update(seeded.id, {text: 'Mine again'});
  assert.deepEqual(plain(conflict), {saved: false, error: 'That item was changed after you opened it. Your changes were not saved.', conflict: true});
  assert.deepEqual(core.items.get(seeded.id), theirs, 'Their change is kept');
  assert.equal(store.snapshot().items[0].text, 'Mine', 'The view keeps what it last read until it reloads');
  assert.deepEqual(await store.load(), {ok: true});
  assert.equal(store.snapshot().items[0].text, 'Theirs');
  assert.equal((await store.update(seeded.id, {text: 'Mine again'})).saved, true);
  assert.equal(core.items.get(seeded.id).text, 'Mine again');
  assert.equal((await store.update('00000000-0000-4000-8000-999999999999', {text: 'x'})).error, 'That item no longer exists.');
}
{ // An edit whose reply was lost: the same edit again writes nothing; a newer one builds on it.
  const core = createStorageCore();
  const seeded = core.seed({kind: 'task', text: 'Prune'});
  const store = await loaded(core);
  core.fault('items.save', 'lose');
  assert.equal((await store.update(seeded.id, {text: 'Prune roses'})).saved, false);
  const stamp = core.items.get(seeded.id).updatedAt;
  assert.equal((await store.update(seeded.id, {text: 'Prune roses'})).saved, true, 'The same edit again succeeds');
  assert.equal(core.items.get(seeded.id).updatedAt, stamp, 'and writes nothing');
  core.fault('items.save', 'lose');
  await store.update(seeded.id, {priority: 'high'});
  const later = await store.update(seeded.id, {priority: 'high', dueDate: '2026-11-20'});
  assert.equal(later.saved, true, 'A newer edit after a lost reply builds on the stored row');
  assert.deepEqual([core.items.get(seeded.id).priority, core.items.get(seeded.id).dueDate], ['high', '2026-11-20']);
}
{ // Archive and restore write stage and done together, as the prototype does.
  const core = createStorageCore();
  const task = core.seed({kind: 'task', text: 'Sow', stage: 'review'});
  const note = core.seed({kind: 'note', text: 'Idea', stage: 'active'});
  const store = await loaded(core);
  await store.setStage(task.id, 'done');
  assert.deepEqual(['stage', 'done', 'previousStage'].map(key => core.items.get(task.id)[key]), ['done', true, 'review']);
  await store.setStage(task.id, 'restore');
  assert.deepEqual(['stage', 'done', 'previousStage'].map(key => core.items.get(task.id)[key]), ['review', false, 'review']);
  await store.complete(task.id, true);
  assert.equal(I.isArchived(core.items.get(task.id)), true);
  await store.setStage(note.id, 'done');
  assert.deepEqual(['stage', 'done', 'previousStage'].map(key => core.items.get(note.id)[key]), ['done', false, 'active']);
  assert.equal((await store.setStage(note.id, 'bogus')).error, 'Choose a valid stage.');
  assert.throws(() => store.complete(note.id, true), TypeError, 'Only a task is completed');
}
{ // Caps: 300 items in all, 30 active, 30 projects, with the prototype's sentences.
  const core = createStorageCore();
  for (let i = 0; i < 299; i++) core.seed({kind: 'note', text: `Old ${i}`, stage: i < 28 ? 'inbox' : 'done'});
  const store = await loaded(core);
  assert.equal((await store.create({kind: 'note', text: 'Item 300'}, {draft: 'cap'})).saved, true, '299 → 300 is allowed');
  const full = await store.create({kind: 'note', text: 'Item 301'}, {draft: 'cap'});
  assert.deepEqual(plain(full), {saved: false, error: 'Your archive is full. Remove an archived item to make room.', cap: true});
  assert.equal(core.items.size, 300);
  const archived = store.snapshot().items.find(item => item.stage === 'done');
  assert.equal((await store.remove(archived.id)).saved, true);
  assert.equal((await store.create({kind: 'task', text: 'Active 30'}, {draft: 'cap'})).saved, true, '29 → 30 active is allowed');
  assert.equal(I.counts(store.snapshot().items).active, 30);
  await store.remove(store.snapshot().items.find(item => item.stage === 'done').id);
  const busy = await store.create({kind: 'task', text: 'Active 31'}, {draft: 'cap'});
  assert.deepEqual(plain(busy), {saved: false, error: 'You have 30 active items. Archive one to make room.', cap: true});
  const task = store.snapshot().items.find(item => item.kind === 'task');
  await store.complete(task.id, true);
  const other = core.seed({kind: 'task', text: 'Elsewhere'});
  await store.load();
  assert.deepEqual(plain(await store.complete(task.id, false)), {saved: false, error: 'Complete or archive an item before restoring this task.', cap: true});
  assert.deepEqual(plain(await store.setStage(store.snapshot().items.find(item => item.kind === 'note' && item.stage === 'done').id, 'restore')), {saved: false, error: 'Complete or archive an item before restoring this note.', cap: true});
  assert.equal((await store.update(other.id, {text: 'Elsewhere, edited'})).saved, true, 'An edit that keeps an item active is not capped');
  assert.equal(saves(core).filter(([, params]) => params.item.text === 'Active 31').length, 0, 'A capped save never reaches the core');
  for (let i = 0; i < 29; i++) core.seedProject(`Project ${i}`);
  await store.load();
  assert.equal((await store.createProject('Project 29', {draft: 'p'})).saved, true, '29 → 30 projects is allowed');
  assert.deepEqual(plain(await store.createProject('Project 30', {draft: 'p'})), {saved: false, error: 'You have 30 projects.', cap: true});
  const existing = await store.createProject('project 3', {draft: 'p'});
  assert.equal(existing.saved, true);
  assert.equal(existing.project.name, 'Project 3', 'A name already in use returns that project, as the prototype does');
}
{ // Projects: create with a client ID and retry, rename with expectedUpdatedAt, delete moves items.
  const core = createStorageCore();
  const store = await loaded(core);
  core.fault('projects.save', 'lose');
  assert.equal((await store.createProject('Garden', {draft: 'p'})).saved, false);
  const garden = await store.createProject('Garden', {draft: 'p'});
  assert.equal(garden.saved, true);
  assert.equal(core.projects.size, 1);
  assert.match(garden.project.id, V4);
  const note = await store.create({kind: 'note', text: 'Beds', projectId: garden.project.id}, {draft: 'n'});
  assert.equal((await store.renameProject(garden.project.id, 'Allotment')).saved, true);
  assert.equal(core.calls.filter(([method]) => method === 'projects.save').at(-1)[1].project.expectedUpdatedAt, garden.project.updatedAt);
  assert.equal(I.today(store.snapshot().items, store.snapshot().projects).latest.project, 'Allotment');
  assert.equal((await store.removeProject(garden.project.id)).saved, true);
  assert.equal(store.snapshot().projects.length, 0);
  assert.equal(store.snapshot().items[0].projectId, '', 'Its items are in the inbox');
  assert.equal((await store.update(note.item.id, {text: 'Beds, dug'})).saved, true, 'The items were read again, so an edit is not a false conflict');
  // The name changed after a lost reply: the core has no projects.get, so the list is read and
  // the stored project renamed, not duplicated.
  core.fault('projects.save', 'lose');
  assert.equal((await store.createProject('Shed', {draft: 'r'})).saved, false);
  const renamed = await store.createProject('Sheds', {draft: 'r'});
  assert.equal(renamed.saved, true);
  assert.deepEqual([...core.projects.values()].map(project => project.name), ['Sheds']);
  assert.equal(core.calls.some(([method]) => method === 'projects.get'), false, 'Only methods the core serves are called');
  await store.removeProject(renamed.project.id);
  core.fault('projects.delete', 'fail');
  const kept = await store.createProject('Kept', {draft: 'q'});
  assert.equal((await store.removeProject(kept.project.id)).saved, false);
  assert.equal(store.snapshot().projects.length, 1, 'A failed delete leaves the project shown');
}
{ // Nothing is written when the lists could not be read, and the read error is what is shown.
  const core = createStorageCore();
  core.fault('items.list', 'fail', 'Could not read your saved data. Try again.');
  const store = I.createItemStore({bridge: core.bridge, uuid});
  assert.deepEqual(await store.load(), {ok: false, error: 'Could not read your saved data. Try again.'});
  assert.deepEqual(plain(await store.create({kind: 'note', text: 'x'}, {draft: 'today'})), {saved: false, error: 'Could not read your saved data. Try again.'});
  assert.equal(saves(core).length, 0);
  assert.deepEqual(await store.load(), {ok: true}, 'A later read recovers');
}
{ // A UUID source that does not give lowercase version 4 UUIDs is refused before any write.
  const core = createStorageCore();
  const store = I.createItemStore({bridge: core.bridge, uuid: () => 'not-a-uuid'});
  await store.load();
  assert.equal((await store.create({kind: 'note', text: 'x'}, {draft: 'today'})).saved, false);
  assert.equal(saves(core).length, 0);
}

// A view reads the lists again whenever it is shown. A read that was answered before a save or a
// delete committed, and arrives after it, must not undo it on screen; of two reads, the later
// one asked wins.
{
  const core = createStorageCore();
  const held = [];
  const bridge = {request: async (method, params) => {
    const reply = await core.bridge.request(method, params);
    if (method === 'items.list' && held.hold) await new Promise(resolve => held.push(resolve));
    return reply;
  }};
  const store = I.createItemStore({bridge, uuid});
  await store.load();
  const kept = (await store.create({kind: 'note', text: 'kept'}, {draft: 'a'})).item;
  const gone = (await store.create({kind: 'task', text: 'gone'}, {draft: 'b'})).item;
  held.hold = true;
  const reading = store.load();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(held.length, 1, 'the read was answered and is held');
  const added = (await store.create({kind: 'note', text: 'added while reading'}, {draft: 'c'})).item;
  const edited = (await store.update(kept.id, {text: 'kept, edited'})).item;
  assert.equal((await store.remove(gone.id)).saved, true);
  held.hold = false;
  held.shift()();
  assert.deepEqual(await reading, {ok: true});
  const rows = store.snapshot().items;
  assert(rows.some(item => item.id === added.id), 'a row saved during the read stays');
  assert.equal(rows.find(item => item.id === kept.id).text, 'kept, edited', 'an edit made during the read stays');
  assert(!rows.some(item => item.id === gone.id), 'a row deleted during the read stays deleted');
  // An older read that arrives last is ignored.
  held.hold = true;
  const older = store.load();
  await new Promise(resolve => setImmediate(resolve));
  held.hold = false;
  await core.bridge.request('items.save', {item: {...plain(I.draftItem({kind: 'note', text: 'from another writer'})), id: '00000000-0000-4000-8000-0000000000ff'}});
  assert.deepEqual(await store.load(), {ok: true});
  held.shift()();
  assert.deepEqual(await older, {ok: true});
  assert(store.snapshot().items.some(item => item.text === 'from another writer'), 'the newer read is kept');
}

// A captured draft becomes the fields the prototype's capture form saved (dist/app.js, its submit
// handler): a note of several lines is titled by its first line, a bookmark without text is
// named by its address, and nothing else is set.
{
  const fields = I.draftItem;
  assert.deepEqual(fields({kind: 'note', text: '  buy milk  '}), {kind: 'note', text: 'buy milk', title: '', body: '', url: '', projectId: '', done: false});
  assert.deepEqual(fields({kind: 'note', text: 'Plan\n\n- one\n- two\n', projectId: 'p1'}), {kind: 'note', text: 'Plan', title: 'Plan', body: '- one\n- two', url: '', projectId: 'p1', done: false});
  assert.deepEqual(fields({kind: 'note', text: '\n  \nonly line\n'}), {kind: 'note', text: 'only line', title: '', body: '', url: '', projectId: '', done: false}, 'Text is trimmed before it is split into lines');
  assert.deepEqual(fields({kind: 'note', text: 'Title\n\n\nbody'}).body, 'body');
  assert.deepEqual(fields({kind: 'note', text: 'a\r\nb'}), {kind: 'note', text: 'a', title: 'a', body: 'b', url: '', projectId: '', done: false});
  assert.deepEqual(fields({kind: 'task', text: 'call Sam\nabout the lease'}), {kind: 'task', text: 'call Sam\nabout the lease', title: '', body: '', url: '', projectId: '', done: false}, 'A task keeps its lines in its text');
  assert.deepEqual(fields({kind: 'bookmark', text: '', url: ' https://example.com/a '}), {kind: 'bookmark', text: 'https://example.com/a', title: '', body: '', url: 'https://example.com/a', projectId: '', done: false});
  assert.deepEqual(fields({kind: 'bookmark', text: 'Read later', url: 'https://example.com'}).text, 'Read later');
  assert.equal(fields({kind: 'note', text: '   '}), null, 'An empty draft is not saved');
  assert.equal(fields({kind: 'bookmark', text: 'no address'}), null, 'A bookmark needs an address');
  assert.equal(fields({kind: 'video', text: 'x'}), null);
  // Saved through the store, the captured note is Today's latest note and its excerpt.
  const core = createStorageCore();
  const store = I.createItemStore({bridge: core.bridge, uuid});
  await store.load();
  const saved = await store.create(fields({kind: 'note', text: 'Plan\nfirst step'}), {draft: 'capture'});
  assert.equal(saved.saved, true);
  const shown = I.today(store.snapshot().items, []);
  assert.equal(shown.latest.title, 'Plan');
  assert.equal(shown.latest.excerpt, 'first step');
}

// 3b. A bookmark's address is checked by the core's rule (check_web_url in
// crates/core/src/storage/model.rs) before it is sent, so the view can say why (#169).
for (const good of ['https://example.com', 'http://example.com/a?b#c', 'HTTPS://Example.com/', 'https://example.com:8443/path', 'https://xn--bcher-kva.example/']) assert.equal(I.isWebAddress(good), true, good);
for (const bad of ['', 'not a url', 'example.com', 'ftp://example.com', 'https://', 'http:///path', 'https://user@example.com', 'https://user:pass@example.com/', 'https://exa mple.com', 'https://example.com/\tx', 'javascript:alert(1)', 'https://example.com/' + 'a'.repeat(2048)]) assert.equal(I.isWebAddress(bad), false, JSON.stringify(bad.slice(0, 40)));
assert.equal(I.isWebAddress('https://example.com/' + 'a'.repeat(2048 - 20)), true, 'exactly 2048 bytes is accepted');
assert.equal(I.NOT_A_WEB_ADDRESS, 'That address is not a web address. Start it with https://.');

// 4. The module is pure: no global, storage, network or clock of its own. Timestamps come from
// the core, IDs from the injected source.
const source = read('ui/items.js');
assert(!/\bimport\b/.test(source), 'The store imports nothing');
assert(!/\b(?:window|globalThis|self|document|localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest)\b/.test(source), 'The store reaches no global, storage or network');
assert(!/Date\.now|new Date\(|setTimeout|setInterval/.test(source), 'The store sets no time and schedules nothing');

console.log('Items: archive rule, stage patch, excerpt and titles match the prototype, except that the excerpt replaces a tag with a space; an edit sends only the fields the person edited; Today shows the latest active note and open tasks; creates reuse their client UUID after a lost reply or failure, edits name expectedUpdatedAt, conflicts overwrite nothing, 300/30/30 caps hold at their edges with the prototype sentences, a failed write saves nothing, and a bookmark address is checked by the core’s web-address rule.');
