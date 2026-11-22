import { tenancy } from '@latticecms/core';
import { describe, expect, it } from 'vitest';
import { httpSetup, rpcRequest } from '../../test/http.js';
import { backends, storeOf } from '../../test/stores.js';
import { Deals } from '../rpc/contract.js';

describe.each(backends)('deal amounts over HTTP on $name', (backend) => {
  const store = storeOf(backend);

  /** ann is a member of org-a, mia its manager, and sam support. */
  async function setup() {
    const s = httpSetup(store(), { support: ['sam'] });
    await s.member('ann', 'org-a');
    await s.member('mia', 'org-a', 'manager');
    const deal = await s.repos.deals.insert(
      { title: 'Big one', companyId: 'c1', amount: 4242 },
      tenancy.scope(Deals, 'org-a'),
    );
    const tokens = {
      ann: await s.signIn('ann'),
      mia: await s.signIn('mia'),
      sam: await s.signIn('sam'),
    };
    /** The body of a call as `user`. */
    async function rpc(
      user: keyof typeof tokens,
      path: string,
      input: unknown,
    ): Promise<unknown> {
      const response = await s.fetch(
        rpcRequest(path, input, { token: tokens[user], org: 'org-a' }),
      );
      const body: unknown = await response.json();
      return body;
    }
    return { ...s, deal, rpc };
  }

  it('a member sees each deal without its amount, on reads and on close', async () => {
    const { rpc, deal } = await setup();

    for (const [path, input] of [
      ['deals/get', { id: deal.id }],
      ['deals/find', {}],
      ['deals/close', { id: deal.id, outcome: 'won' }],
    ] satisfies [string, unknown][]) {
      const body = JSON.stringify(await rpc('ann', path, input));
      expect(body, path).toContain('"Big one"');
      expect(body, path).not.toContain('amount');
      expect(body, path).not.toContain('4242');
    }
  });

  it('a member cannot filter or sort by amount', async () => {
    const { rpc } = await setup();

    for (const input of [
      { where: { amount: { gt: 1000 } } },
      { sort: ['-amount'] },
    ]) {
      expect(await rpc('ann', 'deals/find', input)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION' },
      });
    }
  });

  it('a manager and support see amounts, and a manager filters by them', async () => {
    const { rpc, deal } = await setup();

    for (const user of ['mia', 'sam'] satisfies ('mia' | 'sam')[]) {
      expect(await rpc(user, 'deals/get', { id: deal.id })).toMatchObject({
        ok: true,
        output: { amount: 4242 },
      });
    }
    expect(
      await rpc('mia', 'deals/count', { where: { amount: { gt: 4000 } } }),
    ).toEqual({ ok: true, output: { count: 1 } });
  });
});
