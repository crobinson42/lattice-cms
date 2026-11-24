import { MongoStore } from '@latticecms/store-mongo';

/**
 * The app's MongoStore, not started: `MONGODB_URL`, and `MONGODB_DATABASE`
 * or `crm`. Every process and script that opens the database reads them
 * here.
 */
export function mongoStore(env: NodeJS.ProcessEnv): MongoStore {
  const url = env.MONGODB_URL;
  if (url === undefined) throw new Error('Set MONGODB_URL');
  return new MongoStore({ url, database: env.MONGODB_DATABASE ?? 'crm' });
}
