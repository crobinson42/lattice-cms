import { MongoStore } from '@latticecms/store-mongo';
import { migrations } from '../../infra/migrations/index.js';

const url = process.env.MONGODB_URL;
if (url === undefined) throw new Error('Set MONGODB_URL');

/** What `lattice migrate` runs: the store, not started, and the migrations. */
export const store = new MongoStore({
  url,
  database: process.env.MONGODB_DATABASE ?? 'fixture',
});
export { migrations };
