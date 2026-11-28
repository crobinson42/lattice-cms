import { type Document, MongoClient } from 'mongodb';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { MongoDoc } from './mapper.js';
import { MongoOperations } from './operations.js';

// The queries find sends, seen through the driver's command events: a
// store owns its client, so this drives the operations on a client of its
// own.
describe('find on an ascending optional key', () => {
  const client = new MongoClient(inject('standaloneUrl'), {
    monitorCommands: true,
  });
  const filters: Document[] = [];
  client.on('commandStarted', (event) => {
    if (event.commandName === 'find') filters.push(event.command.filter);
  });

  afterAll(() => client.close());

  it('skips the query for rows with a value once the cursor is past them', async () => {
    const db = client.db(`ops_${crypto.randomUUID().replaceAll('-', '')}`);
    const ops = new MongoOperations(db, new MongoDoc());
    const docs = [
      { id: 'a', due: '2026-01-01' },
      { id: 'b', due: '2026-01-02' },
      ...['u1', 'u2', 'u3', 'u4', 'u5'].map((id) => ({ id })),
    ];
    for (const doc of docs) await ops.insert('tasks', doc);

    const pages: { ids: string[]; valued: boolean }[] = [];
    let after: string | undefined;
    do {
      filters.length = 0;
      const page = await ops.find({
        collection: 'tasks',
        sort: ['due'],
        optional: ['due'],
        limit: 2,
        ...(after === undefined ? {} : { after }),
      });
      pages.push({
        ids: page.docs.map((doc) => doc.id),
        // The rows-with-a-value query filters on { due: { $ne: null } }.
        valued: filters.some((filter) =>
          JSON.stringify(filter).includes('"$ne":null'),
        ),
      });
      after = page.next ?? undefined;
    } while (after !== undefined);

    expect(pages).toEqual([
      { ids: ['a', 'b'], valued: true },
      // The cursor is b, which has a value: the first query runs, empty.
      { ids: ['u1', 'u2'], valued: true },
      // The cursor is u2, past every value: only the missing rows' query.
      { ids: ['u3', 'u4'], valued: false },
      { ids: ['u5'], valued: false },
    ]);
    await db.dropDatabase();
  });
});
