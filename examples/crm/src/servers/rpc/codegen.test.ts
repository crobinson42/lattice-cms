import { MemoryStore, tenancy } from '@latticecms/core';
import { createClient } from '@ts-pf/client';
import { FetchLink } from '@ts-pf/client-http';
import { emit } from '@ts-pf/codegen';
import { catalog } from '@ts-pf/docs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { Companies } from '../../domain/collections/companies.js';
import { Deals } from '../../domain/collections/deals.js';
import type { Contract } from '../../test/client/contract.js';
import { httpSetup } from '../../test/http.js';
import { organizationHeader } from '../http/handler.js';
import { contract } from './contract.js';

// A client in another repo has no server code: it has the contract.d.ts
// ts-pf's codegen prints from the catalog, the same catalog the OpenAPI
// document projects. This file is that client.
describe('a client generated from the catalog', () => {
  it('is the committed contract.d.ts', async () => {
    // A changed contract fails here: run `vitest -u` and commit the file.
    await expect(
      emit(catalog(contract, { prefix: '/rpc' })),
    ).toMatchFileSnapshot('../../test/client/contract.d.ts');
  });

  it('calls the API over HTTP with no casts or annotations, typed per call', async () => {
    const setup = httpSetup(new MemoryStore());
    await setup.member('ann', 'o1');
    const token = await setup.signIn('ann');
    const company = await setup.repos.companies.insert(
      { name: 'Acme' },
      tenancy.scope(Companies, 'o1'),
    );
    const { id } = await setup.repos.deals.insert(
      { title: 'Big one', companyId: company.id, amount: 4242 },
      tenancy.scope(Deals, 'o1'),
    );
    const client = createClient<Contract>(
      new FetchLink({
        url: 'http://localhost/rpc',
        fetch: (input, init) => setup.fetch(new Request(input, init)),
        headers: {
          authorization: `Bearer ${token}`,
          [organizationHeader]: 'o1',
        },
      }),
    );

    const plain = await client.deals.get({ id });
    const populated = await client.deals.get({ id, populate: ['companyId'] });

    expectTypeOf(plain.companyId).toEqualTypeOf<string>();
    // A member may not read the amount, so its type says it may be absent.
    expectTypeOf(plain.amount).toEqualTypeOf<number | undefined>();
    expect(plain.amount).toBeUndefined();
    // A populated ref is the company, or { id } when the caller may not read it.
    const populatedCompany = populated.companyId;
    if (!('name' in populatedCompany)) throw new Error('withheld');
    expect(populatedCompany.name).toBe('Acme');
  });
});
