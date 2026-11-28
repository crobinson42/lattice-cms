import { LatticeError, MemoryStore, unscoped } from '@latticecms/core';
import type { FindQuery } from '@latticecms/core/store';
import { describe, expect, it } from 'vitest';
import { httpSetup, refusals, rpcRequest } from '../../test/http.js';
import { backends, storeOf } from '../../test/stores.js';

describe.each(backends)('the caller’s organizations on $name', (backend) => {
  const store = storeOf(backend);

  /** ann is a member of Zeta and Acme, bob of Other, and sam is support. */
  async function setup() {
    const s = httpSetup(store(), { support: ['sam'] });
    const organizations = s.repos.organizations;
    const zeta = await organizations.insert({ name: 'Zeta' }, unscoped);
    const acme = await organizations.insert({ name: 'Acme' }, unscoped);
    const other = await organizations.insert({ name: 'Other' }, unscoped);
    await s.member('ann', zeta.id);
    await s.member('ann', acme.id, 'manager');
    await s.member('bob', other.id);
    /** POST /auth/organizations, with no organization header. */
    async function listed(token?: string) {
      const response = await s.fetch(
        new Request('http://localhost/auth/organizations', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token === undefined
              ? {}
              : { authorization: `Bearer ${token}` }),
          },
          body: JSON.stringify({ input: {} }),
        }),
      );
      const body: unknown = await response.json();
      return { status: response.status, body };
    }
    return { ...s, zeta, acme, other, listed };
  }

  it('lists a member’s organizations by name, with no organization header', async () => {
    const s = await setup();
    const ann = await s.signIn('ann');

    expect(await s.listed(ann)).toEqual({
      status: 200,
      body: {
        ok: true,
        output: [
          { id: s.acme.id, name: 'Acme' },
          { id: s.zeta.id, name: 'Zeta' },
        ],
      },
    });
    // /rpc needs the header that /auth/organizations does without.
    const rpc = await s.fetch(rpcRequest('companies/find', {}, { token: ann }));
    expect(rpc.status).toBe(403);
  });

  it('lists none for support, which acts in no organization', async () => {
    const s = await setup();

    expect(await s.listed(await s.signIn('sam'))).toEqual({
      status: 200,
      body: { ok: true, output: [] },
    });
  });

  it('is the edge’s one 401 without a live session', async () => {
    const s = await setup();
    const rpc = await s.fetch(rpcRequest('companies/find', {}, {}));
    const rpcBody: unknown = await rpc.json();

    const missing = await s.listed();
    const bad = await s.listed('not-a-token');

    expect(missing).toEqual({ status: 401, body: rpcBody });
    expect(bad).toEqual({ status: 401, body: rpcBody });
    expect(refusals(s.logger)).toContainEqual(['UNAUTHORIZED', 'missing']);
    expect(
      s.logger.records.filter(
        (record) =>
          record.message === 'auth' && record.fields.outcome === 'refused',
      ),
    ).toHaveLength(2);
  });
});

describe.each(backends)('organizations through /rpc on $name', (backend) => {
  const store = storeOf(backend);

  it('a member reads only the organization it acts in, and support reads all', async () => {
    const s = httpSetup(store(), { support: ['sam'] });
    const acme = await s.repos.organizations.insert({ name: 'Acme' }, unscoped);
    const zeta = await s.repos.organizations.insert({ name: 'Zeta' }, unscoped);
    await s.member('ann', acme.id);
    await s.member('ann', zeta.id);
    const ann = await s.signIn('ann');
    const rpc = async (
      path: string,
      input: unknown,
      token: string,
      org?: string,
    ) => {
      const response = await s.fetch(
        rpcRequest(path, input, org === undefined ? { token } : { token, org }),
      );
      const body: unknown = await response.json();
      return body;
    };

    expect(await rpc('organizations/find', {}, ann, acme.id)).toMatchObject({
      ok: true,
      output: { docs: [{ id: acme.id, name: 'Acme' }], next: null },
    });
    expect(
      await rpc('organizations/get', { id: zeta.id }, ann, acme.id),
    ).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(
      await rpc('organizations/create', { name: 'Mine' }, ann, acme.id),
    ).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(
      await rpc(
        'organizations/find',
        { sort: ['name'] },
        await s.signIn('sam'),
      ),
    ).toMatchObject({
      ok: true,
      output: { docs: [{ name: 'Acme' }, { name: 'Zeta' }] },
    });
  });
});

it('sends a Lattice error from /auth as /rpc sends it, not as INTERNAL', async () => {
  // A store that refuses every membership read, as a repo can.
  class Refusing extends MemoryStore {
    override async find(query: FindQuery) {
      if (query.collection !== 'memberships') return super.find(query);
      throw LatticeError.NOT_FOUND({ collection: 'memberships', id: 'x' });
    }
  }
  const s = httpSetup(new Refusing());
  const ann = s.logger.records.length;
  const token = await s.signIn('ann');

  const response = await s.fetch(
    new Request('http://localhost/auth/organizations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ input: {} }),
    }),
  );
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({
    ok: false,
    error: {
      code: 'NOT_FOUND',
      message: 'No document with this id',
      data: { collection: 'memberships', id: 'x' },
    },
  });
  expect(
    s.logger.records
      .slice(ann)
      .filter((record) => record.fields.outcome === 'refused')
      .map((record) => [record.message, record.fields.code]),
  ).toEqual([['auth.organizations', 'NOT_FOUND']]);
});
