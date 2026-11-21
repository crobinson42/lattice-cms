import { type Logger, MemoryLogger } from '@hexok/logger';
import { asResult } from '@ts-pf/client';
import { isPFError, isUnexpectedError, toWireError } from '@ts-pf/protocol';
import { createLocalClient } from '@ts-pf/server';
import { type UseCase, validationError } from 'hexok';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { LatticeError } from './errors.js';
import {
  clientErrors,
  DomainError,
  toRpcError,
} from './fixtures/app-errors.js';
import { AppUseCase, callContext } from './fixtures/context.js';
import { MemoryEventPublisher } from './fixtures/events.js';
import { Posts } from './fixtures/posts.js';
import { type CollectionStore, framework, MemoryStore } from './index.js';
import type { Doc } from './store.js';

type Post = z.output<typeof Posts.output>;

/** Statements the compiler checks and the test never runs. */
function typeOnly(_statements: () => unknown): void {}

/** A hand-written method that throws `throws`. */
class LockPost extends AppUseCase('posts.lock', {
  collection: Posts,
  input: z.object({ id: z.string() }),
  output: Posts.output,
}) {
  throws: unknown = DomainError.PostLocked({ id: 'p1' });

  async execute(
    _ctx: UseCase.Ctx<typeof AppUseCase>,
    _input: { id: string },
  ): Promise<Post> {
    throw this.throws;
  }
}

/** A store whose every insert finds the id taken. */
class TakenStore extends MemoryStore {
  override async insert(collection: string, doc: Doc): Promise<void> {
    throw LatticeError.CONFLICT({ collection, id: doc.id });
  }
}

function setup(
  options: {
    store?: CollectionStore;
    logger?: Logger;
    /** false turns ts-pf's own input check off, so Lattice's guard sees bad input. */
    checkInput?: boolean;
  } = {},
) {
  const lock = new LockPost();
  const { contract, app } = framework({
    family: AppUseCase,
    store: options.store ?? new MemoryStore(),
    events: new MemoryEventPublisher(),
    errors: { declared: clientErrors, map: toRpcError },
  })
    .collection(Posts, { methods: { lock: LockPost } })
    .build({ methods: { posts: { lock } } });
  const context = callContext(options.logger);
  return {
    lock,
    contract,
    app,
    local: createLocalClient(app, {
      context,
      validation: { input: options.checkInput ?? true },
    }),
  };
}

/** The error a call fails with, typed as the client types it. */
async function refused<T, E>(
  call: Promise<T> & { readonly '~pfError'?: E },
): Promise<E> {
  const result = await asResult(call);
  if (result.ok) throw new Error('expected the call to fail');
  return result.error;
}

describe('declared errors', () => {
  it('every procedure declares Lattice’s codes and the app’s, and not VALIDATION', () => {
    const { contract } = setup();
    const codes = [
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
      'CONFLICT',
      'PostLocked',
      'QuotaReached',
    ];
    for (const procedure of Object.values(contract.posts)) {
      expect(Object.keys(procedure['~pf'].errors)).toEqual(codes);
    }
    expect(contract.posts.get['~pf'].errors.NOT_FOUND.status).toBe(404);
  });

  it('a client call types every declared code and the protocol codes', async () => {
    const { local } = setup();
    const error = await refused(local.posts.get({ id: 'nope' }));
    expectTypeOf(error.code).toEqualTypeOf<
      | 'UNAUTHORIZED'
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'CONFLICT'
      | 'PostLocked'
      | 'QuotaReached'
      | 'BAD_REQUEST'
      | 'VALIDATION'
      | 'INTERNAL'
      | 'METHOD_NOT_ALLOWED'
      | 'PAYLOAD_TOO_LARGE'
    >();
  });

  it('is a type error and throws when the app declares a Lattice code', () => {
    const base = {
      family: AppUseCase,
      store: new MemoryStore(),
      events: new MemoryEventPublisher(),
    };
    typeOnly(() => {
      framework({
        ...base,
        // @ts-expect-error NOT_FOUND is a Lattice error code
        errors: { declared: { NOT_FOUND: { status: 404 } }, map: toRpcError },
      });
      framework({
        ...base,
        // @ts-expect-error VALIDATION is a Lattice error code
        errors: { declared: { VALIDATION: {} }, map: toRpcError },
      });
    });
    expect(() =>
      framework({
        ...base,
        // @ts-expect-error CONFLICT is a Lattice error code
        errors: { declared: { CONFLICT: {} }, map: toRpcError },
      }),
    ).toThrow('Lattice: "CONFLICT" is a Lattice error code');
  });

  it('is optional: an app with no domain errors declares Lattice’s', async () => {
    const { contract, app } = framework({
      family: AppUseCase,
      store: new MemoryStore(),
      events: new MemoryEventPublisher(),
    })
      .collection(Posts)
      .build();
    expect(Object.keys(contract.posts.get['~pf'].errors)).toEqual([
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
      'CONFLICT',
    ]);
    const local = createLocalClient(app, { context: callContext() });
    const error = await refused(local.posts.get({ id: 'nope' }));
    expect(error.code).toBe('NOT_FOUND');
  });
});

describe('what a client receives', () => {
  it('NOT_FOUND, with its data and status', async () => {
    const { local } = setup();
    const error = await refused(local.posts.get({ id: 'nope' }));
    if (error.code !== 'NOT_FOUND') throw new Error(error.code);
    expectTypeOf(error.data).toEqualTypeOf<{
      collection: string;
      id: string;
    }>();
    expect(error.data).toEqual({ collection: 'posts', id: 'nope' });
    expect(error.status).toBe(404);
    expect(error.message).toBe('No document with this id');
  });

  it('CONFLICT from the store, with its data and status', async () => {
    const { local } = setup({ store: new TakenStore() });
    const error = await refused(
      local.posts.create({ title: 't', body: 'b', status: 'draft' }),
    );
    if (error.code !== 'CONFLICT') throw new Error(error.code);
    expectTypeOf(error.data).toEqualTypeOf<{
      collection: string;
      id: string;
    }>();
    expect(error.data).toEqual({ collection: 'posts', id: expect.any(String) });
    expect(error.status).toBe(409);
  });

  it('UNAUTHORIZED for a bad actor, with no data', async () => {
    const { app } = setup();
    const local = createLocalClient(app, {
      // @ts-expect-error userId is missing
      context: { actor: {}, logger: new MemoryLogger() },
    });
    const error = await refused(local.posts.get({ id: 'p1' }));
    if (error.code !== 'UNAUTHORIZED') throw new Error(error.code);
    expectTypeOf(error.data).toEqualTypeOf<undefined>();
    expect(error.data).toBeUndefined();
    expect(error.status).toBe(401);
  });

  it('VALIDATION from ts-pf’s input check and from Lattice’s guard, as { path, message }[]', async () => {
    const checked = setup().local;
    const unchecked = setup({ checkInput: false }).local;
    for (const local of [checked, unchecked]) {
      const error = await refused(
        // @ts-expect-error title is a string
        local.posts.create({ title: 1, body: 'b', status: 'draft' }),
      );
      if (error.code !== 'VALIDATION') throw new Error(error.code);
      expectTypeOf(error.data.issues).toEqualTypeOf<
        { message: string; path: (string | number)[] }[]
      >();
      expect(error.data.issues).toEqual([
        { path: ['title'], message: expect.any(String) },
      ]);
    }
  });

  it('VALIDATION paths differ for unknown where keys: ts-pf groups them, Lattice names each', async () => {
    const where = { colour: { eq: 'x' }, size: { eq: 1 } };
    // @ts-expect-error neither is a field
    const grouped = await refused(setup().local.posts.find({ where }));
    const split = await refused(
      // @ts-expect-error neither is a field
      setup({ checkInput: false }).local.posts.find({ where }),
    );
    if (grouped.code !== 'VALIDATION' || split.code !== 'VALIDATION') {
      throw new Error('expected VALIDATION');
    }
    expect(grouped.data.issues.map((issue) => issue.path)).toEqual([['where']]);
    expect(split.data.issues.map((issue) => issue.path)).toEqual([
      ['where', 'colour'],
      ['where', 'size'],
    ]);
  });

  it('a hexok VALIDATION as the protocol VALIDATION, with plain paths', async () => {
    const { local, lock } = setup();
    lock.throws = validationError('Post is invalid', [
      { message: 'Required', path: [{ key: 'title' }, 0] },
    ]);
    const error = await refused(local.posts.lock({ id: 'p1' }));
    if (error.code !== 'VALIDATION') throw new Error(error.code);
    expect(error.message).toBe('Post is invalid');
    expect(error.data.issues).toEqual([
      { message: 'Required', path: ['title', 0] },
    ]);
  });

  it('an app domain error from a method, through the app’s map, with its code, data and status', async () => {
    const { local } = setup();
    const error = await refused(local.posts.lock({ id: 'p1' }));
    if (error.code !== 'PostLocked') throw new Error(error.code);
    expectTypeOf(error.data).toEqualTypeOf<{ id: string }>();
    expect(error.data).toEqual({ id: 'p1' });
    expect(error.status).toBe(423);
    expect(error.message).toBe('Post is locked');
  });

  it('INTERNAL for an unknown Error, and for a domain error the app keeps from clients', async () => {
    const { local, lock } = setup();
    const boom = new Error('boom');
    const kept = DomainError.InternalOnly();

    for (const thrown of [boom, kept]) {
      lock.throws = thrown;
      // ts-pf passes it through unchanged: an in-process caller gets the
      // value itself, and the wire sends it as a bare INTERNAL.
      const error = await local.posts.lock({ id: 'p1' }).catch((e) => e);
      expect(error).toBe(thrown);
      expect(isUnexpectedError(error)).toBe(true);
      expect(toWireError(error)).toEqual({
        code: 'INTERNAL',
        message: 'Internal server error',
      });
    }
  });

  it('a refusal is not an unexpected error, so the edge’s default onError skips it', async () => {
    const { local } = setup();
    const error = await local.posts.get({ id: 'nope' }).catch((e) => e);
    expect(isUnexpectedError(error)).toBe(false);
  });
});

describe('refusal logging', () => {
  function logged() {
    const root = new MemoryLogger();
    return { root, ...setup({ logger: root }) };
  }

  const fields = { collection: 'posts', outcome: 'refused' };

  it('a refusal inside execute: one line, from the family', async () => {
    const { root, local } = logged();
    await refused(local.posts.get({ id: 'nope' }));
    expect(root.records).toHaveLength(1);
    expect(root.records[0]).toMatchObject({
      level: 'info',
      message: 'posts.get',
      fields: {
        ...fields,
        action: 'get',
        actorId: 'u1',
        catalog: 'lattice',
        code: 'NOT_FOUND',
        durationMs: expect.any(Number),
      },
    });
  });

  it('an app domain error from a method: one line, from the family', async () => {
    const { root, local } = logged();
    await refused(local.posts.lock({ id: 'p1' }));
    expect(root.records).toMatchObject([
      {
        level: 'info',
        fields: {
          ...fields,
          action: 'lock',
          catalog: 'app',
          code: 'PostLocked',
        },
      },
    ]);
  });

  it('a guard’s UNAUTHORIZED: one line, from the family guard, with no actorId', async () => {
    const root = new MemoryLogger();
    const local = createLocalClient(setup().app, {
      // @ts-expect-error userId is missing
      context: { actor: {}, logger: root },
    });
    await refused(local.posts.get({ id: 'p1' }));
    expect(root.records).toHaveLength(1);
    expect(root.records[0]).toMatchObject({
      level: 'info',
      message: 'posts.get',
      fields: {
        ...fields,
        action: 'get',
        catalog: 'lattice',
        code: 'UNAUTHORIZED',
      },
    });
    expect(root.records[0]?.fields).not.toHaveProperty('actorId');
  });

  it('a guard’s VALIDATION: one line, from the family guard, with the actorId', async () => {
    const root = new MemoryLogger();
    const { local } = setup({ logger: root, checkInput: false });
    // @ts-expect-error id is a string
    await refused(local.posts.get({ id: 1 }));
    expect(root.records).toMatchObject([
      {
        level: 'info',
        fields: {
          ...fields,
          action: 'get',
          actorId: 'u1',
          catalog: 'lattice',
          code: 'VALIDATION',
        },
      },
    ]);
  });

  it('ts-pf’s own input VALIDATION: one line, from the middleware, which runs before the check', async () => {
    const { root, local } = logged();
    // @ts-expect-error id is a string
    await refused(local.posts.get({ id: 1 }));
    expect(root.records).toHaveLength(1);
    expect(root.records[0]).toMatchObject({
      level: 'info',
      fields: { ...fields, action: 'get', actorId: 'u1', code: 'VALIDATION' },
    });
    expect(root.records[0]?.fields).not.toHaveProperty('catalog');
  });

  it('INTERNAL: one error line, from the family; the middleware leaves it to the edge', async () => {
    const { root, local, lock } = logged();
    lock.throws = new Error('boom');
    await expect(local.posts.lock({ id: 'p1' })).rejects.toThrow('boom');
    expect(root.records).toMatchObject([
      {
        level: 'error',
        message: 'boom',
        fields: { ...fields, action: 'lock', outcome: 'failed' },
      },
    ]);
  });

  it('a call that succeeds: one ok line', async () => {
    const { root, local } = logged();
    await local.posts.find({});
    expect(root.records).toMatchObject([
      { level: 'info', fields: { action: 'find', outcome: 'ok' } },
    ]);
  });
});

describe('the PFError a client receives', () => {
  it('keeps the LatticeError as the cause', async () => {
    const { local } = setup();
    const error = await local.posts.get({ id: 'nope' }).catch((e) => e);
    expect(isPFError(error)).toBe(true);
    expect(LatticeError.is(error.cause)).toBe(true);
  });
});
