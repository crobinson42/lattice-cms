import { MemoryLogger, NoopLogger } from '@hexok/logger';
import {
  type Doc,
  framework,
  MemoryStore,
  unscoped,
  type Withheld,
} from '@latticecms/core';
import { asResult } from '@ts-pf/client';
import { createLocalClient } from '@ts-pf/server';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Actor } from '../app/use-cases/context.js';
import { MemoryDomainEventPublisher } from '../infra/events/memory-domain-events.js';
import { backends, storeOf } from '../test/stores.js';
import { createApp } from './app.js';
import { AppUseCase, Companies, Contacts, Deals } from './rpc/contract.js';

/** A manager, who sees deal amounts. */
const actor: { userId: string; organizationId: string; role: 'manager' } = {
  userId: 'u1',
  organizationId: 'o1',
  role: 'manager',
};

/** Access that allows every generated operation. */
const open = {
  read: () => true,
  create: () => true,
  update: () => true,
  delete: () => true,
};

/** The event keys published so far, in order. */
function published(events: MemoryDomainEventPublisher) {
  return events.messages.map((message) => message.key);
}

describe.each(backends)('on $name', (backend) => {
  const store = storeOf(backend);

  function setup() {
    const events = new MemoryDomainEventPublisher();
    const crm = createApp({ store: store(), events });
    const local = createLocalClient(crm.app, {
      context: { actor, logger: new NoopLogger() },
    });
    return { ...crm, events, local };
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

  describe('the contacts hook', () => {
    it('stores the email in lower case, on create and on update', async () => {
      const { local } = setup();
      const ada = await local.contacts.create({
        name: 'Ada',
        email: 'Ada@Acme.Test',
        companyId: 'c1',
      });
      expect(ada.email).toBe('ada@acme.test');

      const moved = await local.contacts.update({
        id: ada.id,
        email: 'ADA@New.Test',
      });
      expect(moved.email).toBe('ada@new.test');
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

      const moved = await local.deals.update({
        id: deal.id,
        stage: 'proposal',
      });
      expect(moved.stage).toBe('proposal');
      const { docs } = await local.deals.find({
        where: { stage: { in: ['proposal'] } },
        sort: ['-amount'],
      });
      expect(docs).toEqual([moved]);
    });

    it('takes an owner and an expected close date; a bad date is VALIDATION', async () => {
      const { local } = setup();
      const deal = await local.deals.create({
        title: 'Big one',
        companyId: 'c1',
        amount: 1000,
        ownerId: 'u2',
        expectedCloseDate: '2026-12-31',
      });
      expect(deal).toMatchObject({
        ownerId: 'u2',
        expectedCloseDate: '2026-12-31',
      });

      // An unassigned deal: null clears the owner.
      const unassigned = await local.deals.update({
        id: deal.id,
        ownerId: null,
      });
      expect(unassigned).not.toHaveProperty('ownerId');

      const bad = await asResult(
        local.deals.update({ id: deal.id, expectedCloseDate: '31/12/2026' }),
      );
      if (bad.ok || bad.error.code !== 'VALIDATION')
        throw new Error('expected VALIDATION');
      expect(bad.error.data.issues.map((issue) => issue.path)).toEqual([
        ['expectedCloseDate'],
      ]);
    });

    it('a closed deal can no longer change: update answers NOT_FOUND, as for an archived deal', async () => {
      const { local, events } = setup();
      const deal = await local.deals.create({
        title: 'Big one',
        companyId: 'c1',
        amount: 1000,
      });
      await local.deals.close({ id: deal.id, outcome: 'won' });

      const refused = await asResult(
        local.deals.update({ id: deal.id, title: 'Renamed', stage: 'lead' }),
      );

      expect(refused).toMatchObject({
        ok: false,
        error: { code: 'NOT_FOUND' },
      });
      // Still read, and unchanged.
      expect(await local.deals.get({ id: deal.id })).toMatchObject({
        title: 'Big one',
        stage: 'won',
      });
      expect(published(events)).toEqual(['dealsCreated', 'dealClosed']);
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
      expect(await repos.deals.get(deal.id, unscoped)).toEqual(archived);
      // The override publishes nothing, and Lattice publishes nothing for it.
      expect(published(events)).toEqual(['dealsCreated']);
    });

    it('hides an archived deal from find and get, through the read filter', async () => {
      const { local } = setup();
      const kept = await local.deals.create({
        title: 'Kept',
        companyId: 'c1',
        amount: 1,
      });
      const gone = await local.deals.create({
        title: 'Gone',
        companyId: 'c1',
        amount: 2,
      });

      await local.deals.delete({ id: gone.id });

      expect((await local.deals.find({})).docs).toEqual([kept]);
      // The pipeline total runs the same read filter as find.
      expect(
        await local.deals.count({ where: { stage: { eq: 'lead' } } }),
      ).toEqual({ count: 1 });
      expect(await asResult(local.deals.get({ id: gone.id }))).toMatchObject({
        ok: false,
        error: { code: 'NOT_FOUND' },
      });
      expect(await asResult(local.deals.delete({ id: gone.id }))).toMatchObject(
        {
          ok: false,
          error: { code: 'NOT_FOUND' },
        },
      );
    });

    it('the override answers a missing id as the generated delete does', async () => {
      const { local } = setup();
      const { app } = framework({
        family: AppUseCase,
      })
        .collection(Companies, { access: open })
        // Deals relates to contacts, so the framework needs them.
        .collection(Contacts, { access: open })
        .collection(Deals, {
          access: open,
          fields: { amount: { read: () => true } },
        })
        .build({
          store: new MemoryStore(),
          events: new MemoryDomainEventPublisher(),
        });
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
        payload: {
          dealId: deal.id,
          outcome: 'won',
          actorId: 'u1',
          tenantId: 'o1',
        },
      });

      const again = await asResult(
        local.deals.close({ id: deal.id, outcome: 'lost' }),
      );
      if (again.ok) throw new Error('expected AlreadyClosed');
      if (again.error.code !== 'AlreadyClosed')
        throw new Error(again.error.code);
      expectTypeOf(again.error.data).toEqualTypeOf<{ id: string }>();
      expect(again.error.data).toEqual({ id: deal.id });
      expect(again.error.status).toBe(409);
    });
  });

  describe('memberships', () => {
    it('a member reads its organization’s memberships, its team, and support reads every one', async () => {
      const { app, repos } = setup();
      const ann = await repos.memberships.insert(
        { userId: 'u1', organizationId: 'o1', role: 'manager', name: 'Ann' },
        unscoped,
      );
      const ben = await repos.memberships.insert(
        { userId: 'u2', organizationId: 'o1', name: 'Ben' },
        unscoped,
      );
      // Ann in another organization, and someone only there.
      const elsewhere = await repos.memberships.insert(
        { userId: 'u1', organizationId: 'o2', name: 'Ann B' },
        unscoped,
      );
      await repos.memberships.insert(
        { userId: 'u3', organizationId: 'o2', name: 'Cy' },
        unscoped,
      );
      const as = (actor: Actor) =>
        createLocalClient(app, {
          context: { actor, logger: new NoopLogger() },
        });
      const member = as({ userId: 'u2', organizationId: 'o1', role: 'member' });
      const support = as({ userId: 'sam', support: true });

      const team = await member.memberships.find({ sort: ['name'] });

      expect(team.docs).toEqual([ann, ben]);
      expect(
        await asResult(member.memberships.get({ id: elsewhere.id })),
      ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
      expect(await support.memberships.count({})).toEqual({ count: 4 });
    });
  });

  describe('refs', () => {
    it('a company with contacts, or with deals, archived ones too, cannot be deleted', async () => {
      const { local } = setup();
      const acme = await local.companies.create({ name: 'Acme' });
      const ada = await local.contacts.create({
        name: 'Ada',
        email: 'ada@acme.test',
        companyId: acme.id,
      });

      const refused = await asResult(local.companies.delete({ id: acme.id }));
      if (refused.ok || refused.error.code !== 'REFERENCED') {
        throw new Error('expected REFERENCED');
      }
      expect(refused.error.status).toBe(409);
      expect(refused.error.data).toEqual({
        collection: 'companies',
        id: acme.id,
        by: { collection: 'contacts', field: 'companyId' },
      });

      await local.contacts.delete({ id: ada.id });
      const deal = await local.deals.create({
        title: 'Big one',
        companyId: acme.id,
        amount: 1,
      });
      await local.deals.delete({ id: deal.id });
      // The archived deal is hidden from reads, and still refers to Acme.
      expect(
        await asResult(local.companies.delete({ id: acme.id })),
      ).toMatchObject({
        ok: false,
        error: {
          code: 'REFERENCED',
          data: { by: { collection: 'deals', field: 'companyId' } },
        },
      });
    });

    it('a contact populates its company', async () => {
      const { local } = setup();
      const acme = await local.companies.create({ name: 'Acme' });
      const ada = await local.contacts.create({
        name: 'Ada',
        email: 'ada@acme.test',
        companyId: acme.id,
      });

      const got = await local.contacts.get({
        id: ada.id,
        populate: ['companyId'],
      });

      expectTypeOf(got.companyId).toEqualTypeOf<
        Doc<typeof Companies> | Withheld
      >();
      expect(got.companyId).toEqual(acme);
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
        context: {
          actor: { userId: '', organizationId: 'o1', role: 'manager' },
          logger,
        },
      });

      const result = await asResult(anonymous.deals.find({}));

      expect(result.ok ? 'ok' : result.error.code).toBe('UNAUTHORIZED');
      expect(logger.records).toMatchObject([
        { level: 'info', fields: { outcome: 'refused', code: 'UNAUTHORIZED' } },
      ]);
    });
  });

  describe('the actor', () => {
    it('is valid as a member or as support, never both', async () => {
      const { app } = setup();
      const logger = new MemoryLogger();
      const both = createLocalClient(app, {
        context: {
          actor: {
            userId: 'u1',
            organizationId: 'o1',
            role: 'manager',
            support: true,
          },
          logger,
        },
      });

      const result = await asResult(both.deals.find({}));

      expect(result.ok ? 'ok' : result.error.code).toBe('UNAUTHORIZED');
    });

    it('needs no session on a direct call through build().context()', async () => {
      const crm = setup();
      await crm.local.companies.create({ name: 'Acme' });

      const page = await crm.useCases.companies.find.execute(
        crm.context({ actor, logger: new NoopLogger() }),
        {},
      );
      const support = await crm.useCases.companies.find.execute(
        crm.context({
          actor: { userId: 'sam', support: true },
          logger: new NoopLogger(),
        }),
        {},
      );

      expect(page.docs.map((doc) => doc.name)).toEqual(['Acme']);
      expect(support.docs.map((doc) => doc.organizationId)).toEqual(['o1']);
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
        // Maskable: a member does not receive it, so every client types it optional.
        amount?: number | undefined;
        stage:
          | 'lead'
          | 'qualified'
          | 'proposal'
          | 'negotiation'
          | 'won'
          | 'lost';
        archived: boolean;
        id: string;
        organizationId: string;
        createdAt: string;
        updatedAt: string;
        closedAt?: string | undefined;
        ownerId?: string | undefined;
        expectedCloseDate?: string | undefined;
      }>();
      expectTypeOf(local.deals.close)
        .parameter(0)
        .toEqualTypeOf<{ id: string; outcome: 'won' | 'lost' }>();
    });

    it('the override and the method keep the generated slice’s types', () => {
      const { local } = setup();
      const { app } = framework({
        family: AppUseCase,
      })
        .collection(Companies, { access: open })
        .collection(Contacts, { access: open })
        .collection(Deals, {
          access: open,
          fields: { amount: { read: () => true } },
        })
        .build({
          store: new MemoryStore(),
          events: new MemoryDomainEventPublisher(),
        });
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
      // get is generic in its populate list; without one it is plain.
      expectTypeOf<Awaited<ReturnType<Rich['close']>>>().toEqualTypeOf<
        Awaited<ReturnType<typeof plain.deals.get<readonly []>>>
      >();
    });
  });
});
