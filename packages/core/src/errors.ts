import { type ErrorMap, toValidationIssues } from '@ts-pf/contract';
import { PFError } from '@ts-pf/protocol';
import { CodedError, catalogBrand, Errors, type StandardSchemaV1 } from 'hexok';
import { z } from 'zod';

const issue = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});

const target = z.object({ collection: z.string(), id: z.string() });

/**
 * A clash on a unique key. `fields` are the clashing index's fields as
 * declared, tenant field included, or `['id']` when the id exists.
 */
const clash = target.extend({ fields: z.array(z.string()) });

const definitions = {
  VALIDATION: {
    message: 'Validation failed',
    data: z.object({ issues: z.array(issue) }),
  },
  UNAUTHORIZED: { message: 'The actor is missing or invalid' },
  FORBIDDEN: { message: 'The actor may not do this' },
  NOT_FOUND: { message: 'No document with this id', data: target },
  CONFLICT: {
    message: 'A document with the same unique key already exists',
    data: clash,
  },
  REFERENCED: {
    message: 'Other documents refer to this one',
    data: target.extend({
      // A join collection is not in the catalog: `relation` names the
      // parent collection's relation that derived it.
      by: z.object({
        collection: z.string(),
        field: z.string(),
        relation: z
          .object({ collection: z.string(), name: z.string() })
          .optional(),
      }),
    }),
  },
};

/** Lattice's refusals. Each reaches a ts-pf client under the same code. */
export class LatticeError extends Errors('lattice', definitions) {}

export type LatticeCode = keyof typeof definitions;

/** Every LatticeError code. An app may not declare one of these. */
export const latticeCodes: readonly string[] = Object.keys(definitions);

/**
 * The errors every procedure declares, with their statuses. VALIDATION is
 * not declared: it is a ts-pf protocol code, which a contract must not
 * redeclare, and clients already type its `data.issues`.
 */
export const declaredErrors = {
  UNAUTHORIZED: { ...definitions.UNAUTHORIZED, status: 401 },
  FORBIDDEN: { ...definitions.FORBIDDEN, status: 403 },
  NOT_FOUND: { ...definitions.NOT_FOUND, status: 404 },
  CONFLICT: { ...definitions.CONFLICT, status: 409 },
  REFERENCED: { ...definitions.REFERENCED, status: 409 },
} satisfies ErrorMap;

export type Issue = z.output<typeof issue>;

/**
 * A VALIDATION error for Zod issues: each issue as Zod reports it, with
 * every unknown key on its own path. A field that fails two checks has two
 * issues, in the order its schema declares them.
 */
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

/** `value` parsed by `schema`, or a VALIDATION error naming each path. */
export function parse<S extends z.core.$ZodType>(
  schema: S,
  value: unknown,
): z.output<S> {
  const result = z.safeParse(schema, value);
  if (!result.success) throw invalid(result.error.issues);
  return result.data;
}

/** hexok's schema-check failure, such as `Entity.parse` or `validationError`. */
function isCodedValidation(error: unknown): error is CodedError<'VALIDATION'> {
  return error instanceof CodedError && error.code === 'VALIDATION';
}

/**
 * An expected refusal, and the fields that describe it: a member of any
 * hexok `Errors` catalog, LatticeError included, or a hexok `CodedError`
 * VALIDATION. The caller can act on it, so it is not a failure. Whether a
 * client sees it is `toClientError`'s decision.
 */
export function refusal(
  error: unknown,
): { catalog?: unknown; code: unknown } | undefined {
  if (isCodedValidation(error)) return { code: error.code };
  if (!(error instanceof Error) || !(catalogBrand in error)) return undefined;
  return {
    catalog: error[catalogBrand],
    code: 'code' in error ? error.code : undefined,
  };
}

/**
 * The error a client receives. A LatticeError keeps its code, message, data
 * and status. A hexok VALIDATION becomes the protocol VALIDATION. Anything
 * else goes through the app's `map`; what that returns unchanged, ts-pf
 * sends as INTERNAL.
 */
export function toClientError(
  error: unknown,
  map: (error: unknown) => unknown,
): unknown {
  if (LatticeError.is(error)) {
    if (error.code === 'VALIDATION') {
      return new PFError({
        code: error.code,
        message: error.message,
        data: error.data,
        cause: error,
      });
    }
    return new PFError({
      code: error.code,
      message: error.message,
      status: declaredErrors[error.code].status,
      ...('data' in error ? { data: error.data } : {}),
      cause: error,
    });
  }
  if (isCodedValidation(error)) {
    return new PFError({
      code: 'VALIDATION',
      message: error.message,
      data: { issues: toValidationIssues(issuesOf(error.data)) },
      cause: error,
    });
  }
  return map(error);
}

/** The Standard Schema issues in a hexok VALIDATION's `data`. */
function issuesOf(data: unknown): StandardSchemaV1.Issue[] {
  if (typeof data !== 'object' || data === null || !('issues' in data)) {
    return [];
  }
  const { issues } = data;
  return Array.isArray(issues) ? issues.filter(isIssue) : [];
}

function isIssue(value: unknown): value is StandardSchemaV1.Issue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof value.message === 'string' &&
    (!('path' in value) ||
      value.path === undefined ||
      Array.isArray(value.path))
  );
}
