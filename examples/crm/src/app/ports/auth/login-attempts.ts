import { createHash } from 'node:crypto';
import { Port } from 'hexok';

/**
 * The key login's failures are counted under: a SHA-256 of the email, so
 * the store and the logs hold no email. Every email gets one, known or not,
 * so the limit does not tell which exist.
 */
export function attemptKey(email: string): string {
  return createHash('sha256')
    .update(email.trim().toLowerCase())
    .digest('base64url');
}

/** Failed logins per key, to stop guessing one account's password. */
export abstract class LoginAttempts extends Port('LoginAttempts') {
  /** Whether `key` has failed too often in its current window. */
  abstract isLocked(key: string): Promise<boolean>;
  /** Counts one failure for `key`, starting a window when none is open. */
  abstract fail(key: string): Promise<void>;
  /** Forgets `key`'s failures, after a successful login. */
  abstract reset(key: string): Promise<void>;
}
