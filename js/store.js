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
    // `out` is an IDBRequest. On a miss its .result is undefined, and `?? out`
    // used to hand back the request object itself, which is truthy and read as a
    // real record downstream.
    t.oncomplete = () => res(out && 'result' in out ? out.result : out);
    t.onerror = () => rej(t.error);
  });
};

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

export async function saveSession(state, { photos = true } = {}) {
  try {
    const row = (p, i) => ({
      id: p.id, i, name: p.name, blob: p.blob, span: p.span,
      tf: { ...p.tf, adj: { ...p.tf.adj } },
      // The cutout as a PNG blob: a hand-brushed mask is minutes of work and
      // must survive a reload, unlike the bitmaps which decode from blobs.
      cutBlob: p.cutBlob || null,
    });
    const sig = state.pool.map((p) => p.id).join(',');
    const rewritePhotos = photos && sig !== lastPhotoSig;
    const d = await open();
    let nextGen = null;
    // One transaction over both stores: the generation is read and written
    // inside it, so two tabs cannot interleave a check with the other's write.
    const outcome = await new Promise((res, rej) => {
      const t = d.transaction(['photos', 'meta'], 'readwrite');
      const ps = t.objectStore('photos'), ms = t.objectStore('meta');
      let refused = false;
      const read = ms.get('session');
      read.onsuccess = () => {
        const stored = read.result;
        const storedGen = stored?.gen ?? 0;
        // A tab that has never seen this session may claim it; one that has
        // must still be holding the current generation.
        if (myGen !== null && storedGen !== myGen) { refused = true; t.abort(); return; }
        if (rewritePhotos) ps.clear();
        state.pool.forEach((p, i) => ps.put(row(p, i)));
        nextGen = storedGen + 1;
        ms.put({
          overrides: [...state.overrides], layout: state.layout,
          params: { ...state.params }, background: state.background,
          bg2: state.bg2, bgAngle: state.bgAngle, borderColor: state.borderColor,
          nextId: state.nextId,
          overlays: state.overlays.map((o) => ({ ...o })),
          schema: 3, gen: nextGen,
        }, 'session');
      };
      t.oncomplete = () => res(true);
      t.onabort = () => res(refused ? CONFLICT : false);
      t.onerror = () => rej(t.error);
    });
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
    const rows = await tx('photos', 'readonly', (s) => s.getAll());
    const meta = await tx('meta', 'readonly', (s) => s.get('session'));
    if (!rows?.length) return null;
    rows.sort((a, b) => a.i - b.i);
    // Adopt the generation we just read: this tab is now in sync, and its next
    // save is legitimate until some other tab moves the counter.
    myGen = meta?.gen ?? 0;
    return { rows, meta: meta || null };
  } catch { return null; }
}

export function resetSaveCache() { lastPhotoSig = ''; myGen = null; }

export async function clearSession() {
  try {
    await tx('photos', 'readwrite', (s) => s.clear());
    await tx('meta', 'readwrite', (s) => s.delete('session'));
    lastPhotoSig = '';
    // The session is gone, so the next save starts a fresh generation.
    myGen = null;
  } catch { /* nothing to clear */ }
}
