import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/** scrypt's cost: N = 2^ln, block size r, parallelism p. */
export type ScryptParams = {
  readonly ln: number;
  readonly r: number;
  readonly p: number;
};

/**
 * The parameters new hashes use: OWASP's Password Storage Cheat Sheet
 * alternative to N=2^17, r=8, p=1 at the same cost, with 32 MiB of memory
 * per hash (128 · N · r). Raise them here; stored hashes keep theirs, and a
 * login under older ones rehashes.
 */
export const currentParams: ScryptParams = { ln: 15, r: 8, p: 3 };

const saltBytes = 16;
const keyBytes = 32;
// Node's default cap is 32 MiB, which N=2^15, r=8 reaches exactly.
const maxmem = 64 * 1024 * 1024;

function derive(
  password: string,
  salt: Buffer,
  params: ScryptParams,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      keyBytes,
      { N: 2 ** params.ln, r: params.r, p: params.p, maxmem },
      (error, key) => (error === null ? resolve(key) : reject(error)),
    );
  });
}

/**
 * `password` hashed with a fresh random salt, encoded as
 * `$scrypt$ln=15,r=8,p=3$<salt>$<key>`, base64url. The parameters travel
 * with the hash, so they can be raised later.
 */
export async function hashPassword(
  password: string,
  params: ScryptParams = currentParams,
): Promise<string> {
  const salt = randomBytes(saltBytes);
  const key = await derive(password, salt, params);
  return `$scrypt$ln=${params.ln},r=${params.r},p=${params.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

const encoded = /^\$scrypt\$ln=(\d+),r=(\d+),p=(\d+)\$([\w-]+)\$([\w-]+)$/;

/** The parts of an encoded hash, or undefined when it is not one. */
function parse(
  hash: string,
): { params: ScryptParams; salt: Buffer; key: Buffer } | undefined {
  const match = encoded.exec(hash);
  if (match === null) return undefined;
  const [, ln, r, p, salt, key] = match;
  if (
    ln === undefined ||
    r === undefined ||
    p === undefined ||
    salt === undefined ||
    key === undefined
  ) {
    return undefined;
  }
  const params = { ln: Number(ln), r: Number(r), p: Number(p) };
  // A stored hash names its own cost: bound it, so a corrupt one cannot ask
  // scrypt for more memory than maxmem allows or for minutes of work.
  if (
    params.ln < 1 ||
    params.ln > 20 ||
    params.r < 1 ||
    params.r > 32 ||
    params.p < 1 ||
    params.p > 16 ||
    128 * 2 ** params.ln * params.r > maxmem
  ) {
    return undefined;
  }
  return {
    params,
    salt: Buffer.from(salt, 'base64url'),
    key: Buffer.from(key, 'base64url'),
  };
}

/** Whether `params` cost less than the current ones in any dimension. */
function weaker(params: ScryptParams): boolean {
  return (
    params.ln < currentParams.ln ||
    params.r < currentParams.r ||
    params.p < currentParams.p
  );
}

/**
 * Whether `password` matches `hash`, under the parameters stored in it, and
 * whether the hash should be redone with the current ones. A hash that is
 * not one never matches and never throws.
 */
export async function verifyPassword(
  password: string,
  hash: string,
): Promise<{ readonly ok: boolean; readonly rehash: boolean }> {
  const parts = parse(hash);
  if (parts === undefined || parts.key.length !== keyBytes) {
    return { ok: false, rehash: false };
  }
  const key = await derive(password, parts.salt, parts.params);
  const ok = timingSafeEqual(key, parts.key);
  return { ok, rehash: ok && weaker(parts.params) };
}
