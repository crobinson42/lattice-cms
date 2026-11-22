import { createRequire } from 'node:module';
import { type Span, SpanStatusCode, trace } from '@opentelemetry/api';
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
export const tracer = trace.getTracer('@latticecms/core', version);

/**
 * Marks `span` as failed by `error`, an unexpected throw: status ERROR, the
 * error's type, and an exception event. A refusal is never marked so.
 */
export function failed(span: Span, error: unknown): void {
  span.setAttributes({
    'lattice.outcome': 'failed',
    'error.type': error instanceof Error ? error.name : typeof error,
  });
  span.recordException(error instanceof Error ? error : String(error));
  span.setStatus({ code: SpanStatusCode.ERROR });
}
