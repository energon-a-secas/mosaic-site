// When, and whether, the session is written.
//
// Split from events.js because the debounce and the rule it guards are one
// concern: two tabs cannot both own the stored session. js/store.js stamps
// every write with a generation and refuses one whose generation has moved,
// and this is the half that decides what to do about a refusal. The answer is
// to stop, not to retry: the two pools cannot be merged, and the tab that
// would lose its photos is not the one making the request.

import { saveSession, CONFLICT } from './store.js';
import { state } from './state.js';
import { showToast as toast } from './utils.js';

let timer = null, lost = false;

/** True once another tab took the session and this one gave up writing. */
export const sessionLost = () => lost;

export function scheduleSave(delay = 700) {
  if (lost) return;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const result = await saveSession(state);
    const notice = document.querySelector('#saveNotice');
    if (result === true) { if (notice) notice.hidden = true; return; }
    if (result === false) {
      if (notice && state.pool.length) {
        notice.textContent = 'Autosave is unavailable. Download your collage before closing this tab.';
        notice.hidden = false;
      }
      return;
    }
    if (result !== CONFLICT) return;
    lost = true;
    if (notice) {
      notice.textContent = 'Another tab saved this collage. Download this version, or reload to use the saved version.';
      notice.hidden = false;
    }
    toast('Another tab saved this collage. Autosave stopped here so this tab '
        + 'cannot overwrite it. Reload to carry on in this tab.');
  }, delay);
}

/** Clearing the session releases it, so this tab may write again. */
export function resumeSaving() {
  lost = false;
  const notice = document.querySelector('#saveNotice');
  if (notice) notice.hidden = true;
}
