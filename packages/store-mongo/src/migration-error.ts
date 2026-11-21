import { Errors } from 'hexok';
import { z } from 'zod';

/**
 * Why `migrate` refused to run, or stopped. The list checks (`Gap`,
 * `Duplicate`, `Unknown`, `Renamed`) and `NoTransactions` throw before any
 * migration runs.
 */
export class MigrationError extends Errors('migrations', {
  Gap: {
    message: 'Migration ids must run 1, 2, 3 … in list order, with no gap',
    data: z.object({ expected: z.number(), found: z.number() }),
  },
  Duplicate: {
    message: 'Two migrations share an id',
    data: z.object({ id: z.number() }),
  },
  Unknown: {
    message: 'A migration that ran is missing from the list',
    data: z.object({ id: z.number(), name: z.string() }),
  },
  Renamed: {
    message: 'A migration that ran has another name in the list',
    data: z.object({
      id: z.number(),
      recorded: z.string(),
      listed: z.string(),
    }),
  },
  NoTransactions: {
    message: 'A migration asks for a transaction, but the deployment has none',
    data: z.object({ id: z.number() }),
  },
  LockTimeout: {
    message: 'Another process held the migrations lock for longer than waitMs',
    data: z.object({ waitMs: z.number() }),
  },
  LockLost: {
    message: 'The migrations lock was lost while a migration ran',
  },
}) {}
