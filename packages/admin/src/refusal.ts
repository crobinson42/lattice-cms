import { isPFError } from '@ts-pf/protocol';
import { isRecord } from './catalog.js';

/** One `VALIDATION` issue: the input path it names, and why. */
export type Issue = {
  readonly path: readonly (string | number)[];
  readonly message: string;
};

/** A failed call, as the admin shows it. */
export type Refusal = {
  readonly code: string;
  readonly message: string;
  readonly issues: readonly Issue[];
  /** The refusal's data, as its declared error describes it. */
  readonly data: unknown;
};

function issuesOf(data: unknown): Issue[] {
  if (!isRecord(data) || !Array.isArray(data.issues)) return [];
  return data.issues.flatMap((issue): Issue[] => {
    if (!isRecord(issue) || typeof issue.message !== 'string') return [];
    const path = Array.isArray(issue.path)
      ? issue.path.filter(
          (key): key is string | number =>
            typeof key === 'string' || typeof key === 'number',
        )
      : [];
    return [{ path, message: issue.message }];
  });
}

/** What went wrong: the server's code, message and issues, or the throw's. */
export function refusalOf(error: unknown): Refusal {
  if (isPFError(error)) {
    return {
      code: error.code,
      message: error.message,
      issues: issuesOf(error.data),
      data: error.data,
    };
  }
  return {
    code: 'INTERNAL',
    message: error instanceof Error ? error.message : String(error),
    issues: [],
    data: undefined,
  };
}

/** The issues whose path starts with `prefix`. */
export function issuesUnder(
  issues: readonly Issue[],
  prefix: readonly (string | number)[],
): Issue[] {
  return issues.filter((issue) =>
    prefix.every((key, index) => issue.path[index] === key),
  );
}

/** A refusal's issues whose path starts with `prefix`. */
export function issuesAt(
  refusal: Refusal | undefined,
  ...prefix: (string | number)[]
): Issue[] {
  return issuesUnder(refusal?.issues ?? [], prefix);
}
