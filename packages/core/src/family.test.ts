import { MemoryLogger } from '@hexok/logger';
import { createLocalClient } from '@ts-pf/server';
import { Errors, type UseCase } from 'hexok';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LatticeError } from './errors.js';
import { AppUseCase, actor, callContext } from './fixtures/context.js';
import { MemoryEventPublisher } from './fixtures/events.js';
import { Posts } from './fixtures/posts.js';
import { validationPaths } from './fixtures/validation.js';
import { framework, MemoryStore } from './index.js';

type Post = z.output<typeof Posts.output>;

/**
 * A hand-written method with no logging code of its own. It counts how often
 * execute runs, and throws `throws` when that is set.
 */
class CountingPublish extends AppUseCase('posts.publish', {
  collection: Posts,
  input: z.object({ id: z.string() }),
  output: Posts.output,
}) {
  calls = 0;
  throws: unknown = undefined;

  async execute(
    _ctx: UseCase.Ctx<typeof AppUseCase>,
    input: { id: string },
  ): Promise<Post> {
    this.calls += 1;
    if (this.throws !== undefined) throw this.throws;
    const now = new Date().toISOString();
    return {
      id: input.id,
      title: 't',
      body: 'b',
      status: 'published',
      createdAt: now,
      updatedAt: now,
    };
  }
}

class AppError extends Errors('app', {
  Locked: { message: 'Post is locked' },
}) {}

/** The LatticeError code a call fails with, or 'ok'. */
function codeOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => 'ok',
    (error) => (LatticeError.is(error) ? error.code : error),
  );
}

function setup() {
  const publish = new CountingPublish();
  const { app } = framework({
    family: AppUseCase,
    store: new MemoryStore(),
    events: new MemoryEventPublisher(),
  })
    .collection(Posts, { methods: { publish: CountingPublish } })
    .build({ methods: { posts: { publish } } });
  return { publish, app };
}

describe('family guards on a hand-written use case', () => {
  it('called through execute: a bad actor is UNAUTHORIZED, bad input is VALIDATION, and execute does not run', async () => {
    const { publish } = setup();
    const { logger } = callContext();

    expect(
      await codeOf(
        // @ts-expect-error userId is a string
        publish.execute({ actor: { userId: 1 }, logger }, { id: 'p1' }),
      ),
    ).toBe('UNAUTHORIZED');
    expect(
      // @ts-expect-error id is a string
      await codeOf(publish.execute(callContext(), { id: 1 })),
    ).toBe('VALIDATION');
    expect(publish.calls).toBe(0);

    expect(await codeOf(publish.execute(callContext(), { id: 'p1' }))).toBe(
      'ok',
    );
    expect(publish.calls).toBe(1);
  });

  it('checks the actor before the input', async () => {
    const { publish } = setup();
    const { logger } = callContext();
    expect(
      // @ts-expect-error neither the actor nor the input is valid
      await codeOf(publish.execute({ actor: {}, logger }, { id: 1 })),
    ).toBe('UNAUTHORIZED');
  });

  it('keeps the actor issues out of UNAUTHORIZED and puts the input path in VALIDATION', async () => {
    const { publish } = setup();
    const { logger } = callContext();
    const error = await publish
      // @ts-expect-error userId is a string
      .execute({ actor: { userId: 1 }, logger }, { id: 'p1' })
      .catch((e) => e);
    expect(error.data).toBeUndefined();

    const input = await publish
      // @ts-expect-error id is a string
      .execute(callContext(), { id: 1 })
      .catch((e) => e);
    expect(
      validationPaths(() => {
        throw input;
      }),
    ).toEqual([['id']]);
  });

  it('called through createLocalClient: the same guards run', async () => {
    const { publish, app } = setup();
    const { logger } = callContext();
    const anonymous = createLocalClient(app, {
      // @ts-expect-error userId is missing
      context: { actor: {}, logger },
    });
    // ts-pf checks input against the contract first; turning that off lets
    // the call reach the family's input guard.
    const unchecked = createLocalClient(app, {
      context: callContext(),
      validation: { input: false },
    });

    expect(await codeOf(anonymous.posts.publish({ id: 'p1' }))).toBe(
      'UNAUTHORIZED',
    );
    expect(
      // @ts-expect-error id is a string
      await codeOf(unchecked.posts.publish({ id: 1 })),
    ).toBe('VALIDATION');
    expect(publish.calls).toBe(0);

    expect(await codeOf(unchecked.posts.publish({ id: 'p1' }))).toBe('ok');
    expect(publish.calls).toBe(1);
  });

  it('requires a logger on the context', () => {
    const { publish } = setup();
    typeOnly(async () => {
      // @ts-expect-error the context has no logger
      await publish.execute({ actor }, { id: 'p1' });
      // @ts-expect-error console is not a Logger
      await publish.execute({ actor, logger: console }, { id: 'p1' });
    });
  });
});

describe('family guards on a generated use case', () => {
  it('called through createLocalClient: a bad actor is UNAUTHORIZED, bad input is VALIDATION, and execute does not run', async () => {
    const { app } = setup();
    const { logger } = callContext();
    const anonymous = createLocalClient(app, {
      // @ts-expect-error userId is missing
      context: { actor: {}, logger },
    });
    const unchecked = createLocalClient(app, {
      context: callContext(),
      validation: { input: false },
    });

    expect(await codeOf(anonymous.posts.get({ id: 'p1' }))).toBe(
      'UNAUTHORIZED',
    );
    expect(
      // @ts-expect-error id is a string
      await codeOf(unchecked.posts.get({ id: 1 })),
    ).toBe('VALIDATION');
    expect(
      // @ts-expect-error title is required
      await codeOf(unchecked.posts.create({ body: 'b', status: 'draft' })),
    ).toBe('VALIDATION');

    // NOT_FOUND comes from execute, so a valid call got past the guards.
    expect(await codeOf(unchecked.posts.get({ id: 'p1' }))).toBe('NOT_FOUND');
  });
});

/** Statements the compiler checks and the test never runs. */
function typeOnly(_statements: () => unknown): void {}

/** A request logger, as the edge makes one, and the root that records it. */
function requestLogger() {
  const root = new MemoryLogger();
  return { root, logger: root.child({ requestId: 'r1' }) };
}

const callFields = {
  requestId: 'r1',
  collection: 'posts',
  action: 'publish',
  actorId: 'u1',
};

describe('family logging', () => {
  it('logs one info line per successful call, through a child of the request logger', async () => {
    const { app } = setup();
    const { root, logger } = requestLogger();
    const local = createLocalClient(app, { context: callContext(logger) });

    await local.posts.publish({ id: 'p1' });

    expect(root.records).toHaveLength(1);
    const [record] = root.records;
    expect(record).toMatchObject({
      level: 'info',
      message: 'posts.publish',
      fields: { ...callFields, outcome: 'ok' },
    });
    expect(record?.fields.durationMs).toEqual(expect.any(Number));
  });

  it('logs a call through execute the same way', async () => {
    const { publish } = setup();
    const { root, logger } = requestLogger();

    await publish.execute(callContext(logger), { id: 'p1' });

    expect(root.records).toMatchObject([
      { level: 'info', fields: { ...callFields, outcome: 'ok' } },
    ]);
  });

  it('logs an unexpected throw once, at error, with the error', async () => {
    const { publish } = setup();
    const { root, logger } = requestLogger();
    publish.throws = new Error('boom');

    await expect(
      publish.execute(callContext(logger), { id: 'p1' }),
    ).rejects.toThrow('boom');

    expect(root.records).toHaveLength(1);
    expect(root.records[0]).toMatchObject({
      level: 'error',
      message: 'boom',
      error: { name: 'Error', message: 'boom' },
      fields: { ...callFields, outcome: 'failed' },
    });
  });

  it('logs a generated use case the same way', async () => {
    const { app } = setup();
    const { root, logger } = requestLogger();
    const local = createLocalClient(app, { context: callContext(logger) });

    await local.posts.create({ title: 't', body: 'b', status: 'draft' });
    await expect(local.posts.get({ id: 'nope' })).rejects.toThrow();

    expect(root.records).toMatchObject([
      {
        level: 'info',
        message: 'posts.create',
        fields: { ...callFields, action: 'create', outcome: 'ok' },
      },
      {
        level: 'info',
        message: 'posts.get',
        fields: {
          ...callFields,
          action: 'get',
          outcome: 'refused',
          code: 'NOT_FOUND',
        },
      },
    ]);
  });

  it('logs a refusal once at info with its code, never at error', async () => {
    const { publish } = setup();
    const { root, logger } = requestLogger();

    publish.throws = LatticeError.CONFLICT({ collection: 'posts', id: 'p1' });
    await expect(
      publish.execute(callContext(logger), { id: 'p1' }),
    ).rejects.toThrow();
    publish.throws = AppError.Locked();
    await expect(
      publish.execute(callContext(logger), { id: 'p1' }),
    ).rejects.toThrow();

    expect(root.records).toMatchObject([
      {
        level: 'info',
        fields: {
          ...callFields,
          outcome: 'refused',
          catalog: 'lattice',
          code: 'CONFLICT',
        },
      },
      {
        level: 'info',
        fields: {
          ...callFields,
          outcome: 'refused',
          catalog: 'app',
          code: 'Locked',
        },
      },
    ]);
    expect(root.records.some((record) => record.level === 'error')).toBe(false);
  });

  it('writes nothing for a call its guards reject', async () => {
    const { publish } = setup();
    const { root, logger } = requestLogger();

    await expect(
      // @ts-expect-error id is a string
      publish.execute(callContext(logger), { id: 1 }),
    ).rejects.toThrow();

    expect(root.records).toEqual([]);
  });
});
