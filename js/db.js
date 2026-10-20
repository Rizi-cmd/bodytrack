// Storage layer. Everything lives in IndexedDB on this device only.
import { SCHEMA } from './model.js';

const NAME = 'bodytrack-data';
export const STORES = ['weighins', 'measurements', 'checkins', 'goals'];

// Migrations: key = the schema version being created. Each one may reshape existing data.
// Rule: never delete user data in a migration; transform it.
const MIGRATIONS = {
  1(db) {
    for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
    if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
  }
};

let dbp = null;
export function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(NAME, SCHEMA);
    r.onupgradeneeded = e => {
      for (let v = e.oldVersion + 1; v <= SCHEMA; v++) MIGRATIONS[v](r.result, r.transaction);
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('blocked'));
  });
  return dbp;
}

function run(stores, mode, fn) {
  return open().then(db => new Promise((res, rej) => {
    const t = db.transaction(stores, mode);
    let out;
    Promise.resolve(fn(t)).then(v => { out = v; }, rej);
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('aborted'));
  }));
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const getAll = store => run([store], 'readonly', t => req(t.objectStore(store).getAll()));
export const put = (store, rec) => run([store], 'readwrite', t => { t.objectStore(store).put(rec); });

export async function getMeta(key, fallback = null) {
  const r = await run(['meta'], 'readonly', t => req(t.objectStore('meta').get(key)));
  return r ? r.value : fallback;
}
export const setMeta = (key, value) => run(['meta'], 'readwrite', t => { t.objectStore('meta').put({ key, value }); });

// Write many records across stores in ONE transaction: all or nothing.
// replace=true clears the stores first (used by "restore from backup").
export function writeAll(data, { replace = false } = {}) {
  return run([...STORES, 'meta'], 'readwrite', t => {
    for (const s of STORES) {
      const os = t.objectStore(s);
      if (replace) os.clear();
      for (const rec of data[s] || []) os.put(rec);
    }
    if (data.settings && typeof data.settings === 'object') {
      const m = t.objectStore('meta');
      for (const [key, value] of Object.entries(data.settings)) m.put({ key: 'setting:' + key, value });
    }
  });
}

export async function readAll() {
  const out = {};
  for (const s of STORES) out[s] = await getAll(s);
  const meta = await run(['meta'], 'readonly', t => req(t.objectStore('meta').getAll()));
  out.settings = Object.fromEntries(meta.filter(m => m.key.startsWith('setting:')).map(m => [m.key.slice(8), m.value]));
  return out;
}

export async function requestPersistence() {
  try { return await navigator.storage?.persist?.(); } catch { return false; }
}
