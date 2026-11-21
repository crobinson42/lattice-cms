import { unscoped } from '@latticecms/core';
import { describe, expect, it } from 'vitest';
import { httpSetup, rpcRequest } from '../../test/http.js';
import { backends, storeOf } from '../../test/stores.js';

/** Who calls: a user acting in an organization, or a support user. */
type Caller = { readonly user: string; readonly org?: string };

describe.each(backends)('tenant isolation over HTTP on $name', (backend) => {
  const store = storeOf(backend);

  /**
   * The edge with real sessions: each caller signs in once, and members
   * get their memberships. `sam` is support.
   */
  async function setup() {
    const s = httpSetup(store(), { support: ['sam'] });
    await s.member('ada', 'org-a');
    await s.member('bea', 'org-b');
    // cyd works in both organizations.
    await s.member('cyd', 'org-a');
    await s.member('cyd', 'org-b');
    const tokens = new Map<string, string>();
    for (const user of ['ada', 'bea', 'cyd', 'sam']) {
      tokens.set(user, await s.signIn(user));
    }
    /** Calls `path` as `caller`, and returns the response body. */
    async function rpc(caller: Caller, path: string, input: unknown) {
      const token = tokens.get(caller.user);
      if (token === undefined) throw new Error(`${caller.user} has no session`);
      const response = await s.fetch(
        rpcRequest(
          path,
          input,
          caller.org === undefined ? { token } : { token, org: caller.org },
        ),
      );
      const body: unknown = await response.json();
      return body;
    }
    /** The output of a call that must succeed. */
    async function ok(caller: Caller, path: string, input: unknown) {
      const body = await rpc(caller, path, input);
      if (
        typeof body !== 'object' ||
        body === null ||
        !('ok' in body) ||
        body.ok !== true ||
        !('output' in body)
      ) {
        throw new Error(`${path}: ${JSON.stringify(body)}`);
      }
      return body.output;
    }
    /** The error code of a call, or 'ok'. */
    async function code(caller: Caller, path: string, input: unknown) {
      const body = await rpc(caller, path, input);
      return typeof body === 'object' &&
        body !== null &&
        'error' in body &&
        typeof body.error === 'object' &&
        body.error !== null &&
        'code' in body.error
        ? body.error.code
        : 'ok';
    }
    return { ...s, ok, code };
  }

  const a = { user: 'ada', org: 'org-a' };
  const b = { user: 'bea', org: 'org-b' };

  /** One company with a contact and two deals in each organization. */
  async function seeded() {
    const s = await setup();
    const seed = async (caller: Caller, name: string) => {
      const company = await s.ok(caller, 'companies/create', { name });
      const id = idOf(company);
      await s.ok(caller, 'contacts/create', {
        name: `Contact of ${name}`,
        email: `contact@${name}.test`,
        companyId: id,
      });
      for (const title of ['one', 'two']) {
        await s.ok(caller, 'deals/create', { title, companyId: id, amount: 1 });
      }
      return id;
    };
    return { ...s, acme: await seed(a, 'acme'), bolt: await seed(b, 'bolt') };
  }

  it('find, count and get see only the caller’s organization', async () => {
    const { ok, code, acme, bolt } = await seeded();

    expect(names(await ok(a, 'companies/find', {}))).toEqual(['acme']);
    expect(names(await ok(b, 'companies/find', {}))).toEqual(['bolt']);
    expect(await ok(a, 'deals/count', {})).toEqual({ count: 2 });
    // An id from another organization is not there at all.
    expect(await code(a, 'companies/get', { id: bolt })).toBe('NOT_FOUND');
    expect(await code(b, 'companies/get', { id: acme })).toBe('NOT_FOUND');
    // A where on the tenant field cannot reach past the tenant filter.
    expect(
      await ok(a, 'companies/find', {
        where: { organizationId: { eq: 'org-b' } },
      }),
    ).toMatchObject({ docs: [] });
  });

  it('update and delete cannot reach another organization’s rows', async () => {
    const { ok, code, bolt } = await seeded();

    expect(await code(a, 'companies/update', { id: bolt, name: 'mine' })).toBe(
      'NOT_FOUND',
    );
    expect(await code(a, 'companies/delete', { id: bolt })).toBe('NOT_FOUND');
    expect(names(await ok(b, 'companies/find', {}))).toEqual(['bolt']);
  });

  it('a cursor pages within its organization only', async () => {
    const { ok } = await seeded();
    const first = await ok(a, 'deals/find', { sort: ['title'], limit: 1 });
    const after = nextOf(first);

    expect(
      titles(await ok(a, 'deals/find', { sort: ['title'], limit: 1, after })),
    ).toEqual(['two']);
    // A's cursor in B's call is only a position: B reads its own rows
    // after it, never A's.
    const theirs = await ok(b, 'deals/find', { sort: ['title'], after });
    expect(orgsOf(theirs)).toEqual(['org-b']);
  });

  it('population withholds another organization’s document', async () => {
    const { ok, acme } = await seeded();
    // A write does not check its refs, so B can store A's company id.
    const stray = await ok(b, 'contacts/create', {
      name: 'Stray',
      email: 'stray@bolt.test',
      companyId: acme,
    });

    const got = await ok(b, 'contacts/get', {
      id: idOf(stray),
      populate: ['companyId'],
    });
    expect(fieldOf(got, 'companyId')).toEqual({ id: acme });
  });

  it('a restrict counts only the deleted row’s own organization', async () => {
    const { ok, code } = await seeded();
    const lone = idOf(await ok(a, 'companies/create', { name: 'lone' }));
    // B's contact stores A's id; it does not hold A's company in place.
    await ok(b, 'contacts/create', {
      name: 'Stray',
      email: 'stray@bolt.test',
      companyId: lone,
    });

    expect(await code(a, 'companies/delete', { id: lone })).toBe('ok');
  });

  it('a member of two organizations switches by the header, with one session', async () => {
    const { ok } = await seeded();

    expect(
      names(await ok({ user: 'cyd', org: 'org-a' }, 'companies/find', {})),
    ).toEqual(['acme']);
    expect(
      names(await ok({ user: 'cyd', org: 'org-b' }, 'companies/find', {})),
    ).toEqual(['bolt']);
  });

  it('a membership revoked mid-session stops the next call', async () => {
    const { ok, code, repos } = await seeded();
    const cyd = { user: 'cyd', org: 'org-b' };
    expect(names(await ok(cyd, 'companies/find', {}))).toEqual(['bolt']);

    const { docs } = await repos.memberships.find(
      { where: { userId: { eq: 'cyd' }, organizationId: { eq: 'org-b' } } },
      unscoped,
    );
    for (const doc of docs) await repos.memberships.remove(doc.id, unscoped);

    expect(await code(cyd, 'companies/find', {})).toBe('FORBIDDEN');
    // The session itself is still good in the organization cyd kept.
    expect(
      names(await ok({ user: 'cyd', org: 'org-a' }, 'companies/find', {})),
    ).toEqual(['acme']);
  });

  it('a member cannot name another organization to reach its rows', async () => {
    const { code } = await seeded();

    expect(
      await code({ user: 'ada', org: 'org-b' }, 'companies/find', {}),
    ).toBe('FORBIDDEN');
  });

  it('support reads every organization, cannot write, and each bypass is logged', async () => {
    const { ok, code, logger, acme } = await seeded();
    const support = { user: 'sam' };

    expect(
      names(await ok(support, 'companies/find', { sort: ['name'] })),
    ).toEqual(['acme', 'bolt']);
    expect(
      await code(support, 'companies/update', { id: acme, name: 'x' }),
    ).toBe('FORBIDDEN');
    expect(
      logger.records
        .filter((record) => record.message === 'tenancy.bypass')
        .map((record) => record.fields),
    ).toMatchObject([
      {
        actorId: 'sam',
        collection: 'companies',
        action: 'find',
        tenancy: 'bypass',
      },
    ]);
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function fieldOf(value: unknown, field: string): unknown {
  if (!isRecord(value)) throw new Error('not an object');
  return value[field];
}

function idOf(doc: unknown): string {
  const id = fieldOf(doc, 'id');
  if (typeof id !== 'string') throw new Error('no id');
  return id;
}

function docsOf(page: unknown): unknown[] {
  const docs = fieldOf(page, 'docs');
  if (!Array.isArray(docs)) throw new Error('no docs');
  return docs;
}

function nextOf(page: unknown): string {
  const next = fieldOf(page, 'next');
  if (typeof next !== 'string') throw new Error('no next');
  return next;
}

const names = (page: unknown) =>
  docsOf(page).map((doc) => fieldOf(doc, 'name'));
const titles = (page: unknown) =>
  docsOf(page).map((doc) => fieldOf(doc, 'title'));
const orgsOf = (page: unknown) => [
  ...new Set(docsOf(page).map((doc) => fieldOf(doc, 'organizationId'))),
];
