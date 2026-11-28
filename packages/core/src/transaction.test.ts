import { createLocalClient } from '@ts-pf/server';
import { Adapter, type UseCase } from 'hexok';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { AppUseCase, allowAll, callContext } from './fixtures/context.js';
import {
  CollectionStore,
  collection,
  type Doc,
  framework,
  MemoryStore,
  type Repo,
  type Transaction,
  type UpdateInput,
  unscoped,
} from './index.js';

const Accounts = collection('accounts', {
  schema: z.object({ name: z.string(), balance: z.number() }),
});

const Transfers = collection('transfers', {
  schema: z.object({ from: z.string(), to: z.string(), amount: z.number() }),
});

const noEvents = { publish: async (_event: object) => {} };

/** Moves an amount between accounts, and records the transfer, as one unit. */
class Transfer extends AppUseCase('transfers.send', {
  collection: Transfers,
  input: z.object({ from: z.string(), to: z.string(), amount: z.number() }),
  output: Transfers.output,
  summary: 'Move an amount between two accounts.',
  effect: 'write',
}) {
  constructor(
    private readonly deps: {
      // Only the repos it uses: the transaction build() gives fits it.
      transaction: Transaction<{
        accounts: Repo<typeof Accounts>;
        transfers: Repo<typeof Transfers>;
      }>;
    },
  ) {
    super();
  }

  async execute(
    _ctx: UseCase.Ctx<typeof AppUseCase>,
    input: { from: string; to: string; amount: number },
  ): Promise<Doc<typeof Transfers>> {
    return this.deps.transaction(async ({ accounts, transfers }) => {
      const transfer = await transfers.insert(input, unscoped);
      for (const [id, change] of [
        [input.from, -input.amount],
        [input.to, input.amount],
      ] as const) {
        const account = await accounts.get(id, unscoped);
        if (account === null) throw new Error(`no account ${id}`);
        if (account.balance + change < 0) throw new Error('insufficient');
        await accounts.update(
          id,
          { balance: account.balance + change },
          unscoped,
        );
      }
      return transfer;
    });
  }
}

/** A store that hands its transaction's work a store of its own. */
class Recording extends Adapter(CollectionStore) {
  readonly inner = new MemoryStore();
  readonly joined: string[] = [];

  override ensure(...args: Parameters<MemoryStore['ensure']>) {
    return this.inner.ensure(...args);
  }
  override find(...args: Parameters<MemoryStore['find']>) {
    return this.inner.find(...args);
  }
  override count(...args: Parameters<MemoryStore['count']>) {
    return this.inner.count(...args);
  }
  override countBy(...args: Parameters<MemoryStore['countBy']>) {
    return this.inner.countBy(...args);
  }
  override get(...args: Parameters<MemoryStore['get']>) {
    return this.inner.get(...args);
  }
  override getMany(...args: Parameters<MemoryStore['getMany']>) {
    return this.inner.getMany(...args);
  }
  override insert(...args: Parameters<MemoryStore['insert']>) {
    return this.inner.insert(...args);
  }
  override update(...args: Parameters<MemoryStore['update']>) {
    return this.inner.update(...args);
  }
  override remove(...args: Parameters<MemoryStore['remove']>) {
    return this.inner.remove(...args);
  }
  override transaction<T>(work: (store: CollectionStore) => Promise<T>) {
    return this.inner.transaction((tx) => {
      const joined = this.joined;
      // Every call the work makes is recorded, so the test sees that the
      // repos it was given use the transaction's store.
      const spy = new Proxy(tx, {
        get(target, key, receiver) {
          const value = Reflect.get(target, key, receiver);
          if (typeof value !== 'function') return value;
          return (...args: unknown[]) => {
            joined.push(String(key));
            return value.apply(target, args);
          };
        },
      });
      return work(spy);
    });
  }
}

function setup(store: CollectionStore = new MemoryStore()) {
  const built = framework({ family: AppUseCase })
    .collection(Accounts, { access: { read: () => true } })
    .collection(Transfers, {
      access: { read: () => true, send: () => true },
      methods: { send: Transfer },
    })
    .build({
      store,
      events: noEvents,
      methods: ({ transaction }) => ({
        transfers: { send: new Transfer({ transaction }) },
      }),
    });
  return {
    ...built,
    local: createLocalClient(built.app, { context: callContext() }),
  };
}

async function accounts(repos: ReturnType<typeof setup>['repos']) {
  const a = await repos.accounts.insert({ name: 'a', balance: 10 }, unscoped);
  const b = await repos.accounts.insert({ name: 'b', balance: 0 }, unscoped);
  return { a: a.id, b: b.id };
}

describe('transaction', () => {
  it('commits every write and returns the work’s value', async () => {
    const { local, repos } = setup();
    const { a, b } = await accounts(repos);

    const transfer = await local.transfers.send({ from: a, to: b, amount: 4 });

    expect(transfer).toMatchObject({ from: a, to: b, amount: 4 });
    expect((await repos.accounts.get(a, unscoped))?.balance).toBe(6);
    expect((await repos.accounts.get(b, unscoped))?.balance).toBe(4);
  });

  it('rolls back every write when the work throws, and passes the error on', async () => {
    const { local, repos } = setup();
    const { a, b } = await accounts(repos);

    // The transfer and the debit are written before the credit's check fails.
    await expect(
      local.transfers.send({ from: b, to: a, amount: 1 }),
    ).rejects.toThrow('insufficient');

    expect((await repos.transfers.find({}, unscoped)).docs).toEqual([]);
    expect((await repos.accounts.get(a, unscoped))?.balance).toBe(10);
  });

  it('gives the work repos on the transaction’s store', async () => {
    const store = new Recording();
    const { transaction, repos } = setup(store);
    const { a } = await accounts(repos);

    await transaction(async (tx) => {
      await tx.accounts.get(a, unscoped);
      await tx.accounts.update(a, { balance: 1 }, unscoped);
    });

    expect(store.joined).toEqual(['get', 'update']);
  });

  it('is typed on build() over every repo', () => {
    const lattice = framework({ family: AppUseCase }).collection(Accounts, {
      access: {},
    });
    type Built = ReturnType<typeof lattice.build>;
    expectTypeOf<Built['transaction']>().toEqualTypeOf<
      Transaction<{ accounts: Repo<typeof Accounts> }>
    >();
  });
});

const Tickets = collection('tickets', {
  schema: z.object({ title: z.string(), status: z.string() }),
});

const Audits = collection('audits', {
  schema: z.object({ ticketId: z.string(), field: z.string() }),
});

type AppCtx = UseCase.Ctx<typeof AppUseCase>;

/** Replaces tickets.update: the generated update and one audit row per changed field, as one unit. */
class UpdateTicket extends AppUseCase('tickets.update', {
  collection: Tickets,
}) {
  constructor(
    private readonly deps: {
      // Only what it uses: the transaction the overrides factory gets fits it.
      transaction: Transaction<
        { tickets: Repo<typeof Tickets>; audits: Repo<typeof Audits> },
        {
          tickets: {
            update: (
              ctx: AppCtx,
              input: UpdateInput<typeof Tickets>,
            ) => Promise<Doc<typeof Tickets>>;
          };
        }
      >;
    },
  ) {
    super();
  }

  async execute(
    ctx: AppCtx,
    input: UpdateInput<typeof Tickets>,
  ): Promise<Doc<typeof Tickets>> {
    return this.deps.transaction(async (repos, generated) => {
      const ticket = await generated.tickets.update(ctx, input);
      for (const field of Object.keys(input).filter((key) => key !== 'id')) {
        if (field === 'status' && ticket.status === 'refused') {
          throw new Error('refused');
        }
        await repos.audits.insert({ ticketId: ticket.id, field }, unscoped);
      }
      return ticket;
    });
  }
}

/**
 * A store whose transactions fail once after `work` and run it again, as
 * MongoDB may. A transaction on the store `work` receives joins, and does
 * not retry.
 */
class RetryingOnce extends MemoryStore {
  override async transaction<T>(
    work: (store: CollectionStore) => Promise<T>,
  ): Promise<T> {
    await super
      .transaction(async (tx) => {
        await work(tx);
        throw new Error('transient');
      })
      .catch(() => {});
    return super.transaction(work);
  }
}

function overridden(store: CollectionStore = new MemoryStore()) {
  const published: object[] = [];
  const built = framework({ family: AppUseCase })
    .collection(Tickets, {
      access: allowAll,
      overrides: { update: UpdateTicket },
    })
    .collection(Audits, { access: allowAll })
    .build({
      store,
      events: {
        publish: async (event: object) => {
          published.push(event);
        },
      },
      overrides: ({ transaction }) => ({
        tickets: { update: new UpdateTicket({ transaction }) },
      }),
    });
  return {
    ...built,
    published,
    local: createLocalClient(built.app, { context: callContext() }),
  };
}

describe('transaction in an override', () => {
  it('runs the generated operation and repo writes as one unit, and publishes after the commit', async () => {
    const { local, repos, published } = overridden();
    const ticket = await repos.tickets.insert(
      { title: 't', status: 'open' },
      unscoped,
    );

    const updated = await local.tickets.update({
      id: ticket.id,
      title: 'u',
      status: 'closed',
    });

    expect(updated).toMatchObject({ title: 'u', status: 'closed' });
    expect(
      (await repos.audits.find({}, unscoped)).docs
        .map(({ field }) => field)
        .sort(),
    ).toEqual(['status', 'title']);
    expect(published).toHaveLength(1);
    expect(published[0]).toBeInstanceOf(Tickets.events.updated);
  });

  it('rolls back the generated write too, and publishes nothing, when the work throws', async () => {
    const { local, repos, published } = overridden();
    const ticket = await repos.tickets.insert(
      { title: 't', status: 'open' },
      unscoped,
    );

    // The generated update and the title's audit row are written before
    // the status check throws.
    await expect(
      local.tickets.update({ id: ticket.id, title: 'u', status: 'refused' }),
    ).rejects.toThrow('refused');

    expect(await repos.tickets.get(ticket.id, unscoped)).toMatchObject({
      title: 't',
      status: 'open',
    });
    expect((await repos.audits.find({}, unscoped)).docs).toEqual([]);
    expect(published).toEqual([]);
  });

  it('publishes only the events of the attempt that commits', async () => {
    const { local, repos, published } = overridden(new RetryingOnce());
    const ticket = await repos.tickets.insert(
      { title: 't', status: 'open' },
      unscoped,
    );

    await local.tickets.update({ id: ticket.id, title: 'u' });

    expect(published).toHaveLength(1);
    expect((await repos.audits.find({}, unscoped)).docs).toHaveLength(1);
  });

  it('gives the overrides factory generated in the work, and build() repos only', () => {
    const lattice = framework({ family: AppUseCase }).collection(Tickets, {
      access: allowAll,
      overrides: { update: UpdateTicket },
    });
    type Options = Parameters<typeof lattice.build>[0];
    type Wiring = Parameters<NonNullable<Options['overrides']>>[0];
    expectTypeOf<
      Parameters<Parameters<Wiring['transaction']>[0]>[1]
    >().toEqualTypeOf<Wiring['generated']>();
    expectTypeOf<
      Parameters<
        Parameters<ReturnType<typeof lattice.build>['transaction']>[0]
      >[1]
    >().toEqualTypeOf<Record<never, never>>();
  });
});
