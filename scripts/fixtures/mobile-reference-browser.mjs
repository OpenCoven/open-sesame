import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
const reference = fileURLToPath(new URL('../../examples/mobile-reference/', import.meta.url));
const output = path.resolve(process.env.SESAME_REFERENCE_OUTPUT || 'build/mobile-reference-browser');
// The fixture owns its loopback server and isolated browser contexts; it never contacts a provider.
await mkdir(output, { recursive: true });
const html = await readFile(path.join(reference, 'dist/index.html'));
const server = createServer((req, res) => {
  if (req.url !== '/') { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const receipts = [], errors = [], requests = [];
const key = 'opensesame.mobile.prototype.v1';
try {
  for (const [name, engine] of Object.entries({ chromium, webkit })) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const [width, height] of [[320, 640], [390, 844]]) {
        const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
        try {
          const page = await context.newPage();
          page.on('pageerror', e => errors.push({ browser: name, width, message: e.message }));
          await context.route('**/*', async route => {
            const url = route.request().url(); requests.push(url);
            if (url === origin + '/') await route.continue();
            else await route.abort();
          });
          await page.goto(origin + '/');
          await page.evaluate(() => document.fonts.ready);
          assert.equal(await page.locator('#screen').getAttribute('aria-label'), 'Today');
          const nav = page.locator('.nav');
          const go = async destination => nav.locator(`[data-page="${destination}"]`).click();
          for (const destination of ['today', 'projects', 'widgets', 'focus', 'console']) {
            await go(destination);
            const geometry = await page.evaluate(() => {
              const n = document.querySelector('.nav').getBoundingClientRect();
              const s = document.querySelector('#screen');
              const f = document.querySelector('[data-action="timer-toggle"]')?.getBoundingClientRect();
              return { bodyWidth: document.body.scrollWidth, viewportWidth: innerWidth, screenWidth: s.scrollWidth, screenClientWidth: s.clientWidth, navTop: n.top, navBottom: n.bottom, focusBottom: f?.bottom, motion: getComputedStyle(document.querySelector('.nav button')).transitionDuration };
            });
            assert.equal(geometry.bodyWidth, width, `${name} ${width} ${destination}: body overflow`);
            assert(geometry.screenWidth <= geometry.screenClientWidth + 1, `${name} ${width} ${destination}: screen overflow`);
            assert(geometry.navTop >= 0 && geometry.navBottom <= height + 1, 'Navigation fits');
            if (destination === 'focus') assert(geometry.focusBottom <= geometry.navTop, 'Focus primary action above navigation');
            assert.equal(geometry.motion, '0s', 'Reduced motion disables decorative transitions');
            await page.screenshot({ path: path.join(output, `${name}-${width}-${destination}.png`) });
            receipts.push({ browser: name, width, height, destination, geometry });
          }
          await go('today');
          await page.locator('[data-action="capture"]').first().focus();
          await page.keyboard.press('Enter');
          assert.equal(await page.locator('#sheet').evaluate(e => e.open), true);
          await page.locator('#capture-title').fill(`Reference note ${width}`);
          await page.locator('#capture-body').fill('An offline captured thought');
          for (let i = 0; i < 12; i++) {
            await page.keyboard.press('Tab');
            assert.equal(await page.evaluate(() => document.activeElement === document.body || document.querySelector('#sheet').contains(document.activeElement)), true, 'Dialog tab cycle never reaches background controls');
          }
          await page.locator('#capture-title').focus();
          await page.keyboard.press('Tab');
          const outline = await page.evaluate(() => ({ style: getComputedStyle(document.activeElement).outlineStyle, width: getComputedStyle(document.activeElement).outlineWidth, color: getComputedStyle(document.activeElement).outlineColor }));
          assert.equal(outline.style, 'solid'); assert.equal(outline.width, '2px');
          await page.screenshot({ path: path.join(output, `${name}-${width}-capture-keyboard.png`) });
          await page.locator('#capture-form button[type="submit"]').click();
          assert.match(await page.locator('#screen').innerText(), /An offline captured thought/);
          await page.locator('[data-action="search"]').click();
          await page.locator('#item-search').fill(`Reference note ${width}`);
          await page.locator('.note-item').click();
          await page.locator('[data-action="edit-item"]').click();
          await page.locator('#capture-body').fill('Edited and retained');
          await page.locator('#capture-form button[type="submit"]').click();
          await page.reload();
          await go('projects');
          await page.locator('#item-search').fill(`Reference note ${width}`);
          await page.locator('.note-item').click();
          assert.match(await page.locator('#sheet').innerText(), /Edited and retained/);
          await page.keyboard.press('Escape');
          assert.equal(await page.locator('#sheet').evaluate(e => e.open), false);
          await go('today');
          const task = page.locator('[data-action="toggle-task"][data-id="task-1"]');
          await task.click();
          assert.equal(await task.getAttribute('aria-pressed'), 'true');
          await task.click();
          assert.equal(await task.getAttribute('aria-pressed'), 'false');
          await go('widgets');
          const clock = page.getByRole('switch', { name: 'World clock' });
          await clock.click(); assert.equal(await clock.getAttribute('aria-checked'), 'true');
          await go('today'); assert.equal(await page.locator('.clock-big').count(), 1);
          await go('widgets'); await clock.click(); assert.equal(await clock.getAttribute('aria-checked'), 'false');
          await go('focus');
          await page.locator('[data-action="duration"][data-minutes="15"]').click();
          await page.locator('[data-action="timer-toggle"]').click();
          await page.reload(); await go('focus');
          assert.match(await page.locator('[data-action="timer-toggle"]').innerText(), /Pause session/);
          await page.locator('[data-action="timer-toggle"]').click();
          await page.reload(); await go('focus');
          assert.match(await page.locator('[data-action="timer-toggle"]').innerText(), /Begin focus|Resume focus/);
          // Exercise the actual deadline/tick path with a deterministic already-expired persisted timer.
          await page.evaluate(k => {
            const s = JSON.parse(localStorage.getItem(k)); s.timer.running = true; s.timer.end = Date.now() - 1000; s.timer.remaining = 1; localStorage.setItem(k, JSON.stringify(s));
          }, key);
          await page.reload();
          const completed = await page.evaluate(k => JSON.parse(localStorage.getItem(k)).timer.completed, key);
          assert.equal(completed, 1);
          await page.reload();
          assert.equal(await page.evaluate(k => JSON.parse(localStorage.getItem(k)).timer.completed, key), completed);
          await go('console');
          assert.match(await page.locator('#screen').innerText(), /Demo conversation/);
          assert.match(await page.locator('#screen').innerText(), /Not connected/);
          await page.locator('#message-input').fill('Kitty only thought');
          await page.getByRole('button', { name: 'Send demo message' }).click();
          assert.match(await page.locator('#messages').innerText(), /scripted preview/i);
          await page.locator('[data-action="familiar"][data-name="Cody"]').click();
          assert.equal(await page.locator('#messages').innerText(), '');
          await page.locator('[data-action="familiar"][data-name="Kitty"]').click();
          assert.match(await page.locator('#messages').innerText(), /Kitty only thought/);
          await page.locator('[data-action="settings"]').click();
          const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
          await page.locator('[data-action="export"]').click();
          const download = await downloadPromise;
          assert.equal(await download.failure(), null);
          const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
          const saved = await page.evaluate(k => JSON.parse(localStorage.getItem(k)), key);
          assert.deepEqual(exported, saved);
          assert(exported.items.some(i => i.title === `Reference note ${width}` && i.body === 'Edited and retained'));
          await writeFile(path.join(output, `${name}-${width}-export.json`), JSON.stringify(exported, null, 2));
          receipts.push({ browser: name, width, height, workflows: ['capture', 'search', 'edit', 'reload', 'task-complete-restore', 'widget-add-remove', 'timer-recovery', 'single-completion', 'separate-demo-histories', 'modal-keyboard-focus', 'export-bytes'], outline, exportedItems: exported.items.length });
        } finally { await context.close(); }
      }
      const offline = await browser.newContext({ offline: true, viewport: { width: 390, height: 844 } });
      try {
        const page = await offline.newPage();
        const external = [];
        page.on('request', req => { if (/^https?:/.test(req.url())) external.push(req.url()); });
        await page.goto(pathToFileURL(path.join(reference, 'dist/index.html')).href);
        await page.evaluate(async () => {
          await Promise.all([...document.fonts].map(face => face.load()));
          await document.fonts.ready;
        });
        await page.locator('.nav [data-page="console"]').click();
        assert.match(await page.locator('#screen').innerText(), /Not connected/);
        assert.deepEqual(external, []);
        assert.equal(await page.evaluate(() => document.fonts.size), 6);
        assert.equal(await page.evaluate(() => [...document.fonts].every(face => face.status === 'loaded')), true);
        receipts.push({ browser: name, offlineStandalone: true, loadedFontFaces: 6, externalRequests: external });
      } finally { await offline.close(); }
    } finally { await browser.close(); }
  }
  assert.deepEqual(errors, []);
  assert(requests.every(url => url === origin + '/'), 'Only the loopback HTML document was requested');
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: true, receipts, errors, requests }, null, 2));
  console.log(JSON.stringify({ passed: true, cases: receipts.length, output }));
} catch (error) {
  await writeFile(path.join(output, 'failure.json'), JSON.stringify({ passed: false, error: error.stack, receipts, errors, requests }, null, 2));
  throw error;
} finally { await new Promise(resolve => server.close(resolve)); }
