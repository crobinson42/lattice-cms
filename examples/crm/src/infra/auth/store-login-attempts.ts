import { type CollectionStore, LatticeError } from '@latticecms/core';
import { Adapter } from 'hexok';
import { LoginAttempts } from '../../app/ports/auth/login-attempts.js';

/**
 * The store collection of failed logins. Like credentials, it is never a
 * Lattice collection, and no Lattice collection may use this slug.
 */
export const loginAttemptsCollection = 'login_attempts';

/** Failures that lock a key until its window ends. */
export const maxFailures = 10;
/** How long a window lasts, from its first failure. */
export const windowMs = 15 * 60 * 1000;

/**
 * Failed logins per key, in a store collection: `{ id: key, failures,
 * windowStart }`. The store has no atomic increment, so concurrent
 * failures can overshoot by a few; a lock is still reached.
 */
export class StoreLoginAttempts extends Adapter(LoginAttempts) {
  readonly #store: CollectionStore;
  readonly #now: () => number;

  constructor(store: CollectionStore, now: () => number = Date.now) {
    super();
    this.#store = store;
    this.#now = now;
  }

  /** The key's failures in its open window, or none. */
  async #current(key: string): Promise<number> {
    const doc = await this.#store.get(loginAttemptsCollection, key);
    if (doc === null) return 0;
    const { failures, windowStart } = doc;
    if (typeof failures !== 'number' || typeof windowStart !== 'number') {
      return 0;
    }
    return this.#now() - windowStart < windowMs ? failures : 0;
  }

  override async isLocked(key: string): Promise<boolean> {
    return (await this.#current(key)) >= maxFailures;
  }

  override async fail(key: string): Promise<void> {
    const failures = await this.#current(key);
    if (failures > 0) {
      await this.#store.update(loginAttemptsCollection, key, {
        failures: failures + 1,
      });
      return;
    }
    const opened = { failures: 1, windowStart: this.#now() };
    const updated = await this.#store.update(
      loginAttemptsCollection,
      key,
      opened,
    );
    if (updated !== null) return;
    try {
      await this.#store.insert(loginAttemptsCollection, {
        id: key,
        ...opened,
      });
    } catch (error) {
      // Another failure opened the window first: count this one in it.
      if (!LatticeError.is(error) || error.code !== 'CONFLICT') throw error;
      await this.fail(key);
    }
  }

  override async reset(key: string): Promise<void> {
    await this.#store.remove(loginAttemptsCollection, key);
  }
}
