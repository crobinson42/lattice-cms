import { PFError } from '@ts-pf/protocol';
import { Errors } from 'hexok';
import { z } from 'zod';

/** The app's domain errors, as app-template's `domain/errors/domain.ts`. */
export const domainErrorDefs = {
  PostLocked: {
    message: 'Post is locked',
    data: z.object({ id: z.string() }),
  },
  QuotaReached: { message: 'Quota reached' },
  InternalOnly: { message: 'Not for clients' },
};

export class DomainError extends Errors('app', domainErrorDefs) {}

/** Each code's status. `null` keeps the error from clients. */
const statuses = {
  PostLocked: 423,
  QuotaReached: 429,
  InternalOnly: null,
} as const satisfies Record<keyof typeof domainErrorDefs, number | null>;

/** The client-facing domain errors, as app-template's `rpc/errors.ts`. */
export const clientErrors = {
  PostLocked: { ...domainErrorDefs.PostLocked, status: statuses.PostLocked },
  QuotaReached: {
    ...domainErrorDefs.QuotaReached,
    status: statuses.QuotaReached,
  },
};

/**
 * app-template's `toRpcError`, without its hexok VALIDATION branch: Lattice
 * maps that before it calls the app's map.
 */
export function toRpcError(error: unknown): unknown {
  if (DomainError.is(error)) {
    const status = statuses[error.code];
    if (status === null) return error;
    return new PFError({
      code: error.code,
      message: error.message,
      status,
      ...(error.data === undefined ? {} : { data: error.data }),
      cause: error,
    });
  }
  return error;
}
