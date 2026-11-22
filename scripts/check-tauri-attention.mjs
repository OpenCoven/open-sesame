// The Agents settings section (issue #80). Loads ui/attention-settings.js against stand-in
// elements and a stand-in bridge and verifies that nothing is added before the change is shown,
// that the change shown is the host's text, that the section follows the host's messages, and
// that a refusal is shown. It reads the Rust and HTML sources as text for the names both sides
// share. It runs no Rust and touches no settings file: those are separate evidence.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFileSync(path.join(root, file), 'utf8');
const { CHANGED_EVENT, changes, summarize, mountAttention } = await import(pathToFileURL(path.join(root, 'ui/attention-settings.js')));

const element = () => {
  const listeners = new Map();
  return {
    hidden: true, textContent: '', checked: false, dataset: {},
    addEventListener: (name, run) => { listeners.set(name, [...(listeners.get(name) || []), run]); },
    fire: async (name, event = {}) => { for (const run of listeners.get(name) || []) await run(event); },
  };
};
const parts = () => Object.fromEntries(['section', 'summary', 'preview', 'install', 'remove', 'path', 'change', 'notify', 'message'].map(name => [name, element()]));
const settle = () => new Promise(resolve => setImmediate(resolve));

const off = { waiting: 0, working: 0, finished: 0, agents: [], notify: false, hook: { installed: false, listening: false, problem: '' } };
const before = '{"model": "opus"}';
const after = '{\n  "model": "opus",\n  "hooks": {}\n}\n';

function fakeBridge(answers) {
  const calls = [];
  const listeners = [];
  let status = off;
  return {
    calls,
    emit: note => { for (const listener of listeners) listener(note); },
    subscribe: listener => { listeners.push(listener); },
    request: async (method, params = {}) => {
      calls.push({ method, params });
      if (answers[method]) {
        const answer = answers[method](params, status);
        if (method !== 'attention.preview') status = answer;
        return answer;
      }
      if (method === 'attention.status') return status;
      throw new Error(`Unexpected ${method}`);
    },
  };
}

// The diff marks what is added and keeps what stays.
assert.deepEqual(changes('a\nb\nc', 'a\nx\nc\nd'), ['  a', '+ x', '- b', '  c', '+ d']);
assert.deepEqual(changes('', '{\n}'), ['+ {', '+ }']);
assert.deepEqual(changes('a', 'b', 0), ['+ b'], 'past the limit the new text is shown whole');

assert.equal(summarize(off), "The hook is off. Open Sesame does not read or change anything of Claude Code's.");
assert.equal(summarize({ ...off, hook: { installed: true } }), 'The hook is on. No Claude Code session has reported anything yet.');
assert.equal(summarize({ ...off, waiting: 1, working: 2, hook: { installed: true } }), 'One agent is waiting for you, 2 are working.');
assert.equal(summarize({ ...off, waiting: 3, finished: 1, hook: { installed: true } }), '3 agents are waiting for you, one has finished.');

{
  const installed = { ...off, hook: { installed: true, listening: true, problem: '' } };
  const bridge = fakeBridge({
    'attention.preview': () => ({ path: '/work/claude/settings.json', exists: true, before, after }),
    'attention.install': () => installed,
    'attention.remove': () => off,
    'attention.setNotify': (params, status) => ({ ...status, notify: params.enabled }),
  });
  const view = parts();
  await mountAttention(bridge, view);
  assert.equal(view.section.hidden, false);
  assert.equal(view.install.hidden, true, 'nothing can be added before the change is shown');
  assert.equal(view.preview.hidden, false);
  await view.preview.fire('click');
  assert.equal(view.path.textContent, 'This changes /work/claude/settings.json:');
  assert.equal(view.change.hidden, false);
  assert.equal(view.change.textContent, changes(before, after).join('\n'));
  assert.ok(view.change.textContent.includes('+   "hooks": {}'));
  assert.equal(view.install.hidden, false);
  assert.ok(!bridge.calls.some(call => call.method === 'attention.install'), 'showing writes nothing');
  bridge.emit({ event: CHANGED_EVENT, status: off });
  assert.equal(view.install.hidden, false, 'a message from the host does not take away a change being shown');
  await view.install.fire('click');
  await settle();
  assert.deepEqual(bridge.calls.at(-1), { method: 'attention.install', params: { expected: after } }, 'the text shown is the text asked for');
  assert.equal(view.remove.hidden, false);
  assert.equal(view.install.hidden, true);
  assert.equal(view.preview.hidden, true, 'an installed hook has nothing to show before adding');
  assert.equal(view.change.hidden, true);
  // The host's message about an agent reaches the section without a request.
  bridge.emit({ event: CHANGED_EVENT, status: { ...installed, waiting: 1 } });
  assert.equal(view.summary.textContent, 'One agent is waiting for you.');
  bridge.emit({ event: 'summon.changed', status: off });
  assert.equal(view.summary.textContent, 'One agent is waiting for you.', 'another message changes nothing');
  view.notify.checked = true;
  await view.notify.fire('change');
  await settle();
  assert.deepEqual(bridge.calls.at(-1), { method: 'attention.setNotify', params: { enabled: true } });
  assert.equal(view.notify.checked, true);
  await view.remove.fire('click');
  await settle();
  assert.equal(view.remove.hidden, true);
  assert.equal(view.preview.hidden, false);
  assert.equal(view.install.hidden, true, 'after a removal the change is shown again before another install');
}

{
  // A refusal is shown, with the host's sentence; a problem the host reports is shown as a warning.
  const bridge = fakeBridge({
    'attention.preview': () => { throw new Error("Claude Code's settings file is not JSON that Open Sesame can read, so it was left alone."); },
  });
  const view = parts();
  await mountAttention(bridge, view);
  await view.preview.fire('click');
  assert.equal(view.message.textContent, "Claude Code's settings file is not JSON that Open Sesame can read, so it was left alone.");
  assert.equal(view.message.dataset.warn, 'true');
  assert.equal(view.install.hidden, true);
  bridge.emit({ event: CHANGED_EVENT, status: { ...off, hook: { installed: true, problem: 'Open Sesame cannot listen for Claude Code\'s hook on port 1: in use' } } });
  assert.equal(view.message.dataset.warn, 'true');
}

// Both sides name the same message and methods, and the page has the section.
const rust = read('src-tauri/src/attention.rs');
assert.ok(rust.includes(`pub const CHANGED_EVENT: &str = "${CHANGED_EVENT}";`));
for (const method of ['attention.status', 'attention.preview', 'attention.install', 'attention.remove', 'attention.setNotify']) {
  assert.ok(rust.includes(`"${method}"`), method);
  assert.ok(read('crates/core/src/gate.rs').includes(`"${method}"`), `${method} is ported`);
}
const html = read('ui/index.html');
for (const name of ['data-attention', 'data-attention-preview', 'data-attention-install', 'data-attention-remove', 'data-attention-change', 'data-attention-notify']) {
  assert.ok(html.includes(name), name);
}
assert.ok(read('ui/main.js').includes('mountAttention(bridge'));

console.log('Tauri attention: the Agents section shows the change before adding the hook, follows the host and shows refusals.');
