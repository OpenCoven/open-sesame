// Focus timer model (issue #77). ui/focus-model.js keeps a session as start, deadline and pause
// times in one core setting and derives the remaining time from the wall clock it is given, so a
// hidden window, a sleeping machine or a relaunch cannot make it drift. This drives it with an
// injected clock and a stand-in bridge; it opens no window and runs no Rust.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const F = await import(pathToFileURL(path.join(root, 'ui/focus-model.js')));
const MINUTE = 60_000, HOUR = 60 * MINUTE;
const T = Date.UTC(2026, 10, 16, 9, 0, 0);

// 1. The setting and its limits follow the core and the prototype.
assert.equal(F.FOCUS_KEY, 'focus.session');
assert.match(F.FOCUS_KEY, /^[A-Za-z0-9._-]{1,100}$/, 'The key is one the core accepts');
assert.equal(F.MAX_SETTING_BYTES, 65_536);
for (const minutes of [15, 25, 90, 1440]) assert.equal(F.validMinutes(minutes), true, `${minutes} minutes`);
for (const minutes of [14, 1441, 25.5, '25', NaN, null, undefined, -25]) assert.equal(F.validMinutes(minutes), false, `${minutes} minutes`);
assert.equal(F.clock(25 * MINUTE), '25:00');
assert.equal(F.clock(1), '0:01', 'Partial seconds round up, as the prototype shows them');
assert.equal(F.clock(0), '0:00');
assert.equal(F.clock(-5), '0:00');
assert.equal(F.clock(1440 * MINUTE), '1440:00');

// 2. Start, pause and resume. Remaining time comes from the stored times and the clock only.
const idle = F.idle();
assert.deepEqual(idle, {version: 1, durationMs: 25 * MINUTE, startedAt: null, deadlineAt: null, pausedAt: null});
assert(Object.isFrozen(idle));
assert.deepEqual(F.view(idle, T), {status: 'idle', durationMs: 25 * MINUTE, remainingMs: 25 * MINUTE, elapsedMs: 0, deadlineAt: null, clock: '25:00'});
const running = F.start(idle, T);
assert.deepEqual(running, {version: 1, durationMs: 25 * MINUTE, startedAt: T, deadlineAt: T + 25 * MINUTE, pausedAt: null});
assert.equal(F.view(running, T).status, 'running');
assert.equal(F.view(running, T + 10 * MINUTE).remainingMs, 15 * MINUTE);
assert.equal(F.view(running, T + 10 * MINUTE).clock, '15:00');
assert.equal(F.view(running, T + 10 * MINUTE).elapsedMs, 10 * MINUTE);
const paused = F.pause(running, T + 10 * MINUTE);
assert.equal(paused.pausedAt, T + 10 * MINUTE);
assert.equal(paused.deadlineAt, running.deadlineAt, 'Pausing records the time and keeps the deadline');
assert.equal(F.view(paused, T + 10 * MINUTE).status, 'paused');
// A paused session keeps its remaining time however long the machine sleeps.
assert.equal(F.view(paused, T + 10 * MINUTE + 2 * HOUR).remainingMs, 15 * MINUTE);
const resumed = F.resume(paused, T + 10 * MINUTE + 2 * HOUR);
assert.equal(resumed.pausedAt, null);
assert.equal(resumed.deadlineAt, running.deadlineAt + 2 * HOUR, 'Resuming moves the deadline by the paused time');
assert.equal(F.view(resumed, T + 10 * MINUTE + 2 * HOUR).remainingMs, 15 * MINUTE);
assert.equal(F.view(resumed, T + 15 * MINUTE + 2 * HOUR).remainingMs, 10 * MINUTE);

// 3. A 2-hour gap while running (sleep, a hidden window, a relaunch) finishes the session at 0.
assert.deepEqual(F.view(running, T + 2 * HOUR), {status: 'finished', durationMs: 25 * MINUTE, remainingMs: 0, elapsedMs: 25 * MINUTE, deadlineAt: T + 25 * MINUTE, clock: '0:00'});
assert.equal(F.view(running, running.deadlineAt).status, 'finished', 'Finished exactly at the deadline');
assert.equal(F.view(running, running.deadlineAt - 1).remainingMs, 1);
assert.equal(F.view(running, running.deadlineAt - 1).clock, '0:01');
// A clock set back before the start never shows more than the session's length.
assert.equal(F.view(running, T - HOUR).remainingMs, 25 * MINUTE);
// The same stored value read at different times gives the answer for each time: nothing ticks.
for (let gap = 0; gap <= 30 * MINUTE; gap += 7_919) assert.equal(F.view(running, T + gap).remainingMs, Math.max(0, 25 * MINUTE - gap));

// 4. Transitions that do not apply are refused with a sentence, and change nothing.
assert.throws(() => F.pause(idle, T), {message: 'Start your timer first.'});
assert.throws(() => F.pause(paused, T + 11 * MINUTE), {message: 'Your timer is already paused.'});
// With the clock set back, a pause or resume still stores times a later read accepts.
const pausedEarly = F.pause(running, T - HOUR);
assert.equal(pausedEarly.pausedAt, T);
assert.equal(F.parse(pausedEarly).ok, true);
assert.deepEqual(F.resume(pausedEarly, T - HOUR), running);
assert.throws(() => F.pause(running, T + 2 * HOUR), {message: 'This session has finished.'});
assert.throws(() => F.resume(running, T), {message: 'Your timer is not paused.'});
assert.throws(() => F.start(running, T + MINUTE), {message: 'Your timer is already running.'});
assert.throws(() => F.start(paused, T + MINUTE), {message: 'Your timer is already running.'});
assert.throws(() => F.setDuration(running, 45, T + MINUTE), {message: 'Pause your timer to adjust its duration.'});
assert.throws(() => F.setDuration(idle, 10, T), {message: 'Choose 15–1440 whole minutes.'});
// A finished session starts again from the full length; a new length restarts the timer.
const again = F.start(running, T + 2 * HOUR);
assert.equal(again.startedAt, T + 2 * HOUR);
assert.equal(F.view(again, T + 2 * HOUR).remainingMs, 25 * MINUTE);
assert.deepEqual(F.setDuration(paused, 45, T + 11 * MINUTE), {version: 1, durationMs: 45 * MINUTE, startedAt: null, deadlineAt: null, pausedAt: null});
assert.deepEqual(F.reset(paused), F.idle(25));

// 5. Stored values are parsed strictly. A missing value is a fresh timer; anything else that is
// not a session this version wrote is reported and kept as it was.
assert.deepEqual(F.parse(undefined), {ok: true, session: F.idle()});
for (const session of [idle, running, paused, resumed]) assert.deepEqual(F.parse(JSON.parse(JSON.stringify(session))), {ok: true, session});
const corrupt = [null, 'running', 25, [], {}, {...running, version: 0}, {...running, durationMs: 10 * MINUTE}, {...running, durationMs: 25.5 * MINUTE},
  {...running, startedAt: null}, {...idle, deadlineAt: T}, {...idle, pausedAt: T}, {...running, deadlineAt: T + MINUTE}, {...running, pausedAt: T - 1},
  {...running, startedAt: -1, deadlineAt: 25 * MINUTE - 1}, {...running, startedAt: 1.5}, {...running, deadlineAt: Infinity}, {...running, extra: true}, {...running, pausedAt: '1'},
  {...running, pausedAt: running.deadlineAt}];
for (const value of corrupt) {
  const parsed = F.parse(value);
  assert.equal(parsed.ok, false, `Refused ${JSON.stringify(value)}`);
  assert.equal(parsed.error, 'The saved focus session could not be read. It has been kept as it was.');
}
assert.deepEqual(F.parse({...running, version: 2}), {ok: false, error: 'This focus session was saved by a newer version of Open Sesame. It has been kept as it was.'});
// A value over the core's 64 KB setting limit is refused on read and on write.
assert.equal(F.parse({...running, extra: 'x'.repeat(70_000)}).ok, false);
assert.deepEqual(F.encode(running), {ok: true, value: running});
assert.deepEqual(F.encode({...running, label: 'é'.repeat(32_768)}), {ok: false, error: 'That setting is too large to save.'}, 'Measured in UTF-8 bytes, as the core measures');

// 6. The store reads and writes the one setting through the bridge, serialises writes, never
// reports a failed write as saved, preserves a value it cannot read, and survives a relaunch.
function host({stored = {}, failSet = null, failAll = null, holdFirstSet = null} = {}) {
  const settings = {...stored}, calls = [], state = {holdNextAll: null};
  const bridge = {
    async request(method, params) {
      calls.push([method, structuredClone(params)]);
      if (method === 'settings.all') {
        if (failAll) throw Error(failAll);
        const read = structuredClone(settings);
        if (state.holdNextAll) { const hold = state.holdNextAll; state.holdNextAll = null; await hold; }
        return {settings: read};
      }
      if (method === 'settings.set') {
        if (failSet) throw Error(failSet);
        if (holdFirstSet) { const hold = holdFirstSet; holdFirstSet = null; await hold; }
        settings[params.key] = structuredClone(params.value);
        return {saved: true};
      }
      throw Error('That feature is not available in this version.');
    },
  };
  return {bridge, settings, calls, state};
}
let now = T;
const clockNow = () => now;

{ // A first start writes the session, and a relaunch reads it back with the time elapsed since.
  const h = host();
  const store = F.createFocusStore({bridge: h.bridge, now: clockNow});
  assert.deepEqual(await store.load(), {ok: true, view: F.view(F.idle(), T)});
  const started = await store.start();
  assert.equal(started.saved, true);
  assert.deepEqual(h.settings['focus.session'], F.start(F.idle(), T));
  assert.deepEqual(h.calls.map(([method]) => method), ['settings.all', 'settings.set']);
  assert.deepEqual(h.calls[1][1], {key: 'focus.session', value: F.start(F.idle(), T)});
  now = T + 7 * MINUTE;
  assert.equal(store.view().remainingMs, 18 * MINUTE, 'Hidden and shown again: recomputed from the clock');
  const relaunched = F.createFocusStore({bridge: h.bridge, now: clockNow});
  assert.equal((await relaunched.load()).view.remainingMs, 18 * MINUTE, 'Relaunched: the same remaining time');
  assert.equal((await relaunched.pause()).saved, true);
  now = T + 3 * HOUR;
  const after = F.createFocusStore({bridge: h.bridge, now: clockNow});
  assert.deepEqual((await after.load()).view, {status: 'paused', durationMs: 25 * MINUTE, remainingMs: 18 * MINUTE, elapsedMs: 7 * MINUTE, deadlineAt: T + 25 * MINUTE, clock: '18:00'});
  now = T;
}
{ // A failed write shows its error and leaves the stored session and the view where they were.
  const h = host({failSet: 'Could not save. Your changes were not stored; try again.'});
  const store = F.createFocusStore({bridge: h.bridge, now: clockNow});
  await store.load();
  assert.deepEqual(await store.start(), {saved: false, error: 'Could not save. Your changes were not stored; try again.', view: F.view(F.idle(), T)});
  assert.equal(store.view().status, 'idle', 'A failed start is not shown as running');
  assert.equal(Object.hasOwn(h.settings, 'focus.session'), false);
}
{ // A refused transition writes nothing and says why.
  const h = host();
  const store = F.createFocusStore({bridge: h.bridge, now: clockNow});
  await store.load();
  assert.deepEqual(await store.pause(), {saved: false, error: 'Start your timer first.', view: F.view(F.idle(), T)});
  assert.equal(h.calls.filter(([method]) => method === 'settings.set').length, 0);
  assert.equal((await store.setDuration(10)).error, 'Choose 15–1440 whole minutes.');
  assert.equal((await store.setDuration(45)).saved, true);
  assert.equal(store.view().durationMs, 45 * MINUTE);
}
{ // A value it cannot read is kept: no write reaches the core until the person asks to recover.
  const original = {version: 1, durationMs: 'twenty-five'};
  const h = host({stored: {'focus.session': original}});
  const store = F.createFocusStore({bridge: h.bridge, now: clockNow});
  assert.deepEqual(await store.load(), {ok: false, error: 'The saved focus session could not be read. It has been kept as it was.', view: F.view(F.idle(), T)});
  const refused = await store.start();
  assert.equal(refused.saved, false);
  assert.equal(refused.error, 'The saved focus session could not be read. It has been kept as it was.');
  assert.deepEqual(h.settings['focus.session'], original);
  assert.equal(h.calls.filter(([method]) => method === 'settings.set').length, 0);
  assert.equal((await store.recover()).saved, true, 'Recovery is an explicit action');
  assert.deepEqual(h.settings['focus.session'], F.idle());
  assert.equal((await store.start()).saved, true);
}
{ // When the settings cannot be read at all, nothing is written over them.
  const h = host({failAll: 'Could not read your saved data. Try again.'});
  const store = F.createFocusStore({bridge: h.bridge, now: clockNow});
  assert.deepEqual(await store.load(), {ok: false, error: 'Could not read your saved data. Try again.', view: F.view(F.idle(), T)});
  assert.equal((await store.start()).saved, false);
  assert.equal(store.recoverable, false, 'Nothing was read, so there is nothing to recover');
  assert.equal((await store.recover()).saved, false);
  assert.equal(h.calls.filter(([method]) => method === 'settings.set').length, 0);
}
{ // Writes are serialised: a pause sent while a start is still in flight applies after it.
  let release;
  const h = host({holdFirstSet: new Promise(resolve => { release = resolve; })});
  const store = F.createFocusStore({bridge: h.bridge, now: clockNow});
  await store.load();
  const starting = store.start();
  const pausing = store.pause();
  await Promise.resolve();
  assert.equal(h.calls.filter(([method]) => method === 'settings.set').length, 1, 'The pause waits for the start');
  release();
  assert.equal((await starting).saved, true);
  assert.equal((await pausing).saved, true);
  assert.equal(h.settings['focus.session'].pausedAt, T);
}

{ // A view reads the session again whenever it is shown. A read sent while a write is still out
  // waits for it, so a reply answered before the write committed cannot put the old session back.
  let releaseSet, releaseAll;
  const h = host({holdFirstSet: new Promise(resolve => { releaseSet = resolve; })});
  const store = F.createFocusStore({bridge: h.bridge, now: clockNow});
  await store.load();
  h.state.holdNextAll = new Promise(resolve => { releaseAll = resolve; });
  const starting = store.start();
  const reading = store.load();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.filter(([method]) => method === 'settings.all').length, 1, 'The read waits for the write');
  releaseSet();
  assert.equal((await starting).saved, true);
  await new Promise(resolve => setImmediate(resolve));
  releaseAll();
  assert.equal((await reading).view.status, 'running', 'The read sees the start');
  assert.equal(store.view().status, 'running');
}

// 7. The module is pure: it reads no clock of its own, schedules nothing, and defines nothing
// outside itself; the widget owns redraws and recomputes from this model on every show.
const source = readFileSync(path.join(root, 'ui/focus-model.js'), 'utf8');
assert(!/\bimport\b/.test(source), 'The model imports nothing');
assert(!/Date\.now|new Date\(\)|performance\.now|setTimeout|setInterval|requestAnimationFrame/.test(source), 'The model uses only the injected clock and schedules nothing');
assert(!/\b(?:window|globalThis|self|document|localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest)\b/.test(source), 'The model reaches no global, storage or network');

console.log('Focus sessions are stored as start, deadline and pause times; remaining time is derived from the injected clock across pause, a 2-hour sleep, hide/show and relaunch; failed and refused writes change nothing; unreadable and oversized values are kept and reported; writes are serialised.');
