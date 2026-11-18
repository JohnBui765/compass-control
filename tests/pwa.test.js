// Static PWA checks (shared-origin rules). Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));

test('manifest: id is "/<repo-name>/", relative start_url/scope, standalone, icons', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.match(m.id, /^\/[a-z0-9._-]+\/$/);
  assert.notEqual(m.id, './');
  assert.notEqual(m.id, '/');
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.equal(m.display, 'standalone');
  const sizes = { 'icons/icon-192.png': 192, 'icons/icon-512.png': 512, 'icons/icon-maskable-512.png': 512 };
  for (const icon of m.icons) {
    const buf = readFileSync(join(ROOT, icon.src));
    assert.equal(buf.readUInt32BE(16), sizes[icon.src], icon.src); // PNG IHDR width
    assert.equal(buf.readUInt32BE(20), sizes[icon.src], icon.src);
  }
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
});

test('service worker precaches every app file and only deletes its own caches', () => {
  const sw = read('sw.js');
  const list = [...sw.matchAll(/^\s+'([^']+)',$/gm)].map((x) => x[1]);
  const srcFiles = walk(join(ROOT, 'src')).map((f) => relative(ROOT, f).split('\\').join('/'));
  for (const f of [...srcFiles, 'index.html', 'styles.css', 'manifest.webmanifest']) assert.ok(list.includes(f), `sw.js ASSETS is missing ${f}`);
  for (const f of list) if (f !== './') assert.ok(existsSync(join(ROOT, f)), `sw.js lists a missing file ${f}`);
  // the deletion rule: exact pattern, not a bare prefix
  const APP_ID = 'compass-control';
  const OWN = new RegExp(`^${APP_ID.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-v\\d+$`);
  assert.ok(sw.includes('OWN.test(k) && k !== CACHE'));
  assert.ok(OWN.test('compass-control-v1'));
  assert.ok(!OWN.test('compass-control-pro-v1'));
  assert.ok(!OWN.test('compass-control-v2-v1'));
  assert.ok(!OWN.test('other-app-v1'));
});

test('every localStorage access goes through the prefixed helper', () => {
  for (const f of walk(join(ROOT, 'src'))) {
    if (f.endsWith('storage.js')) continue;
    const s = readFileSync(f, 'utf8');
    assert.ok(!/localStorage\./.test(s), `${relative(ROOT, f)} uses localStorage directly`);
    assert.ok(!/indexedDB\.open/.test(s), `${relative(ROOT, f)} opens IndexedDB directly`);
  }
});

test('no network calls or external resources in the app', () => {
  for (const f of [...walk(join(ROOT, 'src')), join(ROOT, 'index.html'), join(ROOT, 'styles.css')]) {
    const s = readFileSync(f, 'utf8');
    assert.ok(!/https?:\/\/(?!www\.|pilotaptitudetest|johnbui765)/.test(s.replace(/href:? ?['"]https?:\/\/[^'"]+['"]/g, '').replace(/link\('https?:[^']+'/g, '')), `${relative(ROOT, f)} references an external URL`);
    assert.ok(!/XMLHttpRequest|sendBeacon|WebSocket/.test(s), `${relative(ROOT, f)} makes network calls`);
  }
});
