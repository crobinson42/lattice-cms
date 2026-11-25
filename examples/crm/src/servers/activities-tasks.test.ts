import { NoopLogger } from '@hexok/logger';
import { unscoped } from '@latticecms/core';
import { asResult } from '@ts-pf/client';
import { createLocalClient } from '@ts-pf/server';
import { describe, expect, it } from 'vitest';
import type { Actor } from '../app/use-cases/context.js';
import { activityKinds } from '../domain/collections/activities.js';
import { MemoryDomainEventPublisher } from '../infra/events/memory-domain-events.js';
import { backends, storeOf } from '../test/stores.js';
import { createApp } from './app.js';

const occurredAt = '2026-11-25T10:00:00.000Z';

describe.each(backends)('activities and tasks on $name', (backend) => {
  const store = storeOf(backend);

  function setup() {
    const events = new MemoryDomainEventPublisher();
    const crm = createApp({ store: store(), events });
    const as = (actor: Actor) =>
      createLocalClient(crm.app, {
        context: { actor, logger: new NoopLogger() },
      });
    return {
      ...crm,
      events,
      // Two members of one organization, and one of another.
      ann: as({ userId: 'u1', organizationId: 'o1', role: 'member' }),
      ben: as({ userId: 'u2', organizationId: 'o1', role: 'member' }),
      cy: as({ userId: 'u3', organizationId: 'o2', role: 'member' }),
    };
  }

  describe('activities', () => {
    it('log stamps the caller as author, drops one the client sends, and publishes created', async () => {
      const { ann, events } = setup();
      const acme = await ann.companies.create({ name: 'Acme' });
      // authorId is not in log's input type; sent anyway, it is dropped.
      const sent = {
        kind: activityKinds[0],
        body: 'Called about renewal',
        occurredAt,
        companyId: acme.id,
        authorId: 'u2',
      };

      const activity = await ann.activities.log(sent);

      expect(activity).toMatchObject({
        kind: 'note',
        authorId: 'u1',
        companyId: acme.id,
        organizationId: 'o1',
      });
      expect(events.messages.at(-1)).toMatchObject({
        key: 'activitiesCreated',
        payload: {
          doc: { id: activity.id, authorId: 'u1' },
          actorId: 'u1',
          tenantId: 'o1',
        },
      });
    });

    it('has no generated create: it is FORBIDDEN', async () => {
      const { ann } = setup();

      const result = await asResult(
        ann.activities.create({
          kind: 'note',
          body: 'Hi',
          occurredAt,
          companyId: 'c1',
          authorId: 'u2',
        }),
      );

      expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    });

    it('only the author changes or deletes one; to another member it is NOT_FOUND', async () => {
      const { ann, ben } = setup();
      const activity = await ann.activities.log({
        kind: 'call',
        body: 'Left a message',
        occurredAt,
        companyId: 'c1',
      });

      const updated = await asResult(
        ben.activities.update({ id: activity.id, body: 'Mine now' }),
      );
      const deleted = await asResult(
        ben.activities.delete({ id: activity.id }),
      );

      for (const result of [updated, deleted]) {
        expect(result).toMatchObject({
          ok: false,
          error: { code: 'NOT_FOUND' },
        });
      }
      // Ben still reads it, and Ann still changes it.
      expect(await ben.activities.get({ id: activity.id })).toMatchObject({
        body: 'Left a message',
      });
      expect(
        await ann.activities.update({ id: activity.id, body: 'Spoke to Ada' }),
      ).toMatchObject({ body: 'Spoke to Ada', authorId: 'u1' });
      expect(await ann.activities.delete({ id: activity.id })).toMatchObject({
        id: activity.id,
      });
    });
  });

  describe('tasks', () => {
    it('create, find open ones, mark done, and delete', async () => {
      const { ann, ben } = setup();

      const call = await ann.tasks.create({
        title: 'Call Ada',
        dueDate: '2026-11-30',
        assigneeId: 'u2',
      });
      expect(call).toMatchObject({ done: false, assigneeId: 'u2' });
      // Any member reads and writes a task.
      const open = await ben.tasks.find({
        where: {
          assigneeId: { eq: 'u2' },
          done: { eq: false },
          dueDate: { lte: '2026-12-01' },
        },
      });
      expect(open.docs).toEqual([call]);

      const done = await ben.tasks.update({ id: call.id, done: true });
      expect(done.done).toBe(true);
      expect(await ben.tasks.count({ where: { done: { eq: false } } })).toEqual(
        { count: 0 },
      );

      expect(await ann.tasks.delete({ id: call.id })).toMatchObject({
        id: call.id,
      });
    });
  });

  describe('onDelete', () => {
    it('a deleted company or contact takes its activities and tasks; an archived deal keeps them', async () => {
      const { ann, repos } = setup();
      const acme = await ann.companies.create({ name: 'Acme' });
      const bolt = await ann.companies.create({ name: 'Bolt' });
      const ada = await ann.contacts.create({
        name: 'Ada',
        email: 'ada@bolt.test',
        companyId: bolt.id,
      });
      const deal = await ann.deals.create({
        title: 'Big one',
        companyId: bolt.id,
        amount: 1,
      });
      const on = (parent: Record<string, string>) =>
        Promise.all([
          ann.activities.log({
            kind: 'note',
            body: 'Note',
            occurredAt,
            ...parent,
          }),
          ann.tasks.create({ title: 'Task', ...parent }),
        ]);
      await on({ companyId: acme.id });
      await on({ contactId: ada.id });
      const [dealActivity, dealTask] = await on({ dealId: deal.id });

      await ann.companies.delete({ id: acme.id });
      await ann.contacts.delete({ id: ada.id });
      await ann.deals.delete({ id: deal.id });

      // Only the deal's are left: the deal was archived, not removed.
      expect(
        (await repos.activities.find({}, unscoped)).docs.map((doc) => doc.id),
      ).toEqual([dealActivity.id]);
      expect(
        (await repos.tasks.find({}, unscoped)).docs.map((doc) => doc.id),
      ).toEqual([dealTask.id]);
    });
  });

  describe('tenancy', () => {
    it('a member reads only its organization’s activities and tasks', async () => {
      const { ann, cy } = setup();
      const activity = await ann.activities.log({
        kind: 'meeting',
        body: 'Kickoff',
        occurredAt,
        companyId: 'c1',
      });
      const task = await ann.tasks.create({ title: 'Send notes' });

      expect((await cy.activities.find({})).docs).toEqual([]);
      expect((await cy.tasks.find({})).docs).toEqual([]);
      for (const result of [
        await asResult(cy.activities.get({ id: activity.id })),
        await asResult(cy.tasks.get({ id: task.id })),
      ]) {
        expect(result).toMatchObject({
          ok: false,
          error: { code: 'NOT_FOUND' },
        });
      }
    });
  });
});
