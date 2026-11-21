import type { Logger } from '@hexok/logger';
import { type StandardSchemaV1, UseCase, validate } from 'hexok';
import type { z } from 'zod';
import type { AnyCollection } from './collection.js';
import { invalid, LatticeError, refusal } from './errors.js';

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

/**
 * A Lattice family: a hexok `UseCase.context` factory, its actor schema, and
 * the id of an actor as log lines and the generated events carry it.
 */
export type Family<Actor> = UseCase.ContextFactory<
  FamilyContext<Actor>,
  FamilySpec
> & {
  readonly actor: StandardSchemaV1<unknown, Actor>;
  readonly actorId: (actor: Actor) => string;
};

/**
 * The errors a family has logged: its guards' rejections and what `onCatch`
 * saw. The procedure middleware logs only the refusals no family saw, such as
 * ts-pf's own input check, and skips these. A WeakSet keeps the error object
 * as it is and holds it no longer than the caller.
 */
const logged = new WeakSet<object>();

/** Whether a family has logged `error`. */
export function loggedByFamily(error: unknown): boolean {
  return typeof error === 'object' && error !== null && logged.has(error);
}

/**
 * The logger of one call: `ctx.logger` with the call's collection, action
 * and, once the actor has parsed, its id. Every family log line goes
 * through it, so the fields cannot drift.
 */
function callLogger(
  logger: Logger,
  spec: FamilySpec,
  token: string,
  actorId: string | undefined,
): Logger {
  const { slug } = spec.collection;
  return logger.child({
    collection: slug,
    action: token.startsWith(`${slug}.`) ? token.slice(slug.length + 1) : token,
    ...(actorId === undefined ? {} : { actorId }),
  });
}

/**
 * Logs a thrown value once and records it: info for a refusal, error for
 * anything else. Returns it, so a guard can throw it.
 */
function logThrown(
  log: Logger,
  token: string,
  error: unknown,
  durationMs?: number,
): unknown {
  const timing = durationMs === undefined ? {} : { durationMs };
  const refused = refusal(error);
  if (refused !== undefined) {
    log.info(token, { outcome: 'refused', ...refused, ...timing });
  } else if (error instanceof Error) {
    log.error(error, { outcome: 'failed', ...timing });
  } else {
    log.error(token, { outcome: 'failed', thrown: error, ...timing });
  }
  if (typeof error === 'object' && error !== null) logged.add(error);
  return error;
}

/**
 * Builds the app's one use case family on hexok `UseCase.context`. Before
 * any member's `execute` runs, the actor must parse against `actor` and the
 * input against the member's `input` static. Each call writes one line
 * through a child of `ctx.logger`: info when it returns or a guard or
 * `execute` refuses it, error when it throws anything else.
 */
export function family<A extends StandardSchemaV1>(options: {
  actor: A;
  /** The id the call's log lines and the generated events carry as `actorId`. */
  actorId: (actor: StandardSchemaV1.InferOutput<A>) => string;
}): Family<StandardSchemaV1.InferOutput<A>> {
  const factory = UseCase.context<
    FamilyContext<StandardSchemaV1.InferOutput<A>>,
    FamilySpec
  >()
    // Guards run outside hexok's hooks, so each logs its own rejection.
    .guard(({ ctx, spec, token }) => {
      // The issues describe the caller's credentials, so they stay out of
      // the error and the log.
      if (!validate(options.actor, ctx.actor).ok) {
        const log = callLogger(ctx.logger, spec, token, undefined);
        throw logThrown(log, token, LatticeError.UNAUTHORIZED());
      }
    })
    .guard(({ ctx, spec, token, input }) => {
      // hexok hands execute the caller's input, not the parsed value. So a
      // method's input schema uses no defaults or transforms; a generated use
      // case parses its own input inside execute to strip unknown keys and
      // apply defaults.
      if (spec.input === undefined) return;
      const result = spec.input.safeParse(input);
      if (!result.success) {
        const actorId = options.actorId(ctx.actor);
        const log = callLogger(ctx.logger, spec, token, actorId);
        throw logThrown(log, token, invalid(result.error.issues));
      }
    })
    .hooks({
      preExecute: ({ ctx, spec, token }) => ({
        log: callLogger(ctx.logger, spec, token, options.actorId(ctx.actor)),
        started: performance.now(),
      }),
      postExecute: ({ token }, { log, started }) => {
        log.info(token, { outcome: 'ok', durationMs: since(started) });
      },
      onCatch: ({ ctx, spec, token, error }, state) => {
        // State is undefined only when preExecute itself threw.
        if (state === undefined) {
          logThrown(
            callLogger(ctx.logger, spec, token, undefined),
            token,
            error,
          );
        } else {
          logThrown(state.log, token, error, since(state.started));
        }
      },
    });
  // The generated use cases and the procedure middleware read these, so the
  // app states them once.
  return Object.assign(factory, {
    actor: options.actor,
    actorId: options.actorId,
  });
}

function since(started: number): number {
  return Math.round(performance.now() - started);
}
