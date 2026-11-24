import { NoopLogger } from '@hexok/logger';
import { isPFError } from '@ts-pf/protocol';
import { createLocalClient } from '@ts-pf/server';
import { FetchHandler } from '@ts-pf/server-http';
import { Adapter, type UseCase } from 'hexok';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  Access,
  type ClientDoc,
  collection,
  type Doc,
  family,
  framework,
  MemoryStore,
  many,
  type Repo,
  ref,
  unscoped,
} from './index.js';

type Role = 'member' | 'manager';
const actorSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['member', 'manager']),
});
const Family = family({
  actor: actorSchema,
  actorId: (actor) => actor.userId,
});
type Ctx = UseCase.Ctx<typeof Family>;

const Deals = collection('deals', {
  schema: z.object({
    title: z.string(),
    amount: z.number(),
    stage: z.enum(['lead', 'won']),
  }),
  maskable: ['amount'],
});
const Tasks = collection('tasks', {
  schema: z.object({ title: z.string(), dealId: ref('deals') }),
});
const Boards = collection('boards', {
  schema: z.object({ name: z.string() }),
  relations: { deals: many('deals', { through: 'board_deals' }) },
});

/** A method that returns one deal as a client may receive it. */
class Peek extends Family('deals.peek', {
  collection: Deals,
  input: z.object({ id: z.string() }),
  output: Deals.clientOutput,
  summary: 'Show one deal.',
  effect: 'read',
}) {
  constructor(private readonly deals: () => Promise<Doc<typeof Deals>>) {
    super();
  }
  async execute(_ctx: Ctx, _input: { id: string }) {
    return this.deals();
  }
}

/** A method whose output extends the client document. */
class Summary extends Family('deals.summary', {
  collection: Deals,
  input: z.object({}),
  output: Deals.clientOutput.extend({ note: z.string() }),
  summary: 'Summarize a deal.',
  effect: 'read',
}) {
  constructor(private readonly deals: () => Promise<Doc<typeof Deals>>) {
    super();
  }
  async execute(_ctx: Ctx, _input: Record<string, never>) {
    return { ...(await this.deals()), note: 'n' };
  }
}

/** A method that names the masked field under another key. */
class Renamed extends Family('deals.renamed', {
  collection: Deals,
  input: z.object({}),
  output: z.object({ dealAmount: Deals.clientOutput.shape.amount }),
  summary: "Show a deal's amount.",
  effect: 'read',
}) {
  constructor(private readonly deals: () => Promise<Doc<typeof Deals>>) {
    super();
  }
  async execute(_ctx: Ctx, _input: Record<string, never>) {
    return { dealAmount: (await this.deals()).amount };
  }
}

const open = {
  read: () => true,
  create: () => true,
  update: () => true,
  delete: () => true,
};

/**
 * The app: deals with a masked amount, tasks that refer to deals, boards
 * related to deals, and three methods. `reads` counts the rule's calls.
 */
async function app(options: { readonly access?: Access<unknown> } = {}) {
  const reads: string[] = [];
  const published: unknown[] = [];
  let first: () => Promise<Doc<typeof Deals>> = async () => {
    throw new Error('no deal yet');
  };
  const latest = () => first();
  const built = framework({ family: Family })
    .collection(Deals, {
      access: {
        ...open,
        peek: () => true,
        summary: () => true,
        renamed: () => true,
      },
      fields: {
        amount: {
          read: async ({ actor }) => {
            reads.push(actor.userId);
            return actor.role === 'manager';
          },
        },
      },
      methods: { peek: Peek, summary: Summary, renamed: Renamed },
    })
    .collection(Tasks, { access: open })
    .collection(Boards, { access: open })
    .build({
      store: new MemoryStore(),
      events: {
        async publish(event: { readonly payload: unknown }) {
          published.push(event.payload);
        },
      },
      ...(options.access === undefined ? {} : { access: options.access }),
      methods: () => ({
        deals: {
          peek: new Peek(latest),
          summary: new Summary(latest),
          renamed: new Renamed(latest),
        },
      }),
    });
  const deal = await built.repos.deals.insert(
    { title: 'big', amount: 4242, stage: 'lead' },
    unscoped,
  );
  first = async () => {
    const found = await built.repos.deals.get(deal.id, unscoped);
    if (found === null) throw new Error('gone');
    return found;
  };
  const http = new FetchHandler(built.app);
  /** One RPC call as `role`, and its JSON body. */
  async function rpc(role: Role, path: string, input: unknown) {
    const result = await http.handle(
      new Request(`http://localhost/rpc/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input }),
      }),
      {
        prefix: '/rpc',
        context: () => ({
          actor: { userId: role, role },
          logger: new NoopLogger(),
        }),
      },
    );
    if (!result.matched) throw new Error(`no route ${path}`);
    const body: unknown = await result.response.json();
    return body;
  }
  return { ...built, deal, reads, published, rpc };
}

/** The output of a successful RPC body. */
function outputOf(body: unknown): unknown {
  if (
    typeof body === 'object' &&
    body !== null &&
    'ok' in body &&
    body.ok === true &&
    'output' in body
  ) {
    return body.output;
  }
  throw new Error(`not ok: ${JSON.stringify(body)}`);
}

/** Whether any object in `value` has the key `key`, at any depth. */
function hasKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((item) => hasKey(item, key));
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(value).some(
    ([name, item]) => name === key || hasKey(item, key),
  );
}

describe('masking a field a caller may not read', () => {
  it('withholds it from a member on every read and write, and gives it to a manager', async () => {
    const { rpc, deal } = await app();
    const calls: [string, unknown][] = [
      ['deals/get', { id: deal.id }],
      ['deals/find', {}],
      ['deals/create', { title: 'new', amount: 7, stage: 'lead' }],
      ['deals/update', { id: deal.id, stage: 'won' }],
    ];

    for (const [path, input] of calls) {
      expect(
        hasKey(outputOf(await rpc('member', path, input)), 'amount'),
        path,
      ).toBe(false);
      expect(
        hasKey(outputOf(await rpc('manager', path, input)), 'amount'),
        path,
      ).toBe(true);
    }
    const removed = outputOf(
      await rpc('member', 'deals/delete', { id: deal.id }),
    );
    expect(removed).toMatchObject({ id: deal.id, title: 'big' });
    expect(hasKey(removed, 'amount')).toBe(false);
  });

  it('masks a populated target under the target’s rule: a ref, a relation and a list', async () => {
    const { rpc, repos, deal } = await app();
    const task = await repos.tasks.insert(
      { title: 't', dealId: deal.id },
      unscoped,
    );
    const board = await repos.boards.insert({ name: 'b' }, unscoped);
    await repos.board_deals.insert(
      { boardsId: board.id, dealsId: deal.id },
      unscoped,
    );

    for (const role of ['member', 'manager'] satisfies Role[]) {
      const outputs = [
        await rpc(role, 'tasks/get', { id: task.id, populate: ['dealId'] }),
        await rpc(role, 'tasks/find', { populate: ['dealId'] }),
        await rpc(role, 'boards/get', { id: board.id, populate: ['deals'] }),
        await rpc(role, 'boards/deals/list', {
          id: board.id,
          populate: ['dealsId'],
        }),
      ].map(outputOf);
      for (const output of outputs) {
        // The target was populated: its title is there.
        expect(JSON.stringify(output)).toContain('"big"');
        expect(hasKey(output, 'amount')).toBe(role === 'manager');
      }
    }
  });

  it('masks the output of an override’s and a method’s documents, however the schema was built', async () => {
    const { rpc, deal } = await app();

    for (const path of ['deals/peek', 'deals/summary']) {
      const output = outputOf(await rpc('member', path, { id: deal.id }));
      expect(output).toMatchObject({ title: 'big' });
      expect(hasKey(output, 'amount')).toBe(false);
    }
    // A field read from clientOutput.shape keeps its mark under a new key.
    expect(outputOf(await rpc('member', 'deals/renamed', {}))).toEqual({});
    expect(outputOf(await rpc('manager', 'deals/renamed', {}))).toEqual({
      dealAmount: 4242,
    });
  });

  it('types a client’s field as optional, and masks it through the local client', async () => {
    const { app: router, deal } = await app();
    const local = createLocalClient(router, {
      context: {
        actor: { userId: 'm', role: 'member' },
        logger: new NoopLogger(),
      },
    });

    const got = await local.deals.get({ id: deal.id });

    expectTypeOf(got.amount).toEqualTypeOf<number | undefined>();
    expect(got).not.toHaveProperty('amount');
    expectTypeOf<Doc<typeof Deals>['amount']>().toEqualTypeOf<number>();
    expectTypeOf<ClientDoc<typeof Deals>['amount']>().toEqualTypeOf<
      number | undefined
    >();
  });

  it('keeps the whole document for server code: direct use cases, repos and events', async () => {
    const { useCases, context, repos, published, deal } = await app();
    const ctx = context({
      actor: { userId: 'm', role: 'member' },
      logger: new NoopLogger(),
    });

    const direct = await useCases.deals.get.execute(ctx, { id: deal.id });
    await useCases.deals.update.execute(ctx, { id: deal.id, stage: 'won' });

    expect(direct).toMatchObject({ amount: 4242 });
    expect(await repos.deals.get(deal.id, unscoped)).toMatchObject({
      amount: 4242,
    });
    expect(published).toMatchObject([{ doc: { amount: 4242 } }]);
  });

  it('asks the rule once per call per collection, through population too', async () => {
    const { rpc, repos, deal, reads } = await app();
    await repos.deals.insert(
      { title: 'second', amount: 1, stage: 'lead' },
      unscoped,
    );
    const task = await repos.tasks.insert(
      { title: 't', dealId: deal.id },
      unscoped,
    );

    await rpc('member', 'deals/find', {});
    expect(reads).toEqual(['member']);
    reads.length = 0;
    await rpc('member', 'tasks/get', { id: task.id, populate: ['dealId'] });
    expect(reads).toEqual(['member']);
  });

  it('withholds every maskable field when an Access adapter returns none', async () => {
    class Nothing extends Adapter(Access) {
      override async check(): Promise<boolean> {
        return true;
      }
      override async readable(): Promise<readonly string[]> {
        return [];
      }
    }
    const { rpc, deal } = await app({ access: new Nothing() });

    const output = outputOf(await rpc('manager', 'deals/get', { id: deal.id }));

    expect(hasKey(output, 'amount')).toBe(false);
  });

  it('describes the field in JSON Schema: optional for clients, required when stored', () => {
    const client = z.toJSONSchema(Deals.clientOutput);
    const stored = z.toJSONSchema(Deals.output);

    expect(client.required).not.toContain('amount');
    expect(JSON.stringify(client)).toContain(
      'Withheld when the caller may not read it.',
    );
    expect(stored.required).toContain('amount');
  });
});

describe('no query reveals a field a caller may not read', () => {
  /** The error code of an RPC body, or the number of rows it counted. */
  function answerOf(body: unknown): unknown {
    if (typeof body !== 'object' || body === null) return body;
    if ('error' in body) return body.error;
    return outputOf(body);
  }

  it('refuses every filter and sort on it with one VALIDATION, so a bisection learns nothing', async () => {
    const { rpc } = await app();
    const answers = new Set<string>();
    /** Every count and find a bisection could send for `value`. */
    const probes = (value: number): [string, unknown][] => [
      ...['gt', 'gte', 'lt', 'lte', 'eq', 'ne'].map((op): [string, unknown] => [
        'deals/count',
        { where: { amount: { [op]: value } } },
      ]),
      ['deals/count', { where: { amount: { in: [value] } } }],
      ['deals/count', { where: { amount: { nin: [value] } } }],
      ['deals/count', { where: { amount: { exists: value > 0 } } }],
      ['deals/count', { where: { and: [{ amount: { gt: value } }] } }],
      [
        'deals/count',
        {
          where: { or: [{ stage: { eq: 'lead' } }, { amount: { lt: value } }] },
        },
      ],
      ['deals/find', { where: { amount: { gt: value } } }],
    ];

    // A binary search for the amount: each answer must not depend on it.
    let low = 0;
    let high = 10_000;
    let recovered: number | undefined;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      for (const [path, input] of probes(middle)) {
        answers.add(JSON.stringify(answerOf(await rpc('member', path, input))));
      }
      const counted = answerOf(
        await rpc('member', 'deals/count', {
          where: { amount: { gt: middle } },
        }),
      );
      if (
        typeof counted !== 'object' ||
        counted === null ||
        !('count' in counted)
      ) {
        break;
      }
      if (counted.count === 1) low = middle + 1;
      else high = middle;
      recovered = low;
    }

    expect(recovered).toBeUndefined();
    for (const sort of [['amount'], ['-amount'], ['title', 'amount']]) {
      expect(
        answerOf(await rpc('member', 'deals/find', { sort })),
      ).toMatchObject({
        code: 'VALIDATION',
      });
    }
    // Each probe got VALIDATION naming the field, whatever value it tried.
    expect(
      [...answers].every(
        (answer) =>
          answer.includes('"is not readable"') ||
          answer.includes('is not readable'),
      ),
    ).toBe(true);
    expect(
      new Set([...answers].map((answer) => JSON.parse(answer).code)),
    ).toEqual(new Set(['VALIDATION']));
  });

  it('refuses a hand-made cursor for a sort on it', async () => {
    const { rpc } = await app();
    const cursor = Buffer.from(
      JSON.stringify({ sort: ['amount', 'id'], values: [4000, 'z'] }),
    ).toString('base64url');

    const answer = answerOf(
      await rpc('member', 'deals/find', { sort: ['amount'], after: cursor }),
    );

    expect(answer).toMatchObject({ code: 'VALIDATION' });
  });

  it('lets a manager filter and sort by it', async () => {
    const { rpc } = await app();

    expect(
      answerOf(
        await rpc('manager', 'deals/count', {
          where: { amount: { gt: 4000 } },
        }),
      ),
    ).toEqual({ count: 1 });
    expect(
      answerOf(await rpc('manager', 'deals/find', { sort: ['-amount'] })),
    ).toMatchObject({ docs: [{ amount: 4242 }] });
  });
});

describe('no update changes a field a caller may not read (0035)', () => {
  const Notes = collection('notes', {
    schema: z.object({ title: z.string(), secret: z.string().optional() }),
    maskable: ['secret'],
  });
  const Memos = collection('memos', {
    schema: z.object({ title: z.string(), secret: z.string().optional() }),
    maskable: ['secret'],
  });

  /** An override of memos' update: it writes the title only. */
  class MemoUpdate extends Family('memos.update', { collection: Memos }) {
    constructor(private readonly memos: Repo<typeof Memos>) {
      super();
    }
    async execute(
      _ctx: Ctx,
      input: {
        id: string;
        title?: string | undefined;
        secret?: string | null | undefined;
      },
    ): Promise<Doc<typeof Memos>> {
      const updated = await this.memos.update(
        input.id,
        { title: input.title ?? '' },
        unscoped,
      );
      if (updated === null) throw new Error('no memo');
      return updated;
    }
  }

  const managers = {
    read: ({ actor }: { actor: { role: Role } }) => actor.role === 'manager',
  };

  function setup() {
    const built = framework({ family: Family })
      .collection(Notes, { access: open, fields: { secret: managers } })
      .collection(Memos, {
        access: open,
        fields: { secret: managers },
        overrides: { update: MemoUpdate },
      })
      .build({
        store: new MemoryStore(),
        events: { publish: async (_event: object) => {} },
        overrides: ({ repos }) => ({
          memos: { update: new MemoUpdate(repos.memos) },
        }),
      });
    const as = (role: Role) =>
      createLocalClient(built.app, {
        context: { actor: { userId: role, role }, logger: new NoopLogger() },
      });
    return { ...built, member: as('member'), manager: as('manager') };
  }

  /** The code and data a call is refused with. */
  async function refusal(call: Promise<unknown>) {
    const error = await call.then(
      () => undefined,
      (caught: unknown) => caught,
    );
    return isPFError(error) ? { code: error.code, data: error.data } : error;
  }

  const refused = {
    code: 'VALIDATION',
    data: {
      issues: [
        {
          path: ['secret'],
          message: '"secret" is not readable, so it cannot be changed',
        },
      ],
    },
  };

  it('refuses a value or a null on it from a non-reader, and leaves the document as it was', async () => {
    const { member, repos } = setup();
    const note = await repos.notes.insert(
      { title: 't', secret: 's' },
      unscoped,
    );

    for (const secret of ['other', null]) {
      expect(
        await refusal(member.notes.update({ id: note.id, secret })),
      ).toEqual(refused);
    }
    expect(await repos.notes.get(note.id, unscoped)).toEqual(note);
    // A patch that leaves the field out goes through.
    expect(
      await member.notes.update({ id: note.id, title: 'u' }),
    ).toMatchObject({ title: 'u' });
  });

  it('lets a reader change it and clear it', async () => {
    const { manager, repos } = setup();
    const note = await repos.notes.insert(
      { title: 't', secret: 's' },
      unscoped,
    );

    expect(
      await manager.notes.update({ id: note.id, secret: 'other' }),
    ).toMatchObject({ secret: 'other' });
    const cleared = await manager.notes.update({ id: note.id, secret: null });
    expect(cleared).not.toHaveProperty('secret');
    expect(await repos.notes.get(note.id, unscoped)).not.toHaveProperty(
      'secret',
    );
  });

  it('refuses it the same way on an override’s update', async () => {
    const { member, manager, repos } = setup();
    const memo = await repos.memos.insert(
      { title: 't', secret: 's' },
      unscoped,
    );

    expect(
      await refusal(member.memos.update({ id: memo.id, secret: 'other' })),
    ).toEqual(refused);
    expect(
      await refusal(member.memos.update({ id: memo.id, secret: null })),
    ).toEqual(refused);
    expect(
      await manager.memos.update({ id: memo.id, title: 'u', secret: 'x' }),
    ).toMatchObject({ title: 'u' });
  });

  it('leaves create’s blind writes alone', async () => {
    const { member, repos } = setup();
    const created = await member.notes.create({ title: 't', secret: 's' });
    expect(created).not.toHaveProperty('secret');
    expect(await repos.notes.get(created.id, unscoped)).toMatchObject({
      secret: 's',
    });
  });
});

describe('declaring masks', () => {
  it('refuses a maskable ref, a maskable field in a unique index, and an unknown field', () => {
    expect(() =>
      collection('a', {
        schema: z.object({ other: ref('deals') }),
        maskable: ['other'],
      }),
    ).toThrow('a.other is a ref; it cannot be maskable');
    expect(() =>
      collection('b', {
        schema: z.object({ email: z.string() }),
        maskable: ['email'],
        indexes: [{ fields: { email: 1 }, unique: true }],
      }),
    ).toThrow('b.email is maskable, so it cannot be in a unique index');
    expect(() =>
      collection('c', {
        schema: z.object({ name: z.string() }),
        // @ts-expect-error salary is not a field
        maskable: ['salary'],
      }),
    ).toThrow('maskable "salary" is not a field of c');
  });

  it('needs exactly one fields rule per maskable field', () => {
    const base = framework({ family: Family });
    expect(() =>
      // @ts-expect-error fields is required for a collection with a maskable field
      base.collection(Deals, { access: open }),
    ).toThrow('deals needs exactly one fields rule for each maskable field');
    expect(() =>
      base.collection(Deals, {
        access: open,
        fields: {
          amount: { read: () => true },
          // @ts-expect-error title is not maskable
          title: { read: () => true },
        },
      }),
    ).toThrow('deals needs exactly one fields rule for each maskable field');
  });

  /** A build with one method whose output is `output`. */
  function withOutput(output: z.ZodType) {
    class Method extends Family('deals.method', {
      collection: Deals,
      input: z.object({}),
      output,
      summary: 'A method.',
      effect: 'read',
    }) {
      async execute(_ctx: Ctx, _input: Record<string, never>): Promise<never> {
        throw new Error('not called');
      }
    }
    return () =>
      framework({ family: Family })
        .collection(Deals, {
          access: { ...open, method: () => true },
          fields: { amount: { read: () => true } },
          methods: { method: Method },
        })
        .build({
          store: new MemoryStore(),
          events: { async publish(_event: object) {} },
          methods: () => ({ deals: { method: new Method() } }),
        });
  }

  it('throws at build for an output that would send the field where it is required', () => {
    const required = [
      Deals.output,
      Deals.output.pick({ amount: true }),
      z.object({ amount: Deals.output.shape.amount }),
      z.object({ list: z.array(Deals.output) }),
      z.object({ value: Deals.output.shape.amount.nullable() }),
    ];
    for (const output of required) {
      expect(withOutput(output)).toThrow('deals.amount where it is required');
    }
  });

  it('throws at build for an output it cannot see through', () => {
    for (const output of [
      z.lazy(() => Deals.clientOutput),
      Deals.clientOutput.transform((doc) => doc),
      z.object({ any: z.unknown() }),
    ]) {
      expect(withOutput(output)).toThrow('which Lattice cannot see through');
    }
  });

  it('builds an output that holds the field optionally, however it was cloned', () => {
    for (const output of [
      Deals.clientOutput,
      Deals.clientOutput.extend({ note: z.string() }),
      Deals.clientOutput.pick({ amount: true }),
      z.object({ list: z.array(Deals.clientOutput) }),
      z.union([Deals.clientOutput, z.object({ id: z.string() })]),
    ]) {
      expect(withOutput(output)).not.toThrow();
    }
  });
});
