import { cacheRefs, buildFilterButtons } from './render.js';
import { wire } from './events.js';
import { registerServiceWorker } from './register-sw.js';

cacheRefs();
buildFilterButtons();
wire();
registerServiceWorker();
