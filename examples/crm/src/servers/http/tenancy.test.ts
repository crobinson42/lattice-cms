import { MemoryLogger } from '@hexok/logger';
import { describe, expect, it } from 'vitest';
import { MemoryDomainEventPublisher } from '../../infra/events/memory-domain-events.js';
import { backends, storeOf } from '../../test/stores.js';
import { createApp } from '../app.js';
import {
  createHttpHandler,
  devOrgHeader,
  devSupportHeader,
  devUserHeader,
} from './handler.js';

/** A caller's headers. */
type Caller = { readonly org: string; readonly support?: boolean };

describe.each(backends)('tenant isolation over HTTP on $name', (backend) => {
  const store = storeOf(backend);

  function setup() {
    const logger = new MemoryLogger();
    const crm = createApp({
      store: store(),
      events: new MemoryDomainEventPublisher(),
    });
    const fetch = createHttpHandler(crm, { logger });
    /** Calls `path` as `caller`, and returns the response body. */
    async function rpc(caller: Caller, path: string, input: unknown) {
      const response = await fetch(
        new Request(`http://localhost/rpc/${path}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [devUserHeader]: `user-of-${caller.org}`,
            [devOrgHeader]: caller.org,
            ...(caller.support === true ? { [devSupportHeader]: 'true' } : {}),
          },
          body: JSON.stringify({ input }),
        }),
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
    return { logger, ok, code };
  }

  const a = { org: 'org-a' };
  const b = { org: 'org-b' };

  /** One company with a contact and two deals in each organization. */
  async function seeded() {
    const s = setup();
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

  it('support reads every organization, cannot write, and each bypass is logged', async () => {
    const { ok, code, logger, acme } = await seeded();
    const support = { org: 'org-support', support: true };

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
        actorId: 'user-of-org-support',
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
