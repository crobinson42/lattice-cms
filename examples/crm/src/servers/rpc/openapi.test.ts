import { MemoryStore } from '@latticecms/core';
import { describe, expect, it, vi } from 'vitest';
import { httpSetup, refusals } from '../../test/http.js';

/** The value at `path` in `value`, through objects and arrays. */
function at(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = Object.entries(current).find(([name]) => name === key)?.[1];
  }
  return current;
}

/** The keys of the object at `path`, sorted. */
function keysAt(value: unknown, path: readonly string[]): string[] {
  const found = at(value, path);
  if (typeof found !== 'object' || found === null) return [];
  return Object.keys(found).sort();
}

/** GET /openapi.json from the crm's edge, sent with `token` if given. */
function getDocument(setup: ReturnType<typeof httpSetup>, token?: string) {
  return setup.fetch(
    new Request('http://localhost/openapi.json', {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    }),
  );
}

/** The document, as a signed-in user with no organization gets it. */
async function fetchDocument() {
  // The codegen profile names the inline objects it hoists, and warns that
  // it made the names up. The snapshot below records them.
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const setup = httpSetup(new MemoryStore());
    const response = await getDocument(setup, await setup.signIn('ann'));
    expect(response.status).toBe(200);
    const text = await response.text();
    const document: unknown = JSON.parse(text);
    return { text, document };
  } finally {
    warn.mockRestore();
  }
}

describe('GET /openapi.json', () => {
  it('needs a session: none, or a dead one, is the 401 /rpc sends', async () => {
    const setup = httpSetup(new MemoryStore());

    for (const token of [undefined, 'not-a-session']) {
      const response = await getDocument(setup, token);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        ok: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'The actor is missing or invalid',
        },
      });
    }
    expect(refusals(setup.logger)).toEqual([
      ['UNAUTHORIZED', 'missing'],
      ['UNAUTHORIZED', 'invalid'],
    ]);
  });

  it('is served to a signed-in user, with no organization needed', async () => {
    const { document } = await fetchDocument();

    expect(at(document, ['openapi'])).toBe('3.1.0');
  });

  it('describes the API at /rpc, shaped for codegen', async () => {
    const { document } = await fetchDocument();

    expect({
      openapi: at(document, ['openapi']),
      paths: keysAt(document, ['paths']),
      schemas: keysAt(document, ['components', 'schemas']),
    }).toMatchSnapshot();
    expect(at(document, ['paths', '/rpc/deals/find', 'post', 'summary'])).toBe(
      'Find deals. Filter with where, order with sort, and page with limit and after (the previous page’s next). populate expands companyId into documents.',
    );
  });

  it('marks populated reads with x-ts-pf-expand', async () => {
    const { document } = await fetchDocument();

    // get populates refs and many() relations; find, refs only.
    expect(
      at(document, ['paths', '/rpc/deals/get', 'post', 'x-ts-pf-expand']),
    ).toEqual({ key: 'populate', at: [], fields: ['companyId', 'contacts'] });
    expect(
      at(document, ['paths', '/rpc/deals/find', 'post', 'x-ts-pf-expand']),
    ).toEqual({ key: 'populate', at: ['docs'], fields: ['companyId'] });
    expect(
      at(document, ['paths', '/rpc/companies/get', 'post', 'x-ts-pf-expand']),
    ).toBeUndefined();
  });

  it('gives amount as optional, saying why, and says a where on it may be refused', async () => {
    const { document } = await fetchDocument();
    const deal = at(document, ['components', 'schemas', 'DealsGetOutput']);

    expect(at(deal, ['required'])).not.toContain('amount');
    expect(at(deal, ['properties', 'amount', 'description'])).toBe(
      'Withheld when the caller may not read it.',
    );
    const where = at(document, [
      'components',
      'schemas',
      'DealsFindInputSchema0',
      'properties',
      'amount',
      '$ref',
    ]);
    expect(where).toBe('#/components/schemas/DealsFindInputSchema0Amount');
    expect(
      at(document, [
        'components',
        'schemas',
        'DealsFindInputSchema0Amount',
        'description',
      ]),
    ).toBe('Refused (VALIDATION) when the caller may not read amount.');
  });

  it('holds nothing of sign-in: no /auth, credentials or login attempts', async () => {
    const { text } = await fetchDocument();

    for (const word of [
      '/auth',
      'login',
      'password',
      'hash',
      'credential',
      'attempt',
      'scrypt',
      'session',
    ]) {
      expect(text.toLowerCase()).not.toContain(word);
    }
  });
});
