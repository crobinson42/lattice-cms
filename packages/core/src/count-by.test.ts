import { MemoryLogger } from '@hexok/logger';
import { isPFError } from '@ts-pf/protocol';
import { createLocalClient } from '@ts-pf/server';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { LatticeError } from './errors.js';
import { AppUseCase } from './fixtures/context.js';
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

const actorSchema = z.object({
  userId: z.string(),
  organizationId: z.string(),
  role: z.enum(['member', 'manager']).optional(),
  support: z.boolean().optional(),
});
type Actor = z.output<typeof actorSchema>;

const Tenanted = family({
  actor: actorSchema,
  actorId: (actor) => actor.userId,
  tenantOf: (actor) =>
    actor.support === true ? tenancy.bypass : actor.organizationId,
});

const Tickets = collection('tickets', {
  schema: z.object({
    title: z.string(),
    status: z.enum(['open', 'closed']),
    projectId: z.string(),
    assignee: z.string().nullable().optional(),
    points: z.number(),
    urgent: z.boolean(),
    labels: z.array(z.string()),
    meta: z.object({ source: z.string() }).optional(),
    budget: z.number().optional(),
  }),
  tenant: 'organizationId',
  maskable: ['budget'],
});

type Ticket = z.output<typeof Tickets.output>;

const open = {
  read: () => true,
  create: () => true,
  update: () => true,
  delete: () => true,
};

const alice: Actor = { userId: 'a', organizationId: 'o1', role: 'manager' };
const bob: Actor = { userId: 'b', organizationId: 'o1', role: 'member' };
const carol: Actor = { userId: 'c', organizationId: 'o2', role: 'manager' };
const staff: Actor = { userId: 's', organizationId: 'o0', support: true };

/** The code and data a call is refused with, or 'ok'. */
async function refusal(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => 'ok',
    (error) =>
      isPFError(error) || LatticeError.is(error)
        ? { code: error.code, data: error.data }
        : error,
  );
}

const ticket = (
  fields: Partial<z.input<typeof Tickets.schema>> = {},
): z.input<typeof Tickets.schema> => ({
  title: 't',
  status: 'open',
  projectId: 'p1',
  points: 1,
  urgent: false,
  labels: [],
  ...fields,
});

function setup(read: () => boolean | Where<Ticket> = () => true) {
  const logger = new MemoryLogger();
  const built = framework({ family: Tenanted })
    .collection(Tickets, {
      access: { ...open, read },
      fields: {
        budget: { read: ({ actor }) => actor.role === 'manager' },
      },
    })
    .build({
      store: new MemoryStore(),
      events: { publish: async (_event: object) => {} },
    });
  const as = (actor: Actor) =>
    createLocalClient(built.app, { context: { actor, logger } });
  const seed = async (
    organizationId: string,
    docs: z.input<typeof Tickets.schema>[],
  ) => {
    const scope = tenancy.scope(Tickets, organizationId);
    for (const doc of docs) await built.repos.tickets.insert(doc, scope);
  };
  return {
    ...built,
    logger,
    seed,
    alice: as(alice),
    bob: as(bob),
    carol: as(carol),
    support: as(staff),
  };
}

describe('countBy', () => {
  it('counts by a field, most first, and types its result', async () => {
    const { seed, alice } = setup();
    await seed('o1', [
      ticket({ status: 'open', assignee: 'x', projectId: 'p1' }),
      ticket({ status: 'open', assignee: null, projectId: 'p2' }),
      ticket({ status: 'closed', projectId: 'p2' }),
      ticket({ status: 'open', assignee: 'x', projectId: 'p2' }),
    ]);

    expect(await alice.tickets.countBy({ field: 'status' })).toEqual({
      groups: [
        { key: 'open', count: 3 },
        { key: 'closed', count: 1 },
      ],
      more: false,
    });
    expect((await alice.tickets.countBy({ field: 'assignee' })).groups).toEqual(
      [
        { key: null, count: 2 },
        { key: 'x', count: 2 },
      ],
    );
    expectTypeOf(alice.tickets.countBy).returns.resolves.toEqualTypeOf<{
      groups: { key: string | number | boolean | null; count: number }[];
      more: boolean;
    }>();
  });

  it('counts the ids of many parents in one call', async () => {
    const { seed, alice } = setup();
    await seed('o1', [
      ticket({ projectId: 'p1' }),
      ticket({ projectId: 'p2' }),
      ticket({ projectId: 'p2' }),
      ticket({ projectId: 'p3' }),
    ]);

    expect(
      await alice.tickets.countBy({
        field: 'projectId',
        where: { projectId: { in: ['p1', 'p2'] } },
      }),
    ).toEqual({
      groups: [
        { key: 'p2', count: 2 },
        { key: 'p1', count: 1 },
      ],
      more: false,
    });
  });

  it('counts each label once per document, booleans and numbers by value', async () => {
    const { seed, alice } = setup();
    await seed('o1', [
      ticket({ labels: ['bug', 'ui', 'bug'], urgent: true, points: 3 }),
      ticket({ labels: ['bug'], points: 3 }),
      ticket({ labels: [], points: 1 }),
    ]);

    expect((await alice.tickets.countBy({ field: 'labels' })).groups).toEqual([
      { key: 'bug', count: 2 },
      { key: null, count: 1 },
      { key: 'ui', count: 1 },
    ]);
    expect((await alice.tickets.countBy({ field: 'urgent' })).groups).toEqual([
      { key: false, count: 2 },
      { key: true, count: 1 },
    ]);
    expect((await alice.tickets.countBy({ field: 'points' })).groups).toEqual([
      { key: 3, count: 2 },
      { key: 1, count: 1 },
    ]);
  });

  it('cuts at limit and says there are more', async () => {
    const { seed, alice } = setup();
    await seed('o1', [
      ticket({ projectId: 'p1' }),
      ticket({ projectId: 'p2' }),
      ticket({ projectId: 'p2' }),
    ]);

    expect(
      await alice.tickets.countBy({ field: 'projectId', limit: 1 }),
    ).toEqual({ groups: [{ key: 'p2', count: 2 }], more: true });
  });

  it('refuses a field it cannot count by, and a limit past 1000', async () => {
    const { alice } = setup();
    const issue = (input: unknown) =>
      // biome-ignore lint/suspicious/noExplicitAny: bad input on purpose
      refusal(alice.tickets.countBy(input as any));

    expect(await issue({ field: 'nope' })).toMatchObject({
      code: 'VALIDATION',
      data: {
        issues: [
          {
            path: ['field'],
            message: '"nope" is not a field to count by',
          },
        ],
      },
    });
    expect(await issue({ field: 'meta' })).toMatchObject({
      code: 'VALIDATION',
      data: {
        issues: [
          {
            path: ['field'],
            message:
              '"meta" cannot be counted by: it is not a string, number, enum, boolean or an array of them',
          },
        ],
      },
    });
    expect(await issue({ field: 'id' })).toMatchObject({
      code: 'VALIDATION',
    });
    expect(await issue({ field: 'status', limit: 1001 })).toMatchObject({
      code: 'VALIDATION',
      data: { issues: [{ path: ['limit'] }] },
    });
    // @ts-expect-error meta is an object
    await refusal(alice.tickets.countBy({ field: 'meta' }));
    // @ts-expect-error createdAt is a system field
    await refusal(alice.tickets.countBy({ field: 'createdAt' }));
  });

  it('runs read access: false is FORBIDDEN, and a Where narrows the count', async () => {
    const denied = setup(() => false);
    expect(
      await refusal(denied.alice.tickets.countBy({ field: 'status' })),
    ).toMatchObject({ code: 'FORBIDDEN' });

    const narrowed = setup(() => ({ points: { gt: 1 } }));
    await narrowed.seed('o1', [
      ticket({ status: 'open', points: 1 }),
      ticket({ status: 'open', points: 2 }),
      ticket({ status: 'closed', points: 2 }),
    ]);
    expect(
      (await narrowed.alice.tickets.countBy({ field: 'status' })).groups,
    ).toEqual([
      { key: 'closed', count: 1 },
      { key: 'open', count: 1 },
    ]);
  });

  it('counts within the caller’s tenant; only a bypass counts by the tenant field', async () => {
    const { seed, alice, carol, support } = setup();
    await seed('o1', [ticket({ status: 'open' }), ticket({ status: 'open' })]);
    await seed('o2', [ticket({ status: 'closed' })]);

    expect((await alice.tickets.countBy({ field: 'status' })).groups).toEqual([
      { key: 'open', count: 2 },
    ]);
    expect((await carol.tickets.countBy({ field: 'status' })).groups).toEqual([
      { key: 'closed', count: 1 },
    ]);
    expect(
      await refusal(alice.tickets.countBy({ field: 'organizationId' })),
    ).toEqual({
      code: 'VALIDATION',
      data: {
        issues: [
          {
            path: ['field'],
            message:
              '"organizationId" is the tenant field: only a call that bypasses tenancy counts by it',
          },
        ],
      },
    });
    expect(await support.tickets.countBy({ field: 'organizationId' })).toEqual({
      groups: [
        { key: 'o1', count: 2 },
        { key: 'o2', count: 1 },
      ],
      more: false,
    });
  });

  it('refuses a withheld field or where, as VALIDATION', async () => {
    const { seed, alice, bob } = setup();
    await seed('o1', [ticket({ budget: 5 }), ticket({ budget: 5 })]);
    const notReadable = {
      code: 'VALIDATION',
      data: {
        issues: [{ path: ['field'], message: '"budget" is not readable' }],
      },
    };

    expect(await refusal(bob.tickets.countBy({ field: 'budget' }))).toEqual(
      notReadable,
    );
    expect(
      await refusal(
        bob.tickets.countBy({
          field: 'status',
          where: { budget: { gt: 1 } },
        }),
      ),
    ).toEqual({
      code: 'VALIDATION',
      data: {
        issues: [
          { path: ['where', 'budget'], message: '"budget" is not readable' },
        ],
      },
    });
    expect((await alice.tickets.countBy({ field: 'budget' })).groups).toEqual([
      { key: 5, count: 2 },
    ]);
  });

  it('writes one log line', async () => {
    const { alice, logger } = setup();
    await alice.tickets.countBy({ field: 'status' });
    expect(logger.records).toMatchObject([
      {
        message: 'tickets.countBy',
        fields: { collection: 'tickets', action: 'countBy', outcome: 'ok' },
      },
    ]);
  });
});

describe('Repo.countBy', () => {
  it('runs under its scope and types the key from the field', async () => {
    const { seed, repos } = setup();
    await seed('o1', [
      ticket({ status: 'open', labels: ['a'] }),
      ticket({ status: 'closed', labels: ['a', 'b'] }),
    ]);
    await seed('o2', [ticket({ status: 'open' })]);
    const tickets: Repo<typeof Tickets> = repos.tickets;

    const inO1 = await tickets.countBy(
      { field: 'status' },
      tenancy.scope(Tickets, 'o1'),
    );
    expect(inO1).toEqual({
      groups: [
        { key: 'closed', count: 1 },
        { key: 'open', count: 1 },
      ],
      more: false,
    });
    expectTypeOf(inO1.groups[0]?.key).toEqualTypeOf<
      'open' | 'closed' | null | undefined
    >();

    const labels = await tickets.countBy(
      { field: 'labels', where: { status: { eq: 'closed' } }, limit: 1 },
      unscoped,
    );
    expect(labels).toEqual({ groups: [{ key: 'a', count: 1 }], more: true });
    expectTypeOf(labels.groups[0]?.key).toEqualTypeOf<
      string | null | undefined
    >();

    // @ts-expect-error meta is not a field to count by
    void tickets.countBy({ field: 'meta' }, unscoped);
  });
});

describe('countBy names', () => {
  it('a method named countBy is a compile error and a throw', () => {
    const Labels = collection('labels', {
      schema: z.object({ name: z.string() }),
    });
    class CountByMethod extends AppUseCase('labels.countBy', {
      collection: Labels,
      input: z.object({}),
      output: z.object({}),
    }) {
      async execute(): Promise<object> {
        return {};
      }
    }
    expect(() =>
      framework({ family: AppUseCase }).collection(Labels, {
        access: { ...open, countBy: () => true },
        // @ts-expect-error "countBy" is a generated operation, an access key or a ts-pf implementer key
        methods: { countBy: CountByMethod },
      }),
    ).toThrow('Lattice: "labels.countBy" cannot be a method name');
  });
});
