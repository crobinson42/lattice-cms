import { hashPassword, verifyPassword } from '../infra/auth/password-hash.js';
import type { Hasher } from '../infra/auth/store-credentials.js';

/**
 * scrypt at a tiny cost, for tests that exercise login rather than hashing:
 * real salts and real comparisons, but milliseconds instead of a second per
 * failure. It never asks for a rehash. `calls` counts verifies.
 */
export function cheapHasher(): Hasher & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    hash: (password) => hashPassword(password, { ln: 4, r: 8, p: 1 }),
    async verify(password, hash) {
      calls.push(hash);
      const { ok } = await verifyPassword(password, hash);
      return { ok, rehash: false };
    },
  };
}
