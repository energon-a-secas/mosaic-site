import { cacheRefs, buildFilterButtons } from './render.js';
import { wire } from './events.js';

cacheRefs();
buildFilterButtons();
wire();
