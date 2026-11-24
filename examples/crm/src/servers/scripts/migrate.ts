import { migrations } from '../../infra/migrations/index.js';
import { mongoStore } from '../../infra/store.js';

/**
 * What `npx lattice migrate` runs, after `npm run build`: the store, not
 * started, and the migrations. The server also migrates at startup.
 */
export const store = mongoStore(process.env);
export { migrations };
