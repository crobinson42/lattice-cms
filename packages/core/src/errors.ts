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
  UNAUTHORIZED: { message: 'The actor is missing or invalid' },
  CONFLICT: {
    message: 'A document with this id already exists',
    data: z.object({ collection: z.string(), id: z.string() }),
  },
}) {}

export type Issue = z.output<typeof issue>;

/** A VALIDATION error for Zod issues, with one issue per path. */
export function invalid(issues: readonly z.core.$ZodIssue[]) {
  return LatticeError.VALIDATION({
    issues: issues.flatMap((issue): Issue[] => {
      const path = issue.path.map((key) =>
        typeof key === 'symbol' ? String(key) : key,
      );
      // Zod reports every unknown key of one object as one issue. Split them
      // so each path names the field or operator that is not allowed.
      if (issue.code === 'unrecognized_keys') {
        return issue.keys.map((key) => ({
          path: [...path, key],
          message: `"${key}" is not a field or not allowed on this field`,
        }));
      }
      return [{ path, message: issue.message }];
    }),
  });
}
