import { describe, expect, it } from 'vitest';
import { attemptKey } from '../../app/ports/auth/login-attempts.js';
import { backends, storeOf } from '../../test/stores.js';
import {
  loginAttemptsCollection,
  maxFailures,
  StoreLoginAttempts,
  windowMs,
} from './store-login-attempts.js';

describe.each(backends)('StoreLoginAttempts on $name', (backend) => {
  const store = storeOf(backend);

  function setup() {
    let clock = Date.parse('2026-01-01T00:00:00.000Z');
    const attempts = new StoreLoginAttempts(store(), () => clock);
    return {
      attempts,
      advance(ms: number) {
        clock += ms;
      },
    };
  }

  it('locks a key at ten failures, until its window ends', async () => {
    const { attempts, advance } = setup();
    const key = attemptKey('ann@x.com');

    for (let failure = 1; failure < maxFailures; failure += 1) {
      await attempts.fail(key);
    }
    expect(await attempts.isLocked(key)).toBe(false);
    await attempts.fail(key);
    expect(await attempts.isLocked(key)).toBe(true);

    advance(windowMs);
    expect(await attempts.isLocked(key)).toBe(false);
    // A new window counts from one again.
    await attempts.fail(key);
    expect(await attempts.isLocked(key)).toBe(false);
  });

  it('reset forgets a key’s failures', async () => {
    const { attempts } = setup();
    const key = attemptKey('ann@x.com');
    for (let failure = 0; failure < maxFailures; failure += 1) {
      await attempts.fail(key);
    }

    await attempts.reset(key);

    expect(await attempts.isLocked(key)).toBe(false);
  });

  it('keys by a hash of the email, so the store holds no email', async () => {
    const { attempts } = setup();
    const key = attemptKey(' Ann@X.com ');

    await attempts.fail(key);

    expect(key).toBe(attemptKey('ann@x.com'));
    const doc = await store().get(loginAttemptsCollection, key);
    expect(doc).toMatchObject({ id: key, failures: 1 });
    expect(JSON.stringify(doc)).not.toContain('ann');
  });
});
