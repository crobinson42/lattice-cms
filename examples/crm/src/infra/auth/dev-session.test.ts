import { unscoped } from '@latticecms/core';
import { describe, expect, it } from 'vitest';
import { CredentialError } from '../../domain/errors/auth.js';
import { createApp } from '../../servers/app.js';
import { cheapHasher } from '../../test/hasher.js';
import { testSessions } from '../../test/sessions.js';
import { backends, storeOf } from '../../test/stores.js';
import { MemoryDomainEventPublisher } from '../events/memory-domain-events.js';
import { openDevSession, provisionDevUser } from './dev-session.js';
import { StoreCredentials } from './store-credentials.js';

describe.each(backends)('openDevSession on $name', (backend) => {
  const store = storeOf(backend);

  it('creates the organization and the membership once, and opens a session for the user', async () => {
    const crm = createApp({
      store: store(),
      events: new MemoryDomainEventPublisher(),
    });
    await crm.ensure();
    const sessions = testSessions();
    const member = { userId: 'ada', organization: 'Org A' };

    const token = await openDevSession({ crm, sessions }, member);
    await openDevSession({ crm, sessions }, member);

    const found = await sessions.authenticate(token);
    expect(found.ok && found.value).toEqual({ userId: 'ada' });
    const { docs: organizations } = await crm.repos.organizations.find(
      {},
      unscoped,
    );
    expect(organizations).toMatchObject([{ name: 'Org A' }]);
    const [organization] = organizations;
    if (organization === undefined) throw new Error('no organization');
    // The membership refers to the organization the script made.
    expect(
      await crm.repos.memberships.count(
        { userId: { eq: 'ada' }, organizationId: { eq: organization.id } },
        unscoped,
      ),
    ).toBe(1);
  });

  it('provisionDevUser sets the password, adds the membership, and opens a session', async () => {
    const crm = createApp({
      store: store(),
      events: new MemoryDomainEventPublisher(),
    });
    await crm.ensure();
    const sessions = testSessions();
    const credentials = new StoreCredentials(store(), cheapHasher());
    await credentials.ensure();
    const user = {
      userId: 'ann',
      email: 'ann@x.com',
      password: 'correct horse battery',
      organization: 'Org A',
    };

    const token = await provisionDevUser({ crm, sessions, credentials }, user);

    expect(await sessions.authenticate(token)).toMatchObject({ ok: true });
    expect(
      await credentials.verify('ann@x.com', 'correct horse battery'),
    ).toEqual({ ok: true, value: { userId: 'ann' } });
    // The policy holds here too.
    const short = await provisionDevUser(
      { crm, sessions, credentials },
      { ...user, password: 'short' },
    ).then(
      () => 'provisioned',
      (error: unknown) => (CredentialError.is(error) ? error.code : error),
    );
    expect(short).toBe('PasswordTooShort');
  });
});
