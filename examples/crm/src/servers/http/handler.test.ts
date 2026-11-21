import { MemorySessionStore, Sessions } from '@hexok/auth';
import { JoseSessionToken } from '@hexok/auth-jose';
import { MemoryStore, tenancy } from '@latticecms/core';
import { describe, expect, it } from 'vitest';
import type { Identity } from '../../infra/auth/sessions.js';
import { httpSetup, refusals, rpcRequest } from '../../test/http.js';
import { testSessions, testToken } from '../../test/sessions.js';
import { backends, storeOf } from '../../test/stores.js';
import { Deals } from '../rpc/contract.js';

/** A store that is down: every read fails. */
class DownStore extends MemoryStore {
  override async get(): Promise<never> {
    throw new Error('store down');
  }
}

/** Sessions whose store does not answer, as when Redis is down. */
class DownSessions extends Sessions<Identity> {
  override async authenticate(): Promise<never> {
    throw new Error('sessions down');
  }
}

/** Another deploy's signing secret: its tokens prove nothing here. */
const otherSecret = 'b3RoZXItc2VjcmV0LWZvci1jcm0tdGVzdHMtb25seS0zMmI';

describe.each(backends)('the HTTP edge on $name', (backend) => {
  const store = storeOf(backend);

  /** u1, a member of o1, signed in. */
  async function signedIn() {
    const s = httpSetup(store());
    await s.member('u1', 'o1');
    return { ...s, token: await s.signIn('u1') };
  }

  it('closes a deal for a signed-in member of the organization', async () => {
    const { fetch, repos, token } = await signedIn();
    // Trusted code writes with a tenant scope it names.
    const deal = await repos.deals.insert(
      { title: 'Big one', companyId: 'c1', amount: 1 },
      tenancy.scope(Deals, 'o1'),
    );

    const response = await fetch(
      rpcRequest(
        'deals/close',
        { id: deal.id, outcome: 'won' },
        { token, org: 'o1' },
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      output: { id: deal.id, stage: 'won', organizationId: 'o1' },
    });
  });

  it('is 401 UNAUTHORIZED, with one body, for every credential it cannot use', async () => {
    let clock = Date.now() - 24 * 60 * 60 * 1000;
    const sessions = testSessions({ now: () => clock });
    const s = httpSetup(store(), { sessions });
    await s.member('u1', 'o1');
    // Opened a day ago: its token is past its absolute end.
    const expired = await s.signIn('u1');
    clock = Date.now();
    const ended = await s.signIn('u1');
    await sessions.close(ended);
    const foreign = await testSessions({ secret: otherSecret }).open({
      userId: 'u1',
    });

    const attempts: Record<string, string>[] = [
      {},
      { authorization: 'Basic dTE6cGFzc3dvcmQ=' },
      { authorization: 'Bearer not-a-token' },
      { authorization: `Bearer ${foreign}` },
      { authorization: `Bearer ${expired}` },
      { authorization: `Bearer ${ended}` },
    ];
    const bodies = [];
    for (const headers of attempts) {
      const response = await s.fetch(
        rpcRequest('deals/find', {}, { org: 'o1', headers }),
      );
      expect(response.status).toBe(401);
      bodies.push(await response.json());
    }

    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
    expect(bodies[0]).toEqual({
      ok: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'The actor is missing or invalid',
      },
    });
    // The reason is logged, never sent.
    expect(refusals(s.logger)).toEqual([
      ['UNAUTHORIZED', 'missing'],
      ['UNAUTHORIZED', 'missing'],
      ['UNAUTHORIZED', 'invalid'],
      ['UNAUTHORIZED', 'invalid'],
      ['UNAUTHORIZED', 'expired'],
      ['UNAUTHORIZED', 'ended'],
    ]);
  });

  it('is 403 FORBIDDEN, with one body, without a membership of the named organization', async () => {
    const s = await signedIn();
    await s.member('u2', 'o2');

    const bodies = [];
    // No organization; another user's; one that does not exist.
    for (const org of [undefined, 'o2', 'no-such-org']) {
      const response = await s.fetch(
        rpcRequest(
          'deals/find',
          {},
          org === undefined ? { token: s.token } : { token: s.token, org },
        ),
      );
      expect(response.status).toBe(403);
      bodies.push(await response.json());
    }

    // An organization that does not exist looks like one the user is not in.
    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
    expect(bodies[0]).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'The actor may not do this' },
    });
    expect(refusals(s.logger)).toEqual([
      ['FORBIDDEN', 'no-organization'],
      ['FORBIDDEN', 'not-a-member'],
      ['FORBIDDEN', 'not-a-member'],
    ]);
  });

  it('answers a missing deal with Lattice’s NOT_FOUND, its status and data', async () => {
    const { fetch, token } = await signedIn();

    const response = await fetch(
      rpcRequest(
        'deals/close',
        { id: 'nope', outcome: 'won' },
        { token, org: 'o1' },
      ),
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

  it('logout ends the session: the same token is then 401', async () => {
    const { fetch, token } = await signedIn();
    const find = () =>
      fetch(rpcRequest('deals/find', {}, { token, org: 'o1' }));
    expect((await find()).status).toBe(200);

    const logout = (headers: Record<string, string>) =>
      fetch(
        new Request('http://localhost/auth/logout', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify({ input: {} }),
        }),
      );

    const out = await logout({ authorization: `Bearer ${token}` });
    expect(out.status).toBe(200);
    expect(await out.json()).toEqual({ ok: true, output: null });
    expect((await find()).status).toBe(401);
    // No token is already signed out.
    expect((await logout({})).status).toBe(200);
  });

  it('serves /health without a session, and 404 elsewhere', async () => {
    const { fetch } = httpSetup(store());

    const health = await fetch(new Request('http://localhost/health'));
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });
    expect((await fetch(new Request('http://localhost/nope'))).status).toBe(
      404,
    );
  });
});

describe('a failure behind the edge', () => {
  it('answers 500 INTERNAL for a store failure inside a use case, logged once', async () => {
    const s = httpSetup(new DownStore());
    await s.member('u1', 'o1');
    const token = await s.signIn('u1');

    const response = await s.fetch(
      rpcRequest(
        'deals/close',
        { id: 'd1', outcome: 'won' },
        { token, org: 'o1' },
      ),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: 'Internal server error' },
    });
    // The family's line; the edge's onError does not log it again.
    expect(s.logger.records).toMatchObject([
      {
        level: 'error',
        message: 'store down',
        fields: { action: 'close', outcome: 'failed' },
      },
    ]);
  });

  it('answers 500 INTERNAL, not 401, when the session store does not answer', async () => {
    const sessions = new DownSessions({
      store: new MemorySessionStore<Identity>({
        idleSeconds: 60,
        absoluteSeconds: 120,
      }),
      token: new JoseSessionToken({
        secrets: [otherSecret],
        ...testToken,
      }),
    });
    const s = httpSetup(new MemoryStore(), { sessions });

    const response = await s.fetch(
      rpcRequest(
        'deals/find',
        {},
        { headers: { authorization: 'Bearer any' }, org: 'o1' },
      ),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL' },
    });
    expect(s.logger.records).toMatchObject([
      { level: 'error', message: 'sessions down' },
    ]);
  });
});
