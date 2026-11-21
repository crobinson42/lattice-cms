import { Errors } from 'hexok';
import { z } from 'zod';

const issue = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});

/** Lattice's refusals. Step 7 maps each code to a ts-pf declared error. */
export class LatticeError extends Errors('lattice', {
  VALIDATION: {
    message: 'Validation failed',
    data: z.object({ issues: z.array(issue) }),
  },
}) {}

export type Issue = z.output<typeof issue>;
