import { tenancy } from '@latticecms/core';
import type { Client } from '@modelcontextprotocol/client';
import { all, audit, createToolkit } from '@ts-pf/mcp';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import { Deals } from '../../domain/collections/deals.js';
import { type As, httpSetup, refusals } from '../../test/http.js';
import { mcpClient, textOf } from '../../test/mcp.js';
import { backends, storeOf } from '../../test/stores.js';
import { contract } from '../rpc/contract.js';
import { crmTools } from './toolset.js';

const clients: Client[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
});

/** A client of `setup`'s `/mcp`, closed after the test. */
async function connect(
  setup: ReturnType<typeof httpSetup>,
  as: As,
): Promise<Client> {
  const client = await mcpClient(setup.fetch, as);
  clients.push(client);
  return client;
}

/** The parsed JSON a tool returned. */
function outputOf(result: { readonly content?: unknown }): unknown {
  return JSON.parse(textOf(result));
}

/** The `$defs` entry a `$ref` names, or the schema itself. */
function resolved(root: unknown, schema: unknown): unknown {
  if (typeof schema !== 'object' || schema === null) return schema;
  if (!('$ref' in schema) || typeof schema.$ref !== 'string') return schema;
  let current = root;
  for (const key of schema.$ref.replace('#/', '').split('/')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = Object.entries(current).find(([name]) => name === key)?.[1];
  }
  return current;
}

describe.each(backends)('MCP at /mcp on $name', (backend) => {
  const store = storeOf(backend);

  /** org-a with ann (member) and mo (manager), and one deal in each org. */
  async function crm() {
    const setup = httpSetup(store());
    await setup.member('ann', 'org-a');
    await setup.member('mo', 'org-a', 'manager');
    // A fraction: a UUID or hex id never holds a ".", so no id can match it.
    const ours = await setup.repos.deals.insert(
      { title: 'Ours', companyId: 'c1', amount: 4242.5 },
      tenancy.scope(Deals, 'org-a'),
    );
    const theirs = await setup.repos.deals.insert(
      { title: 'Theirs', companyId: 'c2', amount: 99 },
      tenancy.scope(Deals, 'org-b'),
    );
    return {
      ...setup,
      ours,
      theirs,
      ann: await setup.signIn('ann'),
      mo: await setup.signIn('mo'),
    };
  }

  it('lists every procedure a caller may use as a tool, with Lattice’s annotations and summaries', async () => {
    const setup = await crm();
    const client = await connect(setup, { token: setup.ann, org: 'org-a' });

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [
        ...['companies', 'contacts'].flatMap((slug) =>
          ['find', 'count', 'get', 'create', 'update', 'delete'].map(
            (action) => `${slug}_${action}`,
          ),
        ),
        ...['find', 'count', 'get', 'create', 'update', 'delete', 'close'].map(
          (action) => `deals_${action}`,
        ),
        'deals_contacts_list',
        'deals_contacts_set',
        // Memberships' and organizations' writes are refused for every
        // caller, so not tools.
        ...['memberships', 'organizations'].flatMap((slug) =>
          ['find', 'count', 'get'].map((action) => `${slug}_${action}`),
        ),
      ].sort(),
    );
    expect(tools).toHaveLength(27);
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    expect(
      Object.fromEntries(
        [
          'deals_find',
          'deals_count',
          'deals_get',
          'deals_create',
          'deals_update',
          'deals_delete',
          'deals_close',
        ].map((name) => [name, byName.get(name)?.annotations]),
      ),
    ).toEqual({
      deals_find: { readOnlyHint: true },
      deals_count: { readOnlyHint: true },
      deals_get: { readOnlyHint: true },
      deals_create: { readOnlyHint: false, destructiveHint: false },
      deals_update: { readOnlyHint: false, destructiveHint: false },
      deals_delete: { readOnlyHint: false, destructiveHint: true },
      deals_close: { readOnlyHint: false, destructiveHint: false },
    });
    expect(byName.get('deals_find')?.description).toBe(
      'Find deals. Filter with where, order with sort, and page with limit and after (the previous page’s next). populate expands companyId into documents.',
    );
    expect(byName.get('deals_close')?.description).toBe(
      'Close a deal as won or lost, by its id. A deal closes once; closing it again is AlreadyClosed.',
    );
  });

  it('leaves deals_close out of a read-only toolset, in types and at runtime', () => {
    // deals.close declares effect 'write' on its use case.
    const reads = all(createToolkit(contract).deals, { effect: 'read' });
    expect(Object.keys(reads)).toContain('deals_find');
    expect(Object.keys(reads)).not.toContain('deals_close');
    expectTypeOf<
      'deals_find' extends keyof typeof reads ? true : false
    >().toEqualTypeOf<true>();
    expectTypeOf<
      'deals_close' extends keyof typeof reads ? true : false
    >().toEqualTypeOf<false>();
  });

  it('says in deals_find’s input schema that a where on amount may be refused', async () => {
    const setup = await crm();
    const client = await connect(setup, { token: setup.ann, org: 'org-a' });

    const { tools } = await client.listTools();
    const find = tools.find((tool) => tool.name === 'deals_find');
    if (find === undefined) throw new Error('no deals_find');
    const where = resolved(
      find.inputSchema,
      find.inputSchema.properties?.where,
    );

    expect(where).toMatchObject({
      properties: {
        amount: {
          description:
            'Refused (VALIDATION) when the caller may not read amount.',
        },
      },
    });
    expect(find.inputSchema.properties?.sort).toMatchObject({
      description:
        'Field names, "-" first for descending. Sorting on amount is refused (VALIDATION) when the caller may not read it.',
    });
  });

  it('withholds amount from a member, and refuses a member’s where on it', async () => {
    const setup = await crm();
    const client = await connect(setup, { token: setup.ann, org: 'org-a' });

    const found = await client.callTool({ name: 'deals_find', arguments: {} });
    expect(found.isError).toBeUndefined();
    expect(outputOf(found)).toEqual({
      docs: [expect.not.objectContaining({ amount: expect.anything() })],
      next: null,
    });
    expect(textOf(found)).not.toContain('4242.5');

    const filtered = await client.callTool({
      name: 'deals_find',
      arguments: { where: { amount: { gt: 4000 } } },
    });
    expect(filtered.isError).toBe(true);
    expect(textOf(filtered)).toContain('VALIDATION');
    expect(textOf(filtered)).toContain('amount');
    expect(textOf(filtered)).not.toContain('4242.5');
  });

  it('gives a manager the amount, and lets a manager filter on it', async () => {
    const setup = await crm();
    const client = await connect(setup, { token: setup.mo, org: 'org-a' });

    const found = await client.callTool({
      name: 'deals_find',
      arguments: { where: { amount: { gt: 4000 } } },
    });

    expect(outputOf(found)).toEqual({
      docs: [expect.objectContaining({ id: setup.ours.id, amount: 4242.5 })],
      next: null,
    });
  });

  it('answers a request with no token, or a dead one, with a 401 challenge', async () => {
    const setup = await crm();
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });

    for (const authorization of [undefined, 'Bearer not-a-session']) {
      const response = await setup.fetch(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            ...(authorization === undefined ? {} : { authorization }),
          },
          body,
        }),
      );
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toMatch(
        /^Bearer error="invalid_token"/,
      );
    }
    expect(refusals(setup.logger)).toEqual([
      ['UNAUTHORIZED', 'missing'],
      ['UNAUTHORIZED', 'invalid'],
    ]);
  });

  it('refuses a call with no organization, as /rpc does', async () => {
    const setup = await crm();
    const client = await connect(setup, { token: setup.ann });

    const result = await client.callTool({ name: 'deals_find', arguments: {} });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('FORBIDDEN');
    expect(refusals(setup.logger)).toEqual([['FORBIDDEN', 'no-organization']]);
    expect(
      setup.logger.records.find((record) => record.fields.outcome === 'refused')
        ?.message,
    ).toBe('mcp');
  });

  it('cannot cross tenants: another org’s deal is not found, and its header is refused', async () => {
    const setup = await crm();
    const ours = await connect(setup, { token: setup.ann, org: 'org-a' });

    const got = await ours.callTool({
      name: 'deals_get',
      arguments: { id: setup.theirs.id },
    });
    expect(got.isError).toBe(true);
    expect(textOf(got)).toContain('NOT_FOUND');
    const found = await ours.callTool({ name: 'deals_find', arguments: {} });
    expect(textOf(found)).not.toContain(setup.theirs.id);

    const theirs = await connect(setup, { token: setup.ann, org: 'org-b' });
    const refused = await theirs.callTool({
      name: 'deals_find',
      arguments: {},
    });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain('FORBIDDEN');
    expect(refusals(setup.logger)).toEqual([
      // The family logs its own refusal of the get.
      ['NOT_FOUND', undefined],
      ['FORBIDDEN', 'not-a-member'],
    ]);
  });
});

describe('the crm’s toolset', () => {
  it('passes ts-pf’s audit: every tool is described and classified', () => {
    const findings = audit([crmTools]);

    expect(findings.filter((finding) => finding.level === 'error')).toEqual([]);
    // What is left: 27 flat tools (ts-pf suggests 15 or fewer), and the
    // recursive where of each find and count.
    expect(
      [...new Set(findings.map((finding) => finding.message))].sort(),
    ).toEqual([
      'lists 27 tools (more than 15); split it or put a large group behind a $host',
      'schema is recursive; references stay as $ref',
    ]);
  });
});
