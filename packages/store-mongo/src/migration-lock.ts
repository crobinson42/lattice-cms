import type { Db } from 'mongodb';
import { MigrationError } from './migration-error.js';

/**
 * The lock migrations run under. An internal seam: the lease below can be
 * replaced by another lock, such as a hexok one, without touching the
 * runner (0027).
 */
export type MigrationLock = {
  /**
   * Waits for the lock, runs `work` while holding it, and releases it.
   * `signal` aborts when the lock is lost.
   */
  run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T>;
};

/** The lease document: who holds the lock, and until when by the server's clock. */
type Lease = {
  _id: string;
  token: string;
  acquiredAt: Date;
  expiresAt: Date;
};

export type LeaseOptions = {
  /** How long a lease lives without a renewal. It is renewed every third. */
  readonly ttlMs: number;
  /** How long to wait for another process's lease before `LockTimeout`. */
  readonly waitMs: number;
  /** Called once, when the lock is held by another process and the run waits. */
  readonly onWait: (heldSince: Date | undefined) => void;
};

const leaseId = 'migrations';

/** Resolves after `ms`, or at once when `signal` aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

/**
 * A lease in `_migrations_lock`, in the database being migrated. Taken
 * atomically with the server's clock (`$$NOW`), so clocks on different
 * hosts do not matter; renewed every third of its TTL; released by its
 * random token, so a process never releases another's lease. A lease whose
 * holder died expires and is taken over.
 */
export function leaseLock(db: Db, options: LeaseOptions): MigrationLock {
  const leases = db.collection<Lease>('_migrations_lock');
  const { ttlMs, waitMs } = options;

  async function acquire(token: string): Promise<boolean> {
    // One atomic update, on the server's clock: it takes the lease only
    // when it has expired, or does not exist yet (a missing expiresAt
    // compares below any date). Otherwise it leaves the holder's fields as
    // they are. The returned token says who holds it.
    const expired = { $lt: ['$expiresAt', '$$NOW'] };
    const lease = await leases.findOneAndUpdate(
      { _id: leaseId },
      [
        {
          $set: {
            token: { $cond: [expired, token, '$token'] },
            acquiredAt: { $cond: [expired, '$$NOW', '$acquiredAt'] },
            expiresAt: {
              $cond: [expired, { $add: ['$$NOW', ttlMs] }, '$expiresAt'],
            },
          },
        },
      ],
      { upsert: true, returnDocument: 'after' },
    );
    return lease?.token === token;
  }

  async function renew(token: string): Promise<boolean> {
    const result = await leases.updateOne({ _id: leaseId, token }, [
      { $set: { expiresAt: { $add: ['$$NOW', ttlMs] } } },
    ]);
    return result.matchedCount === 1;
  }

  async function wait(token: string): Promise<void> {
    const deadline = Date.now() + waitMs;
    const poll = Math.min(1000, ttlMs / 3);
    let waited = false;
    while (!(await acquire(token))) {
      if (!waited) {
        waited = true;
        const held = await leases.findOne({ _id: leaseId });
        options.onWait(held?.acquiredAt);
      }
      const left = deadline - Date.now();
      if (left <= 0) throw MigrationError.LockTimeout({ waitMs });
      await sleep(Math.min(poll, left));
    }
  }

  return {
    async run(work) {
      const token = crypto.randomUUID();
      await wait(token);
      const lost = new AbortController();
      // A lease is good until the TTL after its last renewal was sent. Abort
      // a margin before that, so this process stops before another can take
      // the lock, even when a renewal never answers.
      const margin = Math.min(1000, ttlMs / 4);
      let sent = Date.now();
      const stopped = new AbortController();
      const keep = (async () => {
        while (!stopped.signal.aborted && !lost.signal.aborted) {
          await sleep(ttlMs / 3, stopped.signal);
          if (stopped.signal.aborted) return;
          const at = Date.now();
          const renewed = await Promise.race([
            renew(token).catch(() => false),
            sleep(Math.max(0, sent + ttlMs - margin - at), stopped.signal).then(
              () => false,
            ),
          ]);
          if (stopped.signal.aborted) return;
          if (!renewed) {
            lost.abort(MigrationError.LockLost());
            return;
          }
          sent = at;
        }
      })();
      try {
        return await work(lost.signal);
      } finally {
        stopped.abort();
        await keep;
        await leases.deleteOne({ _id: leaseId, token });
      }
    },
  };
}
