import { describe, expect, it } from 'vitest';
import { CredentialError } from '../../domain/errors/auth.js';
import { cheapHasher } from '../../test/hasher.js';
import { backends, storeOf } from '../../test/stores.js';
import { hashPassword } from './password-hash.js';
import {
  credentialsCollection,
  StoreCredentials,
} from './store-credentials.js';

const password = 'correct horse battery';

describe.each(backends)('StoreCredentials on $name', (backend) => {
  const store = storeOf(backend);

  async function setup() {
    const hasher = cheapHasher();
    const credentials = new StoreCredentials(store(), hasher);
    await credentials.ensure();
    await credentials.set({ userId: 'ann', email: ' Ann@X.com ' }, password);
    return { credentials, hasher };
  }

  it('verifies an email in any case or spacing, and answers only the user', async () => {
    const { credentials } = await setup();

    const found = await credentials.verify('ANN@x.com', password);

    expect(found).toEqual({ ok: true, value: { userId: 'ann' } });
  });

  it('refuses a wrong password and an unknown email, at the cost of one verify each', async () => {
    const { credentials, hasher } = await setup();

    const wrong = await credentials.verify('ann@x.com', 'not the password');
    const unknown = await credentials.verify('nobody@x.com', password);

    expect(wrong).toMatchObject({ ok: false, code: 'wrong-password' });
    expect(unknown).toMatchObject({ ok: false, code: 'unknown' });
    // The unknown email still ran a verify, against the dummy hash.
    expect(hasher.calls).toHaveLength(2);
  });

  it('stores only a hash, never the password', async () => {
    await setup();

    const doc = await store().get(credentialsCollection, 'ann');

    expect(doc).toMatchObject({ id: 'ann', email: 'ann@x.com' });
    expect(JSON.stringify(doc)).not.toContain(password);
    expect(doc?.hash).toMatch(/^\$scrypt\$/);
  });

  it('rehashes an older hash on a successful login', async () => {
    const credentials = new StoreCredentials(store());
    await store().insert(credentialsCollection, {
      id: 'old',
      email: 'old@x.com',
      hash: await hashPassword(password, { ln: 10, r: 8, p: 1 }),
    });

    expect(await credentials.verify('old@x.com', password)).toMatchObject({
      ok: true,
    });

    const doc = await store().get(credentialsCollection, 'old');
    expect(doc?.hash).toMatch(/^\$scrypt\$ln=15,r=8,p=3\$/);
  });

  it('sets a password of 12 characters or more, and refuses a shorter one', async () => {
    const { credentials } = await setup();

    const short = await credentials
      .set({ userId: 'ann', email: 'ann@x.com' }, 'eleven-char')
      .then(
        () => 'set',
        (error: unknown) => (CredentialError.is(error) ? error.code : error),
      );
    await credentials.set(
      { userId: 'ann', email: 'ann@x.com' },
      'a new password',
    );

    expect(short).toBe('PasswordTooShort');
    expect(
      await credentials.verify('ann@x.com', 'a new password'),
    ).toMatchObject({ ok: true });
    expect(await credentials.verify('ann@x.com', password)).toMatchObject({
      ok: false,
    });
  });
});
