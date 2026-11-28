import { createLocalClient } from '@ts-pf/server';
import { Adapter, type UseCase } from 'hexok';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { AppUseCase, callContext } from './fixtures/context.js';
import {
  CollectionStore,
  collection,
  type Doc,
  framework,
  MemoryStore,
  type Repo,
  type Transaction,
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
