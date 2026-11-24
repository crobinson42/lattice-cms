/**
 * Ends a command: 1 for a refusal or a failure, 2 for a usage error. The
 * message is the `lattice: <why>` line on stderr. `details` goes to stdout
 * after it, such as the lines a refused edit would have added.
 */
export class Exit extends Error {
  constructor(
    message: string,
    readonly code: 1 | 2,
    readonly details = '',
  ) {
    super(message);
  }
}

/** Whether `value` is a plain object, as JSON parses one. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
