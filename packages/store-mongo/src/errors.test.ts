import { LatticeError } from '@latticecms/core';
import { MongoServerError } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { writing } from './errors.js';

function duplicate(keyPattern?: Record<string, number>) {
  return new MongoServerError({
    message: 'E11000 duplicate key error',
    code: 11000,
    ...(keyPattern === undefined ? {} : { keyPattern }),
  });
}

async function conflictOf(error: unknown) {
  const thrown = await writing('users', 'u1', async () => {
    throw error;
  }).catch((caught: unknown) => caught);
  if (!LatticeError.is(thrown) || thrown.code !== 'CONFLICT') {
    throw new Error(`expected a CONFLICT, got ${String(thrown)}`);
  }
  return thrown.data;
}

describe('writing', () => {
  it('names the index fields from keyPattern, with _id as id', async () => {
    expect(await conflictOf(duplicate({ org: 1, email: 1 }))).toEqual({
      collection: 'users',
      id: 'u1',
      fields: ['org', 'email'],
    });
    expect(await conflictOf(duplicate({ _id: 1 }))).toEqual({
      collection: 'users',
      id: 'u1',
      fields: ['id'],
    });
  });

  // Older servers and some MongoDB-compatible services leave it out.
  it('names no fields when the error has no keyPattern', async () => {
    expect(await conflictOf(duplicate())).toEqual({
      collection: 'users',
      id: 'u1',
      fields: [],
    });
  });

  it('passes any other error through', async () => {
    const other = new MongoServerError({ message: 'other', code: 171 });
    await expect(
      writing('users', 'u1', async () => {
        throw other;
      }),
    ).rejects.toBe(other);
  });
});
