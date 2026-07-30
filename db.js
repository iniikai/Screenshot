// Shared IndexedDB layer. Screenshots are stored as PNG blobs, which are far
// too large for chrome.storage (5MB quota), so IndexedDB is used instead.

const DB_NAME = 'screenshot-stash';
const DB_VERSION = 1;
const STORE = 'shots';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function addShot({ blob, pageUrl, tabTitle, width, height, hash, kind }) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const id = await promisify(tx.objectStore(STORE).add({
    blob,
    pageUrl,
    tabTitle,
    width,
    height,
    hash: hash || null,
    kind: kind || 'visible',
    tags: [],
    createdAt: Date.now(),
  }));
  return id;
}

export async function getShot(id) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  return promisify(tx.objectStore(STORE).get(id));
}

// Newest first.
export async function getAllShots() {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  const shots = await promisify(tx.objectStore(STORE).getAll());
  return shots.sort((a, b) => b.createdAt - a.createdAt);
}

export async function countShots() {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  return promisify(tx.objectStore(STORE).count());
}

export async function updateShot(id, patch) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const record = await promisify(store.get(id));
  if (!record) return null;
  Object.assign(record, patch);
  await promisify(store.put(record));
  return record;
}

export async function deleteShots(ids) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  await Promise.all(ids.map((id) => promisify(store.delete(id))));
}

// Re-insert previously deleted records with their original ids (for undo).
export async function restoreShots(records) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  await Promise.all(records.map((r) => promisify(store.put(r))));
}

export async function deleteOlderThan(days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const shots = await getAllShots();
  const stale = shots.filter((s) => s.createdAt < cutoff).map((s) => s.id);
  if (stale.length) await deleteShots(stale);
  return stale.length;
}

// Tells every open extension page (popup, library) that the list changed.
export function notifyShotsChanged() {
  chrome.runtime.sendMessage({ type: 'shots-changed' }).catch(() => {
    // No listener open right now — that's fine.
  });
}
