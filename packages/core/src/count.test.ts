import { MemoryLogger } from '@hexok/logger';
import { isPFError } from '@ts-pf/protocol';
import { createLocalClient } from '@ts-pf/server';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { LatticeError } from './errors.js';
import { AppUseCase, callContext } from './fixtures/context.js';
import {
  collection,
  family,
  framework,
  MemoryStore,
  type Repo,
  tenancy,
  unscoped,
  type Where,
} from './index.js';

const Tenanted = family({
  actor: z.object({
    userId: z.string(),
    organizationId: z.string(),
    support: z.boolean().optional(),
  }),
  actorId: (actor) => actor.userId,
  tenantOf: (actor) =>
    actor.support === true ? tenancy.bypass : actor.organizationId,
});

const Notes = collection('notes', {
  schema: z.object({ title: z.string(), rank: z.number() }),
  tenant: 'organizationId',
});

const Labels = collection('labels', {
  schema: z.object({ name: z.string(), rank: z.number() }),
});

type Note = z.output<typeof Notes.output>;

const open = {
  read: () => true,
  create: () => true,
  update: () => true,
  delete: () => true,
};

const alice = { userId: 'a', organizationId: 'o1' };
const bob = { userId: 'b', organizationId: 'o2' };
const staff = { userId: 's', organizationId: 'o0', support: true };

/** The code a call fails with, or 'ok'. */
function codeOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => 'ok',
    (error) =>
      isPFError(error) || LatticeError.is(error) ? error.code : error,
  );
}

function setup(read: () => boolean | Where<Note> = () => true) {
  const logger = new MemoryLogger();
  const published: object[] = [];
  const built = framework({ family: Tenanted })
    .collection(Notes, { access: { ...open, read } })
    .build({
      store: new MemoryStore(),
      events: {
        async publish(event: object) {
          published.push(event);
        },
      },
    });
  const as = (actor: typeof alice | typeof staff) =>
    createLocalClient(built.app, { context: { actor, logger } });
  return {
    ...built,
    logger,
    published,
    o1: as(alice),
    o2: as(bob),
    support: as(staff),
  };
}

async function notesIn(
  repos: { readonly notes: Repo<typeof Notes> },
  organizationId: string,
  ranks: number[],
): Promise<void> {
  const scope = tenancy.scope(Notes, organizationId);
  for (const rank of ranks) {
    await repos.notes.insert({ title: `t${rank}`, rank }, scope);
  }
}

describe('count', () => {
  it('returns { count }, and matches find across the same filter', async () => {
    const { o1, repos } = setup();
    await notesIn(repos, 'o1', [1, 2, 2, 3, 5]);
    const filters: (Where<Note> | undefined)[] = [
      undefined,
      { rank: { eq: 2 } },
      { rank: { gt: 1, lt: 5 } },
      { or: [{ rank: { eq: 1 } }, { title: { contains: 'T5' } }] },
      { rank: { eq: 9 } },
    ];
    for (const where of filters) {
      const input = where === undefined ? {} : { where };
      const { count } = await o1.notes.count(input);
      const { docs } = await o1.notes.find({ ...input, limit: 100 });
      expect(count).toBe(docs.length);
    }
    expectTypeOf(o1.notes.count).returns.resolves.toEqualTypeOf<{
      count: number;
    }>();
  });

  it('runs read access: false is FORBIDDEN, and a Where narrows the count', async () => {
    const denied = setup(() => false);
    expect(await codeOf(denied.o1.notes.count({}))).toBe('FORBIDDEN');

    const narrowed = setup(() => ({ rank: { gt: 1 } }));
    await notesIn(narrowed.repos, 'o1', [1, 2, 3]);
    expect(await narrowed.o1.notes.count({})).toEqual({ count: 2 });
    expect(
      await narrowed.o1.notes.count({
        where: { or: [{ rank: { eq: 1 } }, { rank: { eq: 3 } }] },
      }),
    ).toEqual({ count: 1 });
  });

  it('counts the caller’s tenant only; a bypass counts across tenants', async () => {
    const { o1, o2, support, repos, logger } = setup();
    await notesIn(repos, 'o1', [1, 2]);
    await notesIn(repos, 'o2', [1, 2, 3]);

    expect(await o1.notes.count({})).toEqual({ count: 2 });
    expect(await o2.notes.count({})).toEqual({ count: 3 });
    expect(await support.notes.count({})).toEqual({ count: 5 });
    expect(
      await support.notes.count({ where: { organizationId: { eq: 'o2' } } }),
    ).toEqual({ count: 3 });
    expect(logger.records).toContainEqual(
      expect.objectContaining({
        message: 'tenancy.bypass',
        fields: expect.objectContaining({
          collection: 'notes',
          action: 'count',
        }),
      }),
    );
  });

  it('validates where as find does', async () => {
    const { o1 } = setup();
    expect(
      // @ts-expect-error "nope" is not a field of notes
      await codeOf(o1.notes.count({ where: { nope: { eq: 1 } } })),
    ).toBe('VALIDATION');
    expect(
      // @ts-expect-error contains is not an operator of a number
      await codeOf(o1.notes.count({ where: { rank: { contains: '1' } } })),
    ).toBe('VALIDATION');
  });

  it('writes one log line and publishes no event', async () => {
    const { o1, logger, published } = setup();

    await o1.notes.count({});

    expect(logger.records).toMatchObject([
      {
        level: 'info',
        message: 'notes.count',
        fields: {
          collection: 'notes',
          action: 'count',
          tenantId: 'o1',
          outcome: 'ok',
        },
      },
    ]);
    expect(published).toEqual([]);
  });

  it('works on a global collection, and through Repo.count', async () => {
    const { app, repos } = framework({ family: AppUseCase })
      .collection(Labels, { access: open })
      .build({
        store: new MemoryStore(),
        events: { publish: async (_event: object) => {} },
      });
    for (const rank of [1, 2, 3]) {
      await repos.labels.insert({ name: `l${rank}`, rank }, unscoped);
    }
    const local = createLocalClient(app, { context: callContext() });

    expect(await local.labels.count({ where: { rank: { gte: 2 } } })).toEqual({
      count: 2,
    });
    expect(await repos.labels.count({ rank: { lt: 3 } }, unscoped)).toBe(2);
    expect(await repos.labels.count({}, unscoped)).toBe(3);
  });

  it('Repo.count runs under its scope', async () => {
    const { repos } = setup();
    await notesIn(repos, 'o1', [1, 2]);
    await notesIn(repos, 'o2', [1]);

    expect(await repos.notes.count({}, tenancy.scope(Notes, 'o1'))).toBe(2);
    expect(await repos.notes.count({ rank: { eq: 1 } }, unscoped)).toBe(2);
  });
});

describe('count overrides and names', () => {
  class FixedCount extends AppUseCase('labels.count', { collection: Labels }) {
    async execute(): Promise<{ count: number }> {
      return { count: 42 };
    }
  }

  it('can be overridden like any generated operation', async () => {
    const { app } = framework({ family: AppUseCase })
      .collection(Labels, { access: open, overrides: { count: FixedCount } })
      .build({
        store: new MemoryStore(),
        events: { publish: async (_event: object) => {} },
        overrides: () => ({ labels: { count: new FixedCount() } }),
      });
    const local = createLocalClient(app, { context: callContext() });

    expect(await local.labels.count({})).toEqual({ count: 42 });
  });

  it('a method named count is a compile error and a throw', () => {
    class CountMethod extends AppUseCase('labels.count', {
      collection: Labels,
      input: z.object({}),
      output: z.object({ count: z.number() }),
    }) {
      async execute(): Promise<{ count: number }> {
        return { count: 0 };
      }
    }
    expect(() =>
      framework({ family: AppUseCase }).collection(Labels, {
        access: { ...open, count: () => true },
        // @ts-expect-error "count" is a generated operation, an access key or a ts-pf implementer key
        methods: { count: CountMethod },
      }),
    ).toThrow('Lattice: "labels.count" cannot be a method name');
  });
});
