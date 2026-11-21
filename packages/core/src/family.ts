import type { Logger } from '@hexok/logger';
import { catalogBrand, type StandardSchemaV1, UseCase, validate } from 'hexok';
import type { z } from 'zod';
import type { AnyCollection } from './collection.js';
import { LatticeError, parse } from './errors.js';

/** The statics every use case in a Lattice family declares. */
export type FamilySpec = {
  readonly collection: AnyCollection;
  readonly input?: z.ZodType;
  readonly output?: z.ZodType;
};

/**
 * The per-call context of a Lattice family. The edge passes
 * `rootLogger.child({ requestId })`; workers and tests pass their own.
 */
export type FamilyContext<Actor> = {
  readonly actor: Actor;
  readonly logger: Logger;
};

/** A Lattice family: a hexok `UseCase.context` factory. */
export type Family<Actor> = UseCase.ContextFactory<
  FamilyContext<Actor>,
  FamilySpec
>;

/**
 * An expected refusal: a member of any hexok `Errors` catalog, LatticeError
 * included. The caller can act on it, so it is not logged as an error.
 */
function refusal(
  error: unknown,
): { catalog: unknown; code: unknown } | undefined {
  if (!(error instanceof Error) || !(catalogBrand in error)) return undefined;
  return {
    catalog: error[catalogBrand],
    code: 'code' in error ? error.code : undefined,
  };
}

/**
 * Builds the app's one use case family on hexok `UseCase.context`. Before
 * any member's `execute` runs, the actor must parse against `actor` and the
 * input against the member's `input` static. Each call that passes them
 * writes one line through a child of `ctx.logger`: info when it returns or
 * refuses, error when it throws anything else.
 */
export function family<A extends StandardSchemaV1>(options: {
  actor: A;
  /** The id the call's log lines carry as `actorId`. */
  actorId: (actor: StandardSchemaV1.InferOutput<A>) => string;
}): Family<StandardSchemaV1.InferOutput<A>> {
  return UseCase.context<
    FamilyContext<StandardSchemaV1.InferOutput<A>>,
    FamilySpec
  >()
    .guard(({ ctx }) => {
      // The issues describe the caller's credentials, so they stay out of
      // the error.
      if (!validate(options.actor, ctx.actor).ok) {
        throw LatticeError.UNAUTHORIZED();
      }
    })
    .guard(({ spec, input }) => {
      // hexok hands execute the caller's input, not the parsed value. So a
      // method's input schema uses no defaults or transforms; a generated use
      // case parses its own input inside execute to strip unknown keys and
      // apply defaults.
      if (spec.input !== undefined) parse(spec.input, input);
    })
    .hooks({
      preExecute: ({ ctx, spec, token }) => {
        const { slug } = spec.collection;
        const action = token.startsWith(`${slug}.`)
          ? token.slice(slug.length + 1)
          : token;
        return {
          log: ctx.logger.child({
            collection: slug,
            action,
            actorId: options.actorId(ctx.actor),
          }),
          started: performance.now(),
        };
      },
      postExecute: ({ token }, { log, started }) => {
        log.info(token, { outcome: 'ok', durationMs: since(started) });
      },
      onCatch: ({ ctx, token, error }, state) => {
        // State is undefined only when preExecute itself threw.
        const log = state?.log ?? ctx.logger;
        const durationMs =
          state === undefined ? undefined : since(state.started);
        const refused = refusal(error);
        if (refused !== undefined) {
          log.info(token, { outcome: 'refused', ...refused, durationMs });
        } else if (error instanceof Error) {
          log.error(error, { outcome: 'failed', durationMs });
        } else {
          log.error(token, { outcome: 'failed', thrown: error, durationMs });
        }
      },
    });
}

function since(started: number): number {
  return Math.round(performance.now() - started);
}
