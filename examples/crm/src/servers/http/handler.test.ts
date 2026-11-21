import { MemoryLogger } from '@hexok/logger';
import { MemoryStore, unscoped } from '@latticecms/core';
import { describe, expect, it } from 'vitest';
import { MemoryDomainEventPublisher } from '../../infra/events/memory-domain-events.js';
import { createApp } from '../app.js';
import { createHttpHandler, devUserHeader } from './handler.js';

/** A store that is down: every read fails. */
class DownStore extends MemoryStore {
  override async get(): Promise<never> {
    throw new Error('store down');
  }
}

function setup(store = new MemoryStore()) {
  const logger = new MemoryLogger();
  const crm = createApp({ store, events: new MemoryDomainEventPublisher() });
  return { ...crm, logger, fetch: createHttpHandler(crm, { logger }) };
}

function call(path: string, input: unknown, user?: string): Request {
  return new Request(`http://localhost/rpc/${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(user === undefined ? {} : { [devUserHeader]: user }),
    },
    body: JSON.stringify({ input }),
  });
}

describe('POST /rpc/deals/close', () => {
  it('closes the deal for a caller named by the dev header', async () => {
    const { fetch, repos } = setup();
    const deal = await repos.deals.insert(
      {
        title: 'Big one',
        companyId: 'c1',
        amount: 1,
        stage: 'lead',
        archived: false,
      },
      unscoped,
    );

    const response = await fetch(
      call('deals/close', { id: deal.id, outcome: 'won' }, 'u1'),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      output: { id: deal.id, stage: 'won' },
    });
  });

  it('is 401 UNAUTHORIZED without the dev header, logged once', async () => {
    const { fetch, logger } = setup();

    const response = await fetch(
      call('deals/close', { id: 'd1', outcome: 'won' }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHORIZED' },
    });
    expect(logger.records).toMatchObject([
      { level: 'info', fields: { outcome: 'refused', code: 'UNAUTHORIZED' } },
    ]);
  });

  it('answers a missing deal with Lattice’s NOT_FOUND, its status and data', async () => {
    const { fetch } = setup();

    const response = await fetch(
      call('deals/close', { id: 'nope', outcome: 'won' }, 'u1'),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: 'No document with this id',
        data: { collection: 'deals', id: 'nope' },
      },
    });
  });

  it('answers 500 INTERNAL for a failure inside a use case, logged once', async () => {
    const { fetch, logger } = setup(new DownStore());

    const response = await fetch(
      call('deals/close', { id: 'd1', outcome: 'won' }, 'u1'),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: 'Internal server error' },
    });
    // The family's line; the edge's onError does not log it again.
    expect(logger.records).toMatchObject([
      {
        level: 'error',
        message: 'store down',
        fields: { action: 'close', outcome: 'failed' },
      },
    ]);
  });
});
