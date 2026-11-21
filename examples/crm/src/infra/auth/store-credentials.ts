import { type CollectionStore, LatticeError } from '@latticecms/core';
import { Adapter, fail, ok, type Result } from 'hexok';
import {
  type CredentialRefusal,
  Credentials,
  minPasswordLength,
} from '../../app/ports/auth/credentials.js';
import { CredentialError } from '../../domain/errors/auth.js';
import { hashPassword, verifyPassword } from './password-hash.js';

/**
 * The store collection that holds password hashes. It is never a Lattice
 * collection, so no router, MCP tool or API doc can reach it. No Lattice
 * collection may use this slug.
 */
export const credentialsCollection = 'credentials';

/** How passwords are hashed and checked. Tests count the calls. */
export type Hasher = {
  hash(password: string): Promise<string>;
  verify(
    password: string,
    hash: string,
  ): Promise<{ readonly ok: boolean; readonly rehash: boolean }>;
};

const scryptHasher: Hasher = { hash: hashPassword, verify: verifyPassword };

/** An email as it is stored and looked up. */
function normalized(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Credentials in a store collection Lattice never registers, through the
 * `CollectionStore` port: the app's own store, so no second database
 * client. A document is `{ id: userId, email, hash, updatedAt }`.
 */
export class StoreCredentials extends Adapter(Credentials) {
  readonly #store: CollectionStore;
  readonly #hasher: Hasher;
  /**
   * A hash of nothing, checked for an unknown email, so it costs the same.
   * Made on the first unknown email, and kept.
   */
  #dummy: Promise<string> | undefined;

  constructor(store: CollectionStore, hasher: Hasher = scryptHasher) {
    super();
    this.#store = store;
    this.#hasher = hasher;
  }

  /** One credential per email. Await it at startup, with `crm.ensure()`. */
  ensure(): Promise<void> {
    return this.#store.ensure(credentialsCollection, [
      { fields: { email: 1 }, unique: true },
    ]);
  }

  override async verify(
    email: string,
    password: string,
  ): Promise<Result<{ readonly userId: string }, CredentialRefusal>> {
    const { docs } = await this.#store.find({
      collection: credentialsCollection,
      where: { email: { eq: normalized(email) } },
      sort: [],
      limit: 1,
    });
    const [doc] = docs;
    const hash = doc?.hash;
    if (doc === undefined || typeof hash !== 'string') {
      this.#dummy ??= this.#hasher.hash('dummy password, never a real one');
      await this.#hasher.verify(password, await this.#dummy);
      return fail('unknown');
    }
    const checked = await this.#hasher.verify(password, hash);
    if (!checked.ok) return fail('wrong-password');
    if (checked.rehash) {
      await this.#store.update(credentialsCollection, doc.id, {
        hash: await this.#hasher.hash(password),
        updatedAt: new Date().toISOString(),
      });
    }
    return ok({ userId: doc.id });
  }

  override async set(
    user: { readonly userId: string; readonly email: string },
    password: string,
  ): Promise<void> {
    if (password.length < minPasswordLength) {
      throw CredentialError.PasswordTooShort();
    }
    const values = {
      email: normalized(user.email),
      hash: await this.#hasher.hash(password),
      updatedAt: new Date().toISOString(),
    };
    const updated = await this.#store.update(
      credentialsCollection,
      user.userId,
      values,
    );
    if (updated !== null) return;
    try {
      await this.#store.insert(credentialsCollection, {
        id: user.userId,
        ...values,
      });
    } catch (error) {
      // Two `set`s for a new user raced: the other inserted it.
      if (!LatticeError.is(error) || error.code !== 'CONFLICT') throw error;
      await this.#store.update(credentialsCollection, user.userId, values);
    }
  }
}
