import type { Logger } from '@hexok/logger';
import type { ClientSession, Db } from 'mongodb';
import { MigrationError } from './migration-error.js';
import { leaseLock, type MigrationLock } from './migration-lock.js';
import { connectionOf, type MongoStore } from './mongo-store.js';

/** What a migration's `up` receives. */
export type MigrationContext = {
  /** The store's database, raw: a migration reads documents in their old shape. */
  readonly db: Db;
  /** The transaction's session, when the migration sets `transaction: true`. */
  readonly session?: ClientSession;
  /** Aborts when the migrations lock is lost. Pass it to long loops. */
  readonly signal: AbortSignal;
  /** A child of the runner's logger, with the migration's id and name. */
  readonly logger: Logger;
};

/**
 * One data migration. Forward only. `up` must be safe to run again after it
 * failed partway: the next run retries it.
 */
export type Migration = {
  /** 1, 2, 3 … in list order. */
  readonly id: number;
  readonly name: string;
  /** Runs `up` and its record in one transaction. Needs a replica set. */
  readonly transaction?: boolean;
  up(context: MigrationContext): Promise<void>;
};

export type MigrateOptions = {
  readonly logger: Logger;
  readonly lock?: {
    /** A lease's lifetime without renewal. Default 60 000. */
    readonly ttlMs?: number;
    /** How long to wait for another process's lease. Default 600 000. */
    readonly waitMs?: number;
  };
};

export type Ran = {
  readonly id: number;
  readonly name: string;
  readonly durationMs: number;
};

/** What `_migrations` keeps for each migration that ran. */
type MigrationRecord = {
  _id: number;
  name: string;
  ranAt: Date;
  durationMs: number;
};

/** The list's own checks: ids 1, 2, 3 … in order, none twice. */
function checkList(migrations: readonly Migration[]): void {
  const seen = new Set<number>();
  for (const { id } of migrations) {
    if (seen.has(id)) throw MigrationError.Duplicate({ id });
    seen.add(id);
  }
  migrations.forEach(({ id }, index) => {
    if (id !== index + 1) {
      throw MigrationError.Gap({ expected: index + 1, found: id });
    }
  });
}

/** The recorded migrations against the list: none missing, none renamed. */
function checkRecords(
  migrations: readonly Migration[],
  records: readonly MigrationRecord[],
): void {
  for (const record of records) {
    const listed = migrations[record._id - 1];
    if (listed === undefined) {
      throw MigrationError.Unknown({ id: record._id, name: record.name });
    }
    if (listed.name !== record.name) {
      throw MigrationError.Renamed({
        id: record._id,
        recorded: record.name,
        listed: listed.name,
      });
    }
  }
}

/** Whether the deployment runs transactions: a replica set or a mongos. */
async function hasTransactions(db: Db): Promise<boolean> {
  const hello = await db.admin().command({ hello: 1 });
  return typeof hello.setName === 'string' || hello.msg === 'isdbgrid';
}

/**
 * Runs each pending migration once, in id order, under a lease lock in the
 * store's database (0027). The store must be started. A second process
 * waits for the lock, then finds nothing left to run. A migration that
 * throws is not recorded: the error passes through, and the next run
 * retries it.
 */
export async function migrate(
  store: MongoStore,
  migrations: readonly Migration[],
  options: MigrateOptions,
): Promise<{ readonly ran: readonly Ran[] }> {
  const { client, db } = connectionOf(store);
  const { logger } = options;
  checkList(migrations);
  const lock: MigrationLock = leaseLock(db, {
    ttlMs: options.lock?.ttlMs ?? 60_000,
    waitMs: options.lock?.waitMs ?? 600_000,
    onWait: (heldSince) =>
      logger.info('migrations waiting for lock', {
        ...(heldSince === undefined
          ? {}
          : { heldSince: heldSince.toISOString() }),
      }),
  });
  const records = db.collection<MigrationRecord>('_migrations');

  return lock.run(async (signal) => {
    const recorded = await records.find().sort({ _id: 1 }).toArray();
    checkRecords(migrations, recorded);
    const pending = migrations.slice(recorded.length);
    const transactional = pending.find((migration) => migration.transaction);
    if (transactional !== undefined && !(await hasTransactions(db))) {
      throw MigrationError.NoTransactions({ id: transactional.id });
    }
    if (pending.length === 0) {
      logger.info('migrations up to date', { last: recorded.length });
      return { ran: [] };
    }

    const ran: Ran[] = [];
    for (const migration of pending) {
      if (signal.aborted) throw MigrationError.LockLost();
      const { id, name } = migration;
      const context = { db, signal, logger: logger.child({ id, name }) };
      const started = performance.now();
      const record = (durationMs: number): MigrationRecord => ({
        _id: id,
        name,
        ranAt: new Date(),
        durationMs,
      });
      try {
        if (migration.transaction === true) {
          await client.withSession((session) =>
            session.withTransaction(async () => {
              await migration.up({ ...context, session });
              if (signal.aborted) throw MigrationError.LockLost();
              await records.insertOne(record(since(started)), { session });
            }),
          );
        } else {
          await migration.up(context);
          // The lock was lost while it ran: another process may run it
          // too, so it is not recorded here. up is safe to re-run.
          if (signal.aborted) throw MigrationError.LockLost();
          await records.insertOne(record(since(started)));
        }
      } catch (error) {
        const fields = {
          id,
          name,
          durationMs: since(started),
          outcome: 'failed',
        };
        if (error instanceof Error) logger.error(error, fields);
        else logger.error('migration', { ...fields, thrown: String(error) });
        throw error;
      }
      const durationMs = since(started);
      logger.info('migration', { id, name, durationMs, outcome: 'ok' });
      ran.push({ id, name, durationMs });
    }
    return { ran };
  });
}

function since(started: number): number {
  return Math.round(performance.now() - started);
}
