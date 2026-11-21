import { MemoryLogger } from '@hexok/logger';
import { type CollectionStore, MemoryStore, tenancy } from '@latticecms/core';
import { describe, expect, it } from 'vitest';
import { MemoryDomainEventPublisher } from '../../infra/events/memory-domain-events.js';
import { backends, storeOf } from '../../test/stores.js';
import { createApp } from '../app.js';
import { Deals } from '../rpc/contract.js';
import { createHttpHandler, devOrgHeader, devUserHeader } from './handler.js';

/** A store that is down: every read fails. */
class DownStore extends MemoryStore {
  override async get(): Promise<never> {
    throw new Error('store down');
  }
}

function setup(store: CollectionStore) {
  const logger = new MemoryLogger();
  const crm = createApp({ store, events: new MemoryDomainEventPublisher() });
  return { ...crm, logger, fetch: createHttpHandler(crm, { logger }) };
}

/** A POST to `path`, as user u1 of organization o1 unless told otherwise. */
function call(
  path: string,
  input: unknown,
  headers: Record<string, string> = {
    [devUserHeader]: 'u1',
    [devOrgHeader]: 'o1',
  },
): Request {
  return new Request(`http://localhost/rpc/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ input }),
  });
}

describe.each(backends)('POST /rpc/deals/close on $name', (backend) => {
  const store = storeOf(backend);

  it('closes the deal for a caller named by the dev headers', async () => {
    const { fetch, repos } = setup(store());
    // Trusted code writes with a tenant scope it names.
    const deal = await repos.deals.insert(
      {
        title: 'Big one',
        companyId: 'c1',
        amount: 1,
        stage: 'lead',
        archived: false,
      },
      tenancy.scope(Deals, 'o1'),
    );

    const response = await fetch(
      call('deals/close', { id: deal.id, outcome: 'won' }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      output: { id: deal.id, stage: 'won', organizationId: 'o1' },
    });
  });

  it('is 401 UNAUTHORIZED without the user or the organization, logged once each', async () => {
    const { fetch, logger } = setup(store());

    for (const headers of [
      { [devOrgHeader]: 'o1' },
      { [devUserHeader]: 'u1' },
    ]) {
      const response = await fetch(
        call('deals/close', { id: 'd1', outcome: 'won' }, headers),
      );
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: { code: 'UNAUTHORIZED' },
      });
    }
    expect(logger.records).toMatchObject([
      { level: 'info', fields: { outcome: 'refused', code: 'UNAUTHORIZED' } },
      { level: 'info', fields: { outcome: 'refused', code: 'UNAUTHORIZED' } },
    ]);
  });

  it('answers a missing deal with Lattice’s NOT_FOUND, its status and data', async () => {
    const { fetch } = setup(store());

    const response = await fetch(
      call('deals/close', { id: 'nope', outcome: 'won' }),
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
});

describe('a store that fails', () => {
  it('answers 500 INTERNAL for a failure inside a use case, logged once', async () => {
    const { fetch, logger } = setup(new DownStore());

    const response = await fetch(
      call('deals/close', { id: 'd1', outcome: 'won' }),
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
