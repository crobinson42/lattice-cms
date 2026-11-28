import { describe, expect, it } from 'vitest';
import { LatticeError } from './errors.js';
import { type CollectionStore, MemoryStore } from './store.js';

const abortedMessage = /a CONFLICT aborted this transaction/;

async function seeded() {
  const store = new MemoryStore();
  await store.insert('posts', { id: 'p1' });
  return store;
}

// MongoDB runs work again until it times out here, so the store conformance
// suite cannot hold these cases: MemoryStore fails at once instead.
describe('MemoryStore after a CONFLICT inside a transaction', () => {
  it('passes the CONFLICT through when it ends the work, and rolls back', async () => {
    const store = await seeded();

    await expect(
      store.transaction(async (tx) => {
        await tx.insert('posts', { id: 'p2' });
        await tx.insert('posts', { id: 'p1' });
      }),
    ).rejects.toSatisfy(
      (error) => LatticeError.is(error) && error.code === 'CONFLICT',
    );
    expect(await store.get('posts', 'p2')).toBeNull();
  });

  it('refuses the next call when the work catches it and carries on', async () => {
    const store = await seeded();

    await expect(
      store.transaction(async (tx) => {
        await tx.insert('posts', { id: 'p2' });
        await tx.insert('posts', { id: 'p1' }).catch(() => {});
        await tx.update('posts', 'p1', { title: 'instead' });
      }),
    ).rejects.toThrow(abortedMessage);
    expect(await store.get('posts', 'p1')).toEqual({ id: 'p1' });
    expect(await store.get('posts', 'p2')).toBeNull();
  });

  it('refuses to commit when the work catches it and returns', async () => {
    const store = await seeded();

    await expect(
      store.transaction(async (tx) => {
        await tx.insert('posts', { id: 'p2' });
        await tx.insert('posts', { id: 'p1' }).catch(() => {});
        return 'done';
      }),
    ).rejects.toThrow(abortedMessage);
    expect(await store.get('posts', 'p2')).toBeNull();
  });

  it('leaves the next transaction, and calls outside, alone', async () => {
    const store = await seeded();
    await store
      .transaction((tx) => tx.insert('posts', { id: 'p1' }))
      .catch(() => {});

    await store.transaction((tx) => tx.insert('posts', { id: 'p2' }));
    await expect(store.insert('posts', { id: 'p1' })).rejects.toSatisfy(
      (error) => LatticeError.is(error) && error.code === 'CONFLICT',
    );
    await store.insert('posts', { id: 'p3' });
    expect(await store.count('posts')).toBe(3);
  });

  it('leaves a call on the root store from inside the work alone', async () => {
    const store = await seeded();

    await store.transaction(async (tx) => {
      // As code that inserts, and reads on CONFLICT, outside the transaction.
      await store.insert('posts', { id: 'p1' }).catch(() => {});
      await tx.insert('posts', { id: 'p2' });
    });

    expect(await store.count('posts')).toBe(2);
  });
});

// The store conformance suite runs these where MongoDB can: they are about
// MemoryStore's own undo log and lock.
describe('MemoryStore transactions', () => {
  it('undoes several writes to one row in reverse order', async () => {
    const store = await seeded();

    await expect(
      store.transaction(async (tx) => {
        await tx.update('posts', 'p1', { title: 'a' });
        await tx.remove('posts', 'p1');
        await tx.insert('posts', { id: 'p1', title: 'b' });
        await tx.insert('posts', { id: 'p2' });
        await tx.update('posts', 'p2', { title: 'c' });
        await tx.remove('posts', 'p2');
        throw new Error('failed');
      }),
    ).rejects.toThrow('failed');

    expect(await store.get('posts', 'p1')).toEqual({ id: 'p1' });
    expect(await store.get('posts', 'p2')).toBeNull();
  });

  it('drops on a rollback only the indexes it ensured', async () => {
    const store = new MemoryStore();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const failing = store.transaction(async (tx) => {
      await tx.ensure('users', [{ fields: { name: 1 }, unique: true }]);
      await gate;
      throw new Error('failed');
    });
    await store.ensure('users', [{ fields: { email: 1 }, unique: true }]);
    release();
    await expect(failing).rejects.toThrow('failed');

    await store.insert('users', { id: 'u1', email: 'a', name: 'n' });
    await store.insert('users', { id: 'u2', email: 'b', name: 'n' });
    await expect(
      store.insert('users', { id: 'u3', email: 'a', name: 'm' }),
    ).rejects.toSatisfy(
      (error) => LatticeError.is(error) && error.code === 'CONFLICT',
    );
  });

  it('runs a transaction that a timer starts after the work ended as its own', async () => {
    const store = new MemoryStore();
    let late: Promise<void> | undefined;
    let fired = () => {};
    const timer = new Promise<void>((resolve) => {
      fired = resolve;
    });

    await store.transaction(async (tx) => {
      await tx.insert('posts', { id: 'p1' });
      // The timer keeps the work's async context, and fires after the commit.
      setTimeout(() => {
        late = store.transaction(async (other) => {
          await other.insert('posts', { id: 'p2' });
          throw new Error('late failed');
        });
        fired();
      });
    });
    await timer;
    await expect(late).rejects.toThrow('late failed');

    expect(await store.get('posts', 'p1')).toEqual({ id: 'p1' });
    expect(await store.get('posts', 'p2')).toBeNull();
  });

  it('undoes a remove even when the caller changes the doc it returned', async () => {
    const store = await seeded();

    await expect(
      store.transaction(async (tx) => {
        const removed = await tx.remove('posts', 'p1');
        // StoredDoc is readonly, but a caller in plain JavaScript can still write.
        if (removed !== null) Object.assign(removed, { title: 'changed' });
        throw new Error('failed');
      }),
    ).rejects.toThrow('failed');

    expect(await store.get('posts', 'p1')).toEqual({ id: 'p1' });
  });

  it('refuses a call on the store work received after the transaction ends', async () => {
    const store = new MemoryStore();
    let kept: CollectionStore | undefined;

    await store.transaction(async (tx) => {
      kept = tx;
    });

    await expect(kept?.get('posts', 'p1')).rejects.toThrow(
      'MemoryStore: this transaction has ended',
    );
  });
});
