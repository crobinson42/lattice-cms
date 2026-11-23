import { MemoryLogger } from '@hexok/logger';
import { MongoStore } from '@latticecms/store-mongo';
import { MongoClient } from 'mongodb';
import { afterEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';
import { openDevSession } from '../../infra/auth/dev-session.js';
import { MemoryDomainEventPublisher } from '../../infra/events/memory-domain-events.js';
import { testSessions } from '../../test/sessions.js';
import { builtPage } from '../../test/web.js';
import { createApp } from '../app.js';
import { organizationHeader } from './headers.js';
import { type Running, start } from './server.js';

describe('the server, over the network, on MongoStore', () => {
  const url = inject('mongoUrl');
  const database = `crm_${crypto.randomUUID().replaceAll('-', '')}`;
  let running: Running | undefined;

  afterEach(async () => {
    await running?.stop();
    const client = new MongoClient(url);
    await client.db(database).dropDatabase();
    await client.close();
  });

  it('migrates, serves a signed-in member, and signs out', async () => {
    const sessions = testSessions();
    const store = new MongoStore({ url, database });
    running = await start({
      store,
      events: new MemoryDomainEventPublisher(),
      sessions,
      support: new Set(),
      logger: new MemoryLogger(),
      port: 0,
      hostname: '127.0.0.1',
      web: builtPage,
    });
    // The dev script's own function, against the running server's store.
    const crm = createApp({ store, events: new MemoryDomainEventPublisher() });
    const token = await openDevSession(
      { crm, sessions },
      { userId: 'ada', organization: 'Org A' },
    );
    const base = running.url;
    // The organization's id, as a switcher reads it: no organization header.
    const listed = await fetch(new URL('/auth/organizations', base), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ input: {} }),
    });
    const [org] = z
      .object({
        output: z.array(z.object({ id: z.string(), name: z.string() })),
      })
      .parse(await listed.json()).output;
    if (org === undefined) throw new Error('no organization');
    expect(org.name).toBe('Org A');
    const rpc = (path: string, input: unknown) =>
      fetch(new URL(`/rpc/${path}`, base), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          [organizationHeader]: org.id,
        },
        body: JSON.stringify({ input }),
      });

    expect((await fetch(new URL('/health', base))).status).toBe(200);
    const created = await rpc('deals/create', {
      title: 'Big one',
      companyId: 'c1',
      amount: 1,
    });
    expect(created.status).toBe(200);
    const found = await rpc('deals/find', {});
    expect(await found.json()).toMatchObject({
      ok: true,
      output: { docs: [{ title: 'Big one', organizationId: org.id }] },
    });

    const logout = await fetch(new URL('/auth/logout', base), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ input: {} }),
    });
    expect(logout.status).toBe(200);
    expect((await rpc('deals/find', {})).status).toBe(401);
  });
});
