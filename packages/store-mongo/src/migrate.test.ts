import { MemoryLogger } from '@hexok/logger';
import { MongoClient } from 'mongodb';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  inject,
  it,
} from 'vitest';
import {
  type Migration,
  MigrationError,
  MongoStore,
  migrate,
} from './index.js';
import { databases } from './test/databases.js';

const dbs = databases();
afterAll(() => dbs.close());

let database: string;
let store: MongoStore;
let raw: MongoClient;

beforeEach(async () => {
  database = dbs.fresh();
  store = new MongoStore({ url: dbs.url, database });
  await store.start();
  raw = new MongoClient(dbs.url);
});

afterEach(async () => {
  await store.stop();
  await raw.close();
  await dbs.drop(database);
});

/** The test's own view of the database. */
const db = () => raw.db(database);

/** A migration that notes its run in `log` and in the `runs` collection. */
function step(id: number, log: number[], name = `step-${id}`): Migration {
  return {
    id,
    name,
    async up({ db }) {
      log.push(id);
      await db.collection('runs').insertOne({ id });
    },
  };
}

/** The MigrationError code a call rejects with, or what it resolved to. */
async function codeOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    (value) => ({ resolved: value }),
    (error) => (MigrationError.is(error) ? error.code : error),
  );
}

/** The lease document, as another process would have written it. */
type Lease = { _id: string; token: string; acquiredAt: Date; expiresAt: Date };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('order and records', () => {
  it('runs every migration of a fresh database, in order, and records each', async () => {
    const log: number[] = [];
    const logger = new MemoryLogger();

    const { ran } = await migrate(
      store,
      [step(1, log), step(2, log), step(3, log)],
      {
        logger,
      },
    );

    expect(log).toEqual([1, 2, 3]);
    expect(ran.map(({ id, name }) => [id, name])).toEqual([
      [1, 'step-1'],
      [2, 'step-2'],
      [3, 'step-3'],
    ]);
    const records = await db()
      .collection('_migrations')
      .find()
      .sort({ _id: 1 })
      .toArray();
    expect(records).toMatchObject([
      {
        _id: 1,
        name: 'step-1',
        ranAt: expect.any(Date),
        durationMs: expect.any(Number),
      },
      { _id: 2, name: 'step-2' },
      { _id: 3, name: 'step-3' },
    ]);
    expect(logger.records).toMatchObject(
      [1, 2, 3].map((id) => ({
        level: 'info',
        message: 'migration',
        fields: {
          id,
          name: `step-${id}`,
          durationMs: expect.any(Number),
          outcome: 'ok',
        },
      })),
    );
  });

  it('runs nothing the second time, and logs that it is up to date', async () => {
    const log: number[] = [];
    const list = [step(1, log), step(2, log)];
    await migrate(store, list, { logger: new MemoryLogger() });
    const logger = new MemoryLogger();

    const { ran } = await migrate(store, list, { logger });

    expect(ran).toEqual([]);
    expect(log).toEqual([1, 2]);
    expect(logger.records).toMatchObject([
      { level: 'info', message: 'migrations up to date', fields: { last: 2 } },
    ]);
  });

  it('runs only the migrations appended since', async () => {
    const log: number[] = [];
    await migrate(store, [step(1, log)], { logger: new MemoryLogger() });

    const { ran } = await migrate(
      store,
      [step(1, log), step(2, log), step(3, log)],
      {
        logger: new MemoryLogger(),
      },
    );

    expect(ran.map(({ id }) => id)).toEqual([2, 3]);
    expect(log).toEqual([1, 2, 3]);
  });
});

describe('list checks, before any migration runs', () => {
  const cases: [string, (log: number[]) => Migration[], string][] = [
    ['a gap', (log) => [step(1, log), step(3, log)], 'Gap'],
    ['an id out of order', (log) => [step(2, log), step(1, log)], 'Gap'],
    ['a list that does not start at 1', (log) => [step(2, log)], 'Gap'],
    [
      'a duplicate id',
      (log) => [step(1, log), step(1, log, 'again')],
      'Duplicate',
    ],
  ];
  it.each(cases)('%s', async (_name, list, code) => {
    const log: number[] = [];
    expect(
      await codeOf(migrate(store, list(log), { logger: new MemoryLogger() })),
    ).toBe(code);
    expect(log).toEqual([]);
  });

  it('a recorded migration missing from the list is Unknown', async () => {
    const log: number[] = [];
    await migrate(store, [step(1, log), step(2, log)], {
      logger: new MemoryLogger(),
    });
    log.length = 0;

    const error = await migrate(store, [step(1, log)], {
      logger: new MemoryLogger(),
    }).catch((caught: unknown) => caught);

    expect(
      MigrationError.is(error) && error.code === 'Unknown' && error.data,
    ).toEqual({
      id: 2,
      name: 'step-2',
    });
    expect(log).toEqual([]);
  });

  it('a recorded migration with another name in the list is Renamed', async () => {
    const log: number[] = [];
    await migrate(store, [step(1, log)], { logger: new MemoryLogger() });
    log.length = 0;

    const error = await migrate(
      store,
      [step(1, log, 'renamed'), step(2, log)],
      {
        logger: new MemoryLogger(),
      },
    ).catch((caught: unknown) => caught);

    expect(
      MigrationError.is(error) && error.code === 'Renamed' && error.data,
    ).toEqual({
      id: 1,
      recorded: 'step-1',
      listed: 'renamed',
    });
    expect(log).toEqual([]);
  });
});

describe('a migration that throws', () => {
  it('is not recorded, its error passes through, and the next run retries it', async () => {
    const log: number[] = [];
    let broken = true;
    const flaky: Migration = {
      id: 2,
      name: 'flaky',
      async up({ db }) {
        await db.collection('runs').insertOne({ id: 2 });
        if (broken) throw new Error('flaky failed');
        log.push(2);
      },
    };
    const logger = new MemoryLogger();

    await expect(
      migrate(store, [step(1, log), flaky, step(3, log)], { logger }),
    ).rejects.toThrow('flaky failed');
    expect(log).toEqual([1]);
    expect(await db().collection('_migrations').countDocuments()).toBe(1);
    expect(logger.records.at(-1)).toMatchObject({
      level: 'error',
      message: 'flaky failed',
      fields: {
        id: 2,
        name: 'flaky',
        durationMs: expect.any(Number),
        outcome: 'failed',
      },
    });

    broken = false;
    const { ran } = await migrate(store, [step(1, log), flaky, step(3, log)], {
      logger: new MemoryLogger(),
    });

    expect(ran.map(({ id }) => id)).toEqual([2, 3]);
    expect(await db().collection('runs').countDocuments({ id: 2 })).toBe(2);
  });
});

describe('transaction: true', () => {
  it('commits the writes and the record together', async () => {
    const migration: Migration = {
      id: 1,
      name: 'tx',
      transaction: true,
      async up({ db, session }) {
        expect(session).toBeDefined();
        await db
          .collection('runs')
          .insertOne({ id: 1 }, { ...(session ? { session } : {}) });
      },
    };

    await migrate(store, [migration], { logger: new MemoryLogger() });

    expect(await db().collection('runs').countDocuments()).toBe(1);
    expect(await db().collection('_migrations').countDocuments()).toBe(1);
  });

  it('rolls back the writes and the record when up throws', async () => {
    const migration: Migration = {
      id: 1,
      name: 'tx',
      transaction: true,
      async up({ db, session }) {
        await db
          .collection('runs')
          .insertOne({ id: 1 }, { ...(session ? { session } : {}) });
        throw new Error('tx failed');
      },
    };

    await expect(
      migrate(store, [migration], { logger: new MemoryLogger() }),
    ).rejects.toThrow('tx failed');

    expect(await db().collection('runs').countDocuments()).toBe(0);
    expect(await db().collection('_migrations').countDocuments()).toBe(0);
  });

  it('is NoTransactions on a deployment without a replica set, before anything runs', async () => {
    const single = new MongoStore({
      url: inject('standaloneUrl'),
      database: `m_${crypto.randomUUID().replaceAll('-', '')}`,
    });
    await single.start();
    const log: number[] = [];
    try {
      const transactional: Migration = { ...step(2, log), transaction: true };
      expect(
        await codeOf(
          migrate(single, [step(1, log), transactional], {
            logger: new MemoryLogger(),
          }),
        ),
      ).toBe('NoTransactions');
      expect(log).toEqual([]);
    } finally {
      await single.stop();
    }
  });
});

describe('the lock', () => {
  it('runs each migration once across two processes; the second waits, then runs nothing', async () => {
    const other = new MongoStore({ url: dbs.url, database });
    await other.start();
    const slow = (id: number): Migration => ({
      id,
      name: `slow-${id}`,
      async up({ db }) {
        await sleep(150);
        await db
          .collection<{ _id: number; runs: number }>('runs')
          .updateOne({ _id: id }, { $inc: { runs: 1 } }, { upsert: true });
      },
    });
    const list = [slow(1), slow(2), slow(3)];
    const first = new MemoryLogger();
    const second = new MemoryLogger();
    try {
      const [a, b] = await Promise.all([
        migrate(store, list, { logger: first }),
        sleep(50).then(() => migrate(other, list, { logger: second })),
      ]);

      expect(a.ran.map(({ id }) => id)).toEqual([1, 2, 3]);
      expect(b.ran).toEqual([]);
      const runs = await db()
        .collection('runs')
        .find()
        .sort({ _id: 1 })
        .toArray();
      expect(runs).toEqual([1, 2, 3].map((id) => ({ _id: id, runs: 1 })));
      expect(second.records).toMatchObject([
        {
          level: 'info',
          message: 'migrations waiting for lock',
          fields: { heldSince: expect.any(String) },
        },
        {
          level: 'info',
          message: 'migrations up to date',
          fields: { last: 3 },
        },
      ]);
    } finally {
      await other.stop();
    }
  });

  it('is LockTimeout when another lease outlives waitMs, and runs nothing', async () => {
    await db()
      .collection<Lease>('_migrations_lock')
      .insertOne({
        _id: 'migrations',
        token: 'other',
        acquiredAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });
    const log: number[] = [];

    const error = await migrate(store, [step(1, log)], {
      logger: new MemoryLogger(),
      lock: { waitMs: 300 },
    }).catch((caught: unknown) => caught);

    expect(
      MigrationError.is(error) && error.code === 'LockTimeout' && error.data,
    ).toEqual({
      waitMs: 300,
    });
    expect(log).toEqual([]);
  });

  it('takes over an expired lease', async () => {
    await db()
      .collection<Lease>('_migrations_lock')
      .insertOne({
        _id: 'migrations',
        token: 'dead',
        acquiredAt: new Date(Date.now() - 120_000),
        expiresAt: new Date(Date.now() - 60_000),
      });
    const log: number[] = [];

    await migrate(store, [step(1, log)], {
      logger: new MemoryLogger(),
      lock: { waitMs: 0 },
    });

    expect(log).toEqual([1]);
    expect(await db().collection('_migrations_lock').countDocuments()).toBe(0);
  });

  it('aborts signal when the lease is lost, and the migration is LockLost and not recorded', async () => {
    let aborted = false;
    const lost: Migration = {
      id: 1,
      name: 'lost',
      async up({ signal }) {
        // Another process's view: the lease document is gone.
        await raw.db(database).collection('_migrations_lock').deleteMany({});
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
          setTimeout(resolve, 2000);
        });
        aborted = signal.aborted;
      },
    };

    expect(
      await codeOf(
        migrate(store, [lost], {
          logger: new MemoryLogger(),
          lock: { ttlMs: 300 },
        }),
      ),
    ).toBe('LockLost');
    expect(aborted).toBe(true);
    expect(await db().collection('_migrations').countDocuments()).toBe(0);
  });

  it('releases the lease after a run, and after a failure', async () => {
    await migrate(store, [step(1, [])], { logger: new MemoryLogger() });
    expect(await db().collection('_migrations_lock').countDocuments()).toBe(0);

    const failing: Migration = {
      id: 2,
      name: 'failing',
      async up() {
        throw new Error('no');
      },
    };
    await expect(
      migrate(store, [step(1, []), failing], { logger: new MemoryLogger() }),
    ).rejects.toThrow('no');
    expect(await db().collection('_migrations_lock').countDocuments()).toBe(0);
  });
});
