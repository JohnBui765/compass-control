// Browser checks with Playwright + Chromium. Run from the project folder:
//   node tests/e2e/run.mjs [screenshotDir]
// Serves the PARENT folder so the app lives at /<folder>/ like on GitHub Pages.
import { createRequire } from 'node:module';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const APP_DIR = fileURLToPath(new URL('../..', import.meta.url));
const SERVE_ROOT = dirname(APP_DIR.replace(/\/$/, ''));
const FOLDER = basename(APP_DIR.replace(/\/$/, ''));
const SHOTS = process.argv[2] || null;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

const server = http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/__blank') return res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>blank</title>');
  try {
    const file = join(SERVE_ROOT, path.endsWith('/') ? `${path}index.html` : path);
    if (!file.startsWith(SERVE_ROOT)) throw new Error('outside');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const APP = `${ORIGIN}/${FOLDER}/`;

const results = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
};
const errors = [];
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
const shot = async (name) => SHOTS && page.screenshot({ path: join(SHOTS, `${name}.png`) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  // ---- decoy caches from "other apps" on the same origin ----
  await page.goto(`${ORIGIN}/__blank`);
  await page.evaluate(async () => {
    for (const n of ['other-app-v1', 'compass-control-pro-v1', 'compass-control-v0']) await (await caches.open(n)).put('/x', new Response('x'));
  });

  // ---- home + service worker ----
  await page.goto(APP);
  await page.waitForSelector('.home-hero');
  check('home renders', (await page.textContent('h1')) === 'Control Trainer');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(async () => (await caches.keys()).includes('compass-control-v1') && !(await caches.keys()).includes('compass-control-v0'), null, { timeout: 15000 });
  const keys = await page.evaluate(() => caches.keys());
  check('SW deletes only its own old cache', keys.includes('other-app-v1') && keys.includes('compass-control-pro-v1') && !keys.includes('compass-control-v0') && keys.includes('compass-control-v1'), keys.join(', '));
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).scope);
  check('SW scope is the app folder only', scope === APP, scope);
  await shot('home');

  // ---- every screen without errors ----
  for (const r of ['settings', 'hardware', 'history', 'about', 'help']) {
    await page.goto(`${APP}#/${r}`);
    await page.waitForSelector('.topbar h1');
  }
  await page.goto(`${APP}#/help/controls`);
  await page.waitForSelector('#help-controls .cheat');
  const cheat = (await page.textContent('#help-controls .cheat')).replace(/\s+/g, ' ');
  check('how-to page shows the real keys: ball right → D, ball left → A, needle high → forward', /right → press D/.test(cheat) && /left → press A/.test(cheat) && /high → slide the mouse forward/.test(cheat), cheat.slice(0, 90));
  await shot('help');
  await page.goto(`${APP}#/about`);
  await page.waitForFunction(() => /✓|run tools/.test(document.body.textContent));
  check('about: manifest id matches the serving folder', (await page.textContent('body')).includes('/compass-control/ ✓'));
  await page.goto(`${APP}#/tuning`);
  for (const t of ['Watch & adjust', 'Questionnaire', 'Profiles & readouts', 'Compare (1 or 2?)']) {
    await page.click(`text=${t}`);
    await sleep(150);
  }
  await page.selectOption('.lab-cols select >> nth=0', { index: 0 });
  await page.click('text=Start');
  await sleep(1500);
  await shot('tuning-compare');
  await page.goto(`${APP}#/tuning/watch`);
  await page.click('text=Play');
  await sleep(1200);
  await shot('tuning-watch');

  // ---- hardware page: keys as pedals ----
  await page.goto(`${APP}#/hardware`);
  await page.waitForSelector('.topbar h1');
  await page.keyboard.down('KeyD');
  await sleep(600);
  const held = await page.evaluate(() => [...document.querySelectorAll('.mono')].map((e) => e.textContent).find((t) => /^[+-]\d\.\d\d$/.test(t)));
  await page.keyboard.up('KeyD');
  await sleep(400);
  const released = await page.evaluate(() => [...document.querySelectorAll('.mono')].map((e) => e.textContent).find((t) => /^[+-]\d\.\d\d$/.test(t)));
  const logRows = await page.$$eval('tbody tr', (rows) => rows.map((r) => r.textContent));
  check('hardware: holding D gives full right pedal, release returns to 0', held === '+1.00' && released === '+0.00', `${held} → ${released}`);
  check('hardware: key log shows keyup with hold time', logRows.some((t) => t.startsWith('upKeyD')), logRows[0]);
  // the pressed pedal lights up on the stick/pedal picture (pixels read from the canvas)
  const px = (side) =>
    page.evaluate((sd) => {
      const cv = document.querySelector('canvas.legend-view');
      const g = JSON.parse(cv.dataset.geom);
      const x = g.ox + ((sd === 'L' ? 53 : 70) + 4.5) * g.u;
      const y = g.oy + 34 * g.u;
      const d = cv.getContext('2d').getImageData(Math.round(x * g.dpr), Math.round(y * g.dpr), 1, 1).data;
      return [d[0], d[1], d[2]];
    }, side);
  const isBlue = ([r, , b]) => b > 150 && r < 120;
  const beforeA = await px('L');
  await page.keyboard.down('KeyA');
  await sleep(600);
  const litL = await px('L');
  const litR = await px('R');
  await page.keyboard.up('KeyA');
  await sleep(500);
  const afterA = await px('L');
  check('pressing A lights up and fills the LEFT pedal only; releasing clears it', !isBlue(beforeA) && isBlue(litL) && !isBlue(litR) && !isBlue(afterA), `${beforeA} → ${litL} (right ${litR}) → ${afterA}`);
  // pointer lock in headless Chromium (may be unsupported there)
  await page.click('text=Click here to capture the mouse');
  await sleep(400);
  const locked = await page.evaluate(() => !!document.pointerLockElement);
  if (locked) {
    for (let i = 0; i < 10; i++) await page.mouse.move(640, 380 - i * 10);
    await page
      .waitForFunction(() => /-?[1-9]\d*$/.test([...document.querySelectorAll('.row')].find((r) => r.textContent.startsWith('Σ Y'))?.textContent || ''), null, { timeout: 2000 })
      .catch(() => {});
    const sumY = await page.evaluate(() => [...document.querySelectorAll('.row')].find((r) => r.textContent.startsWith('Σ Y'))?.textContent);
    const n = Number((sumY || '').replace(/[^0-9-]/g, ''));
    if (n) check('hardware: pointer lock works and counts movementY', true, sumY);
    else console.log(`INFO  pointer lock granted in headless Chromium, but synthetic mouse moves give no movementY (${sumY}) – real mouse must be checked on your PC`);
  } else console.log('INFO  pointer lock not available in headless Chromium – lock mode must be checked on your PC');
  await shot('hardware');

  // ---- full short session (absolute mouse mode, no fullscreen) ----
  await page.evaluate(() => {
    localStorage.setItem('compass-control:settings', JSON.stringify({ device: { stick: { mouseMode: 'absolute' } }, session: { practiceSec: 2, runSec: 3, runs: 2, breakSec: 1, fullscreen: false }, training: { pedalIndicator: true } }));
  });
  await page.goto(`${APP}#/session`);
  await page.reload();
  await page.waitForSelector('text=Control – practice session');
  await shot('session-intro');
  await page.click('button:has-text("Start")');
  // wait until run 1 is active, then pause via blur and resume
  await page.waitForFunction(() => document.querySelector('.overlay')?.hidden && performance.now() > 0, null, { timeout: 8000 });
  await page.mouse.move(640, 300);
  await page.keyboard.down('KeyA');
  await sleep(300);
  await shot('session-running');
  await page.keyboard.up('KeyA');
  // pause during the practice/run
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await sleep(300);
  const pausedTxt = await page.textContent('.overlay');
  check('pause: losing focus pauses with "not scored" message', /Paused/.test(pausedTxt) && /not scored/.test(pausedTxt));
  await sleep(1500);
  await page.click('button:has-text("Resume")');
  await page.waitForURL(/#\/results\//, { timeout: 40000 });
  await page.waitForSelector('text=Session practice score');
  const id = decodeURIComponent(page.url().split('#/results/')[1]);
  const nCharts = await page.$$eval('canvas.chart', (c) => c.length);
  check('session completes and shows results with 3 charts (practice + 2 runs)', nCharts === 3, `charts ${nCharts}`);
  const rec = await page.evaluate(
    (sid) =>
      new Promise((res) => {
        const r = indexedDB.open('compass-control-db');
        r.onsuccess = () => {
          const g = r.result.transaction('sessions').objectStore('sessions').get(sid);
          g.onsuccess = () => res(g.result);
        };
      }),
    id,
  );
  const totalPaused = (rec.practice?.pausedMs || 0) + rec.runs.reduce((a, r) => a + r.pausedMs, 0);
  check('session saved to IndexedDB with practice + 2 runs and exact tick counts', rec && rec.runs.length === 2 && rec.practice && rec.runs[0].trace.eN.length === 30, `${rec?.runs.length} runs`);
  check('paused time was recorded (and excluded from the clock)', totalPaused > 1000, `${totalPaused} ms`);
  await page.mouse.move(400, 500);
  await shot('results');

  // ---- replay is bit-exact ----
  await page.goto(`${APP}#/replay/${encodeURIComponent(id)}/1`);
  await page.waitForFunction(() => /Replay finished/.test(document.body.textContent), null, { timeout: 15000 });
  check('replay re-simulates the recorded run exactly', (await page.textContent('body')).includes('matches the stored result ✓'));

  // ---- history ----
  await page.goto(`${APP}#/history`);
  await page.waitForSelector('table.data');
  check('history lists the session', (await page.$$('table.data tr')).length === 2);
  await shot('history');

  // ---- free practice intro + tuning hotkeys do not crash ----
  await page.goto(`${APP}#/free`);
  await page.waitForSelector('text=Free practice');
  await page.click('button:has-text("Start free practice")');
  await sleep(3600);
  await page.keyboard.press('BracketRight');
  await page.keyboard.press('Equal');
  await sleep(200);
  check('free practice: tuning HUD responds to [ ] − =', /Drift restlessness|Drift strength|Shoves/.test(await page.textContent('.tune-hud')));
  await page.keyboard.press('Escape');
  await sleep(300);
  check('free practice: Esc pauses with the tuning drawer', /Tune "/.test(await page.textContent('.overlay')));

  // ---- storage prefixes ----
  const lsKeys = await page.evaluate(() => Object.keys(localStorage));
  const dbs = await page.evaluate(async () => (indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : []));
  check('all localStorage keys are prefixed "compass-control:"', lsKeys.length > 0 && lsKeys.every((k) => k.startsWith('compass-control:')), lsKeys.join(', '));
  check('IndexedDB name is compass-control-db', dbs.length > 0 && dbs.every((n) => n === 'compass-control-db'), dbs.join(', '));

  // ---- offline ----
  await page.goto(APP);
  await page.waitForSelector('.home-hero');
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('.home-hero', { timeout: 8000 });
  await page.goto(`${APP}#/tuning`);
  await page.waitForSelector('.lab-stage');
  check('works offline after the first load (home + tuning lab)', true);
  await context.setOffline(false);
} catch (e) {
  check(`unexpected error: ${e.message.split('\n')[0]}`, false);
  await shot('failure');
} finally {
  const relevant = errors.filter((e) => !/Failed to load resource.*(favicon|__blank)/.test(e));
  check('no console errors or page errors', relevant.length === 0, relevant.slice(0, 5).join(' | '));
  await browser.close();
  server.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} browser checks passed`);
  process.exit(failed ? 1 : 0);
}
