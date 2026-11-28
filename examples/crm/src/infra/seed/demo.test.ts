import { NoopLogger } from '@hexok/logger';
import { unscoped } from '@latticecms/core';
import { createLocalClient } from '@ts-pf/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../../app/use-cases/context.js';
import { type CrmApp, createApp } from '../../servers/app.js';
import { cheapHasher } from '../../test/hasher.js';
import { backends } from '../../test/stores.js';
import { StoreCredentials } from '../auth/store-credentials.js';
import { MemoryDomainEventPublisher } from '../events/memory-domain-events.js';
import {
  alreadySeeded,
  type DemoUser,
  demoPassword,
  demoUsers,
  seedDemo,
} from './demo.js';

const now = new Date('2026-11-25T12:00:00.000Z');

// One seed per store, shared: the tests only read, and the second run
// writes nothing. A seed is a few hundred API calls, so it runs as setup,
// under the hook timeout.
describe.each(backends)('seedDemo on $name', (backend) => {
  // Named types, not one inferred from a seeding function's result: the
  // inferred type, annotated (Awaited<ReturnType<…>>) or chained through
  // .then(), cost the type-check about 3.5 million instantiations.
  let seeded:
    | {
        readonly crm: CrmApp;
        readonly credentials: StoreCredentials;
        readonly users: readonly DemoUser[];
        readonly close: () => Promise<void>;
      }
    | undefined;
  beforeAll(async () => {
    const { store, close } = await backend.open();
    const crm = createApp({ store, events: new MemoryDomainEventPublisher() });
    await crm.ensure();
    const credentials = new StoreCredentials(store, cheapHasher());
    await credentials.ensure();
    const users = await seedDemo({ crm, credentials, now });
    seeded = { crm, credentials, users, close };
  });
  afterAll(() => seeded?.close());

  function demo() {
    if (seeded === undefined) throw new Error('not seeded');
    return seeded;
  }
  async function orgId(name: string): Promise<string> {
    const { docs } = await demo().crm.repos.organizations.find(
      { where: { name: { eq: name } } },
      unscoped,
    );
    return docs[0]?.id ?? '';
  }
  function as(actor: Actor) {
    return createLocalClient(demo().crm.app, {
      context: { actor, logger: new NoopLogger() },
    });
  }

  it('writes the organizations, memberships and users, and each user signs in', async () => {
    const { crm, credentials, users } = demo();
    const { docs: organizations } = await crm.repos.organizations.find(
      { sort: ['name'] },
      unscoped,
    );

    expect(organizations.map((org) => org.name)).toEqual([
      'Acme Corp',
      'Globex',
    ]);
    const { docs: memberships } = await crm.repos.memberships.find(
      { sort: ['userId'] },
      unscoped,
    );
    expect(
      memberships.map(({ userId, role, organizationId }) => [
        userId,
        role,
        organizations.find((org) => org.id === organizationId)?.name,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ['ann', 'manager', 'Acme Corp'],
        ['ann', 'manager', 'Globex'],
        ['ben', 'member', 'Acme Corp'],
      ]),
    );
    expect(memberships).toHaveLength(3);
    expect(users).toEqual(demoUsers);
    for (const { userId, email } of demoUsers) {
      expect(await credentials.verify(email, demoPassword)).toEqual({
        ok: true,
        value: { userId },
      });
    }
  });

  it('fills a pipeline worth opening, through the API', async () => {
    const ann = as({
      userId: 'ann',
      organizationId: await orgId('Acme Corp'),
      role: 'manager',
    });
    const count = async (
      read: Promise<{ readonly count: number }>,
    ): Promise<number> => (await read).count;

    expect(await count(ann.companies.count({}))).toBe(12);
    expect(await count(ann.deals.count({}))).toBe(20);
    for (const stage of [
      'lead',
      'qualified',
      'proposal',
      'negotiation',
      'won',
      'lost',
    ] as const) {
      expect(
        await count(ann.deals.count({ where: { stage: { eq: stage } } })),
      ).toBeGreaterThan(0);
    }
    expect(
      await count(ann.tasks.count({ where: { done: { eq: false } } })),
    ).toBe(6);
    expect(await count(ann.activities.count({}))).toBeGreaterThan(40);
    const globex = as({
      userId: 'ann',
      organizationId: await orgId('Globex'),
      role: 'manager',
    });
    expect(await count(globex.companies.count({}))).toBe(3);
  });

  it('a member sees no amounts', async () => {
    const ben = as({
      userId: 'ben',
      organizationId: await orgId('Acme Corp'),
      role: 'member',
    });

    const { docs } = await ben.deals.find({ limit: 100 });

    expect(docs).toHaveLength(20);
    expect(docs.filter((deal) => 'amount' in deal)).toEqual([]);
  });

  it('refuses a second run, and writes nothing', async () => {
    const { crm, credentials } = demo();

    await expect(seedDemo({ crm, credentials, now })).rejects.toThrow(
      alreadySeeded,
    );
    expect(await crm.repos.organizations.count({}, unscoped)).toBe(2);
  });
});
