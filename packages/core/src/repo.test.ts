import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  collection,
  family,
  framework,
  MemoryStore,
  tenancy,
  unscoped,
} from './index.js';

const Tenanted = family({
  actor: z.object({ userId: z.string(), organizationId: z.string() }),
  actorId: (actor) => actor.userId,
  tenantOf: (actor) => actor.organizationId,
});

const Slots = collection('slots', {
  schema: z.object({
    status: z.enum(['open', 'booked']),
    version: z.number(),
  }),
});

const Notes = collection('notes', {
  schema: z.object({ title: z.string() }),
  tenant: 'organizationId',
});

const noEvents = { publish: async (_event: object) => {} };

function setup() {
  return framework({ family: Tenanted })
    .collection(Slots, { access: {} })
    .collection(Notes, { access: {} })
    .build({ store: new MemoryStore(), events: noEvents }).repos;
}

describe('repo writes with a condition', () => {
  it('update writes only when the row meets if, in the same call', async () => {
    const { slots } = setup();
    const slot = await slots.insert({ status: 'open', version: 1 }, unscoped);

    const booked = await slots.update(
      slot.id,
      { status: 'booked', version: 2 },
      unscoped,
      { if: { status: { eq: 'open' }, version: { eq: 1 } } },
    );
    expect(booked).toMatchObject({ status: 'booked', version: 2 });

    // A second writer read version 1 too: its condition fails.
    const stale = await slots.update(
      slot.id,
      { status: 'open', version: 2 },
      unscoped,
      { if: { version: { eq: 1 } } },
    );
    expect(stale).toBeNull();
    expect(await slots.get(slot.id, unscoped)).toMatchObject({
      status: 'booked',
    });
  });

  it('remove removes only when the row meets if', async () => {
    const { slots } = setup();
    const slot = await slots.insert({ status: 'booked', version: 1 }, unscoped);

    expect(
      await slots.remove(slot.id, unscoped, { if: { status: { eq: 'open' } } }),
    ).toBeNull();
    expect(await slots.get(slot.id, unscoped)).not.toBeNull();

    expect(
      await slots.remove(slot.id, unscoped, {
        if: { status: { eq: 'booked' } },
      }),
    ).toMatchObject({ id: slot.id });
    expect(await slots.get(slot.id, unscoped)).toBeNull();
  });

  it('ANDs if with the scope, so it cannot reach another tenant', async () => {
    const { notes } = setup();
    const note = await notes.insert({ title: 't' }, tenancy.scope(Notes, 'o1'));

    const other = await notes.update(
      note.id,
      { title: 'x' },
      tenancy.scope(Notes, 'o2'),
      { if: { or: [{ title: { eq: 't' } }, { title: { ne: 't' } }] } },
    );

    expect(other).toBeNull();
    expect((await notes.get(note.id, unscoped))?.title).toBe('t');
  });

  it('throws on an if or a where that would drop a clause', async () => {
    const { slots } = setup();
    const slot = await slots.insert({ status: 'open', version: 1 }, unscoped);
    const loose: { version?: number } = {};

    await expect(
      slots.update(slot.id, { version: 2 }, unscoped, {
        if: { version: { eq: loose.version as number } },
      }),
    ).rejects.toThrow(
      'Lattice: a repo update’s if on "slots" has an invalid Where: version.eq',
    );
    await expect(
      slots.remove(slot.id, unscoped, { if: { version: {} } }),
    ).rejects.toThrow('version: a field needs at least one operator');
    await expect(
      slots.find(
        { where: { status: { eq: loose.version as never } } },
        unscoped,
      ),
    ).rejects.toThrow('a repo find on "slots" has an invalid Where');
    await expect(
      slots.count({ status: { eq: undefined as never } }, unscoped),
    ).rejects.toThrow('a repo count on "slots" has an invalid Where');
    expect((await slots.get(slot.id, unscoped))?.version).toBe(1);
  });

  it('throws on a limit that is not a positive integer', async () => {
    const { slots } = setup();
    // Each store would act on it differently: Mongo throws, memory slices.
    for (const limit of [0, -1, 1.5]) {
      await expect(slots.find({ limit }, unscoped)).rejects.toThrow(
        `a repo find on "slots": limit must be a positive integer, got ${limit}`,
      );
      await expect(
        slots.countBy({ field: 'status', limit }, unscoped),
      ).rejects.toThrow(
        `a repo countBy on "slots": limit must be a positive integer, got ${limit}`,
      );
    }
  });
});

describe('repo insert with an id', () => {
  it('stores the given id', async () => {
    const { notes } = setup();
    const scope = tenancy.scope(Notes, 'o1');

    const note = await notes.insert({ title: 't' }, scope, {
      id: 'shared-id',
    });

    expect(note.id).toBe('shared-id');
    expect(await notes.get('shared-id', scope)).toMatchObject({ title: 't' });
  });

  it('is CONFLICT when the id exists, and keeps the first row', async () => {
    const { slots } = setup();
    await slots.insert({ status: 'open', version: 1 }, unscoped, { id: 's1' });

    await expect(
      slots.insert({ status: 'booked', version: 9 }, unscoped, { id: 's1' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      data: { collection: 'slots', id: 's1', fields: ['id'] },
    });
    expect((await slots.get('s1', unscoped))?.version).toBe(1);
  });

  it('refuses an id that is not a non-empty string', async () => {
    const { slots } = setup();

    await expect(
      slots.insert({ status: 'open', version: 1 }, unscoped, { id: '' }),
    ).rejects.toThrow(
      'an insert into "slots" was given the id ""; it must be a non-empty string',
    );
  });
});
