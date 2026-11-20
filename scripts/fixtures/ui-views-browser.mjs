// Rendered Today, Projects and Focus (issue #77) against a synthetic host that persists across a
// relaunch. Extends the shell fixture (ui-shell-browser.mjs): same loopback-only server, real
// module and CSS requests, and every request off that origin is refused and recorded. The host
// lives in this process, so it survives closing the page and opening a new one; its items and
// projects follow the core's rules through the in-memory stand-in (ui-storage-core.mjs), not the
// Rust core. Faults are injected per call. Each page runs on Playwright's fake clock, paused, so
// time moves only when a step moves it. Visibility changes are synthetic events. No provider,
// account, network or native window is involved.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium, webkit} from 'playwright';
import {createStorageCore} from './ui-storage-core.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.argv[2] || 'build/ui-views-browser');
await mkdir(output, {recursive: true});
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const aliases = {'/ui/xterm.js': 'dist/vendor/xterm.js', '/ui/xterm.css': 'dist/vendor/xterm.css'};
    const file = path.resolve(root, aliases[pathname] || pathname.slice(1));
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const engines = process.env.UI_SHELL_ENGINES?.split(',') || ['chromium', 'webkit'];
const report = {kind: 'browser with a persisting synthetic host and fake clock; no native, device, provider or Rust-core acceptance', platform: process.platform, results: []};
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const START = Date.UTC(2026, 10, 16, 9, 0, 0);
const MINUTE = 60_000;
const SAVE_FAILED = 'Could not save. Your changes were not stored; try again.';
const OVERTAKEN = 'That capture was not saved because another view opened first. The palette keeps it; try again.';
const NO_RESPONSE = 'The desktop connection did not respond.';
const KIND_CHANGED = kind => `That item was changed to a ${kind} after you opened it. Your changes were not saved; copy them if you need them, then choose Discard changes to edit the ${kind}.`;

// The host: the shell's own commands in the shapes src-tauri answers, settings and widget
// states as the core keeps them, and items and projects through the stand-in.
function createHost({settings = {}} = {}) {
  const core = createStorageCore();
  const state = {settings: structuredClone(settings), widgets: {}}, calls = [], faults = [], refused = new Map();
  return {
    core, state, calls,
    // A refusal fails every request for `method` until it is lifted.
    refuse(method, value) { refused.set(method, value); },
    lift(method) { refused.delete(method); },
    // A fault is taken by the first request for `method` whose params hold every entry of
    // `match`, so a step can refuse one write while the shell's own writes of the same method
    // go through.
    fault(method, value, match = {}) { faults.push({method, value, match}); },
    writes: () => calls.filter(([method]) => /\.(set|save|delete)$/.test(method)),
    async request(method, params = {}) {
      calls.push([method, structuredClone(params)]);
      if (refused.has(method)) return {ok: false, error: refused.get(method)};
      const index = faults.findIndex(fault => fault.method === method
        && Object.entries(fault.match).every(([name, expected]) => params[name] === expected));
      if (index >= 0) return {ok: false, error: faults.splice(index, 1)[0].value};
      try {
        let result = true;
        if (method === 'system.info') result = {available: true, platform: 'darwin', authenticated: false};
        else if (method === 'auth.status') result = {authenticated: false, busy: false, message: '', name: '', email: ''};
        else if (method === 'summon.status') result = {session: 'macos', shortcut: 'Control+Alt+Shift+Space', defaultShortcut: 'Control+Alt+Shift+Space', registered: true, message: '', toggleCommand: 'open-sesame --toggle', hideOnBlur: false};
        else if (method === 'settings.all') result = {settings: structuredClone(state.settings)};
        else if (method === 'settings.set') {
          if (JSON.stringify(params.value).length > 65_536) throw Error('That setting is too large to save.');
          state.settings[params.key] = structuredClone(params.value); result = {saved: true};
        } else if (method === 'settings.delete') { delete state.settings[params.key]; result = {deleted: true}; }
        else if (method === 'widgets.list') result = {widgets: {...state.widgets}};
        else if (method === 'widgets.set') { state.widgets[params.id] = params.state; result = {saved: true}; }
        else if (/^(items|projects)\./.test(method)) result = await core.bridge.request(method, params);
        return {ok: true, result};
      } catch (error) { return {ok: false, error: error.message}; }
    },
  };
}

// One app install: a browser context bound to a host. `open` starts the app at a time, as a
// launch does; closing the page and opening another is a relaunch against the same host.
async function install(browser, host, name) {
  const context = await browser.newContext({viewport: {width: 1090, height: 760}});
  const blocked = [], errors = [];
  await context.route('**/*', route => {
    if (route.request().url().startsWith(origin)) return route.continue();
    blocked.push(route.request().url());
    return route.abort();
  });
  await context.exposeBinding('__viewsHost', (source, method, params) => host.request(method, params));
  await context.addInitScript(() => {
    window.__OPEN_SESAME_NATIVE__ = true;
    window.__TAURI__ = {event: {listen: async () => () => {}}, core: {Channel: class {}, invoke: async (command, {message}) => {
      const {requestId, method, params} = message;
      const reply = await window.__viewsHost(method, params ?? {});
      return reply.ok ? {requestId, result: reply.result} : {requestId, error: reply.error};
    }}};
  });
  if (name === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'], {origin});
  return {
    context, blocked, errors,
    async open(time) {
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.clock.install({time});
      await page.goto(origin + '/ui/index.html');
      await page.locator('[data-ready="true"]').waitFor();
      // From here the clock moves only when a step moves it.
      await page.clock.pauseAt(time + MINUTE);
      return page;
    },
  };
}
const now = page => page.evaluate(() => Date.now());
const palette = async (page, text) => {
  if (await page.locator('#command-palette').isHidden()) await page.getByRole('button', {name: 'Commands', exact: true}).click();
  await page.locator('[data-command-query]').fill(text);
};
const shown = (page, state) => page.evaluate(state => {
  Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => state});
  document.dispatchEvent(new Event('visibilitychange'));
}, state);
const view = (page, id) => page.locator(`[data-widget-view="${id}"]`);
const rows = (host, test = () => true) => [...host.core.items.values()].filter(test);

try {
  for (const name of engines) {
    const browser = await ({chromium, webkit})[name].launch({headless: process.env.UI_SHELL_HEADLESS !== '0'});
    const step = async (label, action) => {
      try { await action(); report.results.push({engine: name, label, passed: true}); }
      catch (error) { report.results.push({engine: name, label, passed: false, error: error.stack}); throw error; }
    };
    const installs = [];
    try {
      // ---- Capture from the palette, Today and Projects, relaunch ----
      const host = createHost();
      const app = await install(browser, host, name);
      installs.push(app);
      let page = await app.open(START);
      await step('a clean start opens Today and writes nothing', async () => {
        assert(await view(page, 'today').isVisible());
        await view(page, 'today').getByText('No notes yet. Capture one above.').waitFor();
        assert.deepEqual(host.writes(), [], 'no write before the person does something');
        assert(!(await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name))).some(url => /\/(projects|focus)\.js$/.test(url)), 'only the shown view is imported');
      });
      await step('the palette captures a note and a task into Today and Projects', async () => {
        await palette(page, 'Buy oat milk');
        assert.equal(await page.locator('[data-command-results] button').first().getAttribute('data-command'), 'today.capture-note.text', 'plain text is captured as a note first');
        await page.locator('[data-command-query]').press('Enter');
        await view(page, 'today').locator('[data-capture-status]').getByText('Note saved.').waitFor();
        await view(page, 'today').locator('[data-today-note-title]').getByText('Buy oat milk', {exact: true}).waitFor();
        await palette(page, 'task: Call the landlord');
        await page.locator('[data-command-query]').press('Enter');
        await view(page, 'today').locator('[data-today-tasks]').getByText('Call the landlord', {exact: true}).waitFor();
        // The palette's command opens the field, with the kind chosen.
        await palette(page, 'capture a task');
        await page.locator('[data-command="today.capture-task"]').click();
        const field = view(page, 'today').locator('[data-capture-text]');
        assert.equal(await field.evaluate(node => node === document.activeElement), true, 'the capture field has focus');
        assert.equal(await view(page, 'today').locator('[data-capture-kind]').inputValue(), 'task');
        await field.fill('Water the plants');
        await field.press('Enter');
        await view(page, 'today').locator('[data-capture-status]').getByText('Task saved.').waitFor();
        assert.equal(await field.inputValue(), '', 'a saved draft leaves the field');
        assert.equal(await view(page, 'today').locator('[data-today-task-count]').textContent(), '2 open · 0 done');
        const saved = rows(host);
        assert.deepEqual(saved.map(item => [item.kind, item.text]).sort(), [['note', 'Buy oat milk'], ['task', 'Call the landlord'], ['task', 'Water the plants']]);
        assert(saved.every(item => V4.test(item.id)), 'each create names a client UUID v4');
        await page.locator('[data-view="projects"]').click();
        const list = view(page, 'projects').locator('[data-item-list]');
        for (const text of ['Buy oat milk', 'Call the landlord', 'Water the plants']) await list.getByText(text, {exact: true}).waitFor();
        assert.equal(await view(page, 'projects').locator('[data-projects-counts]').textContent(), '3 of 30 active · 3 of 300 items');
      });
      await step('the captures survive a relaunch', async () => {
        const at = await now(page);
        await page.close();
        page = await app.open(at + 5 * MINUTE);
        assert(await view(page, 'projects').isVisible(), 'the last view opens again');
        const list = view(page, 'projects').locator('[data-item-list]');
        for (const text of ['Buy oat milk', 'Call the landlord', 'Water the plants']) await list.getByText(text, {exact: true}).waitFor();
        await page.locator('[data-view="today"]').click();
        await view(page, 'today').locator('[data-today-note-title]').getByText('Buy oat milk', {exact: true}).waitFor();
        await view(page, 'today').locator('[data-today-tasks]').getByText('Call the landlord', {exact: true}).waitFor();
        assert.equal(await view(page, 'today').locator('[data-today-task-count]').textContent(), '2 open · 0 done');
      });
      await step('a palette capture is kept when another view opens before Today has loaded', async () => {
        // The last view is Projects, so Today's module is not loaded when the capture asks for it.
        await page.locator('[data-view="projects"]').click();
        await view(page, 'projects').waitFor({state: 'visible'});
        const at = await now(page);
        await page.close();
        page = await app.open(at + MINUTE);
        assert(await view(page, 'projects').isVisible());
        let release;
        const held = new Promise(resolve => { release = resolve; });
        await page.route('**/ui/widgets/today.js', async route => { await held; await route.continue(); });
        const requested = page.waitForRequest(request => request.url().endsWith('/ui/widgets/today.js'));
        await palette(page, 'note: Bring the umbrella');
        await page.locator('[data-command-query]').press('Enter');
        await requested;
        await page.locator('[data-view="projects"]').click();
        release();
        await page.locator('[data-shell-notice]').getByText(OVERTAKEN).waitFor();
        assert.equal(rows(host, item => item.text === 'Bring the umbrella').length, 0, 'nothing was saved');
        await page.getByRole('button', {name: 'Commands', exact: true}).click();
        assert.equal(await page.locator('[data-command-query]').inputValue(), 'note: Bring the umbrella', 'the palette kept the text');
        await page.locator('[data-command-query]').press('Enter');
        await page.locator('[data-shell-notice]').waitFor({state: 'hidden'});
        await view(page, 'today').locator('[data-capture-status]').getByText('Note saved.').waitFor();
        assert.equal(rows(host, item => item.text === 'Bring the umbrella').length, 1);
        await page.getByRole('button', {name: 'Commands', exact: true}).click();
        assert.equal(await page.locator('[data-command-query]').inputValue(), '', 'a saved capture is not offered again');
        await page.locator('[data-command-query]').press('Escape');
      });
      await step('completing a task in Today archives it in Projects', async () => {
        // The row leaves the list once the core has saved it, so it is clicked once, by name.
        await view(page, 'today').locator('[data-today-tasks] li', {hasText: 'Water the plants'}).getByRole('checkbox').click();
        await page.waitForFunction(() => document.querySelector('[data-today-task-count]')?.textContent === '1 open · 1 done');
        const done = rows(host, item => item.kind === 'task' && item.done);
        assert.equal(done.length, 1);
        assert.equal(done[0].stage, 'done', 'stage and done are written together');
        await page.locator('[data-view="projects"]').click();
        await view(page, 'projects').locator('[data-show-archived="true"]').click();
        await view(page, 'projects').locator('[data-item-list]').getByText(done[0].text, {exact: true}).waitFor();
        await view(page, 'projects').locator('[data-show-archived="false"]').click();
      });
      await step('calculator and world-clock answers show in the palette and save nothing', async () => {
        const before = host.writes().length;
        await palette(page, '2+2');
        const answer = page.locator('[data-command-answer]');
        await answer.getByText('4', {exact: true}).waitFor();
        assert.match(await answer.textContent(), /2 \+ 2/);
        assert.equal(await page.locator('[data-command]').count(), 0, 'no command or capture is offered for a sum');
        await page.locator('[data-command-query]').press('Enter');
        await page.waitForFunction(() => /Copied|Could not copy/.test(document.querySelector('[data-command-answer]')?.textContent || ''));
        if (name === 'chromium') assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '4');
        await palette(page, 'time in Tokyo');
        assert.match(await answer.textContent(), /^\d{1,2}:\d{2}:\d{2}\s?[AP]M.*Asia\/Tokyo/);
        assert.equal(await page.locator('[data-command$=".text"]').count(), 0);
        await palette(page, '(1+');
        await page.locator('[data-command-answer="error"]').getByText('Finish the expression to calculate.').waitFor();
        // An answer that is only an error leaves the capture offers, but Enter does not choose them.
        await palette(page, '(555) 123-4567');
        await page.locator('[data-command-answer="error"]').waitFor();
        assert.equal(await page.locator('[data-command$=".text"]').count(), 2, 'a phone number can still be captured');
        await page.locator('[data-command-query]').press('Enter');
        assert(await page.locator('#command-palette').isVisible(), 'Enter chose no capture');
        await page.locator('[data-command-query]').press('Escape');
        assert.equal(host.writes().length, before, 'an answer writes nothing');
      });
      await step('a failed write shows its error and keeps the draft', async () => {
        await page.locator('[data-view="today"]').click();
        const today = view(page, 'today'), field = today.locator('[data-capture-text]'), status = today.locator('[data-capture-status]');
        await today.locator('[data-capture-kind]').selectOption('note');
        await field.fill('A draft that must survive');
        host.core.fault('items.save', 'fail', SAVE_FAILED);
        await today.getByRole('button', {name: 'Save', exact: true}).click();
        await status.getByText(SAVE_FAILED).waitFor();
        assert.equal(await status.getAttribute('data-tone'), 'warn');
        assert.equal(await field.inputValue(), 'A draft that must survive');
        assert.equal(rows(host, item => item.text === 'A draft that must survive').length, 0, 'nothing was saved');
        // A reply lost after the core committed: the retry names the same ID, so one row.
        host.core.fault('items.save', 'lose');
        await today.getByRole('button', {name: 'Save', exact: true}).click();
        await status.getByText('The desktop connection did not respond.').waitFor();
        assert.equal(await field.inputValue(), 'A draft that must survive', 'an unknown outcome keeps the draft');
        await today.getByRole('button', {name: 'Save', exact: true}).click();
        await status.getByText('Note saved.').waitFor();
        assert.equal(rows(host, item => item.text === 'A draft that must survive').length, 1, 'the retry kept one row');
        // A capture from the palette that fails goes back to the palette with its text.
        host.core.fault('items.save', 'fail', SAVE_FAILED);
        await palette(page, 'note: palette draft');
        await page.locator('[data-command-query]').press('Enter');
        await page.locator('[data-shell-notice]').getByText(SAVE_FAILED).waitFor();
        assert(await page.locator('#command-palette').isVisible(), 'the palette is open again');
        assert.equal(await page.locator('[data-command-query]').inputValue(), 'note: palette draft');
        assert.equal(rows(host, item => item.text === 'palette draft').length, 0);
        // Closed and opened again, the palette still holds the text; saving it clears the error.
        await page.locator('[data-command-query]').press('Escape');
        await page.getByRole('button', {name: 'Commands', exact: true}).click();
        assert.equal(await page.locator('[data-command-query]').inputValue(), 'note: palette draft');
        // A search typed over it and run leaves the kept text as it was.
        await page.locator('[data-command-query]').fill('open projects');
        await page.locator('[data-command-query]').press('Enter');
        await view(page, 'projects').waitFor({state: 'visible'});
        await page.getByRole('button', {name: 'Commands', exact: true}).click();
        assert.equal(await page.locator('[data-command-query]').inputValue(), 'note: palette draft', 'a search does not replace the kept text');
        await page.locator('[data-command-query]').press('Enter');
        await view(page, 'today').locator('[data-capture-status]').getByText('Note saved.').waitFor();
        await page.locator('[data-shell-notice]').waitFor({state: 'hidden'});
        assert.equal(rows(host, item => item.text === 'palette draft').length, 1);
        await page.getByRole('button', {name: 'Commands', exact: true}).click();
        assert.equal(await page.locator('[data-command-query]').inputValue(), '', 'a saved capture is not offered again');
        await page.locator('[data-command-query]').press('Escape');
        // A reply lost after the core committed, then an edited retry: the palette keeps its draft's
        // client ID, so the core keeps one row and the retry edits it.
        host.core.fault('items.save', 'lose');
        await palette(page, 'note: Pack the charger');
        await page.locator('[data-command-query]').press('Enter');
        await page.locator('[data-shell-notice]').getByText(NO_RESPONSE).waitFor();
        assert.equal(rows(host, item => item.text === 'Pack the charger').length, 1, 'the lost reply had committed');
        assert.equal(await page.locator('[data-command-query]').inputValue(), 'note: Pack the charger');
        await page.locator('[data-command-query]').fill('note: Pack the charger and the cable');
        await page.locator('[data-command-query]').press('Enter');
        await page.locator('[data-shell-notice]').waitFor({state: 'hidden'});
        assert.deepEqual(rows(host, item => item.text.startsWith('Pack the charger')).map(item => item.text), ['Pack the charger and the cable'], 'the edited retry changed that row');
        // Cleared and closed, a kept capture is dropped with its notice.
        host.core.fault('items.save', 'fail', SAVE_FAILED);
        await palette(page, 'note: Never mind');
        await page.locator('[data-command-query]').press('Enter');
        await page.locator('[data-shell-notice]').getByText(SAVE_FAILED).waitFor();
        await page.locator('[data-command-query]').fill('');
        await page.locator('[data-command-query]').press('Escape');
        await page.locator('[data-shell-notice]').waitFor({state: 'hidden'});
        await page.getByRole('button', {name: 'Commands', exact: true}).click();
        assert.equal(await page.locator('[data-command-query]').inputValue(), '', 'a cleared capture is not offered again');
        await page.locator('[data-command-query]').press('Escape');
        assert.equal(rows(host, item => item.text === 'Never mind').length, 0);
        // At 30 active items the next capture is refused before it reaches the core.
        const active = rows(host, item => !(item.stage === 'done' || (item.kind === 'task' && item.done))).length;
        for (let index = active; index < 30; index++) host.core.seed({kind: 'note', text: `Seeded ${index}`, id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`});
        await page.locator('[data-view="projects"]').click();
        await page.locator('[data-view="today"]').click();
        const saves = host.calls.filter(([method]) => method === 'items.save').length;
        await field.fill('One too many');
        await field.press('Enter');
        await status.getByText('You have 30 active items. Archive one to make room.').waitFor();
        assert.equal(await field.inputValue(), 'One too many');
        assert.equal(host.calls.filter(([method]) => method === 'items.save').length, saves, 'a capped save never reaches the core');
      });
      await step('the three views fit a narrow window', async () => {
        for (const id of ['today', 'projects', 'focus']) {
          await page.locator(`[data-view="${id}"]`).click();
          await view(page, id).waitFor({state: 'visible'});
          await page.screenshot({path: path.join(output, `${name}-${id}-desktop.png`), fullPage: true});
          await page.setViewportSize({width: 390, height: 844});
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${id} fits 390 pixels`);
          await page.screenshot({path: path.join(output, `${name}-${id}-narrow.png`), fullPage: true});
          await page.setViewportSize({width: 1090, height: 760});
        }
      });
      await step('turning the views off removes their surfaces and style', async () => {
        await page.getByRole('button', {name: 'Settings', exact: true}).click();
        for (const id of ['today', 'projects', 'focus']) {
          await page.locator(`[data-widget="${id}"]`).uncheck();
          await view(page, id).waitFor({state: 'detached'});
        }
        assert.equal(await page.locator('link[data-widget-style*="views.css"]').count(), 0);
        for (const id of ['today', 'projects', 'focus']) await page.locator(`[data-widget="${id}"]`).check();
        await view(page, 'focus').waitFor({state: 'visible'});
        await page.getByRole('button', {name: 'Settings', exact: true}).click();
        assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0], 'no browser storage is used');
      });
      await step('stored markup is shown as text, never as HTML', async () => {
        // Another writer (an agent, once #81 writes items) can store any text.
        const markup = '<img src=x onerror="document.body.dataset.injected=1">Plan <b>bold</b>';
        host.core.seed({kind: 'note', text: markup, title: markup, body: '<script>document.body.dataset.injected=2</script>Body <i>text</i>', id: '00000000-0000-4000-8000-0000000000aa'});
        await page.locator('[data-view="projects"]').click();
        await view(page, 'projects').locator('[data-item-list]').getByText(markup, {exact: true}).waitFor();
        await page.locator('[data-view="today"]').click();
        await view(page, 'today').locator('[data-today-note-title]').getByText(markup, {exact: true}).waitFor();
        await view(page, 'today').getByText('document.body.dataset.injected=2 Body text', {exact: true}).waitFor();
        assert.equal(await page.locator('[data-widget-view] img, [data-widget-view] script').count(), 0, 'no stored tag became an element');
        assert.equal(await page.evaluate(() => document.body.dataset.injected), undefined, 'and nothing stored ran');
      });
      await page.close();

      // ---- Projects: edits, conflicts, archive, delete and projects ----
      const editing = createHost();
      const seeded = editing.core.seed({kind: 'note', text: 'Draft plan', title: 'Draft plan', body: 'first step', id: '00000000-0000-4000-8000-000000000001'});
      const desk = await install(browser, editing, name);
      installs.push(desk);
      page = await desk.open(START);
      await step('a Projects edit keeps its draft through a failure and another writer’s change', async () => {
        await page.locator('[data-view="projects"]').click();
        const projects = view(page, 'projects'), editor = projects.locator('[data-editor]'), status = projects.locator('[data-editor-status]');
        await projects.locator('[data-item-list]').getByRole('button', {name: 'Draft plan', exact: true}).click();
        const title = editor.locator('[data-edit-field="title"]');
        await title.fill('Plan, second draft');
        editing.core.fault('items.save', 'fail', SAVE_FAILED);
        await editor.getByRole('button', {name: 'Save', exact: true}).click();
        await status.getByText(SAVE_FAILED).waitFor();
        assert.equal(await title.inputValue(), 'Plan, second draft');
        assert.equal(editing.core.items.get(seeded.id).title, 'Draft plan');
        editing.core.write({...editing.core.items.get(seeded.id), body: 'changed elsewhere'});
        await editor.getByRole('button', {name: 'Save', exact: true}).click();
        await status.getByText(/changed after you opened it/).waitFor();
        assert.equal(await title.inputValue(), 'Plan, second draft', 'a conflict keeps the draft');
        assert.equal(await editor.locator('[data-edit-field="body"]').inputValue(), 'changed elsewhere', 'and shows the other writer’s change to a field the person did not edit');
        assert.equal(editing.core.items.get(seeded.id).body, 'changed elsewhere', 'a conflict overwrites nothing');
        await editor.getByRole('button', {name: 'Save', exact: true}).click();
        await status.getByText('Saved.', {exact: true}).waitFor();
        assert.equal(editing.core.items.get(seeded.id).title, 'Plan, second draft', 'saving again applies the person’s edit');
        assert.equal(editing.core.items.get(seeded.id).body, 'changed elsewhere', 'and keeps the other writer’s change to the field the person did not edit');
        await editor.getByRole('button', {name: 'Close', exact: true}).click();
      });
      await step('a Projects edit is not saved across another writer’s change of kind', async () => {
        const projects = view(page, 'projects'), editor = projects.locator('[data-editor]'), status = projects.locator('[data-editor-status]');
        const other = editing.core.seed({kind: 'note', text: 'Shopping', title: 'Shopping', body: 'milk', id: '00000000-0000-4000-8000-000000000002'});
        await page.locator('[data-view="focus"]').click();
        await page.locator('[data-view="projects"]').click();
        await projects.locator('[data-item-list]').getByRole('button', {name: 'Shopping', exact: true}).click();
        const title = editor.locator('[data-edit-field="title"]');
        await title.fill('Shopping list');
        editing.core.write({...editing.core.items.get(other.id), kind: 'task', text: 'Shopping', title: ''});
        const saves = () => editing.calls.filter(([method]) => method === 'items.save').length;
        await editor.getByRole('button', {name: 'Save', exact: true}).click();
        await status.getByText(KIND_CHANGED('task')).waitFor();
        assert.equal(await title.inputValue(), 'Shopping list', 'the person’s edit stays to copy');
        const before = saves();
        await editor.getByRole('button', {name: 'Save', exact: true}).click();
        await status.getByText(KIND_CHANGED('task')).waitFor();
        assert.equal(saves(), before, 'saving again sends nothing');
        assert.equal(await status.textContent(), KIND_CHANGED('task'), 'and never says Saved.');
        assert.deepEqual([editing.core.items.get(other.id).kind, editing.core.items.get(other.id).text], ['task', 'Shopping'], 'the other writer’s change stays');
        await editor.getByRole('button', {name: 'Discard changes', exact: true}).click();
        assert.equal(await editor.locator('[data-edit-field="text"]').inputValue(), 'Shopping', 'Discard changes opens the task');
        await editor.getByRole('button', {name: 'Close', exact: true}).click();
      });
      await step('a kept draft reopens in its own kind’s fields after another writer’s change of kind', async () => {
        // The editor is built again on reopening, after the view has read the newer row, so this
        // step fails if the form follows the newer row's kind instead of the draft's (issue #150).
        const projects = view(page, 'projects'), editor = projects.locator('[data-editor]'), status = projects.locator('[data-editor-status]');
        const errands = editing.core.seed({kind: 'note', text: 'Errands', title: 'Errands', body: 'post office', id: '00000000-0000-4000-8000-000000000003'});
        await page.locator('[data-view="focus"]').click();
        await page.locator('[data-view="projects"]').click();
        await projects.locator('[data-item-list]').getByRole('button', {name: 'Errands', exact: true}).click();
        await editor.locator('[data-edit-field="title"]').fill('Errands for Saturday');
        await editor.getByRole('button', {name: 'Close', exact: true}).click();
        await projects.locator(`[data-item="${errands.id}"]`).getByText('Note · Inbox · Unsaved edit', {exact: true}).waitFor();
        editing.core.write({...editing.core.items.get(errands.id), kind: 'bookmark', text: 'Errands', title: '', body: '', url: 'https://example.com/errands'});
        // Showing the view again reads the newer row, so the list and the reopened editor see it.
        await page.locator('[data-view="focus"]').click();
        await page.locator('[data-view="projects"]').click();
        await projects.locator(`[data-item="${errands.id}"]`).getByText('Bookmark · Inbox · Unsaved edit', {exact: true}).waitFor();
        const saves = () => editing.calls.filter(([method]) => method === 'items.save').length, before = saves();
        await projects.locator('[data-item-list]').getByRole('button', {name: 'Errands', exact: true}).click();
        // Close only hides the editor, so the checks below would read the hidden one if the item
        // did not open again.
        assert.equal(await editor.isVisible(), true, 'the item opens again');
        assert.equal(await editor.locator('#editor-title').textContent(), 'Edit note', 'the draft reopens as the note it was opened as');
        assert.deepEqual(await editor.locator('[data-edit-field]').evaluateAll(fields => fields.map(field => field.dataset.editField)), ['title', 'body', 'projectId'], 'in the note’s fields, not the bookmark’s');
        assert.equal(await editor.locator('[data-edit-field="title"]').inputValue(), 'Errands for Saturday', 'with the person’s edit');
        assert.equal(await editor.locator('[data-edit-field="body"]').inputValue(), 'post office', 'and the body as the person last saw it');
        await editor.getByRole('button', {name: 'Save', exact: true}).click();
        await status.getByText(KIND_CHANGED('bookmark')).waitFor();
        assert.equal(saves(), before, 'Save sends nothing');
        assert.equal(await status.textContent(), KIND_CHANGED('bookmark'), 'and never says Saved.');
        assert.equal(await editor.locator('[data-edit-field="title"]').inputValue(), 'Errands for Saturday', 'the person’s edit stays to copy');
        const stored = editing.core.items.get(errands.id);
        assert.deepEqual([stored.kind, stored.text, stored.title, stored.url], ['bookmark', 'Errands', '', 'https://example.com/errands'], 'the other writer’s change stays');
        await editor.getByRole('button', {name: 'Discard changes', exact: true}).click();
        assert.equal(await editor.locator('[data-edit-field="url"]').inputValue(), 'https://example.com/errands', 'Discard changes opens the bookmark');
        await editor.getByRole('button', {name: 'Close', exact: true}).click();
      });
      await step('projects group items; archive, restore and delete need the core’s answer', async () => {
        const projects = view(page, 'projects');
        await projects.locator('[data-project-name]').fill('Home');
        await projects.getByRole('button', {name: 'Add project', exact: true}).click();
        await projects.locator('[data-project-status]').getByText('Home is ready.').waitFor();
        const home = [...editing.core.projects.values()].find(project => project.name === 'Home');
        await projects.locator('[data-filter-project]').selectOption(home.id);
        await projects.locator('[data-add-kind]').selectOption('task');
        await projects.locator('[data-add-text]').fill('Fix the door');
        await projects.getByRole('button', {name: 'Add', exact: true}).click();
        await projects.locator('[data-add-status]').getByText('Task added.').waitFor();
        assert.equal(rows(editing, item => item.text === 'Fix the door')[0].projectId, home.id, 'a new item joins the chosen project');
        await projects.locator(`[data-rename-input="${home.id}"]`).fill('House');
        await projects.locator(`[data-rename="${home.id}"]`).click();
        await projects.locator('[data-project-status]').getByText('Renamed.').waitFor();
        assert.equal(editing.core.projects.get(home.id).name, 'House');
        await projects.locator(`[data-remove-project="${home.id}"]`).click();
        await projects.locator(`[data-remove-project="${home.id}"]`).getByText('Confirm delete').waitFor();
        await projects.locator(`[data-remove-project="${home.id}"]`).click();
        await projects.locator('[data-project-status]').getByText('Project deleted. Its items are in the inbox.').waitFor();
        assert.equal(rows(editing, item => item.text === 'Fix the door')[0].projectId, '', 'its items move to the inbox');
        const row = projects.locator('[data-item-list] li', {hasText: 'Plan, second draft'});
        editing.core.fault('items.save', 'fail', SAVE_FAILED);
        await row.getByRole('button', {name: 'Archive', exact: true}).click();
        await projects.locator('[data-list-status]').getByText(SAVE_FAILED).waitFor();
        assert(await row.isVisible(), 'a refused archive leaves the row where it was');
        await row.getByRole('button', {name: 'Archive', exact: true}).click();
        await row.waitFor({state: 'detached'});
        assert.equal(editing.core.items.get(seeded.id).stage, 'done');
        await projects.locator('[data-show-archived="true"]').click();
        const archived = projects.locator('[data-item-list] li', {hasText: 'Plan, second draft'});
        await archived.getByRole('button', {name: 'Restore', exact: true}).click();
        await archived.waitFor({state: 'detached'});
        assert.equal(editing.core.items.get(seeded.id).stage, 'inbox');
        await projects.locator('[data-show-archived="false"]').click();
        const again = projects.locator('[data-item-list] li', {hasText: 'Plan, second draft'});
        await again.getByRole('button', {name: 'Delete', exact: true}).click();
        await again.getByRole('button', {name: 'Confirm delete', exact: true}).click();
        await again.waitFor({state: 'detached'});
        assert.equal(editing.core.items.has(seeded.id), false);
      });
      await page.close();

      // ---- Focus: hide, show, sleep and relaunch ----
      const timing = createHost();
      const clockApp = await install(browser, timing, name);
      installs.push(clockApp);
      page = await clockApp.open(START);
      const clock = () => view(page, 'focus').locator('[data-focus-clock]').textContent();
      const state = () => view(page, 'focus').locator('[data-focus-state]').textContent();
      await step('a failed focus write changes nothing', async () => {
        await page.locator('[data-view="focus"]').click();
        assert.deepEqual([await clock(), await state()], ['25:00', 'Ready to start']);
        // Opening the view also makes the shell write `shell.lastView`, so the fault names
        // Start's key: only that write can take it.
        timing.fault('settings.set', SAVE_FAILED, {key: 'focus.session'});
        await view(page, 'focus').getByRole('button', {name: 'Start', exact: true}).click();
        await view(page, 'focus').locator('[data-focus-message]').getByText(SAVE_FAILED).waitFor();
        assert.deepEqual([await clock(), await state()], ['25:00', 'Ready to start']);
        assert.equal(Object.hasOwn(timing.state.settings, 'focus.session'), false);
      });
      await step('a focus session keeps its remaining time across hide, show, sleep and relaunch', async () => {
        const focus = view(page, 'focus');
        await focus.getByRole('button', {name: 'Start', exact: true}).click();
        await focus.locator('[data-focus-state]').getByText('Running').waitFor();
        const stored = timing.state.settings['focus.session'];
        assert.deepEqual(Object.keys(stored).sort(), ['deadlineAt', 'durationMs', 'pausedAt', 'startedAt', 'version']);
        assert.equal(stored.deadlineAt - stored.startedAt, 25 * MINUTE);
        await page.clock.runFor(MINUTE);
        assert.equal(await clock(), '24:00', 'the display follows the clock');
        // Hidden for ten minutes, with no redraw while hidden.
        await shown(page, 'hidden');
        await page.clock.setSystemTime(await now(page) + 10 * MINUTE);
        await shown(page, 'visible');
        await page.waitForFunction(() => document.querySelector('[data-focus-clock]')?.textContent === '14:00');
        await focus.getByRole('button', {name: 'Pause', exact: true}).click();
        await focus.locator('[data-focus-state]').getByText('Paused').waitFor();
        // A two-hour sleep while paused changes nothing.
        await shown(page, 'hidden');
        await page.clock.setSystemTime(await now(page) + 120 * MINUTE);
        await shown(page, 'visible');
        await page.waitForTimeout(50);
        assert.deepEqual([await clock(), await state()], ['14:00', 'Paused']);
        await focus.getByRole('button', {name: 'Resume', exact: true}).click();
        await focus.locator('[data-focus-state]').getByText('Running').waitFor();
        await page.clock.runFor(MINUTE);
        assert.equal(await clock(), '13:00');
        // Quit and relaunch three minutes later.
        const at = await now(page);
        await page.close();
        page = await clockApp.open(at + 3 * MINUTE - MINUTE);
        assert(await view(page, 'focus').isVisible(), 'Focus opens again');
        assert.deepEqual([await clock(), await state()], ['10:00', 'Running']);
        await page.locator('[data-view="today"]').click();
        assert.equal(await view(page, 'today').locator('[data-today-clock]').textContent(), '10:00', 'Today shows the same session');
        // Asleep past the deadline: the session has finished when the window comes back.
        await page.locator('[data-view="focus"]').click();
        await shown(page, 'hidden');
        await page.clock.setSystemTime(await now(page) + 120 * MINUTE);
        await shown(page, 'visible');
        await page.waitForFunction(() => document.querySelector('[data-focus-state]')?.textContent === 'Session complete');
        assert.equal(await clock(), '0:00');
        await view(page, 'focus').getByRole('button', {name: 'Reset', exact: true}).click();
        await page.waitForFunction(() => document.querySelector('[data-focus-clock]')?.textContent === '25:00');
      });
      await page.close();
      const unreadable = createHost({settings: {'focus.session': 'not a session'}});
      const kept = await install(browser, unreadable, name);
      installs.push(kept);
      page = await kept.open(START);
      await step('an unreadable stored session is kept until the person starts over', async () => {
        await page.locator('[data-view="focus"]').click();
        const focus = view(page, 'focus');
        await focus.locator('[data-focus-state]').getByText('The saved focus session could not be read. It has been kept as it was.').waitFor();
        assert(await focus.getByRole('button', {name: 'Start', exact: true}).isDisabled());
        assert.equal(unreadable.state.settings['focus.session'], 'not a session');
        await focus.getByRole('button', {name: 'Start over', exact: true}).click();
        await focus.locator('[data-focus-state]').getByText('Ready to start').waitFor();
        assert.equal(unreadable.state.settings['focus.session'].startedAt, null);
      });
      await page.close();

      // ---- Keyboard focus, announcements and failed reads ----
      const keys = createHost();
      const keyboard = await install(browser, keys, name);
      installs.push(keyboard);
      for (const text of ['Sweep the hall', 'Sort the post', 'Oil the hinge']) keys.core.seed({kind: 'task', text});
      for (const text of ['First note', 'Second note', 'Third note']) keys.core.seed({kind: 'note', text, title: text});
      for (const project of ['Garden', 'Garage']) keys.core.seedProject(project);
      page = await keyboard.open(START);
      const focused = () => page.evaluate(() => {
        const node = document.activeElement;
        return node === document.body || !node ? 'BODY' : node.dataset.focusKey || node.dataset.itemEmpty !== undefined && 'empty' || node.id || node.textContent;
      });
      await step('keyboard focus moves to a neighbouring row when a row leaves a list', async () => {
        // Today: Space on a task's checkbox completes it and the row leaves.
        const today = view(page, 'today'), boxes = today.locator('[data-today-tasks] [data-complete]');
        await boxes.first().waitFor();
        const order = await boxes.evaluateAll(nodes => nodes.map(node => node.dataset.focusKey));
        assert.equal(order.length, 3);
        await boxes.first().focus();
        await page.keyboard.press('Space');
        await page.waitForFunction(() => document.querySelector('[data-today-task-count]')?.textContent === '2 open · 1 done');
        assert.equal(await focused(), order[1], 'Today: the next task’s checkbox');
        await boxes.last().focus();
        await page.keyboard.press('Space');
        await page.waitForFunction(() => document.querySelector('[data-today-task-count]')?.textContent === '1 open · 2 done');
        assert.equal(await focused(), order[1], 'Today: the previous task’s checkbox when the last one leaves');
        await page.keyboard.press('Space');
        await page.waitForFunction(() => document.querySelector('[data-today-task-count]')?.textContent === '0 open · 3 done');
        assert.equal(await focused(), 'No open tasks.', 'Today: the empty-state line when no task is left');
        // Projects: Enter on Archive, and Delete then Confirm delete.
        await page.locator('[data-view="projects"]').click();
        const projects = view(page, 'projects'), list = projects.locator('[data-item-list]');
        await list.getByText('Third note', {exact: true}).waitFor();
        const archives = await list.locator('[data-archive]').evaluateAll(nodes => nodes.map(node => node.dataset.focusKey));
        assert.equal(archives.length, 3);
        await list.locator(`[data-focus-key="${archives[0]}"]`).focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelectorAll('[data-item-list] li').length === 2);
        assert.equal(await focused(), archives[1], 'Projects: the next row’s Archive after Archive');
        const deletes = await list.locator('[data-delete]').evaluateAll(nodes => nodes.map(node => node.dataset.focusKey));
        await list.locator(`[data-focus-key="${deletes[1]}"]`).focus();
        await page.keyboard.press('Enter');
        await list.getByRole('button', {name: 'Confirm delete', exact: true}).waitFor();
        assert.equal(await focused(), deletes[1], 'Projects: arming Delete keeps focus on the button');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelectorAll('[data-item-list] li').length === 1);
        assert.equal(await focused(), deletes[0], 'Projects: the previous row’s Delete after the last row is deleted');
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelectorAll('[data-item-list] li').length === 0);
        assert.equal(await focused(), 'empty', 'Projects: the empty-state line after the only row is deleted');
        // Projects: deleting a project.
        const removes = await projects.locator('[data-project-list] [data-remove-project]').evaluateAll(nodes => nodes.map(node => node.dataset.focusKey));
        assert.equal(removes.length, 2);
        await projects.locator(`[data-focus-key="${removes[0]}"]`).focus();
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelectorAll('[data-project-list] li').length === 1);
        assert.equal(await focused(), removes[1], 'Projects: the next project’s Delete after a project is deleted');
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelectorAll('[data-project-list] li').length === 0);
        assert.equal(await focused(), 'project-admin-title', 'Projects: the projects heading when no project is left');
        // Close in the editor gives focus back to the item it showed.
        const note = keys.core.seed({kind: 'note', text: 'Fourth note', title: 'Fourth note'});
        await page.locator('[data-view="today"]').click();
        await page.locator('[data-view="projects"]').click();
        await list.getByRole('button', {name: 'Fourth note', exact: true}).click();
        await projects.locator('[data-editor]').getByRole('button', {name: 'Close', exact: true}).focus();
        await page.keyboard.press('Enter');
        await projects.locator('[data-editor]').waitFor({state: 'hidden'});
        assert.equal(await focused(), `open:${note.id}`, 'Projects: the item’s own button after Close');
      });
      await step('keyboard focus stays on the timer controls after Start, Pause, Resume and Reset', async () => {
        await page.locator('[data-view="focus"]').click();
        const focus = view(page, 'focus'), state = focus.locator('[data-focus-state]');
        const control = () => page.evaluate(() => document.activeElement?.dataset.focusAction ?? document.activeElement?.tagName);
        await focus.getByRole('button', {name: 'Start', exact: true}).focus();
        await page.keyboard.press('Enter');
        await state.getByText('Running', {exact: true}).waitFor();
        assert.equal(await control(), 'pause', 'Start hands focus to Pause');
        await page.keyboard.press('Enter');
        await state.getByText('Paused', {exact: true}).waitFor();
        assert.equal(await control(), 'resume', 'Pause hands focus to Resume');
        await page.keyboard.press('Enter');
        await state.getByText('Running', {exact: true}).waitFor();
        assert.equal(await control(), 'pause', 'Resume hands focus to Pause');
        await page.clock.runFor(26 * MINUTE);
        await state.getByText('Session complete', {exact: true}).waitFor();
        assert.equal(await control(), 'reset', 'a finished session hands focus from Pause to Reset');
        await page.keyboard.press('Enter');
        await state.getByText('Ready to start', {exact: true}).waitFor();
        assert.equal(await control(), 'start', 'Reset hands focus to Start');
      });
      await step('a finished focus session is announced in the status line', async () => {
        const focus = view(page, 'focus'), message = focus.locator('[data-focus-message]');
        await focus.getByRole('button', {name: 'Start', exact: true}).click();
        await message.getByText('Focus started.', {exact: true}).waitFor();
        await page.clock.runFor(26 * MINUTE);
        await focus.locator('[data-focus-state]').getByText('Session complete', {exact: true}).waitFor();
        assert.equal(await message.getAttribute('role'), 'status', 'the line is a live region');
        assert.equal(await message.textContent(), 'Session complete.', 'the end replaces the stale start message');
        assert.equal(await message.getAttribute('data-tone'), null);
        await focus.getByRole('button', {name: 'Reset', exact: true}).click();
        await message.getByText('Timer reset.', {exact: true}).waitFor();
      });
      await step('a Projects row says Unsaved edit only after a field has changed', async () => {
        await page.locator('[data-view="projects"]').click();
        const projects = view(page, 'projects'), editor = projects.locator('[data-editor]');
        const row = projects.locator('[data-item-list] li', {hasText: 'Fourth note'});
        await row.getByRole('button', {name: 'Fourth note', exact: true}).click();
        await editor.waitFor({state: 'visible'});
        assert.equal(await row.locator('.item-main > p.muted').first().textContent(), 'Note · Inbox', 'opening an item changes nothing');
        await editor.locator('[data-edit-field="title"]').fill('Fourth note, edited');
        await editor.getByRole('button', {name: 'Close', exact: true}).click();
        assert.equal(await row.locator('.item-main > p.muted').first().textContent(), 'Note · Inbox · Unsaved edit', 'a changed field is kept as an unsaved edit');
      });
      await step('an armed Confirm delete is said, and disarmed by Escape, leaving it and leaving the view', async () => {
        const projects = view(page, 'projects'), listed = projects.locator('[data-list-status]');
        const remove = projects.locator('[data-item-list] li', {hasText: 'Fourth note'}).locator('[data-delete]');
        const label = () => remove.textContent();
        const arm = async () => {
          await remove.focus();
          await page.keyboard.press('Enter');
          await remove.getByText('Confirm delete', {exact: true}).waitFor();
          assert.equal(await listed.textContent(), 'Press Confirm delete to delete Fourth note.', 'arming is said in the list’s status line');
        };
        await arm();
        await page.keyboard.press('Escape');
        assert.equal(await label(), 'Delete', 'Escape disarms it');
        assert.equal(await listed.textContent(), '', 'and clears the sentence');
        assert(await projects.isVisible(), 'Escape is taken by the button, not by the panel');
        await arm();
        await projects.locator('[data-add-text]').focus();
        assert.equal(await label(), 'Delete', 'moving focus away disarms it');
        await arm();
        await page.locator('[data-view="today"]').click();
        await page.locator('[data-view="projects"]').click();
        await projects.locator('[data-item-list]').getByText('Fourth note', {exact: true}).waitFor();
        assert.equal(await label(), 'Delete', 'leaving the view and coming back disarms it');
        assert(keys.core.items.size > 0 && rows(keys, item => item.title === 'Fourth note').length === 1, 'nothing was deleted');
        // Armed from the keyboard and then clicked, it deletes: WebKit takes focus from a pressed
        // button to the page, which is not leaving it (review of #210).
        await arm();
        await remove.click();
        await page.waitForFunction(() => ![...document.querySelectorAll('[data-item-list] li')].some(node => node.textContent.includes('Fourth note')));
        assert.equal(rows(keys, item => item.title === 'Fourth note').length, 0, 'a click on an armed Confirm delete deletes');
        // A task completed in a list of notes gives the keyboard to a neighbouring row's first
        // control, as no other row has a checkbox (review of #210).
        keys.core.seed({kind: 'note', text: 'Fifth note', title: 'Fifth note'});
        keys.core.seed({kind: 'task', text: 'Wind the clock'});
        await page.locator('[data-view="today"]').click();
        await page.locator('[data-view="projects"]').click();
        const done = projects.locator('[data-item-list] li', {hasText: 'Wind the clock'}).locator('[data-complete]');
        await done.focus();
        await projects.locator('[data-item-list]').getByText('Fifth note', {exact: true}).waitFor();
        assert.equal(await projects.locator('[data-item-list] [data-complete]').count(), 1, 'the task is the only row with a checkbox');
        await page.keyboard.press('Space');
        await page.waitForFunction(() => ![...document.querySelectorAll('[data-item-list] li')].some(node => node.textContent.includes('Wind the clock')));
        assert.match(await focused(), /^open:/, 'the neighbouring row’s first control has the keyboard');
        // A project row the same way.
        const shed = keys.core.seedProject('Shed');
        await page.locator('[data-view="today"]').click();
        await page.locator('[data-view="projects"]').click();
        const removeProject = projects.locator(`[data-remove-project="${shed.id}"]`);
        await removeProject.focus();
        await page.keyboard.press('Enter');
        await removeProject.getByText('Confirm delete', {exact: true}).waitFor();
        assert.equal(await projects.locator('[data-project-status]').textContent(), 'Press Confirm delete to delete Shed.');
        await page.keyboard.press('Escape');
        assert.equal(await removeProject.textContent(), 'Delete', 'Escape disarms a project’s Delete');
        assert(keys.core.projects.has(shed.id), 'the project is kept');
      });
      await page.close();

      // ---- A read that fails is not shown as an empty store ----
      const failing = createHost();
      const broken = await install(browser, failing, name);
      installs.push(broken);
      failing.core.seed({kind: 'note', text: 'Kept note', title: 'Kept note'});
      failing.core.seed({kind: 'task', text: 'Kept task'});
      failing.refuse('items.list', 'Could not read your saved data. Try again.');
      page = await broken.open(START);
      await step('a failed read hides counts, lists and empty states, with its error under the capture field', async () => {
        const today = view(page, 'today'), problem = today.locator('[data-today-problem]');
        await problem.getByText('Could not read your saved data. Try again.').waitFor();
        await page.setViewportSize({width: 400, height: 760});
        await page.screenshot({path: path.join(output, `${name}-today-read-failed.png`), fullPage: true});
        await page.setViewportSize({width: 1090, height: 760});
        assert(await today.locator('[data-today-retry]').isVisible(), 'Today offers Try again');
        assert.equal(await today.locator('[data-today-note]').isVisible(), false, 'Today: no empty Latest note card');
        assert.equal(await today.locator('[data-today-tasks]').isVisible(), false, 'Today: no Tasks card');
        assert(await today.locator('[data-today-focus]').isVisible(), 'Today: the focus card, read separately, stays');
        assert.equal(await today.locator('[data-capture] + .view-row [data-today-problem]').count(), 1, 'Today: the error sits just after the capture form, as in Projects');
        await page.locator('[data-view="projects"]').click();
        const projects = view(page, 'projects');
        await projects.locator('[data-projects-problem]').getByText('Could not read your saved data. Try again.').waitFor();
        await page.setViewportSize({width: 400, height: 760});
        await page.screenshot({path: path.join(output, `${name}-projects-read-failed.png`), fullPage: true});
        await page.setViewportSize({width: 1090, height: 760});
        assert(await projects.locator('[data-projects-retry]').isVisible(), 'Projects offers Try again');
        assert.equal(await projects.locator('[data-projects-counts]').isVisible(), false, 'Projects: no counts');
        assert.equal(await projects.locator('[data-item-empty]').isVisible(), false, 'Projects: no “Nothing here yet.”');
        assert.equal(await projects.locator('[data-item-list]').isVisible(), false, 'Projects: no list');
        // Try again after the read works shows them all.
        failing.lift('items.list');
        await projects.locator('[data-projects-retry]').click();
        await projects.locator('[data-item-list]').getByText('Kept note', {exact: true}).waitFor();
        assert.equal(await projects.locator('[data-projects-counts]').textContent(), '2 of 30 active · 2 of 300 items');
        assert.equal(await projects.locator('[data-projects-retry]').isVisible(), false);
        await page.locator('[data-view="today"]').click();
        await today.locator('[data-today-note-title]').getByText('Kept note', {exact: true}).waitFor();
        assert(await today.locator('[data-today-tasks]').getByText('Kept task', {exact: true}).isVisible());
        assert.equal(await today.locator('[data-today-retry]').isVisible(), false);
      });
      await page.close();
      await step('no request left the loopback origin and no page error was raised', async () => {
        assert.deepEqual(installs.flatMap(entry => entry.blocked), []);
        assert.deepEqual(installs.flatMap(entry => entry.errors), []);
      });
    } finally {
      for (const entry of installs) await entry.context.close().catch(() => {});
      await browser.close();
    }
  }
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
