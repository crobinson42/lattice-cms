import { createLocalClient } from '@ts-pf/server';
import type { UseCase } from 'hexok';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LatticeError } from './errors.js';
import { AppUseCase } from './fixtures/context.js';
import { Posts } from './fixtures/posts.js';
import { validationPaths } from './fixtures/validation.js';
import { framework } from './index.js';

type Post = z.output<typeof Posts.output>;

/** A hand-written method that counts how often execute runs. */
class CountingPublish extends AppUseCase('posts.publish', {
  collection: Posts,
  input: z.object({ id: z.string() }),
  output: Posts.output,
}) {
  calls = 0;

  async execute(
    _ctx: UseCase.Ctx<typeof AppUseCase>,
    input: { id: string },
  ): Promise<Post> {
    this.calls += 1;
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

const actor = { userId: 'u1', roles: [] };

/** The LatticeError code a call fails with, or 'ok'. */
function codeOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => 'ok',
    (error) => (LatticeError.is(error) ? error.code : error),
  );
}

function setup() {
  const publish = new CountingPublish();
  const { app } = framework({ family: AppUseCase })
    .collection(Posts, { methods: { publish: CountingPublish } })
    .build({ methods: { posts: { publish } } });
  return { publish, app };
}

describe('family guards on a hand-written use case', () => {
  it('called through execute: a bad actor is UNAUTHORIZED, bad input is VALIDATION, and execute does not run', async () => {
    const { publish } = setup();

    expect(
      // @ts-expect-error userId is a string
      await codeOf(publish.execute({ actor: { userId: 1 } }, { id: 'p1' })),
    ).toBe('UNAUTHORIZED');
    expect(
      // @ts-expect-error id is a string
      await codeOf(publish.execute({ actor }, { id: 1 })),
    ).toBe('VALIDATION');
    expect(publish.calls).toBe(0);

    expect(await codeOf(publish.execute({ actor }, { id: 'p1' }))).toBe('ok');
    expect(publish.calls).toBe(1);
  });

  it('checks the actor before the input', async () => {
    const { publish } = setup();
    expect(
      // @ts-expect-error neither the actor nor the input is valid
      await codeOf(publish.execute({ actor: {} }, { id: 1 })),
    ).toBe('UNAUTHORIZED');
  });

  it('keeps the actor issues out of UNAUTHORIZED and puts the input path in VALIDATION', async () => {
    const { publish } = setup();
    const error = await publish
      // @ts-expect-error userId is a string
      .execute({ actor: { userId: 1 } }, { id: 'p1' })
      .catch((e) => e);
    expect(error.data).toBeUndefined();

    const input = await publish
      // @ts-expect-error id is a string
      .execute({ actor }, { id: 1 })
      .catch((e) => e);
    expect(
      validationPaths(() => {
        throw input;
      }),
    ).toEqual([['id']]);
  });

  it('called through createLocalClient: the same guards run', async () => {
    const { publish, app } = setup();
    // @ts-expect-error userId is a string
    const anonymous = createLocalClient(app, { context: { actor: {} } });
    // ts-pf checks input against the contract first; turning that off lets
    // the call reach the family's input guard.
    const unchecked = createLocalClient(app, {
      context: { actor },
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
});

describe('family guards on a generated use case', () => {
  it('called through createLocalClient: a bad actor is UNAUTHORIZED, bad input is VALIDATION, and execute does not run', async () => {
    const { app } = setup();
    // @ts-expect-error userId is a string
    const anonymous = createLocalClient(app, { context: { actor: {} } });
    const unchecked = createLocalClient(app, {
      context: { actor },
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

    // Generated bodies throw 'todo' until step 5, so reaching that error is
    // what shows the guards let a valid call through to execute.
    await expect(unchecked.posts.get({ id: 'p1' })).rejects.toThrow('todo');
  });
});
