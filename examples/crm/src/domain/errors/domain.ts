import { Errors } from 'hexok';
import { z } from 'zod';

/** The definitions. The RPC layer maps each code to a status. */
export const domainErrorDefs = {
  AlreadyClosed: {
    message: 'The deal is already closed',
    data: z.object({ id: z.string() }),
  },
  DealNotFound: {
    message: 'No deal with this id',
    data: z.object({ id: z.string() }),
  },
};

export class DomainError extends Errors('crm', domainErrorDefs) {}
