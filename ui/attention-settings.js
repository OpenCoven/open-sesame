// The Agents settings section (issue #80): the opt-in hook in Claude Code's settings, and the
// notice when an agent starts waiting. The host's methods are `attention.status`,
// `attention.preview`, `attention.install`, `attention.remove` and `attention.setNotify`, and it
// sends `attention.changed` when an agent's state or the hook's changes.
//
// Nothing is written until the person has seen the change: the add button appears only after
// `attention.preview` has been shown, and adds exactly that text. Everything the section touches
// is passed in, so scripts/check-tauri-attention.mjs runs it in Node against stand-ins.

export const CHANGED_EVENT = 'attention.changed';

const text = error => (error && error.message) || String(error);

// The lines of `after` against `before`, each marked '+ ' (added), '- ' (taken out) or '  '.
// A longest-common-subsequence diff, enough for a settings file; past `most` lines in either
// file the whole new text is shown as added instead.
export function changes(before, after, most = 2000) {
  const a = before ? before.split('\n') : [];
  const b = after.split('\n');
  if (a.length > most || b.length > most) return b.map(line => `+ ${line}`);
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const lines = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { lines.push(`  ${a[i]}`); i += 1; j += 1; }
    else if (j < b.length && (i >= a.length || table[i][j + 1] >= table[i + 1][j])) { lines.push(`+ ${b[j]}`); j += 1; }
    else { lines.push(`- ${a[i]}`); i += 1; }
  }
  return lines;
}

// One sentence for the agents the host knows about.
export function summarize(status) {
  if (!status.hook?.installed) return 'The hook is off. Open Sesame does not read or change anything of Claude Code\'s.';
  const parts = [];
  const count = (n, one, many) => (n === 1 ? one : many.replace('#', n));
  if (status.waiting) parts.push(count(status.waiting, 'one agent is waiting for you', '# agents are waiting for you'));
  if (status.working) parts.push(count(status.working, 'one is working', '# are working'));
  if (status.finished) parts.push(count(status.finished, 'one has finished', '# have finished'));
  if (!parts.length) return 'The hook is on. No Claude Code session has reported anything yet.';
  const sentence = parts.join(', ');
  return `${sentence[0].toUpperCase()}${sentence.slice(1)}.`;
}

export function mountAttention(bridge, parts) {
  const { section, summary, preview, install, remove, path, change, notify, message } = parts;
  let busy = false;
  let shown = null;

  const say = (words, warn) => {
    message.textContent = words;
    message.dataset.warn = warn ? 'true' : 'false';
  };

  const show = status => {
    const installed = status.hook?.installed === true;
    summary.textContent = summarize(status);
    preview.hidden = installed;
    install.hidden = installed || shown === null;
    remove.hidden = !installed;
    if (installed) { change.hidden = true; path.hidden = true; shown = null; }
    notify.checked = status.notify === true;
    say(status.hook?.problem || '', Boolean(status.hook?.problem));
    section.hidden = false;
  };

  const act = async (method, params) => {
    if (busy) return;
    busy = true;
    try {
      show(await bridge.request(method, params));
    } catch (error) {
      await bridge.request('attention.status').then(show).catch(() => {});
      say(text(error), true);
    } finally {
      busy = false;
    }
  };

  preview.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    try {
      const planned = await bridge.request('attention.preview');
      shown = planned.after;
      path.textContent = planned.exists ? `This changes ${planned.path}:` : `This creates ${planned.path}:`;
      change.textContent = changes(planned.exists ? planned.before : '', planned.after).join('\n');
      path.hidden = false;
      change.hidden = false;
      install.hidden = false;
      say('', false);
    } catch (error) {
      say(text(error), true);
    } finally {
      busy = false;
    }
  });
  install.addEventListener('click', () => act('attention.install'));
  remove.addEventListener('click', () => act('attention.remove'));
  notify.addEventListener('change', () => act('attention.setNotify', { enabled: notify.checked === true }));
  bridge.subscribe?.(note => {
    if (note.event === CHANGED_EVENT && note.status && typeof note.status === 'object') show(note.status);
  });
  return bridge.request('attention.status').then(show).catch(error => { say(text(error), true); section.hidden = false; });
}
