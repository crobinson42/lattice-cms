import { MemoryLogger, NoopLogger } from '@hexok/logger';
import { asResult } from '@ts-pf/client';
import { createLocalClient } from '@ts-pf/server';
import type { UseCase } from 'hexok';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  type CreateInput,
  collection,
  type Doc,
  family,
  framework,
  LatticeError,
  MemoryStore,
  many,
  type UpdateInput,
  unscoped,
} from './index.js';

// An override that adds a rule, then runs the generated operation through
// `generated` (0036): the operation's body, without its guards again.

const Family = family({
  actor: z.object({
    userId: z.string().min(1),
    role: z.enum(['member', 'manager']),
  }),
  actorId: (actor) => actor.userId,
});
type Ctx = UseCase.Ctx<typeof Family>;

const Companies = collection('companies', {
  schema: z.object({ name: z.string() }),
});
const Deals = collection('deals', {
  schema: z.object({
    title: z.string().min(1),
    amount: z.number(),
    stage: z.enum(['lead', 'won']).default('lead'),
    archived: z.boolean().default(false),
    note: z.string().optional(),
  }),
  maskable: ['amount'],
});
const Boards = collection('boards', {
  schema: z.object({ name: z.string() }),
  relations: { deals: many('deals', { through: 'board_deals' }) },
});

/** Only deals.close may win a deal. */
function refuseWon(stage: string | undefined) {
  if (stage === 'won') {
    throw LatticeError.VALIDATION({
      issues: [{ path: ['stage'], message: 'Win a deal with deals.close' }],
    });
  }
}

class CreateDeal extends Family('deals.create', { collection: Deals }) {
  constructor(
    private readonly deps: {
      create: (
        ctx: Ctx,
        input: CreateInput<typeof Deals>,
      ) => Promise<Doc<typeof Deals>>;
    },
  ) {
    super();
  }
  async execute(
    ctx: Ctx,
    input: CreateInput<typeof Deals>,
  ): Promise<Doc<typeof Deals>> {
    refuseWon(input.stage);
    return this.deps.create(ctx, input);
  }
}

class UpdateDeal extends Family('deals.update', { collection: Deals }) {
  constructor(
    private readonly deps: {
      update: (
        ctx: Ctx,
        input: UpdateInput<typeof Deals>,
      ) => Promise<Doc<typeof Deals>>;
    },
  ) {
    super();
  }
  async execute(
    ctx: Ctx,
    input: UpdateInput<typeof Deals>,
  ): Promise<Doc<typeof Deals>> {
    refuseWon(input.stage);
    return this.deps.update(ctx, input);
  }
}

/** An overridden read that adds nothing: its body reads as the generated get. */
class GetDeal extends Family('deals.get', { collection: Deals }) {
  constructor(
    private readonly deps: {
      get: (ctx: Ctx, input: { id: string }) => Promise<Doc<typeof Deals>>;
    },
  ) {
    super();
  }
  async execute(ctx: Ctx, input: { id: string }): Promise<Doc<typeof Deals>> {
    return this.deps.get(ctx, input);
  }
}

type BoardLinks = { id: string; links: { dealsId: string }[] };

/** A relation operation's override: at most two deals on a board. */
class SetBoardDeals extends Family('boards.deals.set', {
  collection: Boards,
}) {
  constructor(
    private readonly deps: {
      set: (
        ctx: Ctx,
        input: BoardLinks,
      ) => Promise<{ docs: Doc<typeof Boards.relations.deals.through>[] }>;
    },
  ) {
    super();
  }
  async execute(ctx: Ctx, input: BoardLinks) {
    if (input.links.length > 2) {
      throw LatticeError.VALIDATION({
        issues: [{ path: ['links'], message: 'At most two deals' }],
      });
    }
    return this.deps.set(ctx, input);
  }
}

const open = {
  read: () => true,
  create: () => true,
  update: () => true,
  delete: () => true,
};

function setup() {
  const store = new MemoryStore();
  const published: object[] = [];
  const events = {
    async publish(event: object) {
      published.push(event);
    },
  };
  // How often the create access function ran. Create's answer depends on
  // its data, so the guard and the body both ask, and the function runs
  // once only because the data is equal.
  const asked = { create: 0 };
  const app = framework({ family: Family })
    .collection(Companies, { access: open })
    .collection(Deals, {
      access: {
        read: () => true,
        create: () => {
          asked.create += 1;
          return true;
        },
        // An archived deal cannot change.
        update: () => ({ archived: { eq: false } }),
        delete: () => true,
      },
      fields: { amount: { read: ({ actor }) => actor.role === 'manager' } },
      overrides: { create: CreateDeal, update: UpdateDeal, get: GetDeal },
    })
    .collection(Boards, {
      access: open,
      overrides: { deals: { set: SetBoardDeals } },
    })
    .build({
      store,
      events,
      overrides: ({ generated }) => ({
        deals: {
          create: new CreateDeal({ create: generated.deals.create }),
          update: new UpdateDeal({ update: generated.deals.update }),
          get: new GetDeal({ get: generated.deals.get }),
        },
        boards: {
          deals: {
            set: new SetBoardDeals({ set: generated.boards.deals.set }),
          },
        },
      }),
    });
  const as = (role: 'member' | 'manager', logger = new MemoryLogger()) =>
    createLocalClient(app.app, {
      context: { actor: { userId: 'u1', role }, logger },
    });
  return { ...app, store, published, asked, as };
}

describe('an override that calls the generated operation', () => {
  // Access answers are kept on the call's context, so how often an access
  // function ran cannot show that the guards ran once. The log line can:
  // the family writes one per use case run.
  it('runs the guards once: one log line per call, for an operation and a relation operation', async () => {
    const { as } = setup();
    const deal = await as('manager').deals.create({ title: 'A', amount: 5 });
    const board = await as('manager').boards.create({ name: 'B' });
    const logger = new MemoryLogger();

    await as('manager', logger).deals.update({ id: deal.id, title: 'B' });
    await as('manager', logger).boards.deals.set({
      id: board.id,
      links: [{ dealsId: deal.id }],
    });

    expect(logger.records).toMatchObject([
      { level: 'info', message: 'deals.update', fields: { outcome: 'ok' } },
      {
        level: 'info',
        message: 'boards.deals.set',
        fields: { outcome: 'ok' },
      },
    ]);
  });

  it('asks create access once, with the data the body writes', async () => {
    const { as, asked } = setup();

    await as('manager').deals.create({ title: 'A', amount: 5 });

    expect(asked.create).toBe(1);
  });

  it('keeps the generated update: defaults, null clears, one updated event with previous', async () => {
    const { as, published } = setup();
    const manager = as('manager');
    // CreateInput leaves the defaulted fields out; create applies them.
    const deal = await manager.deals.create({
      title: 'A',
      amount: 5,
      note: 'n',
    });
    expect(deal).toMatchObject({ stage: 'lead', archived: false });

    const updated = await manager.deals.update({ id: deal.id, note: null });

    expect(updated).not.toHaveProperty('note');
    expect(updated).toMatchObject({ id: deal.id, title: 'A', amount: 5 });
    expect(published).toHaveLength(2);
    expect(published[1]).toBeInstanceOf(Deals.events.updated);
    expect(published[1]).toMatchObject({
      payload: { doc: { id: deal.id }, previous: { note: 'n' } },
    });
  });

  it('keeps the access scope: a row outside it is NOT_FOUND', async () => {
    const { as, store } = setup();
    const manager = as('manager');
    const deal = await manager.deals.create({ title: 'A', amount: 5 });
    await store.update('deals', deal.id, { archived: true }, undefined);

    const result = await asResult(
      manager.deals.update({ id: deal.id, title: 'B' }),
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('is masked where the result leaves for the client, on a write and a read', async () => {
    const { as } = setup();
    const deal = await as('manager').deals.create({ title: 'A', amount: 5 });

    const updated = await as('member').deals.update({
      id: deal.id,
      title: 'B',
    });
    const got = await as('member').deals.get({ id: deal.id });

    for (const doc of [updated, got]) {
      expect(doc).toMatchObject({ id: deal.id, title: 'B' });
      expect(doc).not.toHaveProperty('amount');
    }
  });

  it('refuses before the call, and writes and publishes nothing', async () => {
    const { as, published, repos } = setup();
    const manager = as('manager');
    const deal = await manager.deals.create({ title: 'A', amount: 5 });

    const updated = await asResult(
      manager.deals.update({ id: deal.id, title: 'B', stage: 'won' }),
    );
    const created = await asResult(
      manager.deals.create({ title: 'C', amount: 1, stage: 'won' }),
    );

    for (const result of [updated, created]) {
      if (result.ok || result.error.code !== 'VALIDATION') {
        throw new Error('expected VALIDATION');
      }
      expect(result.error.data.issues).toEqual([
        { path: ['stage'], message: 'Win a deal with deals.close' },
      ]);
    }
    expect((await repos.deals.find({}, unscoped)).docs).toEqual([deal]);
    expect(published).toHaveLength(1);
  });

  it('works for a relation operation too', async () => {
    const { as } = setup();
    const manager = as('manager');
    const board = await manager.boards.create({ name: 'B' });
    const ids = await Promise.all(
      ['a', 'b', 'c'].map(
        async (title) => (await manager.deals.create({ title, amount: 1 })).id,
      ),
    );

    const refused = await asResult(
      manager.boards.deals.set({
        id: board.id,
        links: ids.map((dealsId) => ({ dealsId })),
      }),
    );
    const { docs } = await manager.boards.deals.set({
      id: board.id,
      links: ids.slice(0, 2).map((dealsId) => ({ dealsId })),
    });

    expect(refused).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    expect(docs.map((doc) => doc.dealsId)).toEqual(ids.slice(0, 2));
  });
});

describe('a body called from another operation’s override', () => {
  // Each body checks what its own action needs, so calling it from another
  // operation's override skips nothing.
  const Notes = collection('notes', {
    schema: z.object({ text: z.string(), secret: z.number().optional() }),
    maskable: ['secret'],
  });

  type NoteBodies = {
    create: (
      ctx: Ctx,
      input: CreateInput<typeof Notes>,
    ) => Promise<Doc<typeof Notes>>;
    update: (
      ctx: Ctx,
      input: UpdateInput<typeof Notes>,
    ) => Promise<Doc<typeof Notes>>;
  };

  /** An update that first makes a copy, through create's body. */
  class CopyThenUpdate extends Family('notes.update', { collection: Notes }) {
    constructor(private readonly deps: NoteBodies) {
      super();
    }
    async execute(
      ctx: Ctx,
      input: UpdateInput<typeof Notes>,
    ): Promise<Doc<typeof Notes>> {
      await this.deps.create(ctx, { text: 'copy' });
      return this.deps.update(ctx, input);
    }
  }

  /** A create that then sets the secret, through update's body. */
  class CreateThenSet extends Family('notes.create', { collection: Notes }) {
    constructor(private readonly deps: NoteBodies) {
      super();
    }
    async execute(
      ctx: Ctx,
      input: CreateInput<typeof Notes>,
    ): Promise<Doc<typeof Notes>> {
      const note = await this.deps.create(ctx, { text: input.text });
      return this.deps.update(ctx, { id: note.id, secret: input.secret });
    }
  }

  function notes(create: () => boolean) {
    const built = framework({ family: Family })
      .collection(Notes, {
        access: { read: () => true, create, update: () => true },
        fields: { secret: { read: ({ actor }) => actor.role === 'manager' } },
        overrides: { create: CreateThenSet, update: CopyThenUpdate },
      })
      .build({
        store: new MemoryStore(),
        events: { async publish(_event: object) {} },
        overrides: ({ generated }) => ({
          notes: {
            create: new CreateThenSet(generated.notes),
            update: new CopyThenUpdate(generated.notes),
          },
        }),
      });
    const as = (role: 'member' | 'manager') =>
      createLocalClient(built.app, {
        context: { actor: { userId: 'u1', role }, logger: new NoopLogger() },
      });
    return { ...built, as };
  }

  it('create’s body asks create access, so an update override cannot create where create is refused', async () => {
    const { as, repos } = notes(() => false);
    const note = await repos.notes.insert({ text: 'a' }, unscoped);

    const result = await asResult(
      as('manager').notes.update({ id: note.id, text: 'b' }),
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect((await repos.notes.find({}, unscoped)).docs).toEqual([note]);
  });

  it('update’s body refuses a withheld field, so a create override cannot set it', async () => {
    const { as } = notes(() => true);

    const result = await asResult(
      as('member').notes.create({ text: 'a', secret: 1 }),
    );

    if (result.ok || result.error.code !== 'VALIDATION') {
      throw new Error('expected VALIDATION');
    }
    expect(result.error.data.issues).toEqual([
      {
        path: ['secret'],
        message: '"secret" is not readable, so it cannot be changed',
      },
    ]);
  });
});

describe('create’s access answer', () => {
  // The guard and the create body both ask, and the answer is kept with
  // its data. A hook that changes the body's data in place must not change
  // what the kept answer was for.
  const Notes = collection('notes', {
    schema: z.object({ text: z.string() }),
  }).hooks({
    beforeChange: ({ data }) =>
      Object.assign(data, { text: data.text === 'c' ? 'b' : data.text }),
  });

  /**
   * Creates a 'c' note, which the hook turns into 'b' in place, then a 'b'
   * note, in the same call.
   */
  class CreateTwice extends Family('notes.create', { collection: Notes }) {
    constructor(
      private readonly deps: {
        create: (
          ctx: Ctx,
          input: CreateInput<typeof Notes>,
        ) => Promise<Doc<typeof Notes>>;
      },
    ) {
      super();
    }
    async execute(ctx: Ctx): Promise<Doc<typeof Notes>> {
      await this.deps.create(ctx, { text: 'c' });
      return this.deps.create(ctx, { text: 'b' });
    }
  }

  it('is kept for the data it was asked for, not data a hook changed', async () => {
    const asked: string[] = [];
    const built = framework({ family: Family })
      .collection(Notes, {
        access: {
          read: () => true,
          // 'b' may not be created; 'a' and 'c' may.
          create: ({ data }) => {
            asked.push(data.text);
            return data.text !== 'b';
          },
        },
        overrides: { create: CreateTwice },
      })
      .build({
        store: new MemoryStore(),
        events: { async publish(_event: object) {} },
        overrides: ({ generated }) => ({
          notes: {
            create: new CreateTwice({ create: generated.notes.create }),
          },
        }),
      });
    const local = createLocalClient(built.app, {
      context: {
        actor: { userId: 'u1', role: 'manager' },
        logger: new NoopLogger(),
      },
    });

    const result = await asResult(local.notes.create({ text: 'a' }));

    // 'a' at the guard, 'c' at the first create, and 'b' asked afresh,
    // though the 'c' data became 'b' in the hook.
    expect(asked).toEqual(['a', 'c', 'b']);
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });
});

describe('the types', () => {
  it('generated holds only the declared overrides, each typed as a direct caller sees it', () => {
    framework({ family: Family })
      .collection(Companies, { access: open })
      .collection(Deals, {
        access: open,
        fields: { amount: { read: () => true } },
        overrides: { update: UpdateDeal },
      })
      .build({
        store: new MemoryStore(),
        events: { async publish(_event: object) {} },
        overrides: ({ generated }) => {
          // Only what is overridden: no other collection, no other operation.
          expectTypeOf(generated).toHaveProperty('deals');
          expectTypeOf(generated).not.toHaveProperty('companies');
          expectTypeOf(generated.deals).toHaveProperty('update');
          expectTypeOf(generated.deals).not.toHaveProperty('create');
          expectTypeOf(generated.deals).not.toHaveProperty('find');
          expectTypeOf(generated.deals.update)
            .parameter(1)
            .toEqualTypeOf<UpdateInput<typeof Deals>>();
          expectTypeOf(generated.deals.update).returns.resolves.toEqualTypeOf<
            Doc<typeof Deals>
          >();
          return {
            deals: {
              update: new UpdateDeal({ update: generated.deals.update }),
            },
          };
        },
      });
  });

  it('the methods factory gets no generated', () => {
    class Peek extends Family('companies.peek', {
      collection: Companies,
      input: z.object({}),
      output: z.object({}),
      summary: 'Peek.',
      effect: 'read',
    }) {
      async execute() {
        return {};
      }
    }
    framework({ family: Family })
      .collection(Companies, {
        access: { ...open, peek: () => true },
        methods: { peek: Peek },
      })
      .build({
        store: new MemoryStore(),
        events: { async publish(_event: object) {} },
        methods: (wiring) => {
          expectTypeOf(wiring).not.toHaveProperty('generated');
          return { companies: { peek: new Peek() } };
        },
      });
  });

  it('CreateInput and UpdateInput leave out the tenant field', () => {
    const Tasks = collection('tasks', {
      schema: z.object({
        title: z.string(),
        done: z.boolean().default(false),
        note: z.string().optional(),
      }),
      tenant: 'orgId',
    });
    expectTypeOf<CreateInput<typeof Tasks>>().toEqualTypeOf<{
      title: string;
      done?: boolean | undefined;
      note?: string | undefined;
    }>();
    expectTypeOf<UpdateInput<typeof Tasks>>().toEqualTypeOf<{
      id: string;
      title?: string | undefined;
      done?: boolean | undefined;
      note?: string | null | undefined;
    }>();
  });
});
