// Boot: load state, hash router, service worker registration + update prompt.

import { loadState, saveSettings, saveProfiles } from './state.js';
import { db } from './storage.js';
import { clear, toast, h } from './ui/dom.js';
import * as screens from './ui/screens.js';
import * as session from './ui/session.js';
import * as results from './ui/results.js';
import * as settings from './ui/settings.js';
import * as tuning from './ui/tuning.js';
import * as hardware from './ui/hardware.js';
import * as history from './ui/history.js';

const routes = {
  home: screens.home,
  about: screens.about,
  session,
  free: session,
  replay: session,
  results,
  settings,
  tuning,
  hardware,
  history,
};

const state = loadState();
const root = document.getElementById('app');
let unmount = null;

const ctx = {
  state,
  db,
  memory: {}, // objects passed between screens (e.g. the session just finished)
  saveSettings: () => saveSettings(state),
  saveProfiles: () => saveProfiles(state),
  toast,
  navigate(route, ...params) {
    const hash = `#/${[route, ...params].map((p) => encodeURIComponent(String(p))).join('/')}`;
    if (location.hash === hash) render();
    else location.hash = hash;
  },
};

function parseHash() {
  const parts = location.hash
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
  return { route: parts[0] || 'home', params: parts.slice(1) };
}

function render() {
  if (unmount) {
    try {
      unmount();
    } catch (e) {
      console.error(e);
    }
    unmount = null;
  }
  clear(root);
  window.scrollTo(0, 0);
  const { route, params } = parseHash();
  const mod = routes[route] ? route : 'home';
  try {
    const r = routes[mod].mount(root, ctx, params, mod);
    unmount = typeof r === 'function' ? r : null;
  } catch (e) {
    console.error(e);
    root.append(h('div', { class: 'page' }, h('div', { class: 'notice' }, `Something went wrong: ${e.message}`), h('button', { class: 'btn', onclick: () => ctx.navigate('home') }, 'Home')));
  }
}

window.addEventListener('hashchange', render);
render();

// ---- service worker: cache-first app shell, scoped to this app's folder ----
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .then((reg) => {
        const offer = (worker) => {
          if (document.getElementById('update-bar')) return;
          const bar = h(
            'div',
            { id: 'update-bar', class: 'toast', style: { display: 'flex', gap: '10px', alignItems: 'center' } },
            'A new version is ready.',
            h('button', {
              class: 'btn small primary',
              onclick: () => {
                ctx.memory.updateAccepted = true;
                worker.postMessage({ type: 'SKIP_WAITING' });
                bar.remove();
              },
            }, 'Reload'),
            h('button', { class: 'btn small', onclick: () => bar.remove() }, 'Later'),
          );
          document.body.append(bar);
        };
        if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          if (!w) return;
          w.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
          });
        });
      })
      .catch((e) => console.warn('Service worker registration failed:', e));
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (ctx.memory.updateAccepted && !reloading) {
        reloading = true;
        location.reload();
      }
    });
  });
}
