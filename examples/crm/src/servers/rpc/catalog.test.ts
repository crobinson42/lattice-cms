import { MemoryStore } from '@latticecms/core';
import { describe, expect, it } from 'vitest';
import { httpSetup } from '../../test/http.js';

/** GET /catalog.json from the crm's edge, sent with `token` if given. */
async function getCatalog(setup: ReturnType<typeof httpSetup>, token?: string) {
  const response = await setup.fetch(
    new Request('http://localhost/catalog.json', {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    }),
  );
  const body: unknown = await response.json();
  return { status: response.status, body };
}

/** The meta of the procedure with `key` in a catalog, or undefined. */
function metaOf(catalog: unknown, key: string): unknown {
  if (typeof catalog !== 'object' || catalog === null) return undefined;
  const procedures = Object.entries(catalog).find(
    ([name]) => name === 'procedures',
  )?.[1];
  if (!Array.isArray(procedures)) return undefined;
  const found: unknown = procedures.find(
    (procedure: unknown) =>
      typeof procedure === 'object' &&
      procedure !== null &&
      'key' in procedure &&
      procedure.key === key,
  );
  return typeof found === 'object' && found !== null && 'meta' in found
    ? found.meta
    : undefined;
}

describe('GET /catalog.json', () => {
  it('is for a signed-in user only, with the body /rpc sends', async () => {
    const setup = httpSetup(new MemoryStore());
    const openapi = await setup.fetch(
      new Request('http://localhost/openapi.json'),
    );

    const refused = await getCatalog(setup);

    expect(refused).toEqual({ status: 401, body: await openapi.json() });
  });

  it('carries every procedure with Lattice’s facts, the deal contacts relation too', async () => {
    const setup = httpSetup(new MemoryStore());
    // Any signed-in user: no organization is needed.
    const { status, body } = await getCatalog(setup, await setup.signIn('ann'));

    expect(status).toBe(200);
    const label = { singular: 'deal', plural: 'deals' };
    expect(metaOf(body, 'deals/contacts/list')).toMatchObject({
      mcp: { effect: 'read' },
      lattice: {
        collection: 'deals',
        label,
        operation: 'list',
        relation: 'contacts',
      },
    });
    expect(metaOf(body, 'deals/contacts/set')).toMatchObject({
      mcp: { effect: 'destructive' },
      lattice: {
        collection: 'deals',
        label,
        operation: 'set',
        relation: 'contacts',
      },
    });
    expect(metaOf(body, 'deals/close')).toMatchObject({
      lattice: { collection: 'deals', operation: 'method', method: 'close' },
    });
    expect(metaOf(body, 'organizations/find')).toMatchObject({
      lattice: {
        collection: 'organizations',
        label: { singular: 'organization', plural: 'organizations' },
        operation: 'find',
      },
    });
  });
});
