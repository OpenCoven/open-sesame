// One terminal pane (issue #74): a terminal emulator joined to a shell on the host.
//
// Output arrives on a Tauri channel, one per pane, in order. A message is an ArrayBuffer of the
// bytes the program wrote, or an object: {event: 'terminal.exit'} or
// {event: 'terminal.error', message}. Window events are not used for output: they are not
// ordered and not built for volume.
//
// Flow control. The emulator parses output more slowly than a program can print it, and it
// discards what overflows its write buffer. So every chunk is written with a callback, the pane
// counts the bytes the emulator has finished with, and it tells the host that count with
// terminal.ack each time it has grown by ACK_EVERY. The host stops sending when the count falls
// a megabyte behind (crates/core/src/terminal), which stops the program itself.
//
// Everything the pane touches is passed in, so scripts/check-tauri-terminal.mjs can run it in
// Node against stand-ins.

export const ACK_EVERY = 128 * 1024;

const THEME = {
  background: '#131315', foreground: '#ddd5e7', cursor: '#d0b9ee', selectionBackground: '#bca2da50',
  black: '#24212a', red: '#e19eaf', green: '#b2c9a4', yellow: '#d5c4a0', blue: '#9fb4dc', magenta: '#c9a9e0', cyan: '#9fcfd0', white: '#ddd5e7',
  brightBlack: '#6f687a', brightRed: '#f0b3c2', brightGreen: '#c6dbb9', brightYellow: '#e6d6b4', brightBlue: '#b6c8ea', brightMagenta: '#dcc0ee', brightCyan: '#b7e0e1', brightWhite: '#f4eefb',
};
const OPTIONS = {
  cursorBlink: false, cursorStyle: 'block', cursorInactiveStyle: 'outline', scrollback: 5000, allowTransparency: false,
  fontFamily: '"SFMono-Regular", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace', fontSize: 12, lineHeight: 1.25, theme: THEME,
};

const text = error => (error && typeof error.message === 'string' && error.message) || String(error);

// Bytes as base64, for input the emulator reports as binary (mouse reports, for example).
const base64 = binary => btoa(binary);

/**
 * Opens a pane in `element`.
 *
 * deps: { bridge, Terminal, FitAddon, Channel, mac, observe }
 *   bridge   the object from createBridge
 *   Terminal, FitAddon   the emulator classes
 *   Channel  the Tauri channel class (window.__TAURI__.core.Channel)
 *   mac      true where Command, not Control+Shift, is the copy and paste modifier
 *   observe  optional (element, callback) => stop, called when the element changes size
 * launch: { id, mode, cwd, host, user, launcher, prompt }
 * hooks: { onExit(), onError(message), onBytes(bytes) } - all optional
 */
export function createPane(deps, element, launch, hooks = {}) {
  const { bridge, Terminal, FitAddon, Channel, mac = false, observe } = deps;
  const id = launch.id;
  const term = new Terminal(OPTIONS);
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(element);
  const refit = () => { try { fit.fit(); } catch { /* not laid out yet */ } };
  refit();

  const stats = { received: 0, processed: 0, acknowledged: 0, acks: 0, messages: 0 };
  let ended = false;
  let closed = false;

  const acknowledge = () => {
    stats.acknowledged = stats.processed;
    stats.acks += 1;
    // A lost acknowledgement is repaired by the next one: the count is a running total.
    bridge.request('terminal.ack', { id, bytes: stats.processed }).catch(() => {});
  };

  const finish = () => {
    if (ended) return;
    ended = true;
    hooks.onExit?.();
  };

  const channel = new Channel();
  channel.onmessage = message => {
    if (closed) return;
    const bytes = message instanceof ArrayBuffer ? new Uint8Array(message) : ArrayBuffer.isView(message) ? new Uint8Array(message.buffer, message.byteOffset, message.byteLength) : null;
    if (bytes) {
      stats.messages += 1;
      stats.received += bytes.length;
      hooks.onBytes?.(bytes);
      term.write(bytes, () => {
        stats.processed += bytes.length;
        if (!closed && stats.processed - stats.acknowledged >= ACK_EVERY) acknowledge();
      });
    } else if (message?.event === 'terminal.error') {
      hooks.onError?.(typeof message.message === 'string' ? message.message : 'Terminal stream ended.');
    } else if (message?.event === 'terminal.exit') {
      finish();
    }
  };

  // Input is sent one request at a time, in order, with whatever was typed meanwhile joined into
  // the next request. Separate requests could reach the shell out of order.
  let pending = '';
  let sending = false;
  const flush = async () => {
    if (sending) return;
    sending = true;
    try {
      while (pending && !ended && !closed) {
        const data = pending;
        pending = '';
        try { await bridge.request('terminal.input', { id, data }); }
        catch (error) { hooks.onError?.(text(error)); pending = ''; }
      }
    } finally { sending = false; }
  };
  const send = data => {
    if (ended || closed || !data) return;
    pending += data;
    flush();
  };

  const disposables = [
    term.onData(send),
    term.onBinary(data => {
      if (ended || closed) return;
      bridge.request('terminal.input', { id, data: base64(data), binary: true }).catch(error => hooks.onError?.(text(error)));
    }),
    term.onResize(({ cols, rows }) => {
      if (ended || closed) return;
      bridge.request('terminal.resize', { id, cols, rows }).catch(() => {});
    }),
  ];

  // Copy and paste go through the host, which holds the only clipboard access the app has.
  const copy = () => {
    const selection = term.getSelection();
    if (selection) bridge.request('terminal.clipboard.write', { text: selection }).catch(error => hooks.onError?.(text(error)));
    return Boolean(selection);
  };
  const paste = () => bridge.request('terminal.clipboard.read', {}).then(clip => { if (clip && !ended && !closed) term.paste(clip); }, error => hooks.onError?.(text(error)));
  term.attachCustomKeyEventHandler(event => {
    if (event.type !== 'keydown') return true;
    const modifier = mac ? event.metaKey && !event.ctrlKey && !event.altKey : event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey;
    const key = String(event.key || '').toLowerCase();
    if (modifier && key === 'c') {
      // With nothing selected on other systems the keys keep their terminal meaning.
      if (!copy() && !mac) return true;
      event.preventDefault?.();
      return false;
    }
    if (modifier && key === 'v') {
      paste();
      event.preventDefault?.();
      return false;
    }
    return true;
  });

  const stopObserving = observe ? observe(element, refit) : null;

  const opened = bridge.request('terminal.open', {
    id, mode: launch.mode || 'local', cwd: launch.cwd || '', host: launch.host || '', user: launch.user || '',
    launcher: launch.launcher || 'shell', prompt: launch.prompt || '', cols: term.cols, rows: term.rows, channel,
  });
  opened.catch(() => { ended = true; });

  const close = async () => {
    if (closed) return;
    closed = true;
    stopObserving?.();
    for (const disposable of disposables) disposable?.dispose?.();
    // The pane may never have opened; closing it is then nothing to report.
    await opened.then(() => bridge.request('terminal.close', { id }), () => {}).catch(() => {});
    channel.onmessage = () => {};
    term.dispose();
  };

  return Object.freeze({
    id, opened, stats, close, copy, paste, send,
    focus: () => term.focus(),
    fit: refit,
    get ended() { return ended; },
  });
}
