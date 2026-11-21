import type { CollectionStore } from '@latticecms/core';
import { Login } from '../../app/use-cases/auth/login.js';
import {
  type Hasher,
  StoreCredentials,
} from '../../infra/auth/store-credentials.js';
import { StoreLoginAttempts } from '../../infra/auth/store-login-attempts.js';

/**
 * Login over the app's own store: credentials and failed attempts in store
 * collections Lattice never registers. Await `credentials.ensure()` at
 * startup. Tests pass a clock and a counting hasher.
 */
export function storeLogin(
  store: CollectionStore,
  options: { readonly now?: () => number; readonly hasher?: Hasher } = {},
) {
  const credentials = new StoreCredentials(store, options.hasher);
  const attempts = new StoreLoginAttempts(store, options.now);
  return { credentials, attempts, login: new Login({ credentials, attempts }) };
}
