import { MemoryLogger, NoopLogger } from '@hexok/logger';
import { framework, MemoryStore } from '@latticecms/core';
import { asResult } from '@ts-pf/client';
import { createLocalClient } from '@ts-pf/server';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { MemoryDomainEventPublisher } from '../infra/events/memory-domain-events.js';
import { AppUseCase, Companies, Contacts, createApp, Deals } from './app.js';

const actor = { userId: 'u1' };

function setup() {
  const events = new MemoryDomainEventPublisher();
  const crm = createApp({ store: new MemoryStore(), events });
  const local = createLocalClient(crm.app, {
    context: { actor, logger: new NoopLogger() },
  });
  return { ...crm, events, local };
}

/** The event keys published so far, in order. */
function published(events: MemoryDomainEventPublisher) {
  return events.messages.map((message) => message.key);
}

describe('companies', () => {
  it('create, get, find, update and delete', async () => {
    const { local } = setup();

    const acme = await local.companies.create({ name: 'Acme' });
    expect(acme).toMatchObject({ name: 'Acme', id: expect.any(String) });
    expect(await local.companies.get({ id: acme.id })).toEqual(acme);

    const renamed = await local.companies.update({
      id: acme.id,
      domain: 'acme.test',
    });
    expect(renamed).toMatchObject({ name: 'Acme', domain: 'acme.test' });

    const { docs } = await local.companies.find({
      where: { domain: { eq: 'acme.test' } },
    });
    expect(docs).toEqual([renamed]);

    expect(await local.companies.delete({ id: acme.id })).toEqual(renamed);
    const gone = await asResult(local.companies.get({ id: acme.id }));
    expect(gone.ok ? 'ok' : gone.error.code).toBe('NOT_FOUND');
  });
});

describe('contacts', () => {
  it('create, find by company, update and delete; a bad email is VALIDATION', async () => {
    const { local } = setup();
    const acme = await local.companies.create({ name: 'Acme' });

    const ada = await local.contacts.create({
      name: 'Ada',
      email: 'ada@acme.test',
      companyId: acme.id,
    });
    const { docs } = await local.contacts.find({
      where: { companyId: { eq: acme.id } },
      sort: ['name'],
    });
    expect(docs).toEqual([ada]);

    const moved = await local.contacts.update({ id: ada.id, name: 'Ada L' });
    expect(moved.name).toBe('Ada L');
    expect(await local.contacts.delete({ id: ada.id })).toEqual(moved);

    const bad = await asResult(
      local.contacts.create({
        name: 'Bob',
        email: 'not an email',
        companyId: acme.id,
      }),
    );
    if (bad.ok || bad.error.code !== 'VALIDATION')
      throw new Error('expected VALIDATION');
    expect(bad.error.data.issues.map((issue) => issue.path)).toEqual([
      ['email'],
    ]);
  });
});

describe('deals', () => {
  it('create applies the defaults the client may leave out', async () => {
    const { local } = setup();
    const deal = await local.deals.create({
      title: 'Big one',
      companyId: 'c1',
      amount: 1000,
    });
    expect(deal).toMatchObject({ stage: 'lead', archived: false });
    expect(deal).not.toHaveProperty('closedAt');

    const moved = await local.deals.update({ id: deal.id, stage: 'proposal' });
    expect(moved.stage).toBe('proposal');
    const { docs } = await local.deals.find({
      where: { stage: { in: ['proposal'] } },
      sort: ['-amount'],
    });
    expect(docs).toEqual([moved]);
  });

  it('delete is the ArchiveDeal override: it archives, and the row stays', async () => {
    const { local, repos, events } = setup();
    const deal = await local.deals.create({
      title: 'Big one',
      companyId: 'c1',
      amount: 1000,
    });

    const archived = await local.deals.delete({ id: deal.id });

    expect(archived).toMatchObject({ id: deal.id, archived: true });
    expect(await repos.deals.get(deal.id)).toEqual(archived);
    expect((await local.deals.find({})).docs).toEqual([archived]);
    // The override publishes nothing, and Lattice publishes nothing for it.
    expect(published(events)).toEqual(['dealsCreated']);
  });

  it('the override answers a missing id as the generated delete does', async () => {
    const { local } = setup();
    const { app } = framework({
      family: AppUseCase,
      store: new MemoryStore(),
      events: new MemoryDomainEventPublisher(),
    })
      .collection(Deals)
      .build();
    const generated = createLocalClient(app, {
      context: { actor, logger: new NoopLogger() },
    });

    const fromOverride = await asResult(local.deals.delete({ id: 'nope' }));
    const fromGenerated = await asResult(
      generated.deals.delete({ id: 'nope' }),
    );

    if (fromOverride.ok || fromGenerated.ok)
      throw new Error('expected NOT_FOUND');
    if (fromOverride.error.code !== 'NOT_FOUND') {
      throw new Error(fromOverride.error.code);
    }
    expect(fromOverride.error.data).toEqual({
      collection: 'deals',
      id: 'nope',
    });
    expect({
      code: fromOverride.error.code,
      data: fromOverride.error.data,
      status: fromOverride.error.status,
    }).toEqual({
      code: fromGenerated.error.code,
      data: fromGenerated.error.data,
      status: fromGenerated.error.status,
    });
  });

  it('close wins or loses a deal once, publishes DealClosed, and refuses a second close', async () => {
    const { local, events } = setup();
    const deal = await local.deals.create({
      title: 'Big one',
      companyId: 'c1',
      amount: 1000,
    });

    const won = await local.deals.close({ id: deal.id, outcome: 'won' });
    expect(won).toMatchObject({ stage: 'won', closedAt: expect.any(String) });
    expect(events.messages.at(-1)).toEqual({
      key: 'dealClosed',
      payload: { dealId: deal.id, outcome: 'won', actorId: 'u1' },
    });

    const again = await asResult(
      local.deals.close({ id: deal.id, outcome: 'lost' }),
    );
    if (again.ok) throw new Error('expected AlreadyClosed');
    if (again.error.code !== 'AlreadyClosed') throw new Error(again.error.code);
    expectTypeOf(again.error.data).toEqualTypeOf<{ id: string }>();
    expect(again.error.data).toEqual({ id: deal.id });
    expect(again.error.status).toBe(409);
  });
});

describe('events', () => {
  it('one event per generated write, plus the method’s own', async () => {
    const { local, events } = setup();

    const acme = await local.companies.create({ name: 'Acme' });
    await local.companies.update({ id: acme.id, name: 'Acme Inc' });
    await local.companies.delete({ id: acme.id });
    const ada = await local.contacts.create({
      name: 'Ada',
      email: 'ada@acme.test',
      companyId: acme.id,
    });
    await local.contacts.update({ id: ada.id, name: 'Ada L' });
    await local.contacts.delete({ id: ada.id });
    const deal = await local.deals.create({
      title: 'Big one',
      companyId: acme.id,
      amount: 1,
    });
    await local.deals.update({ id: deal.id, amount: 2 });
    await local.deals.close({ id: deal.id, outcome: 'lost' });
    // Reads publish nothing.
    await local.deals.get({ id: deal.id });
    await local.deals.find({});

    expect(published(events)).toEqual([
      'companiesCreated',
      'companiesUpdated',
      'companiesDeleted',
      'contactsCreated',
      'contactsUpdated',
      'contactsDeleted',
      'dealsCreated',
      'dealsUpdated',
      'dealClosed',
    ]);
  });
});

describe('the family', () => {
  it('answers UNAUTHORIZED without a valid actor, and logs it once', async () => {
    const { app } = setup();
    const logger = new MemoryLogger();
    const anonymous = createLocalClient(app, {
      context: { actor: { userId: '' }, logger },
    });

    const result = await asResult(anonymous.deals.find({}));

    expect(result.ok ? 'ok' : result.error.code).toBe('UNAUTHORIZED');
    expect(logger.records).toMatchObject([
      { level: 'info', fields: { outcome: 'refused', code: 'UNAUTHORIZED' } },
    ]);
  });
});

describe('the contract’s types', () => {
  it('a client gets full types with no annotation at the call site', async () => {
    const { local } = setup();
    const deal = await local.deals.create({
      title: 'Big one',
      companyId: 'c1',
      amount: 1,
    });
    expectTypeOf(deal).toEqualTypeOf<{
      title: string;
      companyId: string;
      amount: number;
      stage: 'lead' | 'proposal' | 'won' | 'lost';
      archived: boolean;
      id: string;
      createdAt: string;
      updatedAt: string;
      closedAt?: string | undefined;
    }>();
    expectTypeOf(local.deals.close)
      .parameter(0)
      .toEqualTypeOf<{ id: string; outcome: 'won' | 'lost' }>();
  });

  it('the override and the method keep the generated slice’s types', () => {
    const { local } = setup();
    const { app } = framework({
      family: AppUseCase,
      store: new MemoryStore(),
      events: new MemoryDomainEventPublisher(),
    })
      .collection(Companies)
      .collection(Contacts)
      .collection(Deals)
      .build();
    const plain = createLocalClient(app, {
      context: { actor, logger: new NoopLogger() },
    });
    // The plain app declares no app errors, so compare inputs and outputs.
    type Rich = typeof local.deals;
    type Plain = typeof plain.deals;
    expectTypeOf<Parameters<Rich['delete']>[0]>().toEqualTypeOf<
      Parameters<Plain['delete']>[0]
    >();
    expectTypeOf<Awaited<ReturnType<Rich['delete']>>>().toEqualTypeOf<
      Awaited<ReturnType<Plain['delete']>>
    >();
    expectTypeOf<Parameters<Rich['create']>[0]>().toEqualTypeOf<
      Parameters<Plain['create']>[0]
    >();
    expectTypeOf<Parameters<Rich['find']>[0]>().toEqualTypeOf<
      Parameters<Plain['find']>[0]
    >();
    expectTypeOf<Awaited<ReturnType<Rich['close']>>>().toEqualTypeOf<
      Awaited<ReturnType<Plain['get']>>
    >();
  });
});
