import { describe, expect, it } from 'vitest';
import {
  currentParams,
  hashPassword,
  verifyPassword,
} from './password-hash.js';

describe('password hashes', () => {
  it('use OWASP’s scrypt parameters, in a versioned format', async () => {
    expect(currentParams).toEqual({ ln: 15, r: 8, p: 3 });
    const hash = await hashPassword('correct horse battery');

    expect(hash).toMatch(/^\$scrypt\$ln=15,r=8,p=3\$[\w-]{22}\$[\w-]{43}$/);
  });

  it('verify the right password and refuse a wrong one', async () => {
    const hash = await hashPassword('correct horse battery');

    expect(await verifyPassword('correct horse battery', hash)).toEqual({
      ok: true,
      rehash: false,
    });
    expect(await verifyPassword('correct horse batterz', hash)).toEqual({
      ok: false,
      rehash: false,
    });
  });

  it('salt each hash, so one password hashes differently twice', async () => {
    expect(await hashPassword('same password')).not.toBe(
      await hashPassword('same password'),
    );
  });

  it('verify an older, cheaper hash by its own parameters, and ask for a rehash', async () => {
    const old = await hashPassword('correct horse battery', {
      ln: 10,
      r: 8,
      p: 1,
    });

    expect(await verifyPassword('correct horse battery', old)).toEqual({
      ok: true,
      rehash: true,
    });
    // A wrong password never asks for a rehash.
    expect(await verifyPassword('wrong', old)).toEqual({
      ok: false,
      rehash: false,
    });
  });

  it('refuse a malformed or runaway hash without throwing', async () => {
    const salt = 'A'.repeat(22);
    const key = 'A'.repeat(43);
    const prefix = '$scrypt$';
    for (const hash of [
      '',
      'plaintext',
      `${prefix}ln=15,r=8,p=3$!!$!!`,
      `${prefix}ln=15,r=8,p=3$${salt}$short`,
      `${prefix}ln=40,r=8,p=1$${salt}$${key}`,
      `${prefix}ln=0,r=8,p=1$${salt}$${key}`,
    ]) {
      expect(await verifyPassword('anything', hash)).toEqual({
        ok: false,
        rehash: false,
      });
    }
  });
});
