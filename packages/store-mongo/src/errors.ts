import { LatticeError } from '@latticecms/core';
import { Errors } from 'hexok';
import { MongoServerError } from 'mongodb';

/**
 * A call at the wrong time in the store's lifecycle. The codes are
 * ioredis-lifecycle's, so an app matches every adapter's on `code`. Fix
 * the call order; do not retry.
 */
export class MongoStoreError extends Errors('store-mongo', {
  NotStarted: {
    message: 'MongoStore: start() has not been called. Await start() first.',
  },
  Starting: {
    message: 'MongoStore: start() has not finished. Await start() first.',
  },
  Stopped: {
    message: 'MongoStore: stop() was called. Start it again to use it.',
  },
}) {}

/** A duplicate key on a write: an id clash or a unique index. */
export function isDuplicateKey(error: unknown): boolean {
  return error instanceof MongoServerError && error.code === 11000;
}

/**
 * Runs a write of the document `id`, turning a duplicate key into Lattice's
 * CONFLICT for that document. `id` is the document being written, which
 * the caller always knows, so the driver's message is never parsed.
 */
export async function writing<T>(
  collection: string,
  id: string,
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isDuplicateKey(error)) throw LatticeError.CONFLICT({ collection, id });
    throw error;
  }
}
