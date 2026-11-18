// Prefixed localStorage + IndexedDB. The origin is shared by all of the
// user's PWAs, so every key starts with APP_ID and the database is APP_ID-db.

import { LS_PREFIX, DB_NAME } from './config.js';

export const ls = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(LS_PREFIX + key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(LS_PREFIX + key);
    } catch {
      /* ignore */
    }
  },
};

let dbPromise = null;

export function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) return reject(new Error('IndexedDB is not available'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('sessions')) d.createObjectStore('sessions', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('replays')) d.createObjectStore('replays', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
    });
    dbPromise.catch(() => (dbPromise = null));
  }
  return dbPromise;
}

function run(store, mode, fn) {
  return openDB().then(
    (d) =>
      new Promise((resolve, reject) => {
        const tx = d.transaction(store, mode);
        const os = tx.objectStore(store);
        let result;
        Promise.resolve(fn(os, (r) => (result = r))).catch(reject);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}
const req2p = (r) => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));

export const db = {
  putSession: (s) => run('sessions', 'readwrite', (os) => void os.put(s)),
  getSession: (id) => run('sessions', 'readonly', async (os, set) => set(await req2p(os.get(id)))),
  /** All sessions, oldest first. */
  listSessions: () =>
    run('sessions', 'readonly', async (os, set) => {
      const all = (await req2p(os.getAll())) || [];
      all.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      set(all);
    }),
  deleteSession: async (id) => {
    await run('sessions', 'readwrite', (os) => void os.delete(id));
    await run('replays', 'readwrite', (os) => void os.delete(IDBKeyRange.bound(`${id}#`, `${id}#￿`)));
  },
  clearAll: async () => {
    await run('sessions', 'readwrite', (os) => void os.clear());
    await run('replays', 'readwrite', (os) => void os.clear());
  },
  /** key = `${sessionId}#${runIndex}` (runIndex 0.. or "practice"); data = {stick: Float32Array, pedal: Float32Array} */
  putReplay: (key, data) => run('replays', 'readwrite', (os) => void os.put({ key, ...data })),
  getReplay: (key) => run('replays', 'readonly', async (os, set) => set(await req2p(os.get(key)))),
  /** Keep full-rate input recordings only for the newest `keep` sessions. */
  pruneReplays: async (keep = 30) => {
    const sessions = await db.listSessions();
    const keepIds = new Set(sessions.slice(-keep).map((s) => s.id));
    await run('replays', 'readwrite', async (os) => {
      const keys = (await req2p(os.getAllKeys())) || [];
      for (const k of keys) if (!keepIds.has(String(k).split('#')[0])) os.delete(k);
    });
  },
};

/** Ask the browser not to evict our data (applies to the whole origin). */
export function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch {
    /* ignore */
  }
}
