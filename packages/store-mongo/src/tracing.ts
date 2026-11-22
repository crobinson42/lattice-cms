import { createRequire } from 'node:module';
import { LatticeError } from '@latticecms/core';
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { z } from 'zod';

// The package's own version, read from its package.json at runtime, so the
// tracer's version never drifts from the release. src/ and dist/ both sit
// one level below it.
const { version } = z
  .object({ version: z.string() })
  .parse(createRequire(import.meta.url)('../package.json'));

/**
 * The package's tracer. With no OpenTelemetry SDK registered it is the
 * API's no-op, so tracing costs nothing until an app registers one.
 */
export const tracer = trace.getTracer('@latticecms/store-mongo', version);

/**
 * Runs `work` as one database client span, `{operation} {collection}`, with
 * OpenTelemetry's database attributes. No query text: a Mongo filter has no
 * parameters, so its text would carry the values it matches. A failure is
 * status ERROR with its type, and no exception event: a driver's message
 * can quote a document's values, such as a duplicate key.
 */
export function traced<T>(
  database: string,
  operation: string,
  collection: string | undefined,
  work: () => Promise<T>,
): Promise<T> {
  const name =
    collection === undefined ? operation : `${operation} ${collection}`;
  return tracer.startActiveSpan(
    name,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        'db.system.name': 'mongodb',
        'db.namespace': database,
        'db.operation.name': operation,
        ...(collection === undefined
          ? {}
          : { 'db.collection.name': collection }),
      },
    },
    async (span) => {
      try {
        return await work();
      } catch (error) {
        const type = LatticeError.is(error)
          ? String(error.code)
          : error instanceof Error
            ? error.name
            : typeof error;
        span.setAttribute('error.type', type);
        span.setStatus({ code: SpanStatusCode.ERROR, message: type });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}
