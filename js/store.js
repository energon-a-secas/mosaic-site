// Persistence. IndexedDB, not localStorage: a dozen photos as data URLs blows the
// ~5MB quota, and blobs avoid the 33% base64 tax entirely.
//
// Photos and arrangement are stored separately so re-opening a session decodes
// bitmaps once, and an arrangement change does not rewrite every blob.

const DB = 'mosaic', VER = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

const tx = async (store, mode, fn) => {
  const d = await open();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => res(out?.result ?? out);
    t.onerror = () => rej(t.error);
  });
};

export async function saveSession(state) {
  try {
    await tx('photos', 'readwrite', (s) => {
      s.clear();
      state.pool.forEach((p, i) => s.put({
        id: p.id, i, name: p.name, blob: p.blob, span: p.span,
        tf: { ...p.tf, adj: { ...p.tf.adj } },
      }));
    });
    await tx('meta', 'readwrite', (s) => s.put({
      overrides: [...state.overrides], layout: state.layout,
      params: { ...state.params }, background: state.background,
      nextId: state.nextId,
    }, 'session'));
    return true;
  } catch {
    // Private browsing and a full quota both land here. Losing persistence is
    // not worth losing the session over, so this reports and moves on.
    return false;
  }
}

export async function loadSession() {
  try {
    const rows = await tx('photos', 'readonly', (s) => s.getAll());
    const meta = await tx('meta', 'readonly', (s) => s.get('session'));
    if (!rows?.length) return null;
    rows.sort((a, b) => a.i - b.i);
    return { rows, meta: meta || null };
  } catch { return null; }
}

export async function clearSession() {
  try {
    await tx('photos', 'readwrite', (s) => s.clear());
    await tx('meta', 'readwrite', (s) => s.delete('session'));
  } catch { /* nothing to clear */ }
}
