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

/**
 * Blobs are written only when the SET of photos changed. The arrangement pass
 * runs on every click, and rewriting twenty 4MB blobs because someone selected a
 * thumbnail was 80MB of traffic per selection.
 */
let lastPhotoSig = '';

/**
 * The generation this tab last read or wrote, or null before it has seen the
 * stored session at all.
 *
 * Two tabs each hold their own pool, and the write below is a clear-then-put:
 * whoever saved last deleted the other tab's photos outright. Every write now
 * carries a counter, and a tab refuses to write when the stored counter is not
 * the one it last saw. The pools cannot be merged, so refusing is the only
 * honest option: destroying one silently is the worse answer, and the caller
 * surfaces the refusal rather than retrying.
 */
let myGen = null;

/** A save that was refused because another tab owns the session. */
export const CONFLICT = 'conflict';
const NEEDS_BYTES = 'needs-bytes';
let byteStorage = false;
const byteCache = new WeakMap();
const bytes = (blob) => {
  if (!byteCache.has(blob)) byteCache.set(blob, blob.arrayBuffer());
  return byteCache.get(blob);
};

// Byte conversion is asynchronous. Queue saves so a slow earlier conversion
// cannot overwrite a newer edit or conflict with another save from this tab.
let saveQueue = Promise.resolve();
export function saveSession(state, options = {}) {
  const saving = saveQueue.then(() => writeSession(state, options));
  saveQueue = saving.catch(() => false);
  return saving;
}

async function writeSession(state, { photos = true } = {}) {
  try {
    const row = (p, i) => ({
      id: p.id, i, name: p.name, blob: p.blob, span: p.span,
      tf: { ...p.tf, adj: { ...p.tf.adj } },
      // The cutout as a PNG blob: a hand-brushed mask is minutes of work and
      // must survive a reload, unlike the bitmaps which decode from blobs.
      cutBlob: p.cutBlob || null,
    });
    const rows = state.pool.map(row);
    const session = {
      overrides: [...state.overrides], layout: state.layout,
      params: { ...state.params }, background: state.background,
      bg2: state.bg2, bgAngle: state.bgAngle, borderColor: state.borderColor,
      nextId: state.nextId, overlays: state.overlays.map((o) => ({ ...o })), schema: 4,
    };
    // Some WebKit storage configurations reject Blob/File writes, while byte
    // buffers work. Convert outside the transaction, once per immutable blob.
    if (byteStorage) {
      for (const record of rows) {
        record.blobType = record.blob.type;
        record.blob = await bytes(record.blob);
        if (record.cutBlob) record.cutBlob = await bytes(record.cutBlob);
      }
    }
    const sig = rows.map((p) => p.id).join(',');
    const rewritePhotos = photos && sig !== lastPhotoSig;
    const d = await open();
    let nextGen = null;
    // One transaction over both stores: the generation is read and written
    // inside it, so two tabs cannot interleave a check with the other's write.
    const outcome = await new Promise((res, rej) => {
      const t = d.transaction(['photos', 'meta'], 'readwrite');
      const ps = t.objectStore('photos'), ms = t.objectStore('meta');
      let refused = false, blobFailure = false;
      const read = ms.get('session');
      read.onsuccess = () => {
        const stored = read.result;
        const storedGen = stored?.gen ?? 0;
        // A tab that has never seen this session may claim it; one that has
        // must still be holding the current generation.
        if (myGen !== null && storedGen !== myGen) { refused = true; t.abort(); return; }
        if (rewritePhotos) ps.clear();
        rows.forEach((record) => {
          const write = ps.put(record);
          write.onerror = () => {
            const error = write.error;
            if (!byteStorage && error?.name === 'UnknownError' && /Blob|File/.test(error.message)) blobFailure = true;
          };
        });
        nextGen = storedGen + 1;
        ms.put({ ...session, gen: nextGen }, 'session');
      };
      t.oncomplete = () => res(true);
      t.onabort = () => res(refused ? CONFLICT : blobFailure ? NEEDS_BYTES : false);
      // Wait for abort: WebKit can report another request's AbortError before
      // the Blob request emits the useful error that selects the fallback.
      t.onerror = () => {};
    });
    if (outcome === NEEDS_BYTES) {
      byteStorage = true;
      return writeSession(state, { photos });
    }
    if (outcome === true) {
      myGen = nextGen;
      if (rewritePhotos) lastPhotoSig = sig;
    }
    return outcome;
  } catch {
    // Private browsing and a full quota both land here. Losing persistence is
    // not worth losing the session over, so this reports and moves on.
    return false;
  }
}

export async function loadSession() {
  try {
    const db = await open();
    const { rows, meta } = await new Promise((resolve, reject) => {
      const transaction = db.transaction(['photos', 'meta'], 'readonly');
      const photos = transaction.objectStore('photos').getAll();
      const session = transaction.objectStore('meta').get('session');
      transaction.oncomplete = () => resolve({ rows: photos.result, meta: session.result });
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    if (!rows?.length) return null;
    for (const record of rows) {
      if (record.blob instanceof ArrayBuffer) {
        byteStorage = true;
        record.blob = new Blob([record.blob], { type: record.blobType || 'image/png' });
      }
      if (record.cutBlob instanceof ArrayBuffer) record.cutBlob = new Blob([record.cutBlob], { type: 'image/png' });
    }
    rows.sort((a, b) => a.i - b.i);
    // Adopt the generation we just read: this tab is now in sync, and its next
    // save is legitimate until some other tab moves the counter.
    myGen = meta?.gen ?? 0;
    return { rows, meta: meta || null };
  } catch { return null; }
}

export function resetSaveCache() { lastPhotoSig = ''; myGen = null; }

export function clearSession() {
  // Clearing and an immediate Undo must stay in the same save order. Both
  // stores clear atomically, before the restored project can be saved again.
  const clearing = saveQueue.then(async () => {
    const db = await open();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(['photos', 'meta'], 'readwrite');
      transaction.objectStore('photos').clear();
      transaction.objectStore('meta').delete('session');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    lastPhotoSig = '';
    // The session is gone, so the next save starts a fresh generation.
    myGen = null;
  });
  saveQueue = clearing.catch(() => false);
  return saveQueue;
}
