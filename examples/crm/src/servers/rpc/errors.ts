import { PFError } from '@ts-pf/protocol';
import { DomainError, domainErrorDefs } from '../../domain/errors/domain.js';

/** The status of each domain error. `null` would keep one from clients. */
const statuses = {
  AlreadyClosed: 409,
} as const satisfies Record<keyof typeof domainErrorDefs, number | null>;

/** Every client-facing domain error, with its status. Every procedure declares them. */
export const clientErrors = {
  AlreadyClosed: {
    ...domainErrorDefs.AlreadyClosed,
    status: statuses.AlreadyClosed,
  },
};

/**
 * The error a client receives for a domain error: its code, message, data
 * and status. Anything else passes through; Lattice maps its own errors and
 * hexok VALIDATION first, and ts-pf sends the rest as INTERNAL.
 */
export function toRpcError(error: unknown): unknown {
  if (!DomainError.is(error)) return error;
  return new PFError({
    code: error.code,
    message: error.message,
    status: statuses[error.code],
    data: error.data,
    cause: error,
  });
}
