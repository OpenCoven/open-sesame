// Acceptance pass for terminal panes (issue #74). It runs only in a development build started
// with OPEN_SESAME_SELFTEST set to a JSON object: {"out": file to write, "cwd": folder to open a
// shell in, "cwdName": text that must appear in its working directory, "lines": how many
// numbered lines the flood prints}. A release build never loads this file.
//
// It uses nothing but the product's own panes. It types into real shells, watches the bytes that
// come back, checks the process list through a shell, and writes what it found to `out` through
// a shell, because the page has no file access of its own. The script that started the app reads
// that file; see src-tauri/AGENTS.md.

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Collects a pane's output as text and lets a step wait for something to appear in it.
function watcher() {
  const decoder = new TextDecoder();
  let text = '';
  return {
    onBytes(bytes) {
      text += decoder.decode(bytes, { stream: true });
      if (text.length > 400000) text = text.slice(-200000);
    },
    get text() { return text; },
    async until(find, limit, what) {
      const end = performance.now() + limit;
      for (;;) {
        const found = find(text);
        if (found) return found;
        if (performance.now() > end) throw new Error(`Timed out waiting for ${what}.`);
        await wait(25);
      }
    },
  };
}

// Checks a flood of numbered lines byte by byte as it arrives: `__S__`, then 1 to `total` each
// on its own line, then `__E__`. Anything missing, repeated or out of order fails it.
function floodChecker(total) {
  const START = '__S__\n';
  let seeking = START.length;
  let window = '';
  let next = 1;
  let current = -1;
  let bytes = 0;
  let started = 0;
  let settle;
  const done = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  let finished = false;
  const fail = reason => { if (!finished) { finished = true; settle.reject(new Error(reason)); } };
  return {
    done,
    get bytes() { return bytes; },
    get started() { return started; },
    get next() { return next; },
    onBytes(chunk) {
      if (finished) return;
      let index = 0;
      if (seeking) {
        for (; index < chunk.length && seeking; index += 1) {
          window = (window + String.fromCharCode(chunk[index])).slice(-START.length);
          if (window === START) { seeking = 0; started = performance.now(); }
        }
        if (seeking) return;
      }
      for (; index < chunk.length; index += 1) {
        const byte = chunk[index];
        bytes += 1;
        if (byte >= 48 && byte <= 57) {
          current = (current < 0 ? 0 : current * 10) + (byte - 48);
        } else if (byte === 10) {
          if (current !== next) return fail(`Line ${next} arrived as ${current < 0 ? 'an empty line' : current}.`);
          next += 1;
          current = -1;
        } else if (byte === 95 && current < 0 && next === total + 1) {
          finished = true;
          return settle.resolve({ bytes: bytes - 1, lines: total, ms: performance.now() - started });
        } else {
          return fail(`Unexpected byte ${byte} after line ${next - 1}.`);
        }
      }
    },
  };
}

// Measures how long the page went without running a timer and without drawing a frame.
function responsiveness() {
  let running = true;
  let lastTick = performance.now();
  let longestTick = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    longestTick = Math.max(longestTick, now - lastTick);
    lastTick = now;
  }, 10);
  let frames = 0;
  let lastFrame = performance.now();
  let longestFrame = 0;
  const frame = now => {
    if (!running) return;
    frames += 1;
    longestFrame = Math.max(longestFrame, now - lastFrame);
    lastFrame = now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return () => {
    running = false;
    clearInterval(timer);
    return { longestTimerGapMs: Math.round(longestTick), frames, longestFrameGapMs: Math.round(longestFrame) };
  };
}

export async function run({ launch, config }) {
  const results = { started: new Date().toISOString(), agent: navigator.userAgent, phase: 'running', steps: [] };
  const lines = Number(config.lines) || 7000000;
  let writes = 0;
  // The window belongs to the test while it runs; closing a tab by hand breaks the run.
  const notice = document.querySelector('[data-notice]');
  const banner = text => { if (notice) { notice.textContent = text; notice.hidden = false; } };
  banner('Self-test running. Please leave this window alone; it closes by itself when the test ends.');

  // The reporter is a plain POSIX shell, so the report does not depend on the startup files of
  // the person's own shell. The panes under test use the default shell.
  const reporter = watcher();
  const report = await launch({ mode: 'local', name: 'Self-test report', launcher: 'bash', prompt: "PS1='report$ ' exec /bin/sh" }, { onBytes: reporter.onBytes });

  const write = async () => {
    writes += 1;
    const body = JSON.stringify(results, null, 1).split('\n');
    const command = [` cat > '${config.out}.tmp' <<'OPEN_SESAME_REPORT_END'`, ...body, 'OPEN_SESAME_REPORT_END', ` mv '${config.out}.tmp' '${config.out}' && printf 'REPORT_%s_WRITTEN\\n' ${writes}`];
    report.pane.send(command.join('\r') + '\r');
    await reporter.until(text => text.includes(`REPORT_${writes}_WRITTEN`), 20000, 'the report to be written');
  };

  // Which of `pids` the operating system still lists, asked through the reporter shell.
  let probes = 0;
  const alive = async pids => {
    probes += 1;
    const tag = `P${probes}`;
    report.pane.send(` for p in ${pids.join(' ')}; do if kill -0 $p 2>/dev/null; then printf 'PID_%s_ALIVE_%s\\n' $p ${tag}; else printf 'PID_%s_GONE_%s\\n' $p ${tag}; fi; done; printf 'PROBE_%s_DONE\\n' ${tag}\r`);
    const text = await reporter.until(output => output.includes(`PROBE_${tag}_DONE`) && output, 10000, 'the process check');
    return pids.filter(pid => text.includes(`PID_${pid}_ALIVE_${tag}`));
  };

  const step = async (name, body) => {
    const started = performance.now();
    try {
      const detail = await body();
      results.steps.push({ name, ok: true, ms: Math.round(performance.now() - started), ...detail });
    } catch (error) {
      results.steps.push({ name, ok: false, ms: Math.round(performance.now() - started), error: String(error?.message || error) });
    }
    await write();
  };

  // A shell with a long-running child, as a person would leave one. Returns both process IDs.
  const shellWithChild = async name => {
    const output = watcher();
    const opened = await launch({ mode: 'local', name }, { onBytes: output.onBytes });
    opened.pane.send("sleep 86400 & printf 'CHILD:%s\\n' $!\r");
    const child = await output.until(text => /CHILD:(\d+)\r?\n/.exec(text)?.[1], 15000, 'the child process ID');
    return { opened, pids: [opened.result.pid, Number(child)] };
  };

  try {
    await write();

    const first = watcher();
    let firstPane;
    await step('A marker echoed through a real shell arrives intact', async () => {
      firstPane = await launch({ mode: 'local', cwd: config.cwd || '', name: 'Marker' }, { onBytes: first.onBytes });
      firstPane.pane.send("printf 'open-%s-marker\\n' sesame\r");
      await first.until(text => text.includes('open-sesame-marker'), 15000, 'the marker');
      return { pid: firstPane.result.pid, machine: firstPane.result.machine };
    });

    await step('A project folder with spaces and non-ASCII characters works', async () => {
      if (!config.cwd || !config.cwdName) throw new Error('No folder was given to the self-test.');
      // The typed command is echoed too, so the match must be the shell's answer: a path, not %s.
      firstPane.pane.send("printf 'CWD:%s:END\\n' \"$PWD\"\r");
      const folder = await first.until(text => /CWD:(\/[^\r\n]*):END/.exec(text)?.[1], 15000, 'the working directory');
      if (!folder.endsWith(`/${config.cwdName}`)) throw new Error(`The shell started in ${folder}.`);
      return { folder };
    });
    await firstPane?.close();

    await step(`A command that prints ${lines} numbered lines does not freeze the window or drop output`, async () => {
      const checker = floodChecker(lines);
      const flood = await launch({ mode: 'local', name: 'Flood' }, { onBytes: checker.onBytes });
      const stop = responsiveness();
      flood.pane.send(`stty -echo -opost; printf '__S__\\n'; awk 'BEGIN { for (i = 1; i <= ${lines}; i++) print i }'; printf '__E__\\n'\r`);
      let outcome;
      let page;
      try {
        outcome = await Promise.race([checker.done, wait(600000).then(() => { throw new Error(`Timed out at line ${checker.next} after ${checker.bytes} bytes.`); })]);
      } finally {
        page = stop();
      }
      // Let the emulator finish what it was handed, then read its counters.
      await wait(500);
      const stats = { ...flood.pane.stats };
      await flood.close();
      return {
        bytes: outcome.bytes, lines: outcome.lines, seconds: Number((outcome.ms / 1000).toFixed(2)),
        megabytesPerSecond: Number((outcome.bytes / 1048576 / (outcome.ms / 1000)).toFixed(1)),
        channelMessages: stats.messages, acknowledgements: stats.acks, ...page,
      };
    });

    await step('Closing a pane that runs a long child process leaves neither process within three seconds', async () => {
      const { opened, pids } = await shellWithChild('Close me');
      const before = await alive(pids);
      if (before.length !== pids.length) throw new Error(`Only ${before.length} of ${pids.length} processes were running before the close.`);
      const started = performance.now();
      await opened.close();
      const closeReturnedMs = Math.round(performance.now() - started);
      let left = pids;
      while ((left = await alive(pids)).length && performance.now() - started < 3000) await wait(100);
      const goneMs = Math.round(performance.now() - started);
      if (left.length) throw new Error(`Still running after ${goneMs} ms: ${left.join(', ')}.`);
      return { pids, closeReturnedMs, checkedGoneAfterMs: goneMs };
    });

    await step('Three panes are open, each with a long child process, ready for Quit', async () => {
      const pids = [];
      for (const name of ['Quit one', 'Quit two', 'Quit three']) pids.push(...(await shellWithChild(name)).pids);
      const running = await alive(pids);
      if (running.length !== pids.length) throw new Error(`Only ${running.length} of ${pids.length} processes are running.`);
      results.quit = { pids, reporter: report.result.pid };
      return { pids };
    });
  } catch (error) {
    results.error = String(error?.message || error);
  }
  banner('Self-test finished. This window is about to close.');
  results.phase = 'ready-to-quit';
  results.finished = new Date().toISOString();
  await write().catch(() => {});
}
