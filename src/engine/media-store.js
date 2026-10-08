// Local storage for the user's own pictures and music: IndexedDB on this
// device only, never uploaded anywhere. Falls back to memory when IndexedDB
// is unavailable (private windows, blocked storage).
const DB = 'ink-media', STORE = 'files';
let dbPromise = null;
const memory = new Map();

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, {keyPath: 'id'});
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch(err => { console.warn('media store: using memory only', err); return null; });
  }
  return dbPromise;
}
function run(mode, fn) {
  return open().then(db => {
    if (!db) return fn(null);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const result = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result?.result ?? result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  });
}

/** Save {id, kind, name, type, blob, order}. */
export async function putMedia(record) {
  memory.set(record.id, record);
  try { await run('readwrite', s => s?.put(record)); } catch (err) { console.warn('media store: save failed', err); }
}
export async function deleteMedia(id) {
  memory.delete(id);
  try { await run('readwrite', s => s?.delete(id)); } catch (err) { console.warn('media store: delete failed', err); }
}
/** All records of one kind ('image' | 'music'), sorted by `order`. */
export async function listMedia(kind) {
  let all = [];
  try {
    all = await run('readonly', s => s?.getAll()) || [];
  } catch (err) { console.warn('media store: read failed', err); }
  if (!all.length) all = [...memory.values()];
  return all.filter(r => r.kind === kind).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
