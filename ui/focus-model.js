// The Focus timer's model (issue #77). A session is stored in one core setting as its length and
// its start, deadline and pause times. The remaining time is always derived from those times and
// the clock it is given, never counted down by a timer, so hiding the app, a sleeping machine
// or a relaunch cannot make it drift. Pure apart from the store, which reaches the core only
// through the bridge it is handed; checked by scripts/check-ui-focus.mjs.

export const FOCUS_KEY = 'focus.session';
// The core refuses a setting larger than this many bytes of JSON (MAX_SETTING_BYTES).
export const MAX_SETTING_BYTES = 65_536;
export const DEFAULT_MINUTES = 25;
const MINUTE = 60_000;
const VERSION = 1;
const FIELDS = ['version', 'durationMs', 'startedAt', 'deadlineAt', 'pausedAt'];
const UNREADABLE = 'The saved focus session could not be read. It has been kept as it was.';
const NEWER = 'This focus session was saved by a newer version of Open Sesame. It has been kept as it was.';
const TOO_LARGE = 'That setting is too large to save.';

// The prototype's limits: whole minutes from 15 to 1440.
export const validMinutes = minutes => Number.isInteger(minutes) && minutes >= 15 && minutes <= 1440;

// m:ss, rounding a partial second up, as the prototype shows it. Minutes are not split into hours.
export function clock(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const session = (durationMs, startedAt, deadlineAt, pausedAt) => Object.freeze({version: VERSION, durationMs, startedAt, deadlineAt, pausedAt});

export function idle(minutes = DEFAULT_MINUTES) {
  if (!validMinutes(minutes)) throw Error('Choose 15–1440 whole minutes.');
  return session(minutes * MINUTE, null, null, null);
}

// What to show at `now`: idle, running, paused or finished, and the remaining time. A clock set
// back before the start never shows more than the session's length.
export function view(value, now) {
  const {durationMs, startedAt, deadlineAt, pausedAt} = value;
  if (startedAt === null) return Object.freeze({status: 'idle', durationMs, remainingMs: durationMs, elapsedMs: 0, deadlineAt: null, clock: clock(durationMs)});
  const remainingMs = Math.min(durationMs, Math.max(0, deadlineAt - (pausedAt ?? now)));
  const status = remainingMs === 0 ? 'finished' : pausedAt !== null ? 'paused' : 'running';
  return Object.freeze({status, durationMs, remainingMs, elapsedMs: durationMs - remainingMs, deadlineAt, clock: clock(remainingMs)});
}

// Transitions return a new session or throw the sentence to show; none of them writes.
export function start(value, now) {
  const {status} = view(value, now);
  if (status === 'running' || status === 'paused') throw Error('Your timer is already running.');
  return session(value.durationMs, now, now + value.durationMs, null);
}

export function pause(value, now) {
  const {status} = view(value, now);
  if (status === 'finished') throw Error('This session has finished.');
  if (status === 'paused') throw Error('Your timer is already paused.');
  if (status !== 'running') throw Error('Start your timer first.');
  return session(value.durationMs, value.startedAt, value.deadlineAt, Math.max(now, value.startedAt));
}

export function resume(value, now) {
  if (view(value, now).status !== 'paused') throw Error('Your timer is not paused.');
  return session(value.durationMs, value.startedAt, value.deadlineAt + Math.max(0, now - value.pausedAt), null);
}

// A new length restarts the timer, as in the prototype; it is refused while the timer runs.
export function setDuration(value, minutes, now) {
  if (view(value, now).status === 'running') throw Error('Pause your timer to adjust its duration.');
  return idle(minutes);
}

export const reset = value => idle(value.durationMs / MINUTE);

const bytes = value => {
  try { return new TextEncoder().encode(JSON.stringify(value)).length; } catch { return Infinity; }
};
const time = value => value === null || (Number.isSafeInteger(value) && value >= 0);

// A stored value, strictly. A missing value is a fresh timer. Anything this version did not
// write is reported, and the caller keeps it as it was.
export function parse(value) {
  if (value === undefined) return {ok: true, session: idle()};
  if (bytes(value) > MAX_SETTING_BYTES || !value || typeof value !== 'object' || Array.isArray(value)) return {ok: false, error: UNREADABLE};
  if (Number.isInteger(value.version) && value.version > VERSION) return {ok: false, error: NEWER};
  const keys = Object.keys(value);
  if (value.version !== VERSION || keys.length !== FIELDS.length || !FIELDS.every(key => Object.hasOwn(value, key))) return {ok: false, error: UNREADABLE};
  const {durationMs, startedAt, deadlineAt, pausedAt} = value;
  const consistent = Number.isInteger(durationMs) && durationMs % MINUTE === 0 && validMinutes(durationMs / MINUTE)
    && time(startedAt) && time(deadlineAt) && time(pausedAt)
    && (startedAt === null) === (deadlineAt === null)
    && (startedAt !== null || pausedAt === null)
    && (startedAt === null || deadlineAt >= startedAt + durationMs)
    && (pausedAt === null || (pausedAt >= startedAt && pausedAt < deadlineAt));
  return consistent ? {ok: true, session: session(durationMs, startedAt, deadlineAt, pausedAt)} : {ok: false, error: UNREADABLE};
}

export const encode = value => bytes(value) > MAX_SETTING_BYTES ? {ok: false, error: TOO_LARGE} : {ok: true, value};

const sentence = error => (error && typeof error.message === 'string' && error.message) || String(error);

// One session in the core's settings, reached only through `bridge.request`. Writes run one at a
// time in the order asked. A write that fails or is refused leaves the session as it was and
// says why; nothing is shown as saved until the core has answered. A stored value this version
// cannot read is never written over unless the person asks to recover.
export function createFocusStore({bridge, now}) {
  if (typeof bridge?.request !== 'function' || typeof now !== 'function') throw TypeError('The focus store needs a bridge and a clock.');
  let current = idle(), writable = false, recoverable = false, problem = 'Focus is still loading.';
  let queue = Promise.resolve();
  const shown = () => view(current, now());
  const failed = error => ({saved: false, error, view: shown()});

  // Reads run in the same queue as writes, so a read cannot overtake a write still out.
  function load() {
    const result = queue.then(read);
    queue = result.catch(() => {});
    return result;
  }
  async function read() {
    try {
      const reply = await bridge.request('settings.all', {});
      const settings = reply?.settings;
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw Error('Could not read your saved data. Try again.');
      const parsed = parse(Object.hasOwn(settings, FOCUS_KEY) ? settings[FOCUS_KEY] : undefined);
      if (!parsed.ok) {
        [writable, recoverable, problem] = [false, true, parsed.error];
        return {ok: false, error: problem, view: shown()};
      }
      [current, writable, recoverable, problem] = [parsed.session, true, false, null];
      return {ok: true, view: shown()};
    } catch (error) {
      [writable, recoverable, problem] = [false, false, sentence(error)];
      return {ok: false, error: problem, view: shown()};
    }
  }

  function write(next, {recovering = false} = {}) {
    const result = queue.then(async () => {
      if (!writable && !(recovering && recoverable)) return failed(problem);
      let value;
      try { value = next(current, now()); } catch (error) { return failed(sentence(error)); }
      const encoded = encode(value);
      if (!encoded.ok) return failed(encoded.error);
      try { await bridge.request('settings.set', {key: FOCUS_KEY, value: encoded.value}); } catch (error) { return failed(sentence(error)); }
      [current, writable, recoverable, problem] = [value, true, false, null];
      return {saved: true, view: shown()};
    });
    queue = result.catch(() => {});
    return result;
  }

  return Object.freeze({
    load,
    view: shown,
    get problem() { return problem; },
    get recoverable() { return recoverable; },
    start: () => write(start),
    pause: () => write(pause),
    resume: () => write(resume),
    reset: () => write(reset),
    setDuration: minutes => write((value, at) => setDuration(value, minutes, at)),
    recover: () => write(() => idle(), {recovering: true}),
  });
}
