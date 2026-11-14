// Terminal pane logic of the new shell (issue #74), run in Node against stand-ins for the
// emulator, the Tauri channel and the bridge. It verifies what a launched window cannot show
// cheaply: the exact requests, the acknowledgement arithmetic, input order, and what happens
// after a pane ends. The real stream is tested in crates/core/tests/terminal.rs and in the
// launched app (ui/dev/selftest.js).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(path.join(root, file), 'utf8');
const { createPane, ACK_EVERY } = await import(pathToFileURL(path.join(root, 'ui/terminal.js')));

const settle = () => new Promise(resolve => setImmediate(resolve));

// An emulator that parses when told to, so a test decides when a write's callback runs.
class Terminal {
  constructor(options) { this.options = options; this.cols = 91; this.rows = 27; this.written = []; this.callbacks = []; this.pasted = []; this.selection = ''; this.disposed = false; this.listeners = {}; }
  loadAddon(addon) { this.addon = addon; }
  open(element) { this.element = element; }
  write(data, callback) { this.written.push(data); this.callbacks.push(callback); }
  parse(count = this.callbacks.length) { for (const callback of this.callbacks.splice(0, count)) callback(); }
  on(name, listener) { this.listeners[name] = listener; return { dispose: () => { delete this.listeners[name]; } }; }
  onData(listener) { return this.on('data', listener); }
  onBinary(listener) { return this.on('binary', listener); }
  onResize(listener) { return this.on('resize', listener); }
  attachCustomKeyEventHandler(handler) { this.keys = handler; }
  getSelection() { return this.selection; }
  paste(text) { this.pasted.push(text); }
  focus() { this.focused = true; }
  dispose() { this.disposed = true; }
}
class FitAddon { fit() { FitAddon.fits += 1; } }
FitAddon.fits = 0;
class Channel { constructor() { Channel.last = this; } }

function harness({ mac = false, fail = {} } = {}) {
  const requests = [];
  const held = [];
  const bridge = {
    request(method, params) {
      requests.push({ method, params });
      if (fail[method]) return Promise.reject(new Error(fail[method]));
      if (method === 'terminal.open') return Promise.resolve({ id: params.id, pid: 4242, machine: 'this-machine' });
      if (method === 'terminal.clipboard.read') return Promise.resolve('pasted text');
      // Input is held so a test can type while a request is in flight.
      if (method === 'terminal.input' && bridge.hold) return new Promise(resolve => held.push(resolve));
      return Promise.resolve(true);
    },
  };
  const events = { exits: 0, errors: [], bytes: 0 };
  let resized;
  const stops = { count: 0 };
  const pane = createPane(
    { bridge, Terminal, FitAddon, Channel, mac, observe: (element, callback) => { resized = callback; return () => { stops.count += 1; }; } },
    { name: 'element' },
    { id: 'pane-1', mode: 'local', cwd: '/tmp/a b' },
    { onExit: () => { events.exits += 1; }, onError: text => events.errors.push(text), onBytes: bytes => { events.bytes += bytes.length; } },
  );
  const channel = Channel.last;
  const term = pane && channel && findTerminal();
  function findTerminal() { return Terminal.latest; }
  return { bridge, requests, held, events, pane, channel, stops, resize: () => resized(), of: method => requests.filter(request => request.method === method) };
}
// Capture the emulator a pane creates.
const construct = Terminal.prototype.loadAddon;
Terminal.prototype.loadAddon = function (addon) { Terminal.latest = this; return construct.call(this, addon); };

const bytes = count => new Uint8Array(count).fill(120).buffer;

// 1. Opening: the emulator is created, fitted and attached, and terminal.open carries the pane's
// size, the launch request and the channel object itself.
{
  const { requests, pane, channel } = harness();
  const term = Terminal.latest;
  assert.equal(term.element.name, 'element');
  assert(term.addon instanceof FitAddon && FitAddon.fits >= 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'terminal.open');
  assert.deepEqual({ ...requests[0].params, channel: undefined }, { id: 'pane-1', mode: 'local', cwd: '/tmp/a b', host: '', user: '', launcher: 'shell', prompt: '', cols: 91, rows: 27, channel: undefined });
  assert.equal(requests[0].params.channel, channel, 'The channel object is passed as it is; Tauri serialises it');
  assert.deepEqual(await pane.opened, { id: 'pane-1', pid: 4242, machine: 'this-machine' });
  assert.equal(pane.ended, false);
  assert(Object.isFrozen(pane));
}

// 2. Output is written as bytes, in order, and acknowledged only after the emulator has parsed
// it, as a running total, each time the total has grown by ACK_EVERY.
{
  const { pane, channel, of, events } = harness();
  const term = Terminal.latest;
  await pane.opened;
  channel.onmessage(bytes(ACK_EVERY - 1));
  channel.onmessage(new Uint8Array([1, 2, 3]));
  assert.equal(term.written.length, 2);
  assert(term.written[0] instanceof Uint8Array && term.written[0].length === ACK_EVERY - 1);
  assert.deepEqual([...term.written[1]], [1, 2, 3]);
  assert.equal(events.bytes, ACK_EVERY + 2);
  assert.equal(pane.stats.received, ACK_EVERY + 2);
  assert.equal(of('terminal.ack').length, 0, 'Nothing is acknowledged before it is parsed');
  term.parse(1);
  assert.equal(of('terminal.ack').length, 0, 'Below the step, nothing is acknowledged');
  term.parse(1);
  assert.deepEqual(of('terminal.ack').map(request => request.params), [{ id: 'pane-1', bytes: ACK_EVERY + 2 }]);
  channel.onmessage(bytes(ACK_EVERY * 3));
  term.parse();
  assert.deepEqual(of('terminal.ack').map(request => request.params.bytes), [ACK_EVERY + 2, ACK_EVERY * 4 + 2], 'The count is a running total');
  assert.equal(pane.stats.acks, 2);
  assert.equal(pane.stats.processed, pane.stats.received);
  // A character split between two messages is handed over as the bytes received, never as text
  // decoded one message at a time: joining the halves is the emulator's work.
  const before = term.written.length;
  channel.onmessage(new Uint8Array([0x53, 0x3a, 0xc3]).buffer);
  channel.onmessage(new Uint8Array([0xa9, 0x3a, 0x45]).buffer);
  assert.deepEqual(term.written.slice(before).map(chunk => chunk instanceof Uint8Array && [...chunk]), [[0x53, 0x3a, 0xc3], [0xa9, 0x3a, 0x45]]);
}

// 3. A failed acknowledgement is not an error for the person, and the next one repairs it.
{
  const { pane, channel, events, of } = harness({ fail: { 'terminal.ack': 'The desktop connection did not respond.' } });
  await pane.opened;
  channel.onmessage(bytes(ACK_EVERY));
  Terminal.latest.parse();
  await settle();
  assert.equal(of('terminal.ack').length, 1);
  assert.deepEqual(events.errors, []);
}

// 4. Input goes one request at a time, in order; what is typed while a request is in flight is
// joined into the next one.
{
  const { bridge, pane, held, of } = harness();
  const term = Terminal.latest;
  await pane.opened;
  bridge.hold = true;
  term.listeners.data('a');
  await settle();
  term.listeners.data('b');
  term.listeners.data('c');
  await settle();
  assert.deepEqual(of('terminal.input').map(request => request.params), [{ id: 'pane-1', data: 'a' }]);
  held.shift()(true);
  await settle();
  assert.deepEqual(of('terminal.input').map(request => request.params.data), ['a', 'bc']);
  held.shift()(true);
  await settle();
  term.listeners.data('d');
  await settle();
  assert.deepEqual(of('terminal.input').map(request => request.params.data), ['a', 'bc', 'd']);
  held.shift()(true);
  // Binary reports are base64 with the flag.
  bridge.hold = false;
  term.listeners.binary('\x00\xff');
  assert.deepEqual(of('terminal.input').at(-1).params, { id: 'pane-1', data: 'AP8=', binary: true });
  term.listeners.resize({ cols: 120, rows: 40 });
  assert.deepEqual(of('terminal.resize').map(request => request.params), [{ id: 'pane-1', cols: 120, rows: 40 }]);
}

// 5. Exit and error messages, and nothing is sent to a pane that has ended.
{
  const { pane, channel, events, of } = harness();
  const term = Terminal.latest;
  await pane.opened;
  channel.onmessage({ event: 'terminal.error', message: 'Terminal stream ended.' });
  assert.deepEqual(events.errors, ['Terminal stream ended.']);
  channel.onmessage({ event: 'terminal.exit' });
  channel.onmessage({ event: 'terminal.exit' });
  assert.equal(events.exits, 1, 'Exit is reported once');
  assert.equal(pane.ended, true);
  term.listeners.data('x');
  term.listeners.resize({ cols: 1, rows: 1 });
  await settle();
  assert.equal(of('terminal.input').length + of('terminal.resize').length, 0);
  channel.onmessage('unexpected');
  channel.onmessage(null);
}

// 6. An input failure is shown and does not stop later input.
{
  const { pane, events, of } = harness({ fail: { 'terminal.input': 'This shell has ended. Reopen the pane to reconnect.' } });
  const term = Terminal.latest;
  await pane.opened;
  term.listeners.data('x');
  await settle();
  term.listeners.data('y');
  await settle();
  assert.deepEqual(events.errors, ['This shell has ended. Reopen the pane to reconnect.', 'This shell has ended. Reopen the pane to reconnect.']);
  assert.equal(of('terminal.input').length, 2);
}

// 7. Copy and paste go through the host. Control+Shift on other systems, Command on a Mac; with
// nothing selected Control+Shift+C is left to the terminal.
{
  const { pane, of } = harness();
  const term = Terminal.latest;
  await pane.opened;
  const key = (letter, modifiers) => { let prevented = false; const handled = term.keys({ type: 'keydown', key: letter, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...modifiers, preventDefault() { prevented = true; } }); return { handled, prevented }; };
  assert.deepEqual(key('c', { ctrlKey: true }), { handled: true, prevented: false }, 'Control+C stays an interrupt');
  assert.deepEqual(key('C', { ctrlKey: true, shiftKey: true }), { handled: true, prevented: false }, 'Nothing selected: not a copy');
  term.selection = 'selected words';
  assert.deepEqual(key('C', { ctrlKey: true, shiftKey: true }), { handled: false, prevented: true });
  assert.deepEqual(of('terminal.clipboard.write').map(request => request.params), [{ text: 'selected words' }]);
  assert.deepEqual(key('V', { ctrlKey: true, shiftKey: true }), { handled: false, prevented: true });
  await settle();
  assert.deepEqual(of('terminal.clipboard.read').map(request => request.params), [{}]);
  assert.deepEqual(term.pasted, ['pasted text']);
  assert.deepEqual(key('v', { metaKey: true }), { handled: true, prevented: false }, 'Command is not the modifier off a Mac');
  assert.equal(term.keys({ type: 'keyup', key: 'v', ctrlKey: true, shiftKey: true }), true);
}
{
  const { pane, of } = harness({ mac: true });
  const term = Terminal.latest;
  await pane.opened;
  const key = (letter, modifiers) => term.keys({ type: 'keydown', key: letter, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...modifiers, preventDefault() {} });
  assert.equal(key('c', { ctrlKey: true }), true, 'Control+C stays an interrupt on a Mac');
  assert.equal(key('c', { metaKey: true }), false, 'Command+C never reaches the shell');
  assert.equal(of('terminal.clipboard.write').length, 0, 'Nothing selected: nothing written');
  term.selection = 'mac words';
  assert.equal(key('c', { metaKey: true }), false);
  assert.deepEqual(of('terminal.clipboard.write').map(request => request.params), [{ text: 'mac words' }]);
  assert.equal(key('v', { metaKey: true }), false);
  await settle();
  assert.deepEqual(term.pasted, ['pasted text']);
}

// 8. Closing asks the host to close the pane once, stops watching the element, disposes the
// emulator, and ignores output that arrives afterwards.
{
  const { pane, channel, of, stops, resize } = harness();
  const term = Terminal.latest;
  await pane.opened;
  const fits = FitAddon.fits;
  resize();
  assert.equal(FitAddon.fits, fits + 1, 'A size change refits the emulator');
  await Promise.all([pane.close(), pane.close()]);
  assert.deepEqual(of('terminal.close').map(request => request.params), [{ id: 'pane-1' }]);
  assert.equal(stops.count, 1);
  assert.equal(term.disposed, true);
  const written = term.written.length;
  channel.onmessage(bytes(10));
  assert.equal(term.written.length, written);
  assert.deepEqual(Object.keys(term.listeners), []);
}

// 9. A pane that could not open reports the host's sentence, counts as ended, and closing it
// sends nothing.
{
  const { pane, of } = harness({ fail: { 'terminal.open': 'Project folder not found on this machine. Choose an existing folder.' } });
  await assert.rejects(pane.opened, /Project folder not found/);
  assert.equal(pane.ended, true);
  await pane.close();
  assert.equal(of('terminal.close').length, 0);
  assert.equal(Terminal.latest.disposed, true);
}

// 10. The emulator is the reviewed bundle in dist/vendor, served beside the shell and not copied:
// the page asks for exactly the two names the configuration serves, the bundle provides the
// global the page reads, and no file in ui/ shadows them.
{
  const config = JSON.parse(read('src-tauri/tauri.conf.json'));
  assert.deepEqual(config.build.frontendDist.slice(1), ['../dist/vendor/xterm.js', '../dist/vendor/xterm.css']);
  assert(read('dist/vendor/xterm.js').trimEnd().endsWith('window.OpenSesameXterm=a;})();'));
  assert(/import\('\.\/xterm\.js'\)\.then\(\(\) => window\.OpenSesameXterm\)/.test(read('ui/main.js')));
  assert(read('ui/index.html').includes('<link rel="stylesheet" href="./xterm.css">'));
  for (const name of ['ui/xterm.js', 'ui/xterm.css']) assert.throws(() => read(name), `${name} would shadow the vendored file`);
  const notice = read('dist/vendor/THIRD-PARTY.txt');
  assert(notice.includes('The xterm.js authors') && notice.includes('Permission is hereby granted') && notice.includes('Provenance:'));
}

// 11. The page and the host agree: output never travels as a window event, the self-test is
// loaded only behind its flag, and the acknowledgement step is below the host's high-water mark.
{
  const terminal = read('ui/terminal.js');
  assert(!/terminal\.data/.test(terminal.replace(/\/\/[^\n]*/g, '')), 'The pane does not listen for output events');
  const main = read('ui/main.js');
  assert.equal((main.match(/import\(/g) || []).length, 2, 'Two things load on demand: the emulator and the self-test');
  assert(/const selftest = window\.__OPEN_SESAME_SELFTEST__;\s*if \(selftest\) import\('\.\/dev\/selftest\.js'\)/.test(main));
  assert(/if !cfg!\(debug_assertions\) \{\s*return String::new\(\);/.test(read('src-tauri/src/window.rs')), 'A release build never sets the self-test flag');
  const high = Number(/pub const HIGH_WATER: u64 = ([0-9* ]+);/.exec(read('crates/core/src/terminal/mod.rs'))[1].split('*').reduce((product, factor) => product * Number(factor), 1));
  assert(ACK_EVERY * 2 <= high, 'The emulator acknowledges well before the host would stop');
  const gate = read('crates/core/src/gate.rs');
  for (const method of new Set([...terminal.matchAll(/'((?:terminal|project)\.[a-zA-Z.]+)'/g)].map(match => match[1]).filter(name => !['terminal.exit', 'terminal.error'].includes(name)))) assert(gate.includes(`"${method}"`), `${method} is a method the gate admits`);
  for (const method of ['project.chooseFolder', 'project.reveal']) assert(main.includes(`'${method}'`) && gate.includes(`"${method}"`));
}

console.log('Tauri terminal pane: requests, acknowledgements, input order, exit, clipboard keys and the vendored emulator passed.');
