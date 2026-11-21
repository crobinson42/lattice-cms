import { describe, expect, it } from 'vitest';
import { attemptKey } from '../../app/ports/auth/login-attempts.js';
import { windowMs } from '../../infra/auth/store-login-attempts.js';
import { cheapHasher } from '../../test/hasher.js';
import { httpSetup, rpcRequest } from '../../test/http.js';
import { backends, storeOf } from '../../test/stores.js';

const password = 'correct horse battery';

describe.each(backends)('login over HTTP on $name', (backend) => {
  const store = storeOf(backend);

  /** ann, with a password and a membership of org-a. */
  async function setup(options: { readonly realHash?: boolean } = {}) {
    let clock = Date.now();
    const s = httpSetup(store(), {
      now: () => clock,
      ...(options.realHash === true ? {} : { hasher: cheapHasher() }),
    });
    await s.credentials.ensure();
    await s.credentials.set({ userId: 'ann', email: 'ann@x.com' }, password);
    await s.member('ann', 'org-a');
    /** A POST to `/auth/<path>` with `input`, and its status and body. */
    async function auth(path: string, input: unknown) {
      const response = await s.fetch(
        new Request(`http://localhost/auth/${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ input }),
        }),
      );
      const body: unknown = await response.json();
      return { status: response.status, body };
    }
    const login = (email: string, secret: string) =>
      auth('login', { email, password: secret });
    /** The reasons login's refusals were logged with, in order. */
    const reasons = () =>
      s.logger.records
        .filter(
          (record) =>
            record.message === 'auth.login' &&
            record.fields.outcome === 'refused',
        )
        .map((record) => record.fields.reason);
    return {
      ...s,
      auth,
      login,
      reasons,
      advance(ms: number) {
        clock += ms;
      },
    };
  }

  /** The token a successful login returned. */
  function tokenOf(body: unknown): string {
    if (
      typeof body === 'object' &&
      body !== null &&
      'output' in body &&
      typeof body.output === 'object' &&
      body.output !== null &&
      'token' in body.output &&
      typeof body.output.token === 'string'
    ) {
      return body.output.token;
    }
    throw new Error(`no token: ${JSON.stringify(body)}`);
  }

  const refused = {
    ok: false,
    error: { code: 'UNAUTHORIZED', message: 'The credentials are not valid' },
  };

  it('signs in with real scrypt, and the token works on /rpc', async () => {
    const s = await setup({ realHash: true });

    const signedIn = await s.login('ann@x.com', password);

    expect(signedIn.status).toBe(200);
    const response = await s.fetch(
      rpcRequest(
        'deals/find',
        {},
        { token: tokenOf(signedIn.body), org: 'org-a' },
      ),
    );
    expect(response.status).toBe(200);
  });

  it('normalizes the email before it validates it', async () => {
    const { login } = await setup();

    expect((await login(' Ann@X.com ', password)).status).toBe(200);
  });

  it('refuses a wrong password and an unknown email with one body', async () => {
    const { login, reasons } = await setup();

    const wrong = await login('ann@x.com', 'not the password');
    const unknown = await login('nobody@x.com', password);

    expect(wrong).toEqual({ status: 401, body: refused });
    expect(unknown).toEqual({ status: 401, body: refused });
    expect(reasons()).toEqual(['wrong-password', 'unknown']);
  });

  it('locks an unknown email exactly as a known one, and unlocks after the window', async () => {
    const { login, reasons, advance } = await setup();

    const answers = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      answers.push(await login('nobody@x.com', password));
    }
    for (let attempt = 0; attempt < 10; attempt += 1) {
      answers.push(await login('ann@x.com', 'not the password'));
    }
    // ann's password is right, but the email is locked.
    answers.push(await login('ann@x.com', password));

    expect(new Set(answers.map((answer) => JSON.stringify(answer)))).toEqual(
      new Set([JSON.stringify({ status: 401, body: refused })]),
    );
    expect(reasons()).toEqual([
      ...Array(10).fill('unknown'),
      'locked',
      ...Array(10).fill('wrong-password'),
      'locked',
    ]);
    advance(windowMs);
    expect((await login('ann@x.com', password)).status).toBe(200);
  });

  it('a success resets the failures', async () => {
    const { login } = await setup();

    for (const round of [1, 2]) {
      for (let attempt = 0; attempt < 9; attempt += 1) {
        await login('ann@x.com', 'not the password');
      }
      expect(
        (await login('ann@x.com', password)).status,
        `round ${round}`,
      ).toBe(200);
    }
  });

  it('answers a malformed email or an overlong password with VALIDATION, never echoing the password', async () => {
    const { login } = await setup();
    const long = 'p'.repeat(1025);

    const badEmail = await login('not an email', password);
    const tooLong = await login('ann@x.com', long);

    expect(badEmail.status).toBe(422);
    expect(badEmail.body).toMatchObject({ error: { code: 'VALIDATION' } });
    expect(tooLong.body).toMatchObject({ error: { code: 'VALIDATION' } });
    expect(JSON.stringify(badEmail.body)).not.toContain(password);
    expect(JSON.stringify(tooLong.body)).not.toContain(long.slice(0, 32));
  });

  it('logs no password and no email, on a refusal, a success or VALIDATION', async () => {
    const { login, logger } = await setup();

    await login('ann@x.com', 'not the password');
    await login('ann@x.com', password);
    await login('not an email', password);

    const logged = JSON.stringify(logger.records);
    expect(logged).not.toContain(password);
    expect(logged).not.toContain('not the password');
    expect(logged).not.toContain('ann@x.com');
    // The refusal names the attempt key instead.
    expect(logger.records).toContainEqual(
      expect.objectContaining({
        message: 'auth.login',
        fields: expect.objectContaining({
          outcome: 'refused',
          attemptKey: attemptKey('ann@x.com'),
        }),
      }),
    );
  });

  it('logout ends the session the login opened', async () => {
    const { login, auth, fetch } = await setup();
    const token = tokenOf((await login('ann@x.com', password)).body);
    const find = () =>
      fetch(rpcRequest('deals/find', {}, { token, org: 'org-a' }));
    expect((await find()).status).toBe(200);

    const response = await fetch(
      new Request('http://localhost/auth/logout', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ input: {} }),
      }),
    );

    expect(response.status).toBe(200);
    expect((await find()).status).toBe(401);
    expect((await auth('logout', {})).status).toBe(200);
  });
});
