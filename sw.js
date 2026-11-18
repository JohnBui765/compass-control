// Service worker: cache-first app shell, scoped to this app's folder.
//
// The origin (johnbui765.github.io) is shared by several PWAs, so:
//  - the app id is derived from this worker's scope (/compass-control/ → "compass-control");
//  - caches are named `${APP_ID}-v${VERSION}`;
//  - on activate, ONLY caches matching exactly /^APP_ID-v\d+$/ are deleted
//    (so "compass-control-pro-v1" or "other-app-v3" are never touched).
// Bump VERSION whenever any file changes, so clients pick up the update.

const VERSION = 1;
const SCOPE = new URL(self.registration.scope);
const seg = SCOPE.pathname.split('/').filter(Boolean).pop();
const APP_ID = seg && /^[a-z0-9._-]+$/i.test(seg) ? seg.toLowerCase() : 'compass-control';
const CACHE = `${APP_ID}-v${VERSION}`;
const OWN = new RegExp(`^${APP_ID.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-v\\d+$`);

const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'src/main.js',
  'src/config.js',
  'src/storage.js',
  'src/state.js',
  'src/input/index.js',
  'src/input/mouse-stick.js',
  'src/input/keyboard-pedals.js',
  'src/input/gamepad.js',
  'src/sim/prng.js',
  'src/sim/disturbance.js',
  'src/sim/model.js',
  'src/sim/scoring.js',
  'src/sim/profile.js',
  'src/sim/feel.js',
  'src/sim/engine.js',
  'src/render/instruments.js',
  'src/render/charts.js',
  'src/ui/dom.js',
  'src/ui/fields.js',
  'src/ui/screens.js',
  'src/ui/session.js',
  'src/ui/results.js',
  'src/ui/settings.js',
  'src/ui/tuning.js',
  'src/ui/hardware.js',
  'src/ui/history.js',
  'src/ui/help.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(new URL(u, SCOPE), { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => OWN.test(k) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const shell = await cache.match(new URL('index.html', SCOPE).href);
        if (shell) return shell;
      }
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }),
  );
});
